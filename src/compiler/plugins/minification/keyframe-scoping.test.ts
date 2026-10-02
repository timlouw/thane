/**
 * Keyframe scoping is bundled only by apps whose stylesheets define `@keyframes`: the compiler adds the
 * runtime switch to a module whose `css` template or `.css` file defines some, and to no other.
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

const component = (styles: string, imports = ''): string => `
import { css, defineComponent, html, mount } from 'thane';
${imports}
export const Card = defineComponent('x-card', () => ({
  template: html\`<p class="pulse">card</p>\`,
  styles: ${styles},
}));
mount(Card);
`;

const KEYFRAMES = '@keyframes pulse { from { opacity: 1; } to { opacity: 0.5; } } .pulse { animation: pulse 1s; }';

describe('keyframe scoping is bundled only when a stylesheet defines keyframes', () => {
  test('a component css template with keyframes turns it on', async () => {
    const js = await buildAndReadJs(component(`css\`${KEYFRAMES}\``));
    expect(js).toContain('__enableKeyframeScoping()');
    expect(js).toContain('scopeKeyframes');
  });

  test('a component without keyframes bundles none of it', async () => {
    const js = await buildAndReadJs(component('css`.pulse { color: red; }`'));
    expect(js).toContain('__enableComponentStyles()');
    expect(js).not.toContain('__enableKeyframeScoping');
    expect(js).not.toContain('scopeKeyframes');
  });

  test('a .css file with keyframes turns it on, from the module the file becomes', async () => {
    const js = await buildAndReadJs(component('cardStyles', "import cardStyles from './card.css';"), {
      extraFiles: { 'src/card.css': KEYFRAMES },
    });
    expect(js).toContain('__enableKeyframeScoping()');
  });

  test('a module of shared css templates with keyframes turns it on', async () => {
    const js = await buildAndReadJs(component('shared', "import { shared } from './shared.js';"), {
      extraFiles: { 'src/shared.ts': `import { css } from 'thane';\nexport const shared = css\`${KEYFRAMES}\`;\n` },
    });
    expect(js).toContain('__enableKeyframeScoping()');
  });
});
