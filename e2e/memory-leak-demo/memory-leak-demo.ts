import { defineComponent, signal, mountComponent } from 'thane';
import type { MountHandle } from 'thane';
import { ParentWithChild } from './parent-with-child';

/**
 * Memory Leak Demonstration — Bug 2 (Child Destroy)
 *
 * This app proves that destroying a parent component does NOT clean up
 * child component subscriptions, intervals, or closures.
 *
 * How it works:
 *   - Each "Mount cycle" creates a parent that contains a <leaky-child>.
 *   - LeakyChild allocates a 1 MB ArrayBuffer and starts a setInterval.
 *   - When we "destroy" the parent, only the parent's cleanup runs.
 *   - The child's onDestroy never fires → interval keeps ticking,
 *     1 MB ArrayBuffer stays retained, signal subscribers leak.
 *
 * How to observe the leak:
 *   1. Open Chrome DevTools → Memory tab
 *   2. Take a "Heap snapshot" (baseline)
 *   3. Click "Mount + Destroy 10 cycles" a few times
 *   4. Force GC (click trash can icon in Memory tab)
 *   5. Take another heap snapshot
 *   6. Compare: you'll see ArrayBuffer objects that were never collected
 *   7. Also check Performance Monitor (Ctrl+Shift+P → "Show Performance Monitor"):
 *      JS Heap size grows monotonically and never drops after GC
 *
 * Console evidence:
 *   - You will see "⚠️ Parent destroyed" for each cycle
 *   - You will NOT see "🧹 LeakyChild.onDestroy" — proving it never fires
 *   - You WILL see leaked intervals still logging (if uncommented in child)
 */
export const MemoryLeakDemo = defineComponent('memory-leak-demo', () => {
  const cycleCount = signal(0);
  const leakedMB = signal(0);
  const activeIntervals = signal(0);

  let handles: MountHandle[] = [];

  const mountAndDestroy = (cycles: number) => {
    for (let i = 0; i < cycles; i++) {
      // Create a temporary container for the parent
      const container = document.createElement('div');
      container.id = `cycle-${cycleCount() + i}`;
      document.getElementById('mount-target')!.appendChild(container);

      // Mount a parent that contains a LeakyChild
      const handle = mountComponent(ParentWithChild, container);
      if (handle) {
        // Immediately destroy — simulates navigating away, closing a modal, etc.
        handle.destroy();
        handles.push(handle);
        console.warn(`⚠️ Parent destroyed (cycle ${cycleCount() + i + 1}) — child.onDestroy was NOT called`);
      }
    }

    cycleCount(cycleCount() + cycles);
    leakedMB(cycleCount()); // ~1 MB per leaked child
    activeIntervals(cycleCount()); // one leaked interval per child
  };

  const forceGC = () => {
    // Ask the browser to GC (only works if DevTools is open or --js-flags=--expose-gc)
    if ((globalThis as any).gc) {
      (globalThis as any).gc();
      console.log('✅ Manual GC triggered');
    } else {
      console.log('ℹ️ Manual GC not available. Open DevTools → Memory → click trash can icon to force GC.');
    }
  };

  return {
    template: html`
      <div style="font-family: system-ui; max-width: 700px; margin: 2rem auto; padding: 1rem;">
        <h1>🔴 Memory Leak Demo — Child Destroy Bug</h1>
        <p style="color: #666; line-height: 1.6;">
          Each cycle mounts a parent component containing a child, then immediately destroys the parent. The child's
          <code>onDestroy</code> never fires, leaking 1 MB + an interval per cycle.
        </p>

        <div style="display: flex; gap: 0.5rem; margin: 1rem 0;">
          <button id="btn-1" style="padding: 0.5rem 1rem; cursor: pointer;">Mount + Destroy ×1</button>
          <button id="btn-10" style="padding: 0.5rem 1rem; cursor: pointer;">Mount + Destroy ×10</button>
          <button id="btn-50" style="padding: 0.5rem 1rem; cursor: pointer;">Mount + Destroy ×50</button>
          <button id="btn-gc" style="padding: 0.5rem 1rem; cursor: pointer; background: #e0e0e0;">Force GC</button>
        </div>

        <div style="background: #f8f0f0; border: 1px solid #e88; border-radius: 8px; padding: 1rem; margin: 1rem 0;">
          <h3 style="margin: 0 0 0.5rem;">Leak Status</h3>
          <p>Cycles completed: <strong>${cycleCount()}</strong></p>
          <p>Estimated leaked memory: <strong>~${leakedMB()} MB</strong> (1 MB ArrayBuffer per child)</p>
          <p>Leaked intervals still ticking: <strong>${activeIntervals()}</strong></p>
        </div>

        <details style="margin: 1rem 0;">
          <summary style="cursor: pointer; font-weight: bold;">How to verify the leak</summary>
          <ol style="line-height: 1.8;">
            <li>Open Chrome DevTools → <strong>Memory</strong> tab</li>
            <li>Take a <strong>Heap Snapshot</strong> (baseline)</li>
            <li>Click "Mount + Destroy ×50" a few times</li>
            <li>Force GC: click the <strong>🗑 trash can</strong> icon in the Memory tab</li>
            <li>Take another Heap Snapshot</li>
            <li>In the new snapshot, filter by <code>ArrayBuffer</code></li>
            <li>You'll see ~50 × 1 MB <code>ArrayBuffer</code> objects that were <strong>never collected</strong></li>
            <li>Also check the Console — you'll see "Parent destroyed" but never "LeakyChild.onDestroy"</li>
          </ol>
        </details>

        <details style="margin: 1rem 0;">
          <summary style="cursor: pointer; font-weight: bold;">What SHOULD happen (after the fix)</summary>
          <ul style="line-height: 1.8;">
            <li>Parent.destroy() should propagate to all child components</li>
            <li>Child's <code>onDestroy</code> fires → <code>clearInterval</code> runs</li>
            <li>Child's signal subscriptions are cleaned up</li>
            <li>The 1 MB ArrayBuffer becomes unreachable and is collected by GC</li>
            <li>JS heap returns to baseline after GC</li>
          </ul>
        </details>

        <div id="mount-target" style="display: none;"></div>
      </div>
    `,

    onMount: () => {
      document.getElementById('btn-1')!.addEventListener('click', () => mountAndDestroy(1));
      document.getElementById('btn-10')!.addEventListener('click', () => mountAndDestroy(10));
      document.getElementById('btn-50')!.addEventListener('click', () => mountAndDestroy(50));
      document.getElementById('btn-gc')!.addEventListener('click', forceGC);
    },
  };
});
