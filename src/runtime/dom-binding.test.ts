import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// These tests run in a child process: dom-binding.ts caches its parsing <template> in module state,
// which bun shares between test files, so each script gets a runtime of its own. The fake DOM has
// nodes with siblings, fragments, insertBefore and remove; a <template>'s innerHTML is a
// space-separated list of node names (`#text` a text node).
const run = (body: string): unknown => {
  const internalUrl = pathToFileURL(join(dirname(import.meta.path), 'internal.ts')).href;
  const signalUrl = pathToFileURL(join(dirname(import.meta.path), 'signal.ts')).href;
  const script = `
    class Node_ {
      constructor(name) { this.name = name; this.parentNode = null; this.childNodes = []; }
      get nextSibling() { const l = this.parentNode?.childNodes; return l?.[l.indexOf(this) + 1] ?? null; }
      appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
      insertBefore(n, ref) {
        const nodes = n.name === '#fragment' ? [...n.childNodes] : [n];
        for (const c of nodes) { this.childNodes.splice(ref ? this.childNodes.indexOf(ref) : this.childNodes.length, 0, c); c.parentNode = this; }
        if (n.name === '#fragment') n.childNodes = [];
        return n;
      }
      remove() { if (!this.parentNode) return; const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); this.parentNode = null; }
    }
    globalThis.document = {
      createElement: (tag) => {
        const t = new Node_(tag);
        t.content = new Node_('#fragment');
        Object.defineProperty(t, 'innerHTML', { set(v) { t.content = new Node_('#fragment'); for (const n of v.split(' ').filter(Boolean)) t.content.appendChild(new Node_(n)); } });
        return t;
      },
    };
    const errors = [];
    globalThis.queueMicrotask = (cb) => { try { cb(); } catch (e) { errors.push(e.message); } };
    const { __bindIfExpr } = await import(${JSON.stringify(internalUrl)});
    const { signal } = await import(${JSON.stringify(signalUrl)});
    const root = new Node_('div');
    const start = root.appendChild(new Node_('start'));
    const end = root.appendChild(new Node_('end'));
    const range = () => { const r = []; for (let n = start.nextSibling; n !== end; n = n.nextSibling) r.push(n); return r; };
    ${body}
  `;
  const child = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const out = child.stdout.toString().trim().split('\n').at(-1) ?? '';
  if (!out) throw new Error(child.stderr.toString());
  return JSON.parse(out);
};

describe('dom-binding remount semantics', () => {
  test('whenElse remount re-initializes nested bindings and does not reuse stale branch DOM', () => {
    expect(
      run(`
        const show = signal(false);
        let inits = 0;
        let cleanups = 0;
        const dispose = __bindIfExpr(start, end, [show], () => show(), 'div', () => { inits++; return [() => cleanups++]; });
        const steps = [{ inits, cleanups, shown: range().length }];
        show(true);
        const first = range()[0];
        steps.push({ inits, cleanups, shown: range().length });
        show(false);
        steps.push({ inits, cleanups, shown: range().length });
        show(true);
        const second = range()[0];
        steps.push({ inits, cleanups, shown: range().length, fresh: second !== first });
        show(false);
        dispose();
        steps.push({ inits, cleanups, shown: range().length });
        console.log(JSON.stringify(steps));
      `),
    ).toEqual([
      { inits: 0, cleanups: 0, shown: 0 },
      { inits: 1, cleanups: 0, shown: 1 },
      { inits: 1, cleanups: 1, shown: 0 },
      { inits: 2, cleanups: 1, shown: 1, fresh: true },
      { inits: 2, cleanups: 2, shown: 0 },
    ]);
  });
});

describe('a branch template with no element', () => {
  // A when() branch that is only text and starts hidden. Before branches became anchored ranges, its placeholder was
  // replaced by `null` (the text "null" in a real DOM) and the binding went inert; between anchors the
  // text is inserted and removed like any other content.
  test('a text-only branch that starts hidden shows its text and keeps toggling, without errors', () => {
    expect(
      run(`
        const show = signal(false);
        const inits = [];
        let cleanups = 0;
        const dispose = __bindIfExpr(start, end, [show], () => show(), '#text', (first) => { inits.push(first.name); return [() => cleanups++]; });
        const seen = [];
        for (let i = 0; i < 3; i++) {
          show(true);
          seen.push(range().map((n) => n.name).join());
          show(false);
          seen.push(range().map((n) => n.name).join());
        }
        dispose();
        console.log(JSON.stringify({ seen, inits, cleanups, errors }));
      `),
    ).toEqual({
      seen: ['#text', '', '#text', '', '#text', ''],
      inits: ['#text', '#text', '#text'],
      cleanups: 3,
      errors: [],
    });
  });
});
