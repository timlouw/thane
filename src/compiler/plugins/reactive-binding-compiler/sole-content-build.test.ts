/**
 * Row text bindings whose sole-content answer changed with the parse-tree rule, compiled end to end
 * (development build, so the row template is emitted as written). The analysis itself is
 * pinned in sole-content.test.ts; this checks that codegen builds each shape and emits the
 * marker or the element id where the analysis put it.
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

const app = (row: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, name: 'A' }]);
  const a = signal(0);
  return { template: html\`<ul>\${repeat(items(), (item) => html\`${row}\`)}</ul>\` };
});
mount(App);
`;

/** The emitted static row template (the `__T(\`…\`)` of the list's `__tpl_bN`). */
const rowTemplate = (js: string): string | undefined => /__tpl_b\d+ = __T\(`([^`]*)`\)/.exec(js)?.[1];

describe('sole content through the build', () => {
  test('a void sibling before: comment marker, the void element gets no id', async () => {
    const js = await buildAndReadJs(app('<li><img src="x">${item.name}</li>'));
    expect(rowTemplate(js)).toBe('<li><img src="x"><!----> <!----></li>');
  });

  test('a comment before: comment marker', async () => {
    const js = await buildAndReadJs(app('<li><!-- c -->${item.name}</li>'));
    expect(rowTemplate(js)).toBe('<li><!-- c --><!----> <!----></li>');
  });

  test('a < in an attribute value of the parent builds (it failed with THANE202 before the parse-tree rule)', async () => {
    const js = await buildAndReadJs(app('<li title="a<b">${item.name}</li>'));
    expect(rowTemplate(js)).toBe('<li title="a<b"></li>');
  });
});
