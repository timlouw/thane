/**
 * The DOM a compiled template becomes, as the browser builds it.
 *
 * Compiled code reaches the nodes it binds by their position in the template, not by ids, so the
 * compiler has to know the tree the browser's parser makes of the template's HTML, which is not
 * always the tree the markup reads as. This module parses a template the way `template.innerHTML =
 * html` does (the HTML standard's tokenizer and tree construction, in a template's context), for
 * the markup templates are made of:
 *   - void elements, raw text and RCDATA elements (`<script>`, `<style>`, `<textarea>`, `<title>`, …),
 *     `/>` honoured only inside `<svg>` / `<math>`, the newline dropped after `<pre>` / `<textarea>`;
 *   - end tags implied by start tags: a `<p>` closed by a block element, `<li>` / `<dt>` / `<dd>` /
 *     `<option>` closed by the next one, nested headings and buttons;
 *   - end tags that do not match: a stray `</p>` becomes an empty `<p>`, `</br>` a `<br>`, other stray
 *     end tags are dropped, and an end tag closes the elements still open inside its element;
 *   - tables: an implied `<tbody>`, `<tr>` or `<colgroup>`, cells and rows closed by the next one;
 *   - `<template>` elements, whose content is not part of the tree.
 * Where the browser would restructure markup in a way this model does not follow (content moved out
 * of a table, a formatting element re-opened after an implicit close, markup the parser drops), the
 * model records a problem instead of guessing; the caller reports it when it needs a position.
 */

export interface DomNode {
  kind: 'element' | 'text' | 'comment';
  /** Lower-case tag name; '' for text and comments */
  tag: string;
  /** Attributes by lower-case name, the first of duplicates (elements) */
  attrs: Map<string, string>;
  /** Text content or comment data */
  data: string;
  children: DomNode[];
  /** The parent element; null for a top-level node */
  parent: DomNode | null;
  /** Position among the tree's elements in document order: the index `querySelectorAll('*')` gives it (-1 for other nodes) */
  order: number;
}

export interface DomModel {
  /** The template's top-level nodes */
  roots: DomNode[];
  /** Every element in document order: `elements[node.order] === node` */
  elements: DomNode[];
  /** Markup the model does not follow, in words; empty when the tree is the browser's */
  problems: string[];
}

// ─────────────────────────────────────────────────────────────
//  Template literal text → the string the browser parses
// ─────────────────────────────────────────────────────────────

/**
 * The value of template-literal text written as `raw`: what a compiled template hands to
 * innerHTML. Templates are carried as written, so their escape sequences are still in them.
 */
export const cookTemplateText = (raw: string): string =>
  raw
    .replace(/\r\n?/g, '\n')
    .replace(/\\(u\{[0-9A-Fa-f]+\}|u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|[\s\S])/g, (_m, e: string) => {
      if (e.length > 1) {
        return e[0] === 'x' || e[1] !== '{'
          ? String.fromCharCode(parseInt(e.slice(1), 16))
          : String.fromCodePoint(parseInt(e.slice(2, -1), 16));
      }
      const simple: Record<string, string> = {
        'n': '\n',
        't': '\t',
        'r': '\r',
        'b': '\b',
        'f': '\f',
        'v': '\v',
        '0': '\0',
        '\n': '',
      };
      return simple[e] ?? e;
    });

// ─────────────────────────────────────────────────────────────
//  Element categories (HTML standard, "Parsing HTML documents")
// ─────────────────────────────────────────────────────────────

const names = (list: string): Set<string> => new Set(list.split(' '));

export const VOID = names(
  'area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr',
);
/** Template content is parsed without scripting, so `<noscript>` holds markup there */
const RAW_TEXT = names('script style xmp iframe noembed noframes plaintext');
const RCDATA = names('textarea title');
/** Start tags that close an open `<p>` (in button scope) before they are inserted (no-quirks mode) */
const CLOSES_P = names(
  'address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form header hgroup hr listing main menu nav ol p pre search section summary table ul xmp plaintext',
);
/** End tags that close their element when it is in scope, and whatever is still open inside it */
const BLOCK_END = names(
  'address article aside blockquote button center details dialog dir div dl fieldset figcaption figure footer form header hgroup listing main menu nav ol pre search section summary ul applet marquee object',
);
const HEADINGS = names('h1 h2 h3 h4 h5 h6');
const FORMATTING = names('a b big code em font i nobr s small strike strong tt u');
const IMPLIED_END = names('dd dt li optgroup option p rb rp rt rtc');
const SPECIAL = names(
  'address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp',
);
const SCOPE = names('applet caption html table td th marquee object template');
const TABLE_SCOPE = names('html table template');
const SECTIONS = names('tbody thead tfoot');
const TABLE_PARTS = names('caption col colgroup tbody td tfoot th thead tr');
/** HTML start tags that end foreign (svg / math) content */
const BREAKS_FOREIGN = names(
  'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var',
);

const isWhitespace = (s: string): boolean => /^[\t\n\f\r ]*$/.test(s);

// ─────────────────────────────────────────────────────────────
//  Tokenizer
// ─────────────────────────────────────────────────────────────

type Token =
  | { type: 'text'; data: string }
  | { type: 'comment'; data: string }
  | { type: 'start'; tag: string; attrs: Map<string, string>; selfClosing: boolean }
  | { type: 'end'; tag: string };

/**
 * The tokens of `html`. After a start tag, `rawContent()` says whether the element just opened
 * takes raw text (its content is text up to its own end tag); the tree builder decides, because
 * that depends on where the element went (an svg `<style>` is not raw text).
 */
function* tokenize(html: string, rawContent: () => boolean): Generator<Token> {
  let pos = 0;
  let text = '';
  const isAlpha = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);
  const until = (from: string, at: number): number => {
    const i = html.indexOf(from, at);
    return i === -1 ? html.length : i;
  };

  while (pos < html.length) {
    const c = html[pos]!;
    const next = html[pos + 1];
    const tagLike =
      c === '<' && (isAlpha(next) || next === '!' || next === '?' || (next === '/' && html[pos + 2] !== undefined));
    if (!tagLike) {
      text += c;
      pos++;
      continue;
    }
    if (text) yield { type: 'text', data: text };
    text = '';

    if (html.startsWith('<!--', pos)) {
      // `<!-->` and `<!--->` close at once; otherwise a comment ends at `-->` or `--!>`
      if (html[pos + 4] === '>' || html.startsWith('->', pos + 4)) {
        pos += html[pos + 4] === '>' ? 5 : 6;
        yield { type: 'comment', data: '' };
        continue;
      }
      let end = until('-->', pos + 4);
      const bang = until('--!>', pos + 4);
      const bangFirst = bang < end;
      if (bangFirst) end = bang;
      yield { type: 'comment', data: html.slice(pos + 4, end) };
      pos = Math.min(html.length, end + (bangFirst ? 4 : 3));
      continue;
    }
    if (next === '!' || next === '?') {
      const end = until('>', pos + 2);
      const body = html.slice(pos + (next === '!' ? 2 : 1), end);
      pos = Math.min(html.length, end + 1);
      // A doctype in element content is dropped; anything else is a bogus comment
      if (!/^doctype/i.test(body)) yield { type: 'comment', data: body };
      continue;
    }
    if (next === '/') {
      const end = until('>', pos + 2);
      const inner = html.slice(pos + 2, end);
      pos = Math.min(html.length, end + 1);
      if (isAlpha(inner[0])) yield { type: 'end', tag: inner.split(/[\t\n\f\r /]/)[0]!.toLowerCase() };
      else if (inner !== '') yield { type: 'comment', data: inner };
      continue;
    }

    // Start tag: the name, then attributes up to `>`
    let i = pos + 1;
    let tag = '';
    while (i < html.length && !/[\t\n\f\r />]/.test(html[i]!)) tag += html[i++]!;
    const attrs = new Map<string, string>();
    let selfClosing = false;
    for (;;) {
      while (i < html.length && /[\t\n\f\r ]/.test(html[i]!)) i++;
      if (i >= html.length) break;
      if (html[i] === '>') {
        i++;
        break;
      }
      if (html[i] === '/') {
        i++;
        if (html[i] === '>') {
          selfClosing = true;
          i++;
          break;
        }
        continue;
      }
      let name = html[i++]!;
      while (i < html.length && !/[\t\n\f\r />=]/.test(html[i]!)) name += html[i++]!;
      while (i < html.length && /[\t\n\f\r ]/.test(html[i]!)) i++;
      let value = '';
      if (html[i] === '=') {
        i++;
        while (i < html.length && /[\t\n\f\r ]/.test(html[i]!)) i++;
        const q = html[i];
        if (q === '"' || q === "'") {
          const end = until(q, i + 1);
          value = html.slice(i + 1, end);
          i = Math.min(html.length, end + 1);
        } else {
          while (i < html.length && !/[\t\n\f\r >]/.test(html[i]!)) value += html[i++]!;
        }
      }
      name = name.toLowerCase();
      if (!attrs.has(name)) attrs.set(name, value);
    }
    pos = i;
    tag = tag.toLowerCase();
    yield { type: 'start', tag, attrs, selfClosing };

    // Raw text and RCDATA content: text up to the element's own end tag
    if (rawContent()) {
      const close = new RegExp(`</${tag}[\\t\\n\\f\\r />]`, 'ig');
      close.lastIndex = pos;
      const m = close.exec(html);
      const end = m ? m.index : html.length;
      if (end > pos) yield { type: 'text', data: html.slice(pos, end) };
      pos = end;
    }
  }
  if (text) yield { type: 'text', data: text };
}

// ─────────────────────────────────────────────────────────────
//  Tree construction
// ─────────────────────────────────────────────────────────────

type Mode = 'body' | 'table' | 'tablebody' | 'row' | 'cell' | 'caption' | 'colgroup' | 'select';

/** Build the tree the browser makes of `html` (already cooked, see cookTemplateText). */
export const buildDomModel = (html: string): DomModel => {
  const roots: DomNode[] = [];
  const problems: string[] = [];
  const problem = (message: string): void => {
    if (!problems.includes(message)) problems.push(message);
  };

  /** Open elements, innermost last; `foreign` marks svg / math content */
  const stack: { node: DomNode; foreign: boolean }[] = [];
  /** Nesting inside a <template> element's content, which is not part of the tree */
  let templateContent = 0;
  /** The top level's own mode: a template's content is parsed by its first start tag's rules */
  let topMode: Mode | 'template' = 'template';
  /** Formatting elements closed without their own end tag: the browser re-opens them for later content */
  let stale: string[] = [];
  let skipNewline = false;
  let rawNext = false;

  const current = () => stack[stack.length - 1];
  const make = (kind: DomNode['kind'], tag = '', attrs = new Map<string, string>(), data = ''): DomNode => ({
    kind,
    tag,
    attrs,
    data,
    children: [],
    parent: null,
    order: -1,
  });
  const insert = (n: DomNode): void => {
    const parent = current()?.node ?? null;
    const list = parent ? parent.children : roots;
    const last = list[list.length - 1];
    if (n.kind === 'text' && last?.kind === 'text') {
      last.data += n.data;
      return;
    }
    n.parent = parent;
    list.push(n);
  };
  const open = (tag: string, attrs: Map<string, string>, foreign: boolean, isVoid: boolean): void => {
    const el = make('element', tag, attrs);
    insert(el);
    if (!isVoid) stack.push({ node: el, foreign });
    rawNext = !isVoid && !foreign && (RAW_TEXT.has(tag) || RCDATA.has(tag));
  };

  const inScope = (tag: string, boundaries: Set<string> = SCOPE, extra: string[] = []): boolean => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const o = stack[i]!;
      if (o.foreign) {
        if (o.node.tag === 'svg' || o.node.tag === 'math') return false;
        continue;
      }
      if (o.node.tag === tag) return true;
      if (boundaries.has(o.node.tag) || extra.includes(o.node.tag)) return false;
    }
    return false;
  };
  /** Pop up to and including the innermost element `match` accepts; formatting elements popped on the way go stale */
  const popUntil = (match: (tag: string) => boolean): void => {
    while (stack.length > 0) {
      const o = stack.pop()!;
      if (!o.foreign && match(o.node.tag)) return;
      if (FORMATTING.has(o.node.tag)) stale.push(o.node.tag);
    }
  };
  const is = (tag: string) => (t: string) => t === tag;
  const impliedEnds = (except?: string): void => {
    for (
      let top = current();
      top && !top.foreign && top.node.tag !== except && IMPLIED_END.has(top.node.tag);
      top = current()
    ) {
      stack.pop();
    }
  };
  const closeP = (): void => {
    if (!inScope('p', SCOPE, ['button'])) return;
    impliedEnds('p');
    popUntil(is('p'));
  };
  /** Content the browser wraps in re-opened formatting elements, when some went stale */
  const reconstruct = (): void => {
    if (stale.length > 0) {
      problem(`<${stale[0]}> is closed by another element's end tag, so the browser re-opens it: close it explicitly`);
    }
  };
  const mode = (): Mode | 'template' => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const o = stack[i]!;
      if (o.foreign) continue;
      switch (o.node.tag) {
        case 'select':
          return 'select';
        case 'td':
        case 'th':
          return 'cell';
        case 'tr':
          return 'row';
        case 'tbody':
        case 'thead':
        case 'tfoot':
          return 'tablebody';
        case 'caption':
          return 'caption';
        case 'colgroup':
          return 'colgroup';
        case 'table':
          return 'table';
      }
    }
    return topMode;
  };
  const inForeign = (): boolean => {
    const top = current();
    if (!top?.foreign) return false;
    // HTML integration points: their content is HTML again
    return !/^(foreignobject|desc|title|mi|mo|mn|ms|mtext)$/.test(top.node.tag);
  };

  const startTag = (tag: string, attrs: Map<string, string>, selfClosing: boolean): void => {
    if (templateContent > 0) {
      // Inside a <template> element's content: only its nesting is followed
      if (tag === 'template') templateContent++;
      return;
    }
    if (inForeign()) {
      const breaksOut =
        BREAKS_FOREIGN.has(tag) || (tag === 'font' && ['color', 'face', 'size'].some((a) => attrs.has(a)));
      if (!breaksOut) {
        open(tag, attrs, true, selfClosing);
        return;
      }
      while (inForeign()) stack.pop();
    }
    if (tag === 'template') {
      open(tag, attrs, false, true);
      templateContent = 1;
      return;
    }

    const m = mode();
    if (m === 'template') {
      topMode =
        tag === 'caption' || tag === 'colgroup' || SECTIONS.has(tag)
          ? 'table'
          : tag === 'col'
            ? 'colgroup'
            : tag === 'tr'
              ? 'tablebody'
              : tag === 'td' || tag === 'th'
                ? 'row'
                : 'body';
      startTag(tag, attrs, selfClosing);
      return;
    }

    if (m === 'table' || m === 'tablebody' || m === 'row') {
      if (m === 'row') {
        if (tag === 'td' || tag === 'th') return open(tag, attrs, false, false);
        if (TABLE_PARTS.has(tag)) {
          // after a template's top-level cell, a row part has no row to close: the browser drops it
          if (!stack.some((o) => o.node.tag === 'tr')) return;
          popUntil(is('tr'));
          return startTag(tag, attrs, selfClosing);
        }
      }
      if (m === 'tablebody') {
        if (tag === 'tr') return open(tag, attrs, false, false);
        if (tag === 'td' || tag === 'th') {
          open('tr', new Map(), false, false);
          return startTag(tag, attrs, selfClosing);
        }
        if (TABLE_PARTS.has(tag) && stack.some((o) => SECTIONS.has(o.node.tag))) {
          popUntil((t) => SECTIONS.has(t));
          return startTag(tag, attrs, selfClosing);
        }
      }
      if (m === 'table') {
        if (tag === 'caption' || tag === 'colgroup' || SECTIONS.has(tag)) return open(tag, attrs, false, false);
        if (tag === 'col') {
          open('colgroup', new Map(), false, false);
          return startTag(tag, attrs, selfClosing);
        }
        if (tag === 'tr' || tag === 'td' || tag === 'th') {
          open('tbody', new Map(), false, false);
          return startTag(tag, attrs, selfClosing);
        }
      }
      if (tag === 'script' || tag === 'style') return open(tag, attrs, false, false);
      if (tag === 'input' && attrs.get('type')?.toLowerCase() === 'hidden') return open(tag, attrs, false, true);
      problem(`the browser moves <${tag}> out of the table: only table parts go directly in <table>, <tbody> and <tr>`);
      return open(tag, attrs, false, VOID.has(tag));
    }

    if (m === 'colgroup') {
      if (tag === 'col') return open(tag, attrs, false, true);
      if (current()?.node.tag === 'colgroup') {
        stack.pop();
        return startTag(tag, attrs, selfClosing);
      }
      // at the top level of a <col> template, other elements are dropped
      return;
    }

    if (m === 'select') {
      if (tag === 'option' || tag === 'optgroup' || tag === 'hr') {
        if (current()?.node.tag === 'option') stack.pop();
        if (tag !== 'option' && current()?.node.tag === 'optgroup') stack.pop();
        return open(tag, attrs, false, tag === 'hr');
      }
      if (tag === 'script') return open(tag, attrs, false, false);
      problem(`<${tag}> inside <select>: browsers do not agree on whether it is kept`);
      return open(tag, attrs, false, VOID.has(tag));
    }

    if ((m === 'cell' || m === 'caption') && TABLE_PARTS.has(tag)) {
      // A table part closes the open cell (or caption) and is parsed again in the row or table
      impliedEnds();
      popUntil(m === 'cell' ? (t) => t === 'td' || t === 'th' : is('caption'));
      stale = [];
      return startTag(tag, attrs, selfClosing);
    }

    // ── in body ──
    // The browser drops document-level tags, and table parts outside a table
    if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'frameset' || tag === 'frame') return;
    if (TABLE_PARTS.has(tag)) return;
    if (tag === 'svg' || tag === 'math') {
      reconstruct();
      return open(tag, attrs, true, selfClosing);
    }
    if (tag === 'li' || tag === 'dd' || tag === 'dt') {
      const same = tag === 'li' ? is('li') : (t: string) => t === 'dd' || t === 'dt';
      for (let i = stack.length - 1; i >= 0; i--) {
        const o = stack[i]!;
        if (o.foreign) break;
        const t = o.node.tag;
        if (same(t)) {
          impliedEnds(t);
          popUntil(is(t));
          break;
        }
        if (SPECIAL.has(t) && t !== 'address' && t !== 'div' && t !== 'p') break;
      }
      closeP();
      return open(tag, attrs, false, false);
    }
    if (HEADINGS.has(tag)) {
      closeP();
      const top = current();
      if (top && !top.foreign && HEADINGS.has(top.node.tag)) stack.pop();
      return open(tag, attrs, false, false);
    }
    if (CLOSES_P.has(tag)) {
      closeP();
      // A <form> inside another is dropped
      if (tag === 'form' && stack.some((o) => o.node.tag === 'form')) return;
      open(tag, attrs, false, tag === 'hr');
      if (tag === 'pre' || tag === 'listing') skipNewline = true;
      return;
    }
    if (tag === 'button' && inScope('button')) {
      impliedEnds();
      popUntil(is('button'));
    }
    if ((tag === 'a' || tag === 'nobr') && inScope(tag)) {
      problem(`<${tag}> inside another <${tag}>: the browser closes the outer one first`);
    }
    if ((tag === 'option' || tag === 'optgroup') && current()?.node.tag === 'option') stack.pop();
    if (tag === 'image') tag = 'img';
    reconstruct();
    open(tag, attrs, false, VOID.has(tag));
    if (tag === 'textarea') skipNewline = true;
  };

  const endTag = (tag: string): void => {
    if (templateContent > 0) {
      if (tag === 'template') templateContent--;
      return;
    }
    // Foreign content: an end tag closes the innermost foreign element of that name
    if (current()?.foreign) {
      for (let i = stack.length - 1; i >= 0 && stack[i]!.foreign; i--) {
        if (stack[i]!.node.tag === tag) {
          stack.length = i;
          return;
        }
      }
    }
    const m = mode();
    if (m === 'select' && tag !== 'select' && tag !== 'option' && tag !== 'optgroup') return;
    if (tag === 'p') {
      if (!inScope('p', SCOPE, ['button'])) {
        // A stray </p> becomes an empty <p>
        reconstruct();
        open('p', new Map(), false, true);
        return;
      }
      impliedEnds('p');
      popUntil(is('p'));
      return;
    }
    if (tag === 'br') {
      // </br> is read as <br>
      reconstruct();
      open('br', new Map(), false, true);
      return;
    }
    if (tag === 'li' || tag === 'dd' || tag === 'dt') {
      if (!inScope(tag, SCOPE, tag === 'li' ? ['ol', 'ul'] : [])) return;
      impliedEnds(tag);
      popUntil(is(tag));
      return;
    }
    if (BLOCK_END.has(tag)) {
      if (!inScope(tag)) return;
      impliedEnds();
      popUntil(is(tag));
      return;
    }
    if (HEADINGS.has(tag)) {
      if (![...HEADINGS].some((h) => inScope(h))) return;
      impliedEnds();
      popUntil((t) => HEADINGS.has(t));
      return;
    }
    if (TABLE_PARTS.has(tag) || tag === 'table') {
      if (!inScope(tag, TABLE_SCOPE)) return;
      impliedEnds();
      popUntil(is(tag));
      if (tag === 'td' || tag === 'th' || tag === 'caption') stale = [];
      return;
    }
    if (FORMATTING.has(tag)) {
      const top = current();
      if (top && !top.foreign && top.node.tag === tag) {
        stack.pop();
        stale = stale.filter((t) => t !== tag);
        return;
      }
      if (stack.some((o) => !o.foreign && o.node.tag === tag)) {
        problem(
          `</${tag}> does not close the innermost open element, so the browser restructures the markup around it`,
        );
        popUntil(is(tag));
      }
      stale = stale.filter((t) => t !== tag);
      return;
    }
    // Any other end tag closes the innermost open element of that name, unless a special element is
    // open inside it (then the end tag is dropped)
    for (let i = stack.length - 1; i >= 0; i--) {
      const o = stack[i]!;
      if (o.node.tag === tag) {
        impliedEnds(tag);
        popUntil(is(tag));
        return;
      }
      if (!o.foreign && SPECIAL.has(o.node.tag)) return;
    }
  };

  const text = (data: string): void => {
    if (skipNewline && data.startsWith('\n')) data = data.slice(1);
    skipNewline = false;
    if (!data || templateContent > 0) return;
    const top = current();
    if (top && !top.foreign && (RAW_TEXT.has(top.node.tag) || RCDATA.has(top.node.tag))) {
      insert(make('text', '', new Map(), data));
      return;
    }
    const m = mode();
    if (m === 'table' || m === 'tablebody' || m === 'row') {
      if (!isWhitespace(data)) problem('the browser moves text out of the table: text belongs in a cell');
    } else if (m === 'colgroup') {
      if (!isWhitespace(data)) problem('the browser moves text out of the table: text belongs in a cell');
    } else if (m !== 'select') {
      reconstruct();
    }
    insert(make('text', '', new Map(), data));
  };

  for (const token of tokenize(html, () => rawNext)) {
    rawNext = false;
    if (token.type === 'start') {
      skipNewline = false;
      startTag(token.tag, token.attrs, token.selfClosing);
    } else if (token.type === 'end') {
      skipNewline = false;
      endTag(token.tag);
    } else if (token.type === 'comment') {
      skipNewline = false;
      if (templateContent === 0) insert(make('comment', '', new Map(), token.data));
    } else {
      text(token.data);
    }
  }

  // Number the elements in document order
  const elements: DomNode[] = [];
  const number = (list: DomNode[]): void => {
    for (const n of list) {
      if (n.kind !== 'element') continue;
      n.order = elements.length;
      elements.push(n);
      number(n.children);
    }
  };
  number(roots);
  return { roots, elements, problems };
};
