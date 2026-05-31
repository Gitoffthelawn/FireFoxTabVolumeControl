/**
 * Tab List Manager class for individual tab management
 */
import { CONFIG, formatPresetLabel } from '../config.js';

class TabListManager {
  constructor(state, uiManager, messageHandler) {
    this.state = state;
    this.uiManager = uiManager;
    this.messageHandler = messageHandler;
  }

  /**
   * Render the list of audio tabs.
   */
  render() {
    const tabs = this.state.getAudioTabs();

    if (tabs.length === 0) {
      this.uiManager.showNoAudioMessage();
      return;
    }

    this.uiManager.clearTabList();
    const tabList = this.uiManager.getElement('tabList');

    tabs.forEach(tab => {
      tabList.appendChild(this.createTabElement(tab));
    });
  }

  /**
   * Update slider values + volume display for the existing tab list, in place.
   * Used when only volumes change so we don't destroy slider/checkbox state.
   */
  updateDisplay() {
    const tabItems = this.uiManager.getElement('tabList').querySelectorAll('.tab-item');

    tabItems.forEach(tabDiv => {
      const slider = tabDiv.querySelector('.volume-slider');
      const tabVolumeDisplay = tabDiv.querySelector('.tab-volume-display');

      if (slider && tabVolumeDisplay) {
        const tabId = parseInt(slider.getAttribute('data-tab-id'));
        const tab = this.state.findTab(tabId);

        if (tab) {
          slider.value = tab.volume;
          tabVolumeDisplay.textContent = `${tab.volume}%`;
          tabVolumeDisplay.className = `tab-volume-display ${this.uiManager.getVolumeClass(tab.volume)}`;
        }
      }
    });
  }

  createTabElement(tab) {
    const tabDiv = document.createElement('div');
    tabDiv.className = 'tab-item';
    if (tab.active) tabDiv.classList.add('tab-item-active');

    const volumeClass = this.uiManager.getVolumeClass(tab.volume);
    const favicon = tab.favIconUrl || CONFIG.UI.DEFAULT_FAVICON;
    const presetButtons = CONFIG.VOLUMES.PRESETS.map(preset => {
      const label = formatPresetLabel(preset);
      return `<button class="preset-btn" data-tab-id="${tab.id}" data-volume="${preset}">${label}</button>`;
    }).join('');

    const rememberControl = tab.hostname
      ? `
        <label class="remember-site" title="Save this volume for ${this._escape(tab.hostname)} across browser restarts">
          <input type="checkbox" class="remember-checkbox" data-tab-id="${tab.id}" ${tab.remembered ? 'checked' : ''}>
          <span class="remember-label">Remember for ${this._escape(tab.hostname)}</span>
        </label>
      `
      : '';

    tabDiv.innerHTML = `
      <div class="tab-header">
        <img class="tab-favicon" src="${favicon}" alt="">
        <span class="tab-title" title="${this._escape(tab.title)}">${this._escape(tab.title)}</span>
        <span class="tab-volume-display ${volumeClass}">${tab.volume}%</span>
      </div>
      <div class="volume-container">
        <div class="volume-slider-container">
          <span class="volume-label">${CONFIG.VOLUMES.MIN}%</span>
          <input type="range" class="volume-slider" min="${CONFIG.VOLUMES.MIN}" max="${CONFIG.VOLUMES.MAX}" value="${tab.volume}" data-tab-id="${tab.id}">
          <span class="volume-label">${CONFIG.VOLUMES.MAX}%</span>
        </div>
        <div class="preset-buttons">${presetButtons}</div>
        ${rememberControl}
      </div>
    `;

    this.setupTabEvents(tabDiv, tab);
    return tabDiv;
  }

  setupTabEvents(tabDiv, tab) {
    const slider = tabDiv.querySelector('.volume-slider');
    const tabVolumeDisplay = tabDiv.querySelector('.tab-volume-display');

    slider.addEventListener('input', (e) => {
      const volume = parseInt(e.target.value);
      this.updateTabVolume(tab.id, volume, tabVolumeDisplay);
    });

    tabDiv.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const volume = parseInt(e.target.getAttribute('data-volume'));
        slider.value = volume;
        this.updateTabVolume(tab.id, volume, tabVolumeDisplay);
      });
    });

    const rememberCheckbox = tabDiv.querySelector('.remember-checkbox');
    if (rememberCheckbox) {
      rememberCheckbox.addEventListener('change', (e) => {
        this.toggleRememberSite(tab.id, e.target.checked);
      });
    }
  }

  async updateTabVolume(tabId, volume, tabVolumeDisplay) {
    try {
      tabVolumeDisplay.textContent = `${volume}%`;
      tabVolumeDisplay.className = `tab-volume-display ${this.uiManager.getVolumeClass(volume)}`;

      await this.messageHandler.setTabVolume(tabId, volume);
      this.state.updateTabVolume(tabId, volume);
    } catch (error) {
      console.error('Failed to update tab volume:', error);

      const currentTab = this.state.findTab(tabId);
      if (currentTab) {
        tabVolumeDisplay.textContent = `${currentTab.volume}%`;
        tabVolumeDisplay.className = `tab-volume-display ${this.uiManager.getVolumeClass(currentTab.volume)}`;

        const slider = tabVolumeDisplay.closest('.tab-item').querySelector('.volume-slider');
        if (slider) slider.value = currentTab.volume;
      }
    }
  }

  async toggleRememberSite(tabId, remember) {
    try {
      if (remember) {
        await this.messageHandler.rememberSite(tabId);
      } else {
        await this.messageHandler.forgetSite(tabId);
      }
      // Reflect new state without round-tripping through the full reload path.
      this.state.updateTabRemembered(tabId, remember);
    } catch (error) {
      console.error('Failed to update site preference:', error);
      // Revert checkbox if the call failed.
      const currentTab = this.state.findTab(tabId);
      const checkbox = document.querySelector(`.remember-checkbox[data-tab-id="${tabId}"]`);
      if (checkbox && currentTab) checkbox.checked = currentTab.remembered ?? false;
    }
  }

  /**
   * Sync tab volumes by querying the background script
   */
  async syncTabVolumes() {
    const tabs = this.state.getAudioTabs();
    const volumePromises = tabs.map(async (tab) => {
      try {
        const response = await this.messageHandler.getTabVolume(tab.id);
        if (response?.volume !== undefined) {
          this.state.updateTabVolume(tab.id, response.volume);
        }
      } catch (error) {
        // Background script communication error — non-fatal.
      }
    });

    await Promise.all(volumePromises);
  }

  _escape(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export default TabListManager;
