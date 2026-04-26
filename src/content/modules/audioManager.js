/**
 * AudioManager - Handles Web Audio API operations for volume amplification
 */

import { VOLUME_MAX } from './constants.js';

class AudioManager {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.connectedElements = new Set();
    this.blockedSites = new Set();
    this.blockedElements = new WeakSet();
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

  isSiteBlocked() {
    return this.blockedSites.has(window.location.hostname.toLowerCase());
  }

  markSiteAsBlocked() {
    this.blockedSites.add(window.location.hostname.toLowerCase());
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
   * Try to route element through Web Audio. Once routed, never disconnect:
   * disconnecting a MediaElementAudioSourceNode permanently kills audio for
   * that element.
   */
  tryConnectToAudioContext(element) {
    if (!this.audioContext || !this.gainNode) return false;
    if (this.connectedElements.has(element)) return true;

    if (element._audioSource) {
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
      this.connectedElements.add(element);
      element._audioSource = source;
      return true;
    } catch (e) {
      this.blockedElements.add(element);
      return false;
    }
  }

  setGainValue(volume) {
    if (this.gainNode && !this.isSiteBlocked() && this.connectedElements.size > 0) {
      this.gainNode.gain.value = volume / VOLUME_MAX;
    }
  }

  isAmplificationAvailable() {
    return !this.isSiteBlocked() && (this.audioContext || this.initAudioContext());
  }

  /**
   * Stop tracking an element without disconnecting its source node.
   * The audio routing remains intact — disconnecting would kill playback.
   */
  cleanupAudioSource(element) {
    this.connectedElements.delete(element);
  }

  reset() {
    this.blockedSites.clear();
    this.blockedElements = new WeakSet();

    // Closing the AudioContext is the only safe way to fully clean up;
    // disconnecting individual source nodes would break audio permanently.
    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
      this.gainNode = null;
    }

    this.connectedElements.clear();
  }

  getConnectedElementsCount() {
    return this.connectedElements.size;
  }
}

export default AudioManager;
