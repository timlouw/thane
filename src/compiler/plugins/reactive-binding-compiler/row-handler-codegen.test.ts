import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so the delegated listener body can be asserted directly.

const app = (row: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, label: 'A' }]);
  const clicks = signal(0);
  const bump = () => clicks(clicks() + 1);
  const pick = (id) => console.log(id);
  const nav = { go: (id) => console.log(id) };
  return {
    template: html\`
      <ul>
        \${repeat(rows(), (item) => html\`${row}\`, { key: "id" })}
      </ul>
    \`,
  };
});
mount({ component: App });
`;

describe('Row event handlers of every shape run on the event', () => {
  test('a function reference is called with the event', async () => {
    const js = await buildAndReadJs(app('<li><i @click=${bump}>${item.label}</i></li>'));
    expect(js).toMatch(/bump\(_e\);/);
    expect(js).not.toMatch(/\bbump;/);
  });

  test('a member reference is called with the event', async () => {
    const js = await buildAndReadJs(app('<li @click=${nav.go}>${item.label}</li>'));
    expect(js).toMatch(/nav\.go\(_e\);/);
  });

  test("an arrow is inlined, its parameter declared from the listener's event", async () => {
    const js = await buildAndReadJs(app('<li @click=${(ev) => pick(ev.target)}>${item.label}</li>'));
    expect(js).toMatch(/const ev = _e;\s*pick\(ev\.target\);/);
  });

  test('an arrow with parameter e and a call expression are inlined', async () => {
    const js = await buildAndReadJs(
      app('<li><b @click=${(e) => pick(e.target)}>x</b><i @click=${() => pick(item.id)}>${item.label}</i></li>'),
    );
    expect(js).toMatch(/const e = _e;\s*pick\(e\.target\);/);
    expect(js).toMatch(/pick\(item\.id\);/);
  });
});

describe('Only a function or a reference is a listener; any other expression runs on the event', () => {
  test('in a row, a call with an arrow argument runs as written, not the arrow alone', async () => {
    const js = await buildAndReadJs(app('<li @click=${pick(item.id, () => bump())}>${item.label}</li>'));
    expect(js).toMatch(/pick\(item\.id, \(\) => bump\(\)\);/);
  });

  test('in a row, a function expression is called with the event', async () => {
    const js = await buildAndReadJs(app('<li @click=${function (ev) { pick(ev); }}>${item.label}</li>'));
    expect(js).toMatch(/\(function\(ev\) \{\s*pick\(ev\);\s*\}\)\(_e\);/);
  });

  const component = (button: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const clicks = signal(0);
  const bump = () => clicks(clicks() + 1);
  const pick = (id, then) => then(id);
  return { template: html\`${button}\` };
});
mount({ component: App });
`;

  test('in a component, a call with an arrow argument runs on the event, as written', async () => {
    const js = await buildAndReadJs(component('<button @click=${pick(1, () => bump())}>go</button>'));
    expect(js).toMatch(/addEventListener\("click", \(\) => \{\s*pick\(1, \(\) => bump\(\)\);\s*\}\)/);
  });

  test('in a component, a function expression is the listener', async () => {
    const js = await buildAndReadJs(component('<button @click=${function (ev) { pick(ev, bump); }}>go</button>'));
    expect(js).toMatch(/addEventListener\("click", function\(ev\) \{\s*pick\(ev, bump\);\s*\}\)/);
  });
});
