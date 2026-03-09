import { defineComponent, signal } from 'thane';

/**
 * Child component that tracks its onDestroy lifecycle.
 * Exposes side-effects visible to the parent via window globals
 * so Playwright can observe them.
 */

type DestroyTrackerProps = {
  trackerId: string;
};

export const DestroyTracker = defineComponent<DestroyTrackerProps>('destroy-tracker', ({ props }) => {
  const label = signal(props.trackerId ?? 'unknown');

  // Register this instance in the global tracker
  const win = window as any;
  if (!win.__destroyLog) win.__destroyLog = [];
  if (!win.__activeTrackers) win.__activeTrackers = new Set();
  win.__activeTrackers.add(props.trackerId);

  // Start a repeating interval to prove it's alive (and leaks if not cleaned up)
  const intervalId = setInterval(() => {
    if (!win.__intervalTicks) win.__intervalTicks = {};
    win.__intervalTicks[props.trackerId] = (win.__intervalTicks[props.trackerId] || 0) + 1;
  }, 50);

  return {
    template: html`<span data-testid="tracker-label">${label()}</span>`,
    onDestroy: () => {
      clearInterval(intervalId);
      win.__destroyLog.push(props.trackerId);
      win.__activeTrackers.delete(props.trackerId);
    },
  };
});
