import { expect, test } from 'bun:test';
import { runBuild } from '../../cli/build.js';
import {
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

mount(FixtureApp);
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

test('directly nested html`` inside another html`` interpolation fails compile (THANE404)', async () => {
  const source = `
import { defineComponent, mount } from 'thane';

export const FixtureApp = defineComponent('fixture-app', () => ({
  template: html\`<main>\${html\`<div data-testid="bad-nested">nested</div>\`}</main>\`,
}));

mount(FixtureApp);
`;

  const project = await createTempProject(source);
  try {
    let errorText = '';
    try {
      await runBuild(createTestBuildConfig(project));
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
    }

    expect(errorText.length).toBeGreaterThan(0);
    expect(errorText.includes('Build failed')).toBe(true);
  } finally {
    await removeTempProject(project);
  }
});

test('repeat with unsupported optimized shape compiles via safe fallback renderer', async () => {
  const source = `
import { defineComponent, signal, mount } from 'thane';

export const FixtureApp = defineComponent('fixture-app', () => {
  const rows = signal([{ id: 1, label: 'A' }, { id: 2, label: 'B' }]);
  return {
    template: html\`
      <main>
        <ul>
          \${repeat(
            rows(),
            (item) => html\`<li data-testid="row-label">\${item.label}</li><li data-testid="row-id">\${item.id}</li>\`,
            html\`<li data-testid="empty">empty</li>\`,
            (item) => item.id,
          )}
        </ul>
      </main>
    \`,
  };
});

mount(FixtureApp);
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
