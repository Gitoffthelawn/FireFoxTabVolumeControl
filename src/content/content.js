/**
 * Firefox Tab Volume Control - Content Script
 * Loads modules and wires up the per-tab volume pipeline.
 */

const SCAN_INTERVAL = 5000;
const INITIAL_SCAN_DELAY = 1000;

let audioManager;
let mediaRegistry;
let volumeController;
let mediaScanner;
let navigationHandler;
let modulesLoaded = false;

async function initializeModules() {
  const baseUrl = browser.runtime.getURL('src/content/modules/');

  const [
    AudioManager,
    MediaElementRegistry,
    VolumeController,
    MediaScanner,
    NavigationHandler
  ] = await Promise.all([
    import(baseUrl + 'audioManager.js').then(m => m.default),
    import(baseUrl + 'mediaElementRegistry.js').then(m => m.default),
    import(baseUrl + 'volumeController.js').then(m => m.default),
    import(baseUrl + 'mediaScanner.js').then(m => m.default),
    import(baseUrl + 'navigationHandler.js').then(m => m.default)
  ]);

  audioManager = new AudioManager();
  volumeController = new VolumeController(audioManager);
  mediaRegistry = new MediaElementRegistry(volumeController);
  mediaScanner = new MediaScanner(mediaRegistry);
  navigationHandler = new NavigationHandler(audioManager, mediaRegistry, volumeController, mediaScanner);

  modulesLoaded = true;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!modulesLoaded) {
    sendResponse({ error: 'Modules not loaded yet' });
    return;
  }

  switch (message.action) {
    case 'setVolume':
      if (message.volume !== undefined) {
        volumeController.setVolume(message.volume, mediaRegistry);
        sendResponse({ success: true });
      }
      break;

    case 'getVolume':
      sendResponse({ volume: volumeController.getCurrentVolume() });
      break;

    case 'checkForAudio':
      mediaScanner.scanForMediaElements();
      mediaRegistry.cleanupOrphanedElements();
      sendResponse({
        hasAudio: mediaRegistry.getMediaElementsCount() > 0,
        canAmplify: volumeController.isAmplificationAvailable(),
        siteBlocked: volumeController.isSiteBlocked()
      });
      break;

    case 'checkAmplification':
      sendResponse({
        canAmplify: volumeController.isAmplificationAvailable(),
        siteBlocked: volumeController.isSiteBlocked()
      });
      break;
  }
});

async function initialize() {
  try {
    await initializeModules();
  } catch (error) {
    console.error('Tab Volume Control: failed to initialize modules', error);
    return;
  }

  // Pull persisted volume from background. The background may have already
  // tried to push it (e.g. via "remember site" on URL change) before our
  // message listener was ready, in which case that push was dropped. This
  // pull ensures we pick up the right starting volume regardless.
  try {
    const response = await browser.runtime.sendMessage({ action: 'getVolume' });
    if (response?.volume !== undefined) {
      volumeController.setVolume(response.volume, mediaRegistry);
    }
  } catch {}

  mediaScanner.setupObservers();
  setTimeout(() => mediaScanner.scanForMediaElements(), INITIAL_SCAN_DELAY);
  setInterval(() => mediaScanner.scanForMediaElements(), SCAN_INTERVAL);

  navigationHandler.startNavigationMonitoring();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
