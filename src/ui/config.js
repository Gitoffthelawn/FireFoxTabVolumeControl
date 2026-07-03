/**
 * Configuration constants for the popup UI.
 *
 * VOLUMES.DEFAULT is a cross-context invariant: it must match
 * TabManager.DEFAULT_VOLUME (src/background/tabManager.js) and
 * DEFAULT_VOLUME (src/content/modules/constants.js).
 */
export const CONFIG = {
  VOLUMES: { MIN: 0, MAX: 500, DEFAULT: 100, PRESETS: [0, 50, 100, 200, 500] },
  VOLUME_THRESHOLDS: { LOW: 50, HIGH: 150 },
  UI: { DEFAULT_FAVICON: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23ccc"/></svg>' },
  CLASSES: { VOLUME_NORMAL: 'volume-normal', VOLUME_LOW: 'volume-low', VOLUME_HIGH: 'volume-high', VOLUME_MUTED: 'volume-muted' }
};

/**
 * Format a volume percentage as a compact preset label.
 * Expressed as a multiplier: "0x", "0.5x", "1x", "2x", "5x".
 * @param {number} volume - Volume percentage
 * @returns {string} Button label
 */
export function formatPresetLabel(volume) {
  return `${volume / 100}x`;
}

