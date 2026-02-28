const CHARS = 'abcdefghijklmnopqrstuvwxyz';

export const generateMinifiedSelector = (index: number): string => {
  const prefixIndex = Math.floor(index / CHARS.length);
  const suffixIndex = index % CHARS.length;
  let prefix = '';
  let remaining = prefixIndex;
  do {
    prefix = CHARS[remaining % CHARS.length] + prefix;
    remaining = Math.floor(remaining / CHARS.length) - 1;
  } while (remaining >= 0);

  const suffix = CHARS[suffixIndex];

  return `${prefix}-${suffix}`;
};

export class SelectorMap {
  private originalToMinified = new Map<string, string>();
  private nextIndex = 0;

  register(originalSelector: string): string {
    const existing = this.originalToMinified.get(originalSelector);
    if (existing) {
      return existing;
    }

    const minified = generateMinifiedSelector(this.nextIndex++);
    this.originalToMinified.set(originalSelector, minified);
    return minified;
  }

  entries(): IterableIterator<[string, string]> {
    return this.originalToMinified.entries();
  }

  get size(): number {
    return this.originalToMinified.size;
  }

  clear(): void {
    this.originalToMinified.clear();
    this.nextIndex = 0;
  }
}

export const applySelectorsToSource = (source: string, selectorMap: SelectorMap): string => {
  if (selectorMap.size === 0) return source;

  // Build a single combined regex that matches any selector in all contexts.
  // This gives O(n) scanning instead of O(n * selectors * 5).
  const escapedEntries: Array<{ escaped: string; original: string; minified: string }> = [];
  for (const [original, minified] of selectorMap.entries()) {
    const escaped = original.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    escapedEntries.push({ escaped, original, minified });
  }

  // Sort by length descending so longer selectors match before shorter prefixes
  escapedEntries.sort((a, b) => b.original.length - a.original.length);

  const alternatives = escapedEntries.map((e) => e.escaped).join('|');
  const lookup = new Map(escapedEntries.map((e) => [e.original, e.minified]));

  // Combined pattern covers all four replacement contexts in one pass:
  //   1. <selector(\s|>|/)   — HTML open tags
  //   2. </selector>          — HTML close tags
  //   3. (['"])selector\1     — quoted strings
  //   4. .selector(?=[\s{(,:>+~[\]])  — CSS class selectors
  const combined = new RegExp(
    `<(${alternatives})([\\s>/])|</(${alternatives})>|(['"])(${alternatives})\\4|\\.(${alternatives})(?=[\\s{(,:>+~\\[\\]])`,
    'g',
  );

  return source.replace(combined, (...args: any[]) => {
    // Group 1,2: HTML open tag  <selector(\s|>|/)
    if (args[1]) return `<${lookup.get(args[1]) || args[1]}${args[2]}`;
    // Group 3: HTML close tag </selector>
    if (args[3]) return `</${lookup.get(args[3]) || args[3]}>`;
    // Group 4,5: Quoted string 'selector' or "selector"
    if (args[5]) return `${args[4]}${lookup.get(args[5]) || args[5]}${args[4]}`;
    // Group 6: CSS class .selector
    if (args[6]) return `.${lookup.get(args[6]) || args[6]}`;
    return args[0];
  });
};

export const extractSelectorsFromSource = (source: string): string[] => {
  const selectors: string[] = [];
  const seen = new Set<string>();

  const addSelector = (sel: string) => {
    if (sel && !seen.has(sel)) {
      seen.add(sel);
      selectors.push(sel);
    }
  };

  const selectorRegex = /selector:\s*(['"])([a-z][a-z0-9]*-[a-z0-9-]+)\1/gi;
  let match;
  while ((match = selectorRegex.exec(source)) !== null) {
    addSelector(match[2]!);
  }

  const cssClassRegex = /\.([a-z][a-z0-9]*-[a-z0-9-]+)(?=[\s{(,:>+~[\]])/gi;
  while ((match = cssClassRegex.exec(source)) !== null) {
    // Only add if it was already seen as a selector (avoids false positives from arbitrary CSS classes)
    if (seen.has(match[1]!)) {
      addSelector(match[1]!);
    }
  }

  return selectors;
};
