/**
 * Shared application state — a global signal-based store.
 * Used to verify that state persists across page navigations.
 */
import { signal } from 'thane';

/** Global visit counter — incremented every time a page mounts. */
export const visitCount = signal(0);

/** Simple shared message — pages can read/write this. */
export const sharedMessage = signal('initial');
