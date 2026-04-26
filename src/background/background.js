/**
 * Firefox Tab Volume Control - Background Script
 * Routes messages from popup and content scripts to TabManager.
 *
 * tabManager.js is loaded ahead of this file via the manifest scripts array,
 * so the TabManager class is available globally here.
 */

const tabManager = new TabManager();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId ?? sender.tab?.id;

  switch (message.action) {
    case 'setVolume':
      if (tabId && message.volume !== undefined) {
        tabManager.setTabVolume(tabId, message.volume).then(() => {
          sendResponse({ success: true });
        });
        return true;
      }
      sendResponse({ error: 'Missing tabId or volume' });
      break;

    case 'getVolume':
      if (tabId) {
        sendResponse({ volume: tabManager.getTabVolume(tabId) });
      } else {
        sendResponse({ error: 'No tab ID provided' });
      }
      break;

    case 'getTabAudioStatus':
      tabManager.getAudioTabStatus().then(tabs => sendResponse({ tabs }));
      return true;

    case 'applyToAllTabs':
      tabManager.applyToAllTabs(message.volume).then(() => sendResponse({ success: true }));
      return true;

    case 'resetAllTabs':
      tabManager.resetAllTabs().then(() => sendResponse({ success: true }));
      return true;

    case 'rememberSite':
      if (tabId !== undefined) {
        tabManager.setSitePreference(tabId).then(success => sendResponse({ success }));
        return true;
      }
      sendResponse({ error: 'No tab ID provided' });
      break;

    case 'forgetSite':
      if (tabId !== undefined) {
        tabManager.removeSitePreference(tabId).then(success => sendResponse({ success }));
        return true;
      }
      sendResponse({ error: 'No tab ID provided' });
      break;

    default:
      sendResponse({ error: 'Unknown action' });
      break;
  }
});
