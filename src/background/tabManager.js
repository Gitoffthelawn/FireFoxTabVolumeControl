/**
 * Firefox Tab Volume Control - Tab Manager
 *
 * Owns per-tab and per-site volume state.
 *
 * Persistence:
 *   - storage.session: per-tab volume + hostname. Survives background script
 *     suspension within a session; cleared on browser restart, which matches
 *     the lifetime of tab IDs.
 *   - storage.local:   per-hostname "remembered" volume. Survives restarts.
 */

class TabManager {
  constructor() {
    this.tabVolumes = new Map();      // tabId -> volume
    this.audioTabs = new Set();        // tabIds that are/were audible
    this.tabHostnames = new Map();     // tabId -> hostname
    this.tabRemovalTimeouts = new Map();
    this.sitePrefs = {};               // hostname -> volume

    this.DEFAULT_VOLUME = 100;
    this.REMOVAL_DELAY = 3000;
    this.PERSIST_DEBOUNCE = 250;

    this._persistTabsTimer = null;
    this._persistSitePrefsTimer = null;

    this.handleTabUpdated = this.handleTabUpdated.bind(this);
    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.handleTabActivated = this.handleTabActivated.bind(this);

    this.ready = this._loadFromStorage()
      .then(() => this._pruneStaleEntries())
      .then(() => this._applyRememberedToOpenTabs());
    this._setupEventListeners();
  }

  /**
   * On startup, walk every open tab and apply any matching site preference.
   * Covers the case where the browser restored tabs from cache without
   * firing tabs.onUpdated, so handleUrlChange never ran for them.
   * Tabs that already have a stored volume from this session are left alone.
   */
  async _applyRememberedToOpenTabs() {
    try {
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        if (!tab.url) continue;
        const hostname = this._hostnameOf(tab.url);
        if (!hostname) continue;

        if (!this.tabHostnames.has(tab.id)) {
          this.tabHostnames.set(tab.id, hostname);
        }

        if (hostname in this.sitePrefs && !this.tabVolumes.has(tab.id)) {
          this._applyVolume(tab.id, this.sitePrefs[hostname]);
        }
      }
    } catch (error) {
      console.warn('Tab Volume Control: failed to apply remembered sites on startup', error);
    }
  }

  /**
   * Drop persisted tab entries whose tabs are no longer open. Runs once at
   * startup so the background script reloading after suspension doesn't carry
   * forward dead tab IDs.
   */
  async _pruneStaleEntries() {
    try {
      const tabs = await browser.tabs.query({});
      const liveIds = new Set(tabs.map(t => t.id));
      let changed = false;

      for (const tabId of [...this.tabVolumes.keys()]) {
        if (!liveIds.has(tabId)) { this.tabVolumes.delete(tabId); changed = true; }
      }
      for (const tabId of [...this.tabHostnames.keys()]) {
        if (!liveIds.has(tabId)) { this.tabHostnames.delete(tabId); changed = true; }
      }
      for (const tabId of [...this.audioTabs]) {
        if (!liveIds.has(tabId)) { this.audioTabs.delete(tabId); changed = true; }
      }

      if (changed) this._schedulePersistTabs();
    } catch (error) {
      console.warn('Tab Volume Control: prune failed', error);
    }
  }

  async _loadFromStorage() {
    try {
      const session = await browser.storage.session.get(['tabVolumes', 'tabHostnames']);
      if (session.tabVolumes) {
        this.tabVolumes = new Map(
          Object.entries(session.tabVolumes).map(([k, v]) => [parseInt(k, 10), v])
        );
      }
      if (session.tabHostnames) {
        this.tabHostnames = new Map(
          Object.entries(session.tabHostnames).map(([k, v]) => [parseInt(k, 10), v])
        );
      }
      const local = await browser.storage.local.get('sitePrefs');
      this.sitePrefs = local.sitePrefs || {};
    } catch (error) {
      console.warn('Tab Volume Control: failed to load persisted state', error);
    }
  }

  _schedulePersistTabs() {
    clearTimeout(this._persistTabsTimer);
    this._persistTabsTimer = setTimeout(() => this._persistTabs(), this.PERSIST_DEBOUNCE);
  }

  async _persistTabs() {
    try {
      await browser.storage.session.set({
        tabVolumes: Object.fromEntries(this.tabVolumes),
        tabHostnames: Object.fromEntries(this.tabHostnames)
      });
    } catch (error) {
      console.warn('Tab Volume Control: failed to persist tab state', error);
    }
  }

  _schedulePersistSitePrefs() {
    clearTimeout(this._persistSitePrefsTimer);
    this._persistSitePrefsTimer = setTimeout(() => this._persistSitePrefs(), this.PERSIST_DEBOUNCE);
  }

  async _persistSitePrefs() {
    try {
      await browser.storage.local.set({ sitePrefs: this.sitePrefs });
    } catch (error) {
      console.warn('Tab Volume Control: failed to persist site prefs', error);
    }
  }

  _setupEventListeners() {
    browser.tabs.onUpdated.addListener(this.handleTabUpdated);
    browser.tabs.onRemoved.addListener(this.handleTabRemoved);
    browser.tabs.onActivated.addListener(this.handleTabActivated);
  }

  /**
   * Extract a normalized "site" key from a URL. Strips common generic
   * subdomain prefixes (www, m, mobile) so e.g. youtube.com,
   * www.youtube.com, and m.youtube.com all share one preference.
   * Does not attempt eTLD+1 collapsing — that would require the Public
   * Suffix List to handle ccTLDs like bbc.co.uk correctly.
   */
  _hostnameOf(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname.replace(/^(?:www|m|mobile)\./, '');
    } catch {
      return null;
    }
  }

  async _ensureHostname(tabId) {
    if (this.tabHostnames.has(tabId)) return this.tabHostnames.get(tabId);
    try {
      const tab = await browser.tabs.get(tabId);
      const hostname = tab?.url ? this._hostnameOf(tab.url) : null;
      if (hostname) {
        this.tabHostnames.set(tabId, hostname);
        this._schedulePersistTabs();
      }
      return hostname;
    } catch {
      return null;
    }
  }

  getTabVolume(tabId) {
    if (tabId === undefined || tabId === null) return this.DEFAULT_VOLUME;
    return this.tabVolumes.get(tabId) ?? this.DEFAULT_VOLUME;
  }

  /**
   * Apply a volume internally without touching site prefs. Used both for the
   * external setTabVolume API and for auto-applying remembered volumes on
   * navigation.
   */
  _applyVolume(tabId, volume) {
    this.tabVolumes.set(tabId, volume);
    browser.tabs.sendMessage(tabId, { action: 'setVolume', volume }).catch(() => {});
    this._schedulePersistTabs();
  }

  async setTabVolume(tabId, volume) {
    await this.ready;
    this._applyVolume(tabId, volume);

    const hostname = await this._ensureHostname(tabId);
    if (hostname && hostname in this.sitePrefs && this.sitePrefs[hostname] !== volume) {
      // Slider moved on a remembered site → update the saved value.
      this.sitePrefs[hostname] = volume;
      this._schedulePersistSitePrefs();
    }
  }

  async getAudioTabStatus() {
    await this.ready;

    const [tabs, activeTabs] = await Promise.all([
      browser.tabs.query({}),
      browser.tabs.query({ active: true, currentWindow: true })
    ]);
    const activeTabId = activeTabs[0]?.id;

    const result = tabs
      .filter(tab => this.audioTabs.has(tab.id) || tab.audible || tab.id === activeTabId)
      .map(tab => {
        const hostname = this.tabHostnames.get(tab.id) || (tab.url ? this._hostnameOf(tab.url) : null);
        return {
          id: tab.id,
          title: tab.title,
          volume: this.getTabVolume(tab.id),
          favIconUrl: tab.favIconUrl,
          audible: tab.audible || false,
          active: tab.id === activeTabId,
          hostname,
          remembered: hostname ? hostname in this.sitePrefs : false
        };
      });

    // Pin the active tab to the top so users can pre-set volume.
    result.sort((a, b) => Number(b.active) - Number(a.active));
    return result;
  }

  async applyToAllTabs(volume) {
    await this.ready;
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs
        .filter(tab => this.audioTabs.has(tab.id) || tab.audible)
        .map(tab => this.setTabVolume(tab.id, volume))
    );
  }

  async resetAllTabs() {
    await this.applyToAllTabs(this.DEFAULT_VOLUME);
  }

  async setSitePreference(tabId) {
    await this.ready;
    const hostname = await this._ensureHostname(tabId);
    if (!hostname) return false;
    this.sitePrefs[hostname] = this.getTabVolume(tabId);
    this._schedulePersistSitePrefs();
    this.notifyPopupUpdate();
    return true;
  }

  async removeSitePreference(tabId) {
    await this.ready;
    const hostname = await this._ensureHostname(tabId);
    if (!hostname || !(hostname in this.sitePrefs)) return false;
    delete this.sitePrefs[hostname];
    this._schedulePersistSitePrefs();
    this.notifyPopupUpdate();
    return true;
  }

  notifyPopupUpdate() {
    browser.runtime.sendMessage({ action: 'audioStatusChanged' }).catch(() => {});
  }

  handleTabUpdated(tabId, changeInfo) {
    if (changeInfo.audible !== undefined) {
      if (changeInfo.audible) {
        this._handleAudibleStarted(tabId);
      } else {
        this.handleAudioStopped(tabId);
      }
    }

    if (changeInfo.url) {
      this.handleUrlChange(tabId, changeInfo.url);
    }
  }

  /**
   * Tab just started making sound. By now the content script is guaranteed
   * to be loaded (audio doesn't play before scripts run). This is our reliable
   * sync point: ensure the content script is using the correct volume,
   * including auto-adopting a remembered site preference if we haven't yet.
   */
  async _handleAudibleStarted(tabId) {
    await this.ready;
    this.audioTabs.add(tabId);

    if (this.tabRemovalTimeouts.has(tabId)) {
      clearTimeout(this.tabRemovalTimeouts.get(tabId));
      this.tabRemovalTimeouts.delete(tabId);
    }

    let hostname = this.tabHostnames.get(tabId);
    if (!hostname) {
      hostname = await this._ensureHostname(tabId);
    }

    if (hostname && hostname in this.sitePrefs && !this.tabVolumes.has(tabId)) {
      // First time hearing audio from this tab — adopt the saved volume.
      this._applyVolume(tabId, this.sitePrefs[hostname]);
    } else {
      // Re-push the canonical volume in case the content script is out of
      // sync (e.g. its initial pull happened before the URL-change handler
      // had set the volume).
      const volume = this.getTabVolume(tabId);
      browser.tabs.sendMessage(tabId, { action: 'setVolume', volume }).catch(() => {});
    }

    this.notifyPopupUpdate();
  }

  async handleAudioStopped(tabId) {
    if (!this.audioTabs.has(tabId)) return;
    if (this.tabRemovalTimeouts.has(tabId)) return;

    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id === tabId) return; // active tab keeps its slot
    } catch {}

    const timeoutId = setTimeout(async () => {
      this.tabRemovalTimeouts.delete(tabId);
      try {
        const tab = await browser.tabs.get(tabId);
        if (!tab.audible && this.audioTabs.has(tabId)) {
          this.audioTabs.delete(tabId);
          this.notifyPopupUpdate();
        }
      } catch {
        this.audioTabs.delete(tabId);
        this.notifyPopupUpdate();
      }
    }, this.REMOVAL_DELAY);

    this.tabRemovalTimeouts.set(tabId, timeoutId);
  }

  async handleUrlChange(tabId, newUrl) {
    await this.ready;
    const hostname = this._hostnameOf(newUrl);
    if (!hostname) return;

    const previousHostname = this.tabHostnames.get(tabId);
    this.tabHostnames.set(tabId, hostname);
    this._schedulePersistTabs();

    if (previousHostname === hostname) return;

    // Hostname change: prefer a remembered volume, otherwise reset to default.
    const newVolume = hostname in this.sitePrefs ? this.sitePrefs[hostname] : this.DEFAULT_VOLUME;
    if (this.tabVolumes.get(tabId) !== newVolume) {
      this._applyVolume(tabId, newVolume);
      this.notifyPopupUpdate();
    }
  }

  handleTabRemoved(tabId) {
    this.tabVolumes.delete(tabId);
    this.tabHostnames.delete(tabId);

    if (this.tabRemovalTimeouts.has(tabId)) {
      clearTimeout(this.tabRemovalTimeouts.get(tabId));
      this.tabRemovalTimeouts.delete(tabId);
    }

    const wasAudioTab = this.audioTabs.has(tabId);
    this.audioTabs.delete(tabId);

    this._schedulePersistTabs();

    if (wasAudioTab) this.notifyPopupUpdate();
  }

  async handleTabActivated(activeInfo) {
    if (this.tabRemovalTimeouts.has(activeInfo.tabId)) {
      clearTimeout(this.tabRemovalTimeouts.get(activeInfo.tabId));
      this.tabRemovalTimeouts.delete(activeInfo.tabId);
    }

    // Schedule removal for now-inactive non-audible audio tabs.
    try {
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        if (tab.id === activeInfo.tabId) continue;
        if (this.audioTabs.has(tab.id) && !tab.audible && !this.tabRemovalTimeouts.has(tab.id)) {
          const timeoutId = setTimeout(() => {
            this.tabRemovalTimeouts.delete(tab.id);
            if (this.audioTabs.has(tab.id)) {
              this.audioTabs.delete(tab.id);
              this.notifyPopupUpdate();
            }
          }, this.REMOVAL_DELAY);
          this.tabRemovalTimeouts.set(tab.id, timeoutId);
        }
      }
    } catch {}

    // Active tab changed → popup needs to re-render with new pinned tab.
    this.notifyPopupUpdate();
  }
}
