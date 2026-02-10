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
import { componentPropertyOrder } from './component-property-order.js';
import { lifecycleArrowFunction } from './lifecycle-arrow-function.js';
import { requireConstTaggedTemplates } from './require-const-tagged-templates.js';
import { noNestedHtmlTags } from './no-nested-html-tags.js';
import { noConditionalTemplateInit } from './no-conditional-template-init.js';
import type { LintRuleDefinition } from './types.js';

export { noDefaultExportComponent } from './no-default-export-component.js';
export { componentPropertyOrder } from './component-property-order.js';
export { lifecycleArrowFunction } from './lifecycle-arrow-function.js';
export { requireConstTaggedTemplates } from './require-const-tagged-templates.js';
export { noNestedHtmlTags } from './no-nested-html-tags.js';
export { noConditionalTemplateInit } from './no-conditional-template-init.js';

/**
 * All built-in lint rules, in registration order.
 * The linter plugin runs every rule in this array.
 */
export const allRules: readonly LintRuleDefinition[] = [
  noDefaultExportComponent,
  componentPropertyOrder,
  lifecycleArrowFunction,
  requireConstTaggedTemplates,
  noNestedHtmlTags,
  noConditionalTemplateInit,
];
