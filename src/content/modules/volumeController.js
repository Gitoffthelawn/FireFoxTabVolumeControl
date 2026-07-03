/**
 * VolumeController - Decides how to apply a volume to each media element:
 * Web Audio gain when the element can be routed, native HTML5 volume as
 * fallback (e.g. cross-origin media that Web Audio would silence).
 */

class VolumeController {
  constructor(audioManager) {
    this.audioManager = audioManager;
    this.currentVolume = DEFAULT_VOLUME;
    this.html5Adjusted = new WeakSet(); // elements whose native volume we changed
  }

  applyVolumeToElement(element, volume = this.currentVolume) {
    if (volume === DEFAULT_VOLUME) {
      if (this.audioManager.hasSource(element)) {
        this.audioManager.setGainValue(volume);
      } else if (this.html5Adjusted.has(element)) {
        // Undo an earlier fallback adjustment.
        this.html5Adjusted.delete(element);
        element.volume = 1;
      }
      // Untouched element at default volume: leave the browser alone.
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

    if (this.audioManager.tryConnectToAudioContext(element)) {
      // A late joiner must pick up the current gain - a fresh GainNode
      // starts at 1.0 regardless of the tab's chosen volume.
      this.audioManager.setGainValue(volume);
    } else {
      this._applyHtml5Fallback(element, volume);
    }
  }

  _applyHtml5Fallback(element, volume) {
    // HTML5 volume property maxes out at 1.0; clamp amplification.
    element.volume = Math.min(volume, VOLUME_SCALE) / VOLUME_SCALE;
    this.html5Adjusted.add(element);
  }

  /**
   * Apply a new volume to every registered media element.
   */
  setVolume(volume, mediaRegistry) {
    this.currentVolume = volume;

    mediaRegistry.applyToAllElements((element) => {
      this.applyVolumeToElement(element, volume);
    });

    this.audioManager.setGainValue(volume);
  }
}
