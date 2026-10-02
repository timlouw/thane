/**
 * Characterisation of the mount-call optimiser (component-precompiler.ts).
 *
 * An entry file that calls `mount(Component, { target?, props? })` once, with a component it can name, and
 * holds no `html` template, is rewritten to `mountComponent(component, target?, props?)`, so the router-aware
 * `mount` wrapper is tree-shaken. Routes (`mount(Shell, { routes })`, `mount(Routes)`) keep `mount()`.
 * Build-through tests: the component lives in its own file, as it does in an app, so the entry reaches the
 * optimiser.
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

const APP = `import { defineComponent } from 'thane';
export const App = defineComponent(() => ({ template: html\`<p>hi</p>\` }));
`;

const build = (entry: string, extraFiles: Record<string, string> = {}) =>
  buildAndReadJs(entry, { extraFiles: { 'src/app.ts': APP, ...extraFiles } });

/** The router-aware wrapper is bundled only when `mount` itself is still called. */
const hasMountWrapper = (js: string) => /function mount\(app, options/.test(js);

const ROUTES = `import { defineRoutes } from 'thane/router';
import { App } from './app';
export const Routes = defineRoutes({ '/': { component: App }, notFound: { component: App } });
`;

describe('mount optimiser: rewritten', () => {
  test('component only', async () => {
    const js = await build(`import { mount } from 'thane';
import { App } from './app';
mount(App);
`);
    expect(js).toContain('\nmountComponent(App);\n');
    expect(hasMountWrapper(js)).toBe(false);
    expect(js).not.toContain('_routerMount');
  });

  test('with a target', async () => {
    const js = await build(`import { mount } from 'thane';
import { App } from './app';
mount(App, { target: document.getElementById('app')! });
`);
    expect(js).toContain('\nmountComponent(App, document.getElementById("app"));\n');
    expect(hasMountWrapper(js)).toBe(false);
  });

  test('with props only: the target defaults to document.body', async () => {
    const js = await build(`import { mount } from 'thane';
import { App } from './app';
mount(App, { props: { n: 1 } });
`);
    expect(js).toContain('\nmountComponent(App, document.body, { n: 1 });\n');
    expect(hasMountWrapper(js)).toBe(false);
  });

  test('with target and props, written in the other order: arguments keep their positions', async () => {
    const js = await build(`import { mount } from 'thane';
import { App } from './app';
const el = document.getElementById('app')!;
mount(App, { props: { n: 1 }, target: el });
`);
    expect(js).toContain('\nmountComponent(App, el, { n: 1 });\n');
    expect(hasMountWrapper(js)).toBe(false);
  });

  test('the result is kept, and other names in the thane import survive the rename', async () => {
    const js = await build(`import { mount, signal } from 'thane';
import { App } from './app';
const ready = signal(true);
const handle = mount(App);
if (ready()) console.log(handle.root);
`);
    expect(js).toContain('var handle = mountComponent(App);');
    expect(js).toContain('var ready = signal(true);');
    expect(hasMountWrapper(js)).toBe(false);
  });

  test('an entry with a css template is rewritten and its stylesheet compiled', async () => {
    const js = await build(`import { mount, registerGlobalStyles } from 'thane';
import { App } from './app';
registerGlobalStyles(css\`body { margin: 0; }\`);
mount(App);
`);
    expect(js).toContain('registerGlobalStyles(`body { margin: 0; }`);');
    expect(js).toContain('\nmountComponent(App);\n');
    expect(hasMountWrapper(js)).toBe(false);
  });

  test('a module that is not the entry is rewritten the same way when it matches', async () => {
    // The optimiser runs on every loaded .ts file, not only the entry
    const js = await build(`import { boot } from './boot';\nboot();\n`, {
      'src/boot.ts': `import { mount } from 'thane';
import { App } from './app';
export const boot = () => mount(App);
`,
    });
    expect(js).toContain('var boot = () => mountComponent(App);');
    expect(hasMountWrapper(js)).toBe(false);
  });

  test('mount imported by the second of two thane imports', async () => {
    const js = await build(`import { signal } from 'thane';
import { mount } from 'thane';
import { App } from './app';
const ready = signal(true);
if (ready()) mount(App);
`);
    expect(js).toContain('if (ready()) mountComponent(App);');
    expect(js).toContain('function mountComponent(');
    expect(hasMountWrapper(js)).toBe(false);
  });

  test('an unmount() call is not a second mount() call', async () => {
    const js = await build(`import { mount, unmount } from 'thane';
import { App } from './app';
const handle = mount(App);
unmount(handle);
`);
    expect(js).toContain('var handle = mountComponent(App);');
    expect(js).toContain('function mountComponent(');
    expect(js).toContain('unmount(handle);');
    expect(hasMountWrapper(js)).toBe(false);
  });
});

describe('mount optimiser: not rewritten', () => {
  test('the routes alone, or a shell with routes: they need the router', async () => {
    const alone = await build(
      `import { mount } from 'thane';
import { Routes } from './routes';
mount(Routes);
`,
      { 'src/routes.ts': ROUTES },
    );
    expect(alone).toContain('\nmount(Routes);\n');
    expect(hasMountWrapper(alone)).toBe(true);
    const shell = await build(
      `import { mount } from 'thane';
import { App } from './app';
import { Routes } from './routes';
mount(App, { routes: Routes });
`,
      { 'src/routes.ts': ROUTES },
    );
    expect(shell).toContain('\nmount(App, { routes: Routes });\n');
    expect(hasMountWrapper(shell)).toBe(true);
  });

  test('options that are not an object literal: their keys are unknown', async () => {
    const js = await build(`import { mount } from 'thane';
import { App } from './app';
const options = { target: document.body };
mount(App, options);
`);
    expect(js).toContain('mount(App, options)');
    expect(hasMountWrapper(js)).toBe(true);
  });

  test('an entry that contains an html template', async () => {
    const js = await buildAndReadJs(`import { defineComponent, mount } from 'thane';
export const App = defineComponent(() => ({ template: html\`<p>hi</p>\` }));
mount(App);
`);
    expect(js).toContain('\nmount(App);\n');
    expect(hasMountWrapper(js)).toBe(true);
  });

  test('two mount() calls on different targets: neither is rewritten', async () => {
    const js = await build(`import { mount } from 'thane';
import { App } from './app';
mount(App, { target: document.getElementById('a')! });
mount(App, { target: document.getElementById('b')! });
`);
    expect(js).toContain('\nmount(App, { target: document.getElementById("a") });\n');
    expect(js).toContain('\nmount(App, { target: document.getElementById("b") });\n');
    expect(js).not.toContain('mountComponent(App');
    expect(hasMountWrapper(js)).toBe(true);
  });

  test("a local function called mount is not thane's", async () => {
    const js = await build(`import { App } from './app';
const mount = (options: { component: unknown }) => console.log(options);
mount(App);
`);
    expect(js).toContain('\nmount(App);\n');
    expect(js).not.toContain('mountComponent');
  });

  test('mount also used as a value: the import stays and the call is left alone', async () => {
    const js = await build(`import { mount } from 'thane';
import { App } from './app';
const start = mount;
mount(App);
console.log(start);
`);
    expect(js).toContain('\nmount(App);\n');
    expect(js).not.toContain('mountComponent(App');
    expect(hasMountWrapper(js)).toBe(true);
  });

  test('mount also exported: the import stays and the call is left alone', async () => {
    const js = await build(`import { mount } from 'thane';
import { App } from './app';
mount(App);
export { mount };
`);
    expect(js).toContain('\nmount(App);\n');
    expect(hasMountWrapper(js)).toBe(true);
  });

  test('mount imported from another module', async () => {
    const js = await build(
      `import { mount } from './my-mount';
import { App } from './app';
mount(App);
`,
      { 'src/my-mount.ts': 'export const mount = (options: { component: unknown }) => console.log(options);\n' },
    );
    expect(js).toContain('\nmount(App);\n');
    expect(js).not.toContain('mountComponent');
  });
});
