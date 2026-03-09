/**
 * Lint rule unit tests
 *
 * Tests all 12 Thane lint rules (THANE400–THANE411) by parsing
 * source strings into TS ASTs and running each rule's check function.
 */

import { afterEach, describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { ErrorCode } from './errors.js';
import type { Diagnostic } from './types.js';
import { createBuildConfig, resolveCLIOptions } from './cli/cli-common.js';
import {
  noDefaultExportComponent,
  componentPropertyOrder,
  lifecycleArrowFunction,
  requireConstTaggedTemplates,
  noNestedHtmlTags,
  noConditionalTemplateInit,
  noElementId,
  singleComponentPerFile,
  componentConstDeclaration,
  noAliasedComponentExport,
  noCrossFileHtmlTemplate,
  duplicateMountTarget,
} from './plugins/thane-linter/rules/index.js';

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
// THANE401 — component-property-order
// ============================================================================

describe('THANE401 — component-property-order', () => {
  test('passes with correct order: template → styles → onMount → onDestroy', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div/>\`,
      styles: css\`:host { color: red }\`,
      onMount: () => {},
      onDestroy: () => {},
    }));`;
    expect(componentPropertyOrder.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('passes with partial properties in order', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div/>\`,
      onDestroy: () => {},
    }));`;
    expect(componentPropertyOrder.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails when styles comes before template', () => {
    const src = `export const A = defineComponent(() => ({
      styles: css\`:host { color: red }\`,
      template: html\`<div/>\`,
    }));`;
    const d = componentPropertyOrder.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.COMPONENT_PROPERTY_ORDER]);
  });

  test('fails when onMount comes before template', () => {
    const src = `export const A = defineComponent(() => ({
      onMount: () => {},
      template: html\`<div/>\`,
    }));`;
    const d = componentPropertyOrder.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.COMPONENT_PROPERTY_ORDER]);
  });
});

// ============================================================================
// THANE402 — lifecycle-arrow-function
// ============================================================================

describe('THANE402 — lifecycle-arrow-function', () => {
  test('passes with arrow function lifecycle hooks', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div/>\`,
      onMount: () => {},
      onDestroy: () => {},
    }));`;
    expect(lifecycleArrowFunction.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails on method shorthand onMount', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div/>\`,
      onMount() { console.log('hi'); },
    }));`;
    const d = lifecycleArrowFunction.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.LIFECYCLE_ARROW_FUNCTION]);
  });

  test('fails on function expression onDestroy', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div/>\`,
      onDestroy: function() {},
    }));`;
    const d = lifecycleArrowFunction.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.LIFECYCLE_ARROW_FUNCTION]);
  });

  test('reports both lifecycle hooks if both are wrong', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div/>\`,
      onMount() {},
      onDestroy: function() {},
    }));`;
    const d = lifecycleArrowFunction.check(parse(src), 'test.ts');
    expect(d).toHaveLength(2);
    expect(codes(d)).toEqual([ErrorCode.LIFECYCLE_ARROW_FUNCTION, ErrorCode.LIFECYCLE_ARROW_FUNCTION]);
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

  test('fails with directly nested html template', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div>\${html\`<span>nested</span>\`}</div>\`,
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
// THANE406 — no-element-id
// ============================================================================

describe('THANE406 — no-element-id', () => {
  test('passes with user-defined IDs that do not match b0 pattern', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div id="main">content</div>\`,
    }));`;
    expect(noElementId.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with compiler-reserved ID b0', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div id="b0">content</div>\`,
    }));`;
    const d = noElementId.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_ELEMENT_ID]);
  });

  test('fails with compiler-reserved ID b12', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<span id="b12">test</span>\`,
    }));`;
    const d = noElementId.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_ELEMENT_ID]);
  });

  test('passes with non-reserved ID that starts with b', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<table id="tbody">test</table>\`,
    }));`;
    expect(noElementId.check(parse(src), 'test.ts')).toEqual([]);
  });
});

// ============================================================================
// THANE407 — single-component-per-file
// ============================================================================

describe('THANE407 — single-component-per-file', () => {
  test('passes with one component per file', () => {
    const src = `export const MyApp = defineComponent(() => ({ template: html\`<div/>\` }));`;
    expect(singleComponentPerFile.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with two components in one file', () => {
    const src = `
      export const Foo = defineComponent(() => ({ template: html\`<div/>\` }));
      export const Bar = defineComponent(() => ({ template: html\`<span/>\` }));
    `;
    const d = singleComponentPerFile.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.SINGLE_COMPONENT_PER_FILE]);
  });

  test('fails with three components — reports on each after the first', () => {
    const src = `
      export const A = defineComponent(() => ({ template: html\`<div/>\` }));
      export const B = defineComponent(() => ({ template: html\`<div/>\` }));
      export const C = defineComponent(() => ({ template: html\`<div/>\` }));
    `;
    const d = singleComponentPerFile.check(parse(src), 'test.ts');
    expect(d).toHaveLength(2);
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

  test('fails with re-export from another module', () => {
    const src = `export { MyCounter } from './counter.js';`;
    const d = noAliasedComponentExport.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_ALIASED_COMPONENT_EXPORT]);
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
// THANE410 — no-cross-file-html-template
// ============================================================================

describe('THANE410 — no-cross-file-html-template', () => {
  test('passes when template variables are local', () => {
    const src = `
      const header = html\`<header>Title</header>\`;
      export const A = defineComponent(() => ({
        template: html\`\${header}<main>Content</main>\`,
      }));
    `;
    expect(noCrossFileHtmlTemplate.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails when imported variable is used in html template', () => {
    const src = `
      import { header } from './shared-templates.js';
      export const A = defineComponent(() => ({
        template: html\`\${header}<main>Content</main>\`,
      }));
    `;
    const d = noCrossFileHtmlTemplate.check(parse(src), 'test.ts');
    expect(d).toHaveLength(1);
    expect(codes(d)).toEqual([ErrorCode.NO_CROSS_FILE_HTML_TEMPLATE]);
  });

  test('passes with no imports', () => {
    const src = `export const A = defineComponent(() => ({
      template: html\`<div>\${count()}</div>\`,
    }));`;
    expect(noCrossFileHtmlTemplate.check(parse(src), 'test.ts')).toEqual([]);
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
      mount(App);
    `;
    expect(duplicateMountTarget.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with duplicate default mounts', () => {
    const src = `
      import { mount } from 'thane';
      import { App } from './app.js';
      import { Other } from './other.js';
      mount(App);
      mount(Other);
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
      mount(App, document.getElementById('app'));
      mount(Nav, document.getElementById('nav'));
    `;
    expect(duplicateMountTarget.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('fails with same variable target used twice', () => {
    const src = `
      import { mount } from 'thane';
      const el = document.getElementById('root')!;
      mount(App, el);
      mount(Other, el);
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
        return mount(AppA, t);
      };
      win.__mountB = () => {
        const t = document.createElement('div');
        return mount(AppB, t);
      };
      win.__mountC = () => {
        const t = document.createElement('div');
        return mount(AppC, t);
      };
    `;
    expect(duplicateMountTarget.check(parse(src), 'test.ts')).toEqual([]);
  });

  test('still flags duplicate mount in the same closure scope', () => {
    const src = `
      import { mount } from 'thane';
      const setup = () => {
        const el = document.getElementById('root')!;
        mount(AppA, el);
        mount(AppB, el);
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
