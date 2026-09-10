/**
 * MediaElementRegistry - Tracks media elements and applies the current
 * volume to them as they appear or start playing.
 */

class MediaElementRegistry {
  constructor(volumeController, audioManager) {
    this.mediaElements = new Set();
    this.playListenerAttached = new WeakSet();
    this.everPlayed = new WeakSet(); // elements that fired 'play' at least once
    this.volumeController = volumeController;
    this.audioManager = audioManager;
    // Called whenever the answer to getAmplificationStatus() may have
    // changed; content.js forwards the status to the background.
    this.onStatusChange = null;
  }

  /**
   * Whether any tracked element that has actually played is stuck on the
   * HTML5 volume path, and why. Elements that never played (preloaded
   * videos, ads waiting in the wings) don't count, and null is returned
   * while nothing qualifies, so a momentary gap between players does not
   * flip the popup back and forth.
   */
  getAmplificationStatus() {
    let counted = 0;
    for (const element of this.mediaElements) {
      if (!this.everPlayed.has(element)) continue;
      counted++;
      const reason = this.audioManager.amplificationBlockReason(element);
      if (reason) return { limited: true, reason };
    }
    return counted > 0 ? { limited: false, reason: null } : null;
  }

  announceStatus() {
    if (this.onStatusChange) this.onStatusChange();
  }

  registerMediaElement(element) {
    if (!(element instanceof HTMLMediaElement) || this.mediaElements.has(element)) {
      return;
    }

    this.mediaElements.add(element);
    if (!element.isConnected) {
      // Only reachable through the page-level play() hook; worth a trace.
      console.debug('Tab Volume Control: registered detached media element', element);
    }
    if (!element.paused) this.everPlayed.add(element); // found mid-playback
    this.volumeController.applyVolumeToElement(element);
    this.announceStatus();

    // Re-apply on play: elements skipped while paused pick up the volume
    // here. Attached once per element ever - an element can be untracked
    // and re-registered (SPAs re-parent players), and listeners would
    // otherwise accumulate. No cleanup on 'ended'/'error' - sites like
    // Reddit fire these during normal operation and the element may play
    // again.
    if (!this.playListenerAttached.has(element)) {
      this.playListenerAttached.add(element);
      element.addEventListener('play', () => {
        this.everPlayed.add(element);
        this.volumeController.applyVolumeToElement(element);
        this.announceStatus();
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
    if (this.mediaElements.delete(element)) this.announceStatus();
  }

  /**
   * Drop elements that are not in the DOM and not playing.
   *
   * Removing a media element from its document pauses it, so a detached
   * element that is still playing was never inserted (SoundCloud's player,
   * found through the page-level play() hook) and must stay tracked. Once
   * such an element pauses it can be dropped: the hook re-registers it the
   * next time the page calls play().
   */
  cleanupOrphanedElements() {
    for (const element of [...this.mediaElements]) {
      if (!element.isConnected && element.paused) {
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
