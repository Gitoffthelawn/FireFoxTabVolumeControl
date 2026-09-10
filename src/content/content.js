/**
 * Firefox Tab Volume Control - Content Script
 *
 * Entry point; the module files listed before this one in manifest.json
 * provide the classes. Everything is constructed synchronously at
 * document_start, so the message listener is live before the background
 * or popup can talk to us - no "not loaded yet" window.
 */

const SCAN_INTERVAL = 5000;
const INITIAL_SCAN_DELAY = 1000;

const audioManager = new AudioManager();
const volumeController = new VolumeController(audioManager);
const mediaRegistry = new MediaElementRegistry(volumeController, audioManager);
const mediaScanner = new MediaScanner(mediaRegistry);

// Wrap the page's play() before any page script can run (we are at
// document_start), so media the page never attaches to the DOM still
// reaches the registry. See pageHooks.js.
installPageHooks(mediaRegistry, audioManager, volumeController);

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'setVolume':
      if (message.volume !== undefined) {
        volumeController.setVolume(message.volume, mediaRegistry);
        sendResponse({ success: true });
      }
      break;

    case 'getVolume':
      sendResponse({ volume: volumeController.currentVolume });
      break;
  }
});

async function initialize() {
  // Pull the persisted volume from the background. A push may have happened
  // before this content script existed (navigation, remembered site), so the
  // pull ensures we start at the right volume regardless.
  try {
    const response = await browser.runtime.sendMessage({ action: 'getVolume' });
    if (response?.volume !== undefined) {
      volumeController.setVolume(response.volume, mediaRegistry);
    }
  } catch {}

  mediaScanner.setupObservers();
  setTimeout(() => mediaScanner.scanForMediaElements(), INITIAL_SCAN_DELAY);
  setInterval(() => mediaScanner.scanIfPageChanged(), SCAN_INTERVAL);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
