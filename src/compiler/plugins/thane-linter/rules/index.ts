/**
 * Barrel export for lint rules.
 *
 * To add a new rule:
 * 1. Create a file in this directory that exports a `LintRuleDefinition`.
 * 2. Import and re-export it below.
 * 3. Add it to the `allRules` array.
 */

export type { LintRule, LintRuleMeta, LintRuleDefinition } from './types.js';

import { noDefaultExportComponent } from './no-default-export-component.js';
import { requireConstTaggedTemplates } from './require-const-tagged-templates.js';
import { noNestedHtmlTags } from './no-nested-html-tags.js';
import { noConditionalTemplateInit } from './no-conditional-template-init.js';
import { componentConstDeclaration } from './component-const-declaration.js';
import { noAliasedComponentExport } from './no-aliased-component-export.js';
import { duplicateMountTarget } from './duplicate-mount-target.js';
import { singleReturnObject } from './single-return-object.js';
import { noAliasedThaneImport } from './no-aliased-thane-import.js';
import type { LintRuleDefinition } from './types.js';

export { noDefaultExportComponent } from './no-default-export-component.js';
export { requireConstTaggedTemplates } from './require-const-tagged-templates.js';
export { noNestedHtmlTags } from './no-nested-html-tags.js';
export { noConditionalTemplateInit } from './no-conditional-template-init.js';
export { componentConstDeclaration } from './component-const-declaration.js';
export { noAliasedComponentExport } from './no-aliased-component-export.js';
export { duplicateMountTarget } from './duplicate-mount-target.js';
export { singleReturnObject } from './single-return-object.js';
export { noAliasedThaneImport } from './no-aliased-thane-import.js';

/**
 * All built-in lint rules, in registration order.
 * The linter plugin runs every rule in this array.
 */
export const allRules: readonly LintRuleDefinition[] = [
  noDefaultExportComponent,
  requireConstTaggedTemplates,
  noNestedHtmlTags,
  noConditionalTemplateInit,
  componentConstDeclaration,
  noAliasedComponentExport,
  duplicateMountTarget,
  singleReturnObject,
  noAliasedThaneImport,
];
