/**
 * Lint rule unit tests
 *
 * Tests the Thane lint rules THANE400–THANE411 (THANE401, THANE402, THANE406, THANE407 and THANE410 are retired) by parsing
 * source strings into TS ASTs and running each rule's check function.
 */

import { afterEach, describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { ErrorCode } from '../../errors.js';
import type { Diagnostic } from '../../types.js';
import { createBuildConfig, resolveCLIOptions } from '../../cli/cli-common.js';
import {
  noDefaultExportComponent,
  requireConstTaggedTemplates,
  noNestedHtmlTags,
  noConditionalTemplateInit,
  componentConstDeclaration,
  noAliasedComponentExport,
  duplicateMountTarget,
} from './rules/index.js';

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);

// ============================================================================
// THANE400 — no-default-export-component
// ============================================================================

describe('THANE400 — no-default-export-component', () => {
  test('passes on named export', () => {
    const src = `export const MyApp = defineComponent(() => ({ template: html\`<div/>\` }));`;
    expect(noDefaultExportComponent.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails on default export', () => {
    const src = `export default defineComponent(() => ({ template: html\`<div/>\` }));`;
    const d = noDefaultExportComponent.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_DEFAULT_EXPORT_COMPONENT]);
  });

  test('ignores non-component default exports', () => {
    const src = `export default { foo: 'bar' };`;
    expect(noDefaultExportComponent.check(parse(src), 'test.ts')).toEqual([]);
  });
});

// ============================================================================
// THANE403 — require-const-tagged-templates
// ============================================================================

describe('THANE403 — require-const-tagged-templates', () => {
  test('passes with const html template', () => {
    const src = `const header = html\`<header>Title</header>\`;
    export const A = defineComponent(() => ({ template: html\`\${header}\` }));`;
    expect(requireConstTaggedTemplates.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with let html template', () => {
    const src = `let header = html\`<header>Title</header>\`;
    export const A = defineComponent(() => ({ template: html\`\${header}\` }));`;
    const d = requireConstTaggedTemplates.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.REQUIRE_CONST_TAGGED_TEMPLATES]);
  });

  test('fails with var css template', () => {
    const src = `var myStyles = css\`:host { color: red }\`;
    export const A = defineComponent(() => ({ template: html\`<div/>\`, styles: myStyles }));`;
    const d = requireConstTaggedTemplates.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.REQUIRE_CONST_TAGGED_TEMPLATES]);
  });
});

// ============================================================================
// THANE404 — no-nested-html-tags
// ============================================================================

describe('THANE404 — no-nested-html-tags', () => {
  test('passes with flat html template', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div>\${count()}</div>\`,
    }));`;
    expect(noNestedHtmlTags.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with html inside repeat (directive exemption)', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<ul>\${repeat(items(), (i) => html\`<li>\${i}</li>\`)}</ul>\`,
    }));`;
    expect(noNestedHtmlTags.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with html inside whenElse (directive exemption)', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div>\${whenElse(show(), html\`<p>Yes</p>\`, html\`<p>No</p>\`)}</div>\`,
    }));`;
    expect(noNestedHtmlTags.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with an html template that is the whole ${}', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div>\${html\`<span>nested</span>\`}</div>\`,
    }));`;
    expect(noNestedHtmlTags.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with an html template in a ternary', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div>\${show() ? html\`<span>nested</span>\` : ''}</div>\`,
    }));`;
    const d = noNestedHtmlTags.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_NESTED_HTML_TAGS]);
  });
});

// ============================================================================
// THANE405 — no-conditional-template-init
// ============================================================================

describe('THANE405 — no-conditional-template-init', () => {
  test('passes with direct template assignment', () => {
    const src = `const header = html\`<header>Title</header>\`;
    export const A = defineComponent(() => ({ template: html\`\${header}\` }));`;
    expect(noConditionalTemplateInit.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with ternary html template', () => {
    const src = `const tpl = isAdmin ? html\`<div>Admin</div>\` : html\`<div>User</div>\`;
    export const A = defineComponent(() => ({ template: tpl }));`;
    const d = noConditionalTemplateInit.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_CONDITIONAL_TEMPLATE_INIT]);
  });

  test('fails with logical AND html template', () => {
    const src = `const tpl = show && html\`<div>Content</div>\`;
    export const A = defineComponent(() => ({ template: tpl }));`;
    const d = noConditionalTemplateInit.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_CONDITIONAL_TEMPLATE_INIT]);
  });
});

// ============================================================================
// THANE408 — component-const-declaration
// ============================================================================

describe('THANE408 — component-const-declaration', () => {
  test('passes with const declaration', () => {
    const src = `export const MyApp = defineComponent(() => ({ template: html\`<div/>\` }));`;
    expect(componentConstDeclaration.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with let declaration', () => {
    const src = `export let MyApp = defineComponent(() => ({ template: html\`<div/>\` }));`;
    const d = componentConstDeclaration.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.COMPONENT_CONST_DECLARATION]);
    expect(d[0]!.message).toContain("'let'");
  });

  test('fails with var declaration', () => {
    const src = `var MyApp = defineComponent(() => ({ template: html\`<div/>\` }));`;
    const d = componentConstDeclaration.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.COMPONENT_CONST_DECLARATION]);
    expect(d[0]!.message).toContain("'var'");
  });
});

// ============================================================================
// THANE409 — no-aliased-component-export
// ============================================================================

describe('THANE409 — no-aliased-component-export', () => {
  test('passes with direct named export', () => {
    const src = `export const MyApp = defineComponent(() => ({ template: html\`<div/>\` }));`;
    expect(noAliasedComponentExport.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with aliased export', () => {
    const src = `
      const _Internal = defineComponent(() => ({ template: html\`<div/>\` }));
      export { _Internal as MyApp };
    `;
    const d = noAliasedComponentExport.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_ALIASED_COMPONENT_EXPORT]);
  });

  test('passes with a re-export from another module (a barrel)', () => {
    const src = `export { MyCounter } from './counter.js';`;
    expect(noAliasedComponentExport.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with non-PascalCase re-export', () => {
    const src = `export { helper } from './utils.js';`;
    expect(noAliasedComponentExport.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with type-only re-export declaration', () => {
    const src = `export type { Signal, ReadonlySignal } from './types.js';`;
    expect(noAliasedComponentExport.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with inline type-only specifiers in re-export', () => {
    const src = `export { defineComponent, type ComponentContext, type MountHandle } from './component.js';`;
    // defineComponent is not PascalCase so it's skipped; the type specifiers should also be skipped
    expect(noAliasedComponentExport.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with type-only re-export of PascalCase names', () => {
    const src = `export type { ComponentRoot } from './types.js';`;
    expect(noAliasedComponentExport.check(parse(src), 'test.ts')).toEqual([]);
  });
});

// ============================================================================
// THANE411 — duplicate-mount-target
// ============================================================================

describe('THANE411 — duplicate-mount-target', () => {
  test('passes with single mount call', () => {
    const src = `
      import { mount } from 'thane';
      import { App } from './app.js';
      mount({ component: App });
    `;
    expect(duplicateMountTarget.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with duplicate default mounts', () => {
    const src = `
      import { mount } from 'thane';
      import { App } from './app.js';
      import { Other } from './other.js';
      mount({ component: App });
      mount({ component: Other });
    `;
    const d = duplicateMountTarget.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.DUPLICATE_MOUNT_TARGET]);
  });

  test('passes with different explicit targets', () => {
    const src = `
      import { mount } from 'thane';
      import { App } from './app.js';
      import { Nav } from './nav.js';
      mount({ component: App, target: document.getElementById('app') });
      mount({ component: Nav, target: document.getElementById('nav') });
    `;
    expect(duplicateMountTarget.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with same variable target used twice', () => {
    const src = `
      import { mount } from 'thane';
      const el = document.getElementById('root')!;
      mount({ component: App, target: el });
      mount({ component: Other, target: el });
    `;
    const d = duplicateMountTarget.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.DUPLICATE_MOUNT_TARGET]);
  });

  test('passes with no mount calls', () => {
    const src = `const x = 42;`;
    expect(duplicateMountTarget.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with same variable name in different closure scopes', () => {
    const src = `
      import { mount } from 'thane';
      const win = window;
      win.__mountA = () => {
        const t = document.createElement('div');
        return mount({ component: AppA, target: t });
      };
      win.__mountB = () => {
        const t = document.createElement('div');
        return mount({ component: AppB, target: t });
      };
      win.__mountC = () => {
        const t = document.createElement('div');
        return mount({ component: AppC, target: t });
      };
    `;
    expect(duplicateMountTarget.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('still flags duplicate mount in the same closure scope', () => {
    const src = `
      import { mount } from 'thane';
      const setup = () => {
        const el = document.getElementById('root')!;
        mount({ component: AppA, target: el });
        mount({ component: AppB, target: el });
      };
    `;
    const d = duplicateMountTarget.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.DUPLICATE_MOUNT_TARGET]);
  });
});

// ============================================================================
// CLI defaults + config precedence
// ============================================================================

const originalCwd = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const createTempProject = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'thane-cli-'));
  tempDirs.push(dir);
  return dir;
};

describe('CLI defaults and config precedence', () => {
  test('uses generic defaults for new users', () => {
    const options = resolveCLIOptions([]);
    const build = createBuildConfig(options);

    expect(build.entryPoints).toEqual(['./src/main.ts']);
    expect(build.outDir).toBe('./dist');
    expect(build.assetsInputDir).toBe('./src/assets');
    expect(build.inputHTMLFilePath).toBe('./index.html');
  });

  test('loads thane.config.json defaults when present', () => {
    const dir = createTempProject();
    process.chdir(dir);

    writeFileSync(
      join(dir, 'thane.config.json'),
      JSON.stringify({
        entry: './app/main.ts',
        outDir: './build',
        assetsDir: './public',
        html: './site.html',
        prod: true,
      }),
    );

    const options = resolveCLIOptions([]);
    const build = createBuildConfig(options);

    expect(options.prod).toBe(true);
    expect(build.entryPoints[0]?.replace(/\\/g, '/')).toContain('/app/main.ts');
    expect(build.outDir.replace(/\\/g, '/')).toContain('/build');
    expect(build.assetsInputDir?.replace(/\\/g, '/')).toContain('/public');
    expect(build.inputHTMLFilePath.replace(/\\/g, '/')).toContain('/site.html');
  });

  test('CLI flags override config values', () => {
    const dir = createTempProject();
    process.chdir(dir);

    writeFileSync(
      join(dir, 'thane.config.json'),
      JSON.stringify({
        entry: './cfg/main.ts',
        outDir: './cfg-dist',
        prod: false,
        commands: {
          build: {
            prod: true,
          },
        },
      }),
    );

    const options = resolveCLIOptions(['build', '--entry', './cli/main.ts', '--out', './cli-dist', '--prod']);
    const build = createBuildConfig(options);

    expect(options.prod).toBe(true);
    expect(build.entryPoints).toEqual(['./cli/main.ts']);
    expect(build.outDir).toBe('./cli-dist');
  });

  test('dev command always enables serve and disables prod', () => {
    const dir = createTempProject();
    process.chdir(dir);

    writeFileSync(
      join(dir, 'thane.config.json'),
      JSON.stringify({
        prod: true,
      }),
    );

    const options = resolveCLIOptions(['dev']);

    expect(options.command).toBe('dev');
    expect(options.serve).toBe(true);
    expect(options.prod).toBe(false);
  });
});
