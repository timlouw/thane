/**
 * THANE414 — no-uncalled-signal
 *
 * A signal in a template is read by calling it. Without the call, the template gets the signal function itself:
 *
 *   html`<p>${count()}</p>`                   // ✅
 *   html`<p>${count}</p>`                     // ❌ shows the function's source code
 *   html`<p class=${theme}>…</p>`              // ❌ the same in an attribute
 *   html`<input @input=${query} />`            // ❌ calls the signal with the event, setting it to the event
 *   html`<p ${when(show)}>…</p>`               // ❌ a function is always truthy (also a type error)
 *   html`${repeat(items, (i) => html`…`)}`      // ❌ reconciles the function (also a type error)
 *
 * Reported for a name the file declares as `signal(…)` or `computed(…)`, in the scope the template reads it
 * from. A signal imported from a store is reported by the type check (a function is not a template value).
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';
import { createReporter, eventOfSlot, isTaggedWith, readsDeclaredSignal, slotsOf } from './lint-utils.js';

const unwrap = (node: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};

/** The expression when it is a bare name that reads a declared signal */
const signalName = (node: ts.Expression | undefined): ts.Identifier | undefined => {
  const bare = node && unwrap(node);
  return bare && ts.isIdentifier(bare) && readsDeclaredSignal(bare) ? bare : undefined;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.NO_UNCALLED_SIGNAL, 'error');

  // when(show) and repeat(items, …), anywhere in a template's expressions
  const visitExpression = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) return; // a nested template is visited on its own
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const directive = node.expression.text;
      const name = directive === FN.WHEN || directive === FN.REPEAT ? signalName(node.arguments[0]) : undefined;
      if (name) {
        const rest = directive === FN.REPEAT ? ', …' : node.arguments.length > 1 ? ', …' : '';
        report(
          name,
          `${directive}(${name.text}${rest}) is given the signal itself, not its value: ` +
            (directive === FN.WHEN ? 'a function is always truthy. ' : 'it lists nothing. ') +
            `Call it: ${directive}(${name.text}()${rest}).`,
        );
      }
    }
    ts.forEachChild(node, visitExpression);
  };

  const visit = (node: ts.Node): void => {
    if (isTaggedWith(node, [FN.HTML])) {
      for (const slot of slotsOf(node)) {
        // A two-way binding takes the signal itself: bind:value=${name}
        const name = /\sbind:(value|checked)=["']?$/.test(slot.before) ? undefined : signalName(slot.expression);
        const event = eventOfSlot(slot);
        if (name && event) {
          report(
            name,
            `@${event}=\${${name.text}} calls the signal with the event, which sets it to the event: ` +
              `write a handler, @${event}=\${() => ${name.text}(…)}.`,
          );
        } else if (name) {
          report(name, `\${${name.text}} is the signal function itself, not its value: call it, \${${name.text}()}.`);
        }
        visitExpression(slot.expression);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
};

export const noUncalledSignal: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_UNCALLED_SIGNAL,
    name: 'no-uncalled-signal',
    severity: 'error',
    description: 'A signal in a template is called: ${count()}, not ${count}.',
  },
  check,
};
