/**
 * Shared constants for the content scripts.
 *
 * Content scripts are listed in manifest.json and load in order into one
 * shared scope, so everything defined here is visible to the other files.
 */

// Volume values are percentages; 100 = native volume.
// DEFAULT_VOLUME is a cross-context invariant: it must match
// TabManager.DEFAULT_VOLUME (src/background/tabManager.js) and
// CONFIG.VOLUMES.DEFAULT (src/ui/config.js). The content script treats
// exactly this value as "leave the page's media alone".
const DEFAULT_VOLUME = 100;
const VOLUME_SCALE = 100;
