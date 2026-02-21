import { defineComponent, signal } from 'thane';

/**
 * A child component that deliberately holds a reference to a large buffer
 * AND subscribes a signal — so we can prove both:
 *  1. The subscription array keeps the closure alive (preventing GC)
 *  2. The large buffer held by the closure leaks visibly in memory
 *
 * In production the "leak" per child would be the signal subscriber arrays
 * and any closures they retain.  We exaggerate with a 1 MB buffer so the
 * leak is unmistakable in a heap snapshot or the performance monitor.
 */
export const LeakyChild = defineComponent('leaky-child', () => {
  // ── 1 MB buffer that the closure captures ──
  const _leak = new ArrayBuffer(1024 * 1024); // 1 MB per child instance

  // ── A signal whose subscriber list is never cleaned up ──
  const tick = signal(0);

  // Interval that keeps ticking — onDestroy should clear it, but
  // the parent's destroy() never calls the child's onDestroy.
  let intervalId: ReturnType<typeof setInterval> | undefined;

  return {
    template: html`<span data-testid="leaky-child">child:${tick()}</span>`,

    onMount: () => {
      intervalId = setInterval(() => tick(tick() + 1), 100);
    },

    onDestroy: () => {
      // This NEVER fires when the *parent* is destroyed.
      clearInterval(intervalId);
      console.log('🧹 LeakyChild.onDestroy — cleared interval (you should NOT see this when parent is destroyed)');
    },
  };
});
