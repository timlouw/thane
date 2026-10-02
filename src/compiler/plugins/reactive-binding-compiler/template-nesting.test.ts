import { expect, test } from 'bun:test';
import { runBuild } from '../../cli/build.js';
import {
  buildAndReadJs,
  createTempProject,
  createTestBuildConfig,
  listBuiltJsFiles,
  removeTempProject,
} from '../../testing/build-project.js';

test('variable-assigned html template can be injected via ${} into another html template', async () => {
  const source = `
import { defineComponent, mount } from 'thane';

const loading = html\`<div data-testid="loading-piece">Loading...</div>\`;
const shell = html\`<section data-testid="loading-shell">\${loading}</section>\`;

export const FixtureApp = defineComponent('fixture-app', () => ({
  template: html\`<main data-testid="fixture-root">\${shell}</main>\`,
}));

mount({ component: FixtureApp });
`;

  const project = await createTempProject(source);
  try {
    await runBuild(createTestBuildConfig(project));

    const jsFiles = await listBuiltJsFiles(project.outDir);
    expect(jsFiles.length).toBeGreaterThan(0);
  } finally {
    await removeTempProject(project);
  }
});

test('an html`` template written as a whole ${} is inlined', async () => {
  const js = await buildAndReadJs(`
import { defineComponent, mount, signal } from 'thane';

export const FixtureApp = defineComponent('fixture-app', () => {
  const n = signal(1);
  return { template: html\`<main>\${html\`<div data-testid="nested">\${n()}</div>\`}</main>\` };
});

mount({ component: FixtureApp });
`);
  expect(js).toContain('<main><div data-testid="nested"><!---->1<!----></div></main>');
  expect(js).toMatch(/n\.subscribe\(/);
});

test('an html`` template in a ternary with a template on one side and text on the other fails compile (THANE404)', async () => {
  const source = `
import { defineComponent, mount } from 'thane';

export const FixtureApp = defineComponent('fixture-app', () => ({
  template: html\`<main>\${Math.random() > 1 ? html\`<div data-testid="bad-nested">nested</div>\` : 'text'}</main>\`,
}));

mount({ component: FixtureApp });
`;

  const project = await createTempProject(source);
  try {
    let errorText = '';
    try {
      await runBuild(createTestBuildConfig(project));
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
    }

    expect(errorText).toContain('THANE404');
    expect(errorText.includes('Build failed')).toBe(true);
  } finally {
    await removeTempProject(project);
  }
});
