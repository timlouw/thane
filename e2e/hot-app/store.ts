import { signal } from 'thane';

// A module that is not a component file: when it changes, it runs again (its signals keep their values),
// and so does the component file that imports it
export const clicks = signal(0);
export const step = 1;
