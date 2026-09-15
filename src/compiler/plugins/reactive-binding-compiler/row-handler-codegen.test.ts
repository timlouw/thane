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
        \${repeat(rows(), (item) => html\`${row}\`, null, (item) => item.id)}
      </ul>
    \`,
  };
});
mount(App);
`;

describe('Row event handlers of every shape run on the event', () => {
  test('a function reference is called with the event', async () => {
    const js = await buildAndReadJs(app('<li><i @click=${bump}>${item.label}</i></li>'));
    expect(js).toMatch(/bump\(e\);/);
    expect(js).not.toMatch(/\bbump;/);
  });

  test('a member reference is called with the event', async () => {
    const js = await buildAndReadJs(app('<li @click=${nav.go}>${item.label}</li>'));
    expect(js).toMatch(/nav\.go\(e\);/);
  });

  test('an arrow whose parameter is not named e is aliased', async () => {
    const js = await buildAndReadJs(app('<li @click=${(ev) => pick(ev.target)}>${item.label}</li>'));
    expect(js).toMatch(/const ev = e;\s*pick\(ev\.target\);/);
  });

  test('an arrow with parameter e and a call expression are inlined as before', async () => {
    const js = await buildAndReadJs(
      app('<li><b @click=${(e) => pick(e.target)}>x</b><i @click=${() => pick(item.id)}>${item.label}</i></li>'),
    );
    expect(js).toMatch(/pick\(e\.target\);/);
    expect(js).toMatch(/pick\(item\.id\);/);
    expect(js).not.toMatch(/const e = e/);
  });
});
