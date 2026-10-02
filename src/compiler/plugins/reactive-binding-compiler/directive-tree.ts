/** One walk over the nested directive blocks (`when`, `whenElse`, `repeat`) of a template. */

import type { ConditionalBlock, RepeatBlock, WhenElseBlock } from './types.js';

/** The directive blocks at the top of a template (or of any branch or row). */
export interface DirectiveRoots {
  conditionals?: readonly ConditionalBlock[] | undefined;
  whenElse?: readonly WhenElseBlock[] | undefined;
  repeats?: readonly RepeatBlock[] | undefined;
}

/**
 * Called once per block, before its children, with the lists whose rows the block is in (outermost first).
 * Returning `false` skips the block's subtree.
 */
export interface DirectiveVisitor {
  cond?: ((block: ConditionalBlock, rows: readonly RepeatBlock[]) => boolean | void) | undefined;
  whenElse?: ((block: WhenElseBlock, rows: readonly RepeatBlock[]) => boolean | void) | undefined;
  repeat?: ((block: RepeatBlock, rows: readonly RepeatBlock[]) => boolean | void) | undefined;
}

/**
 * Visit every directive block in pre-order. At each level conditionals come first, then
 * whenElse blocks, then repeats. A whenElse block's children are its then and else
 * conditionals, then its then and else whenElse blocks, then its then and else repeats.
 */
export const walkDirectives = (roots: DirectiveRoots, visit: DirectiveVisitor): void => {
  const cond = (block: ConditionalBlock, rows: readonly RepeatBlock[]): void => {
    if (visit.cond?.(block, rows) === false) return;
    level(block.nestedConditionals, block.nestedWhenElse, block.nestedRepeats, rows);
  };
  const whenElse = (block: WhenElseBlock, rows: readonly RepeatBlock[]): void => {
    if (visit.whenElse?.(block, rows) === false) return;
    for (const c of block.thenConditionals) cond(c, rows);
    for (const c of block.elseConditionals) cond(c, rows);
    for (const w of block.thenWhenElse) whenElse(w, rows);
    for (const w of block.elseWhenElse) whenElse(w, rows);
    for (const r of block.thenRepeats) repeat(r, rows);
    for (const r of block.elseRepeats) repeat(r, rows);
  };
  const repeat = (block: RepeatBlock, rows: readonly RepeatBlock[]): void => {
    if (visit.repeat?.(block, rows) === false) return;
    level(block.nestedConditionals, block.nestedWhenElse, block.nestedRepeats, [...rows, block]);
  };
  const level = (
    conditionals: readonly ConditionalBlock[] | undefined,
    whenElseBlocks: readonly WhenElseBlock[] | undefined,
    repeats: readonly RepeatBlock[] | undefined,
    rows: readonly RepeatBlock[],
  ): void => {
    for (const c of conditionals ?? []) cond(c, rows);
    for (const w of whenElseBlocks ?? []) whenElse(w, rows);
    for (const r of repeats ?? []) repeat(r, rows);
  };
  level(roots.conditionals, roots.whenElse, roots.repeats, []);
};
