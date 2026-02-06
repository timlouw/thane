# Thane Framework - Proposed Performance Improvements

> All improvements maintain identical developer experience (API, syntax, behavior).
> Only internal implementation and compiler output change.

---

## Runtime Improvements

### 1. Signal — Eliminate `arguments` usage (Impact: High)

**Current:**
```ts
function reactiveFunction(newValue?: T): T {
  if (arguments.length === 0) { return value; }
  ...
}
```

**Proposed:** Use a unique sentinel symbol to detect "no argument" instead of the deoptimizing `arguments` object:
```ts
const SIGNAL_NO_ARG: unique symbol = Symbol();
const sig = (newValue: T | typeof SIGNAL_NO_ARG = SIGNAL_NO_ARG as any): T => {
  if (newValue === SIGNAL_NO_ARG) return value;
  ...
}
```

**Why:** V8 cannot optimize functions that access `arguments` — they get deoptimized to "slow mode". Using a sentinel symbol eliminates this entirely while preserving the same calling convention.

---

### 2. Signal — Unsubscribe with swap-and-pop (Impact: Medium)

**Current:** `subscribers.splice(idx, 1)` — O(n), creates intermediate array  
**Proposed:** Swap-and-pop for O(1) unsubscribe:
```ts
return () => {
  if (subscribers) {
    const idx = subscribers.indexOf(callback);
    if (idx !== -1) {
      const last = subscribers.length - 1;
      if (idx !== last) subscribers[idx] = subscribers[last]!;
      subscribers.length = last;
    }
  }
};
```

**Why:** For signals with many subscribers (e.g., array signals in large repeat blocks), splice is O(n) and creates GC pressure. Swap-and-pop is O(1). Subscriber ordering doesn't matter since all subscribers are called on every update.

---

### 3. Component — Batch style registration with single `textContent` set (Impact: Medium)

**Current:** `styleEl.textContent += css + '\n'` per style — triggers CSSOM reparse each time  
**Proposed:** Collect all pending styles and set `textContent` once:
```ts
let pendingStyles: string[] | null = null;
let flushScheduled = false;

export function registerGlobalStyles(...styles: string[]): void {
  for (const css of styles) {
    if (!registeredStyles.has(css)) {
      registeredStyles.add(css);
      if (!pendingStyles) pendingStyles = [];
      pendingStyles.push(css);
    }
  }
  if (pendingStyles && !flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushStyles);
  }
}
```

**Why:** Each `textContent +=` triggers the browser to reparse the entire stylesheet. With 20+ components, this means 20+ full reparses during initialization. Batching into a single write avoids this.

---

### 4. DOM Binding — Cache element references in `bindConditional` (Impact: Medium)

**Current:** `show()` and `hide()` both call `root.getElementById(id)` on every toggle  
**Proposed:** Track the current DOM reference and only re-query when absolutely necessary:
```ts
const show = () => {
  if (currentlyShowing) return;
  currentlyShowing = true;
  const placeholder = root.getElementById(id);
  if (placeholder && contentEl) {
    placeholder.replaceWith(contentEl);
    // contentEl is now in the DOM, no need to query again
    ...
  }
};
```

---

### 5. DOM Binding — Avoid `items.slice()` in append path (Impact: Low)

**Current:** `const itemsToAdd = newItems.slice(oldLength);` creates a copy  
**Proposed:** Pass start/end indices to `bulkCreate` and iterate over the original array:
```ts
if (newLength > oldLength) {
  bulkCreate(newItems, oldLength, newLength);
}
```

---

### 6. DOM Binding — Use `nodeValue` instead of `textContent` for text nodes (Impact: Low)

**Current:** Text node updates use `textContent` property  
**Proposed:** For known text nodes (from `__findTextNode`), use `nodeValue` which is slightly faster as it doesn't need to check for child nodes:
```ts
textNode.nodeValue = newValue;
```

---

## Compiler Output Improvements

### 7. Reactive Binding Compiler — Cache regex in loops (Impact: Medium)

**Current:** `new RegExp(...)` is created inside every loop iteration:
```ts
for (const sigName of signalNames) {
  const sigRegex = new RegExp(`this\\.${sigName}\\(\\)`, 'g');
  evalExpr = evalExpr.replace(sigRegex, ...);
}
```

**Proposed:** Create regex once per signal name and reuse:
```ts
const signalRegexes = new Map<string, RegExp>();
const getSignalRegex = (name: string): RegExp => {
  let re = signalRegexes.get(name);
  if (!re) { re = new RegExp(`this\\.${name}\\(\\)`, 'g'); signalRegexes.set(name, re); }
  re.lastIndex = 0;
  return re;
};
```

---

### 8. Reactive Binding Compiler — Single-pass binding categorization (Impact: Medium)

**Current:** 6+ separate `for` loops over `parsed.bindings`, each filtering by type  
**Proposed:** Single pass categorizing bindings into type-specific arrays:
```ts
const whenBindings = [], textBindings = [], eventBindings = [], ...;
for (const binding of parsed.bindings) {
  switch(binding.type) {
    case 'when': whenBindings.push(binding); break;
    case 'text': textBindings.push(binding); break;
    ...
  }
}
```

---

### 9. HTML Parser — Use numeric state constants (Impact: Low-Medium)

**Current:** Parser state is string type `'TEXT' | 'TAG_OPEN' | ...`  
**Proposed:** Use numeric constants for faster comparisons in the parser's hot loop:
```ts
const S_TEXT = 0, S_TAG_OPEN = 1, S_TAG_NAME = 2, ...;
let state = S_TEXT;
// Numeric comparison is ~3x faster than string comparison in tight loops
```

---

### 10. `toCamelCase` — Cache results (Impact: Low)

**Current:** Runs regex and string transforms on every call  
**Proposed:** Add a simple Map cache since CSS properties are repeated:
```ts
const camelCaseCache = new Map<string, string>();
export const toCamelCase = (str: string): string => {
  const cached = camelCaseCache.get(str);
  if (cached !== undefined) return cached;
  const result = str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  camelCaseCache.set(str, result);
  return result;
};
```

---

## Summary of Expected Impact

| # | Improvement | Impact | Risk |
|---|------------|--------|------|
| 1 | Signal sentinel instead of arguments | **High** | Low |
| 2 | Swap-and-pop unsubscribe | **Medium** | Low |
| 3 | Batch style registration | **Medium** | Low |
| 4 | Cache conditional element refs | **Medium** | Low |
| 5 | Avoid slice in append | **Low** | Very Low |
| 6 | nodeValue for text nodes | **Low** | Very Low |
| 7 | Cache regex in compiler | **Medium** | Very Low |
| 8 | Single-pass binding categorization | **Medium** | Low |
| 9 | Numeric parser states | **Low-Medium** | Very Low |
| 10 | Cache toCamelCase | **Low** | Very Low |

All changes maintain identical developer-facing API and behavior. Only internal implementation details change.
