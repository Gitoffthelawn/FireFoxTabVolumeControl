/**
 * Main Popup Controller class that orchestrates all popup functionality
 */
import PopupState from './PopupState.js';
import UIManager from './UIManager.js';
import MessageHandler from './MessageHandler.js';
import MasterVolumeManager from './MasterVolumeManager.js';
import TabListManager from './TabListManager.js';
import { CONFIG } from '../config.js';

class PopupController {
  constructor() {
    this.state = new PopupState();
    this.uiManager = new UIManager();
    this.messageHandler = new MessageHandler(this);
    this.masterVolumeManager = new MasterVolumeManager(this.state, this.uiManager, this.messageHandler);
    this.tabListManager = new TabListManager(this.state, this.uiManager, this.messageHandler);
  }

  /**
   * Initialize popup interface
   */
  async init() {
    try {
      // Initialize UI components
      this.uiManager.initializeElements();
      this.uiManager.initializeMasterVolumeSlider();
      this.uiManager.updateVolumeLabels();
      this.uiManager.updatePresetButtons();
      
      // Initialize theme manager
      await this.uiManager.initializeTheme();

      // Set up event listeners
      this.setupEventListeners();
      
      // Load audio tabs
      await this.loadAudioTabs();
    } catch (error) {
      console.error('Failed to initialize popup:', error);
    }
  }

  /**
   * Set up all event listeners
   */
  setupEventListeners() {
    // Set up message listeners
    this.messageHandler.setupMessageListeners();
    
    // Set up master volume listeners
    this.masterVolumeManager.setupEventListeners();
    
    // Set up state change listeners for reactive UI updates
    this.setupStateListeners();
    
    // Control buttons
    this.uiManager.getElement('applyToAllBtn').addEventListener('click', () => {
      this.masterVolumeManager.applyToAllTabs().then(() => {
        this.tabListManager.updateDisplay();
      });
    });
    
    this.uiManager.getElement('refreshBtn').addEventListener('click', () => {
      this.loadAudioTabs();
    });
    
    this.uiManager.getElement('resetBtn').addEventListener('click', () => {
      this.masterVolumeManager.resetAllTabs().then(() => {
        setTimeout(() => this.loadAudioTabs(), CONFIG.TIMING.REFRESH_DELAY);
      });
    });
  }

  /**
   * Set up state change event listeners for reactive UI updates
   */
  setupStateListeners() {
    // Listen for master volume changes
    this.state.addEventListener('masterVolumeChanged', (event) => {
      this.masterVolumeManager.updateDisplay();
    });

    // Listen for tab volume changes
    this.state.addEventListener('volumeChanged', (event) => {
      if (event.type === 'bulk') {
        // Bulk update - refresh entire tab list display
        this.tabListManager.updateDisplay();
      } else {
        // Single tab update - could optimize to update just that tab
        this.tabListManager.updateDisplay();
      }
    });

    // Listen for tabs list changes
    this.state.addEventListener('tabsChanged', (event) => {
      // Re-render the tab list when tabs change
      this.tabListManager.render();
    });

    // Listen for state resets
    this.state.addEventListener('stateReset', (event) => {
      // Re-initialize UI after state reset
      this.masterVolumeManager.updateDisplay();
      this.tabListManager.render();
    });
  }

  /**
   * Load audio tabs from background script.
   * @param {Object} [options]
   * @param {boolean} [options.silent] - Skip the "Loading..." placeholder.
   *   Used for live refreshes triggered by background notifications, so the
   *   list doesn't flicker mid-interaction (slider drag, checkbox toggle).
   */
  async loadAudioTabs({ silent = false } = {}) {
    try {
      if (this.state.wasJustApplied()) {
        return;
      }

      if (!silent) {
        this.uiManager.showLoadingMessage();
      }

      const response = await this.messageHandler.getTabAudioStatus();

      if (response?.tabs) {
        this.state.setAudioTabs(response.tabs);
        await this.tabListManager.syncTabVolumes();
        this.tabListManager.render();
      } else if (!silent) {
        this.uiManager.showNoAudioMessage();
      }
    } catch (error) {
      console.error('Failed to load audio tabs:', error);
      if (!silent) this.uiManager.showNoAudioMessage();
    }
  }
}

export default PopupController;
