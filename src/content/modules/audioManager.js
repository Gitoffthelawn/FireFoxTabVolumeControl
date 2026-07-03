/**
 * AudioManager - Routes media elements through Web Audio for amplification.
 */

class AudioManager {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.routedElements = new WeakSet();  // ever routed through createMediaElementSource
    this.connectedElements = new Set();
    this.blockedElements = new WeakSet(); // elements Web Audio rejected
  }

  initAudioContext() {
    if (this.audioContext) return true;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
      return true;
    } catch (error) {
      console.warn('Tab Volume Control: AudioContext unavailable', error);
      return false;
    }
  }

  /**
   * Cross-origin media cannot be routed through Web Audio without CORS,
   * so we detect that up front and fall back to native HTML5 volume.
   */
  isCrossOriginElement(element) {
    if (element.crossOrigin === null && element.currentSrc) {
      try {
        if (new URL(element.currentSrc).origin !== window.location.origin) {
          return true;
        }
      } catch {
        return true;
      }
    }

    const sources = [
      element.src,
      element.currentSrc,
      element.querySelector('source')?.src
    ].filter(Boolean);

    if (sources.length === 0) return false;

    try {
      return sources.some(src => {
        if (src.startsWith('blob:') || src.startsWith('data:')) return false;
        return new URL(src).origin !== window.location.origin;
      });
    } catch {
      return true;
    }
  }

  shouldBlockAmplification(element) {
    if (this.blockedElements.has(element)) return true;
    return this.isCrossOriginElement(element);
  }

  /**
   * Whether the element was ever routed through Web Audio.
   */
  hasSource(element) {
    return this.routedElements.has(element);
  }

  /**
   * Try to route element through Web Audio. Once routed, never disconnect:
   * disconnecting a MediaElementAudioSourceNode permanently kills audio for
   * that element.
   */
  tryConnectToAudioContext(element) {
    if (!this.audioContext || !this.gainNode) return false;
    if (this.connectedElements.has(element)) return true;

    if (this.routedElements.has(element)) {
      // Already routed previously, re-track without reconnecting.
      this.connectedElements.add(element);
      return true;
    }

    if (this.shouldBlockAmplification(element)) {
      return false;
    }

    try {
      const source = this.audioContext.createMediaElementSource(element);
      source.connect(this.gainNode);
      this.routedElements.add(element);
      this.connectedElements.add(element);
      return true;
    } catch {
      this.blockedElements.add(element);
      return false;
    }
  }

  setGainValue(volume) {
    if (this.gainNode && this.connectedElements.size > 0) {
      this.gainNode.gain.value = volume / VOLUME_SCALE;
    }
  }

  /**
   * Stop tracking an element without disconnecting its source node.
   * The audio routing remains intact - disconnecting would kill playback.
   */
  cleanupAudioSource(element) {
    this.connectedElements.delete(element);
  }
}
