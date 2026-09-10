import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so subscriptions can be asserted directly.

const child = (markup: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', ({ props }) => {
  const local = signal(1);
  return {
    template: html\`<div>${markup}</div>\`,
  };
});
mount(App);
`;

describe('A prop read as props.x() in a template is a signal read', () => {
  test('a text binding subscribes to the prop', async () => {
    const js = await buildAndReadJs(child('<span>Count: ${props.count()}</span>'));
    expect(js).toMatch(/props\.count\.subscribe\(/);
    expect(js).toMatch(/props\.count\(\)/);
  });

  test('an attribute binding and an expression with a local signal subscribe to both', async () => {
    const js = await buildAndReadJs(child('<p title=${props.title()}>${props.count() + local()}</p>'));
    expect(js).toMatch(/props\.title\.subscribe\(/);
    expect(js).toMatch(/props\.count\.subscribe\(/);
    expect(js).toMatch(/local\.subscribe\(/);
  });

  test('a when() condition on a prop is driven by the prop', async () => {
    const js = await buildAndReadJs(child('<p ${when(props.show())}>x</p>'));
    expect(js).toMatch(/__bindIf\(r, props\.show, /);
  });

  test('a prop called with arguments is not treated as a signal', async () => {
    const js = await buildAndReadJs(child('<p title=${props.format(local())}>x</p>'));
    expect(js).not.toMatch(/props\.format\.subscribe\(/);
    expect(js).toMatch(/local\.subscribe\(/);
  });
});
