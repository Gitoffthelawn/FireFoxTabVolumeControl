/**
 * MediaScanner - Finds media elements and feeds them to the registry.
 *
 * Discovery paths, cheapest first:
 *   1. A capturing 'play' listener - catches anything that actually plays
 *      in the light DOM ('play' does not cross shadow boundaries).
 *   2. A MutationObserver on the document - registers added audio/video
 *      immediately and marks the page dirty for the next full scan.
 *   3. The same observer attached to every open shadow root found by a
 *      full scan - document-level observation can't see inside shadow
 *      roots, so each one is observed individually.
 *   4. A periodic full scan, skipped while nothing changed - the initial
 *      sweep and the safety net that discovers new shadow roots.
 */

class MediaScanner {
  constructor(mediaRegistry) {
    this.mediaRegistry = mediaRegistry;
    this.mutationObserver = null;
    this.observedShadowRoots = new WeakSet();
    this.needsScan = true;
  }

  /**
   * Run a full scan only if the DOM changed since the last one.
   */
  scanIfPageChanged() {
    if (this.needsScan) {
      this.scanForMediaElements();
    }
  }

  scanForMediaElements() {
    this.needsScan = false;

    document.querySelectorAll('audio, video').forEach(element => {
      this.mediaRegistry.registerMediaElement(element);
    });

    this.scanShadowDOMElements();
    this.mediaRegistry.cleanupOrphanedElements();
  }

  /**
   * Walk open shadow roots for media, and start observing each root found
   * so media injected into it later (invisible to the document observer,
   * and whose 'play' events don't compose across the boundary) still
   * registers immediately.
   */
  scanShadowDOMElements() {
    document.querySelectorAll('*').forEach(element => {
      const root = element.shadowRoot;
      if (!root) return;

      root.querySelectorAll('audio, video').forEach(shadowElement => {
        this.mediaRegistry.registerMediaElement(shadowElement);
      });

      if (this.mutationObserver && !this.observedShadowRoots.has(root)) {
        this.mutationObserver.observe(root, { childList: true, subtree: true });
        this.observedShadowRoots.add(root);
      }
    });
  }

  setupObservers() {
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          this.registerSubtree(node);
          // Only element churn warrants a rescan; text-node updates
          // (tickers, chats, clocks) can't introduce media or shadow roots.
          this.needsScan = true;
        }

        if (this.mediaRegistry.hasElements()) {
          for (const node of mutation.removedNodes) {
            this.cleanupSubtree(node);
          }
        }
      }
    });

    this.mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    document.addEventListener('play', (event) => {
      this.mediaRegistry.registerMediaElement(event.target);
    }, true);
  }

  /**
   * Register a just-added element and any media inside it.
   */
  registerSubtree(node) {
    this.mediaRegistry.registerMediaElement(node);
    node.querySelectorAll('audio, video').forEach(element => {
      this.mediaRegistry.registerMediaElement(element);
    });
  }

  /**
   * Untrack a just-removed element and any media inside it.
   */
  cleanupSubtree(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    this.mediaRegistry.cleanupMediaElement(node);
    node.querySelectorAll('audio, video').forEach(element => {
      this.mediaRegistry.cleanupMediaElement(element);
    });
  }
}
