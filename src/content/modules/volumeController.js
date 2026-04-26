/**
 * VolumeController - Handles volume application logic and coordination
 */

import { VOLUME_MAX, VOLUME_AMPLIFICATION_THRESHOLD, DEFAULT_VOLUME } from './constants.js';

class VolumeController {
  constructor(audioManager) {
    this.audioManager = audioManager;
    this.currentVolume = DEFAULT_VOLUME;
  }

  /**
   * Apply volume to a specific media element.
   */
  applyVolumeToElement(element, volume = this.currentVolume) {
    // Default volume on a never-connected element: leave the browser alone.
    if (volume === DEFAULT_VOLUME && !element._audioSource) {
      return;
    }

    // Already routed through Web Audio: just update gain, don't reconnect.
    if (element._audioSource && volume === DEFAULT_VOLUME) {
      if (this.audioManager.audioContext && this.audioManager.gainNode) {
        this.audioManager.setGainValue(volume);
      }
      return;
    }

    if (this.audioManager.shouldBlockAmplification(element)) {
      this._applyHtml5Fallback(element, volume);
      return;
    }

    if (!this.audioManager.audioContext && !this.audioManager.initAudioContext()) {
      this._applyHtml5Fallback(element, volume);
      return;
    }

    const connected = this.audioManager.tryConnectToAudioContext(element);
    if (!connected) {
      this._applyHtml5Fallback(element, volume);
    }
  }

  _applyHtml5Fallback(element, volume) {
    // HTML5 volume property maxes out at 1.0; clamp amplification.
    const clampedVolume = Math.min(volume, VOLUME_AMPLIFICATION_THRESHOLD);
    element.volume = clampedVolume / VOLUME_MAX;
  }

  /**
   * Apply a new volume to every registered media element.
   */
  setVolume(volume, mediaRegistry) {
    this.currentVolume = volume;

    const hasConnectedElements = this.audioManager.getConnectedElementsCount() > 0;
    if (volume === DEFAULT_VOLUME && !hasConnectedElements) {
      return;
    }

    if (mediaRegistry) {
      mediaRegistry.applyToAllElements((element) => {
        this.applyVolumeToElement(element, volume);
      });
    }

    if (!this.audioManager.isSiteBlocked() && this.audioManager.getConnectedElementsCount() > 0) {
      this.audioManager.setGainValue(volume);
    }
  }

  getCurrentVolume() {
    return this.currentVolume;
  }

  isAmplificationAvailable() {
    return this.audioManager.isAmplificationAvailable();
  }

  isSiteBlocked() {
    return this.audioManager.isSiteBlocked();
  }

  reset(defaultVolume = DEFAULT_VOLUME) {
    this.currentVolume = defaultVolume;
  }
}

export default VolumeController;
