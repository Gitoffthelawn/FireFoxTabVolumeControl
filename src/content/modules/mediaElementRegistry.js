/**
 * MediaElementRegistry - Tracks media elements and applies the current
 * volume to them as they appear or start playing.
 */

class MediaElementRegistry {
  constructor(volumeController, audioManager) {
    this.mediaElements = new Set();
    this.playListenerAttached = new WeakSet();
    this.volumeController = volumeController;
    this.audioManager = audioManager;
  }

  registerMediaElement(element) {
    if (!(element instanceof HTMLMediaElement) || this.mediaElements.has(element)) {
      return;
    }

    this.mediaElements.add(element);
    this.volumeController.applyVolumeToElement(element);

    // Re-apply on play: elements skipped while paused pick up the volume
    // here. Attached once per element ever - an element can be untracked
    // and re-registered (SPAs re-parent players), and listeners would
    // otherwise accumulate. No cleanup on 'ended'/'error' - sites like
    // Reddit fire these during normal operation and the element may play
    // again.
    if (!this.playListenerAttached.has(element)) {
      this.playListenerAttached.add(element);
      element.addEventListener('play', () => {
        this.volumeController.applyVolumeToElement(element);
      });
    }
  }

  hasElements() {
    return this.mediaElements.size > 0;
  }

  /**
   * Stop tracking an element. Never disconnects its Web Audio source node -
   * that would permanently break the element's audio.
   */
  cleanupMediaElement(element) {
    this.audioManager.cleanupAudioSource(element);
    this.mediaElements.delete(element);
  }

  /**
   * Drop elements that are no longer in the DOM.
   */
  cleanupOrphanedElements() {
    for (const element of [...this.mediaElements]) {
      if (!element.isConnected) {
        this.cleanupMediaElement(element);
      }
    }
  }

  applyToAllElements(applyFunction) {
    this.mediaElements.forEach(element => {
      if (!element.paused) {
        applyFunction(element);
      }
    });
  }
}
