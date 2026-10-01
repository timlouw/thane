import { signal } from 'thane';
import { expose } from './expose.js';

/** Store signals that list rows subscribe to (the destroyRows and hiddenRows probes). The spec counts their live subscribers. */
export const destroyRowsTick = signal(0);
export const hiddenRowsTick = signal(0);

expose('store', { destroyRowsTick, hiddenRowsTick });
