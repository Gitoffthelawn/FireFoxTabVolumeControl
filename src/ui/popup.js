/**
 * Firefox Tab Volume Control - Popup Script
 * Manages the popup interface for controlling tab volumes
 */

import PopupController from './classes/PopupController.js';

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const popupController = new PopupController();
  popupController.init();
});
