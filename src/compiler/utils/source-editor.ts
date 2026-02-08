/**
 * Source Editor Utilities
 * 
 * Provides utilities for editing source code with position-based edits.
 */

/**
 * Represents a single edit to source code
 */
export interface SourceEdit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Represents a code removal (edit with empty replacement)
 */
export interface CodeRemoval {
  start: number;
  end: number;
  description?: string;
}

/**
 * Apply multiple edits to source code
 * 
 * Edits are applied from bottom to top (highest position first)
 * to avoid position shifting issues.
 * 
 * @param source - Original source code
 * @param edits - Array of edits to apply
 * @returns Modified source code
 */
export const applyEdits = (source: string, edits: SourceEdit[]): string => {
  if (edits.length === 0) return source;

  // Sort by position descending (apply from bottom to top)
  const sortedEdits = [...edits].sort((a, b) => b.start - a.start);

  let result = source;
  for (const edit of sortedEdits) {
    result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
  }

  return result;
};

/**
 * Remove code at specified positions
 * 
 * @param source - Original source code
 * @param removals - Array of code sections to remove
 * @returns Modified source code
 */
export const removeCode = (source: string, removals: CodeRemoval[]): string => {
  const edits: SourceEdit[] = removals.map((r) => ({
    start: r.start,
    end: r.end,
    replacement: '',
  }));
  return applyEdits(source, edits);
};

