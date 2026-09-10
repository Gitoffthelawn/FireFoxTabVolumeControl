/**
 * Firefox Tab Volume Control - Popup Script
 *
 * Renders the master control and per-tab volume list, and relays changes
 * to the background script (which owns all volume state).
 */

import { CONFIG, AMPLIFICATION_LIMITS, formatPresetLabel } from './config.js';
import themeManager from './themeManager.js';

const send = (action, extra = {}) => browser.runtime.sendMessage({ action, ...extra });

const el = {
  masterSlider: document.getElementById('masterVolumeSlider'),
  masterDisplay: document.getElementById('masterVolumeDisplay'),
  tabList: document.getElementById('tabList'),
  applyToAllBtn: document.getElementById('applyToAllBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  resetBtn: document.getElementById('resetBtn')
};

let tabs = [];
let masterVolume = CONFIG.VOLUMES.DEFAULT;
let applyInFlight = false; // an Apply-to-All is awaiting the background
let loadSeq = 0;           // discards out-of-order tab-list responses

// ---------------------------------------------------------------------------
// Rendering

/**
 * CSS modifier class for a volume level (muted/low/normal/high).
 */
function volumeClass(volume) {
  if (volume === 0) return CONFIG.CLASSES.VOLUME_MUTED;
  if (volume <= CONFIG.VOLUME_THRESHOLDS.LOW) return CONFIG.CLASSES.VOLUME_LOW;
  if (volume > CONFIG.VOLUME_THRESHOLDS.HIGH) return CONFIG.CLASSES.VOLUME_HIGH;
  return CONFIG.CLASSES.VOLUME_NORMAL;
}

/**
 * Write a volume value into a "NNN%" display element, updating its
 * level-modifier class.
 */
function setVolumeDisplay(display, volume, baseClass) {
  display.textContent = `${volume}%`;
  display.className = `${baseClass} ${volumeClass(volume)}`;
}

function findTab(tabId) {
  return tabs.find(tab => tab.id === tabId);
}

/**
 * Upper bound of a tab's slider: tabs whose media cannot be routed through
 * Web Audio stop at 100%.
 */
function maxVolumeFor(tab) {
  return tab.canAmplify === false ? CONFIG.VOLUMES.MAX_NATIVE : CONFIG.VOLUMES.MAX;
}

/**
 * The volume the tab actually plays at. A stored value above the tab's
 * ceiling (e.g. a remembered 500% on a site that cannot be amplified) has
 * no effect, so the badge shows the ceiling rather than the stored number.
 */
function effectiveVolume(tab) {
  return Math.min(tab.volume, maxVolumeFor(tab));
}

function showNoAudioMessage() {
  el.tabList.innerHTML = `
    <div class="no-audio">
      No tabs with audio detected.<br>
      Start playing media to see volume controls.
    </div>
  `;
}

/**
 * Stamp the master control's slider range, labels, and preset buttons from
 * CONFIG so popup.html never drifts from the values the per-tab rows use.
 */
function initMasterControl() {
  el.masterSlider.min = CONFIG.VOLUMES.MIN;
  el.masterSlider.max = CONFIG.VOLUMES.MAX;
  el.masterSlider.value = masterVolume;

  const [minLabel, maxLabel] = document.querySelectorAll('.master-control .volume-label');
  minLabel.textContent = `${CONFIG.VOLUMES.MIN}%`;
  maxLabel.textContent = `${CONFIG.VOLUMES.MAX}%`;

  document.querySelectorAll('.master-control .preset-btn').forEach((btn, i) => {
    const preset = CONFIG.VOLUMES.PRESETS[i];
    if (preset === undefined) return;
    btn.dataset.volume = preset;
    btn.textContent = formatPresetLabel(preset);
  });
}

/**
 * Rebuild the tab list from scratch.
 */
function renderTabList() {
  if (tabs.length === 0) {
    showNoAudioMessage();
    return;
  }

  el.tabList.innerHTML = '';
  tabs.forEach(tab => el.tabList.appendChild(createTabElement(tab)));
}

/**
 * Build one tab row: header (favicon/title/volume), slider, presets, and
 * the per-site remember checkbox.
 */
function createTabElement(tab) {
  const tabDiv = document.createElement('div');
  tabDiv.className = 'tab-item';
  if (tab.active) tabDiv.classList.add('tab-item-active');

  // Static markup only; all tab-derived values are set through DOM
  // properties below, so nothing needs HTML escaping.
  tabDiv.innerHTML = `
    <div class="tab-header">
      <img class="tab-favicon" alt="">
      <span class="tab-title"></span>
      <span class="tab-volume-display"></span>
    </div>
    <div class="volume-container">
      <div class="volume-slider-container">
        <span class="volume-label"></span>
        <input type="range" class="volume-slider">
        <span class="volume-label"></span>
      </div>
      <div class="preset-buttons"></div>
    </div>
  `;

  tabDiv.querySelector('.tab-favicon').src = tab.favIconUrl || CONFIG.UI.DEFAULT_FAVICON;

  const title = tabDiv.querySelector('.tab-title');
  title.textContent = tab.title;
  title.title = tab.title;

  const display = tabDiv.querySelector('.tab-volume-display');
  setVolumeDisplay(display, effectiveVolume(tab), 'tab-volume-display');

  const maxVolume = maxVolumeFor(tab);
  const limitText = AMPLIFICATION_LIMITS[tab.amplificationLimit] || AMPLIFICATION_LIMITS['rejected'];

  const [minLabel, maxLabel] = tabDiv.querySelectorAll('.volume-label');
  minLabel.textContent = `${CONFIG.VOLUMES.MIN}%`;
  maxLabel.textContent = `${maxVolume}%`;

  const slider = tabDiv.querySelector('.volume-slider');
  slider.min = CONFIG.VOLUMES.MIN;
  slider.max = maxVolume;
  slider.value = tab.volume;
  slider.dataset.tabId = tab.id;
  slider.addEventListener('input', () => {
    setTabVolume(tab.id, parseInt(slider.value, 10), slider, display);
  });

  const presetContainer = tabDiv.querySelector('.preset-buttons');
  for (const preset of CONFIG.VOLUMES.PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = formatPresetLabel(preset);
    if (preset > maxVolume) {
      btn.disabled = true;
      btn.title = limitText;
    }
    btn.addEventListener('click', () => {
      slider.value = preset;
      setTabVolume(tab.id, preset, slider, display);
    });
    presetContainer.appendChild(btn);
  }

  if (tab.canAmplify === false) {
    const note = document.createElement('div');
    note.className = 'amplify-note';
    note.textContent = 'Amplification not available on this site';
    note.title = limitText;
    tabDiv.querySelector('.volume-container').appendChild(note);
  }

  if (tab.hostname) {
    const label = document.createElement('label');
    label.className = 'remember-site';
    label.title = `Save this volume for ${tab.hostname} across browser restarts`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'remember-checkbox';
    checkbox.checked = !!tab.remembered;
    checkbox.addEventListener('change', () => toggleRememberSite(tab.id, checkbox));

    const text = document.createElement('span');
    text.className = 'remember-label';
    text.textContent = `Remember for ${tab.hostname}`;

    label.append(checkbox, text);
    tabDiv.querySelector('.volume-container').appendChild(label);
  }

  return tabDiv;
}

/**
 * Update slider positions and volume displays of the existing list in place,
 * so mid-interaction state (slider drag, checkbox focus) isn't destroyed.
 */
function updateTabListInPlace() {
  el.tabList.querySelectorAll('.volume-slider').forEach(slider => {
    const tab = findTab(parseInt(slider.dataset.tabId, 10));
    if (!tab) return;

    slider.value = tab.volume;
    const display = slider.closest('.tab-item').querySelector('.tab-volume-display');
    setVolumeDisplay(display, effectiveVolume(tab), 'tab-volume-display');
  });
}

function updateMasterDisplay() {
  setVolumeDisplay(el.masterDisplay, masterVolume, 'volume-display');
}

// ---------------------------------------------------------------------------
// Actions

/**
 * Fetch the tab list from the background and render it. Silent reloads
 * (triggered by background notifications) skip the loading placeholder and,
 * when the set of tabs is unchanged, update the existing rows in place
 * instead of rebuilding the DOM under the user.
 */
async function loadAudioTabs({ silent = false } = {}) {
  if (applyInFlight) return;
  const seq = ++loadSeq;

  try {
    if (!silent) {
      el.tabList.innerHTML = '<div class="loading">Loading audio tabs...</div>';
    }

    const response = await send('getTabAudioStatus');
    if (seq !== loadSeq) return; // a newer load superseded this one

    if (response?.tabs) {
      const sameTabs = response.tabs.length === tabs.length &&
        response.tabs.every((t, i) =>
          t.id === tabs[i].id &&
          t.title === tabs[i].title &&
          t.remembered === tabs[i].remembered &&
          t.canAmplify === tabs[i].canAmplify
        );
      tabs = response.tabs;

      if (silent && sameTabs) {
        updateTabListInPlace();
      } else {
        renderTabList();
      }
    } else if (!silent) {
      showNoAudioMessage();
    }
  } catch (error) {
    console.error('Failed to load audio tabs:', error);
    if (!silent) showNoAudioMessage();
  }
}

/**
 * Send one tab's new volume to the background, updating the row
 * optimistically and reverting it if the message fails.
 */
async function setTabVolume(tabId, volume, slider, display) {
  setVolumeDisplay(display, volume, 'tab-volume-display');

  try {
    await send('setVolume', { tabId, volume });
    const tab = findTab(tabId);
    if (tab) tab.volume = volume;
  } catch (error) {
    console.error('Failed to update tab volume:', error);
    const tab = findTab(tabId);
    if (tab) {
      slider.value = tab.volume;
      setVolumeDisplay(display, tab.volume, 'tab-volume-display');
    }
  }
}

async function toggleRememberSite(tabId, checkbox) {
  try {
    await send(checkbox.checked ? 'rememberSite' : 'forgetSite', { tabId });
    const tab = findTab(tabId);
    if (tab) tab.remembered = checkbox.checked;
  } catch (error) {
    console.error('Failed to update site preference:', error);
    checkbox.checked = findTab(tabId)?.remembered ?? false;
  }
}

function setMasterVolume(volume) {
  masterVolume = volume;
  el.masterSlider.value = volume;
  updateMasterDisplay();
}

/**
 * Apply the master volume to all listed tabs: optimistic in-place update,
 * then reconcile with the background's actual state once it has finished.
 * Notification-driven reloads are held off only while the request is
 * genuinely in flight.
 */
async function applyMasterToAllTabs() {
  applyInFlight = true;
  tabs.forEach(tab => { tab.volume = masterVolume; });
  updateTabListInPlace();

  try {
    await send('applyToAllTabs', { volume: masterVolume });
  } catch (error) {
    console.error('Failed to apply master volume to all tabs:', error);
  } finally {
    applyInFlight = false;
  }

  loadAudioTabs({ silent: true });
}

async function resetAllTabs() {
  try {
    // The background responds only after every tab is reset, so the state
    // is already consistent when this resolves.
    await send('resetAllTabs');
    setMasterVolume(CONFIG.VOLUMES.DEFAULT);
    loadAudioTabs({ silent: true });
  } catch (error) {
    console.error('Failed to reset all tabs:', error);
  }
}

// ---------------------------------------------------------------------------
// Wiring

function setupEventListeners() {
  browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'audioStatusChanged') {
      loadAudioTabs({ silent: true });
    }
  });

  el.masterSlider.addEventListener('input', () => {
    masterVolume = parseInt(el.masterSlider.value, 10);
    updateMasterDisplay();
  });

  document.querySelectorAll('.master-control .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setMasterVolume(parseInt(btn.dataset.volume, 10));
    });
  });

  el.applyToAllBtn.addEventListener('click', applyMasterToAllTabs);
  el.refreshBtn.addEventListener('click', () => loadAudioTabs());
  el.resetBtn.addEventListener('click', resetAllTabs);
}

async function init() {
  try {
    await themeManager.init();
    initMasterControl();
    updateMasterDisplay();
    setupEventListeners();
    await loadAudioTabs();
  } catch (error) {
    console.error('Failed to initialize popup:', error);
  }
}

init();
