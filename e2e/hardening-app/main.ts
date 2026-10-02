/**
 * Hardening app: one probe component per defect found by probing the compiler and runtime.
 *
 * `/?probe=<id>` mounts that one probe into #app, so every test sees only its own component, styles
 * and errors. `&manual=1` skips the mount, for tests that measure state before mounting and call
 * `window.__mountProbe()` themselves. `&target=body` mounts into document.body instead of #app. A mount
 * that throws is recorded in `window.__mountErrors`.
 */
import { mount, type ComponentHTMLSelector } from 'thane';
import { BackslashEscape } from './probes/backslash-escape.js';
import { BodyMount } from './probes/body-mount.js';
import { BranchPositions } from './probes/branch-positions.js';
import { ChildHosts } from './probes/child-hosts.js';
import { ChildSameId } from './probes/child-same-id.js';
import { ComponentRowTemplate } from './probes/component-row-template.js';
import { ComponentRowsInWhen } from './probes/component-rows-in-when.js';
import { ControlFlow } from './probes/control-flow.js';
import { CssCommentQuote } from './probes/css-comment-quote.js';
import { CssNamespace } from './probes/css-namespace.js';
import { DestroyRows } from './probes/destroy-rows.js';
import { DuplicateIds } from './probes/duplicate-ids.js';
import { EmptyIdEvent } from './probes/empty-id-event.js';
import { Fragments } from './probes/fragments.js';
import { HelperCalls } from './probes/helper-calls.js';
import { HelperReturn } from './probes/helper-return.js';
import { HiddenRows } from './probes/hidden-rows.js';
import { HiddenTextBranch } from './probes/hidden-text-branch.js';
import { HostCompound } from './probes/host-compound.js';
import { HostContext } from './probes/host-context.js';
import { HyphenatedTag } from './probes/hyphenated-tag.js';
import { ImportedFragments } from './probes/imported-fragments.js';
import { IndexChildProps } from './probes/index-child-props.js';
import { MultiRootBranch } from './probes/multi-root-branch.js';
import { NestedListRowRoot } from './probes/nested-list-row-root.js';
import { NestedLists } from './probes/nested-lists.js';
import { NestedRowEvent } from './probes/nested-row-event.js';
import { NestedRowWhen } from './probes/nested-row-when.js';
import { NestedWhenElseChild } from './probes/nested-when-else-child.js';
import { Narrowing } from './probes/narrowing.js';
import { PreWhitespace } from './probes/pre-whitespace.js';
import { QuotesInAttrs } from './probes/quotes-in-attrs.js';
import { RebuiltMarkup } from './probes/rebuilt-markup.js';
import { ReorderBeforeAnchor } from './probes/reorder-before-anchor.js';
import { RootList } from './probes/root-list.js';
import { RowChildAfterWhen } from './probes/row-child-after-when.js';
import { RowChildInWhen } from './probes/row-child-in-when.js';
import { RowChildProps } from './probes/row-child-props.js';
import { RowClosures } from './probes/row-closures.js';
import { EventModifiers } from './probes/event-modifiers.js';
import { RowDirectives } from './probes/row-directives.js';
import { RowMethodCall } from './probes/row-method-call.js';
import { RowTextSpace } from './probes/row-text-space.js';
import { RowWhenAttribute } from './probes/row-when-attribute.js';
import { RowWhenChild } from './probes/row-when-child.js';
import { RowWhenElseEvent } from './probes/row-when-else-event.js';
import { RowWhenRepeat } from './probes/row-when-repeat.js';
import { RowWhenSignal } from './probes/row-when-signal.js';
import { SeveralComponents } from './probes/several-components.js';
import { SignalRows } from './probes/signal-rows.js';
import { StaticSibling } from './probes/static-sibling.js';
import { TextNextToElements } from './probes/text-next-to-elements.js';
import { TextPositions } from './probes/text-positions.js';
import { TopLevelBranches } from './probes/top-level-branches.js';

const probes: Record<string, ComponentHTMLSelector<any>> = {
  backslashEscape: BackslashEscape,
  bodyMount: BodyMount,
  branchPositions: BranchPositions,
  childHosts: ChildHosts,
  childSameId: ChildSameId,
  componentRowTemplate: ComponentRowTemplate,
  componentRowsInWhen: ComponentRowsInWhen,
  controlFlow: ControlFlow,
  cssCommentQuote: CssCommentQuote,
  cssNamespace: CssNamespace,
  destroyRows: DestroyRows,
  duplicateIds: DuplicateIds,
  emptyIdEvent: EmptyIdEvent,
  fragments: Fragments,
  helperCalls: HelperCalls,
  helperReturn: HelperReturn,
  hiddenRows: HiddenRows,
  hiddenTextBranch: HiddenTextBranch,
  hostCompound: HostCompound,
  hostContext: HostContext,
  hyphenatedTag: HyphenatedTag,
  importedFragments: ImportedFragments,
  indexChildProps: IndexChildProps,
  multiRootBranch: MultiRootBranch,
  nestedListRowRoot: NestedListRowRoot,
  nestedLists: NestedLists,
  nestedRowEvent: NestedRowEvent,
  nestedRowWhen: NestedRowWhen,
  nestedWhenElseChild: NestedWhenElseChild,
  narrowing: Narrowing,
  preWhitespace: PreWhitespace,
  quotesInAttrs: QuotesInAttrs,
  rebuiltMarkup: RebuiltMarkup,
  reorderBeforeAnchor: ReorderBeforeAnchor,
  rootList: RootList,
  rowChildAfterWhen: RowChildAfterWhen,
  rowChildInWhen: RowChildInWhen,
  rowChildProps: RowChildProps,
  rowClosures: RowClosures,
  eventModifiers: EventModifiers,
  rowDirectives: RowDirectives,
  rowMethodCall: RowMethodCall,
  rowTextSpace: RowTextSpace,
  rowWhenAttribute: RowWhenAttribute,
  rowWhenChild: RowWhenChild,
  rowWhenElseEvent: RowWhenElseEvent,
  rowWhenRepeat: RowWhenRepeat,
  rowWhenSignal: RowWhenSignal,
  severalComponents: SeveralComponents,
  signalRows: SignalRows,
  staticSibling: StaticSibling,
  textNextToElements: TextNextToElements,
  textPositions: TextPositions,
  topLevelBranches: TopLevelBranches,
};

const win = window as any;
const params = new URLSearchParams(location.search);
const probeId = params.get('probe') ?? '';
win.__mountErrors = [];

win.__mountProbe = (): boolean => {
  const component = probes[probeId];
  // `&target=body` mounts into document.body, after the nodes the page already has
  const target = params.get('target') === 'body' ? document.body : document.getElementById('app');
  if (!component || !target) {
    win.__mountErrors.push(`unknown probe "${probeId}"`);
    return false;
  }
  try {
    win.__handle = mount({ component, target });
    return true;
  } catch (error) {
    win.__mountErrors.push(String(error));
    return false;
  }
};

if (params.get('manual') !== '1') win.__mountProbe();
win.__ready = true;
