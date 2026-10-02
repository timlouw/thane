/**
 * The type check's rewrite of template event handlers: which substitutions it types, and how a
 * position in the rewritten text maps back to the source as written.
 */
import { describe, expect, test } from 'bun:test';
import { rewriteTemplates } from './template-types.js';

const inTemplate = (markup: string): string => `const t = html\`${markup}\`;`;
const rewritten = (markup: string): string | undefined => rewriteTemplates('x.ts', inTemplate(markup))?.text;

describe('rewriteTemplates', () => {
  test('a listener is typed by its event: an arrow, a function, a reference, a member reference', () => {
    expect(rewritten('<b @click=${(e) => go(e)}>x</b>')).toBe(
      inTemplate("<b @click=${((e) => go(e)) satisfies ThaneEventListener<'click', 'b'>}>x</b>"),
    );
    expect(rewritten('<b @keydown=${function (e) { go(e); }}></b>')).toBe(
      inTemplate("<b @keydown=${(function (e) { go(e); }) satisfies ThaneEventListener<'keydown', 'b'>}></b>"),
    );
    expect(rewritten('<b @input=${onInput} @blur=${menu.close}></b>')).toBe(
      inTemplate(
        "<b @input=${(onInput) satisfies ThaneEventListener<'input', 'b'>} @blur=${(menu.close) satisfies ThaneEventListener<'blur', 'b'>}></b>",
      ),
    );
  });

  test('modifiers, a quoted value and a self-closing tag keep the event name', () => {
    expect(rewritten('<form @submit.prevent.stop="${onSubmit}"/>')).toBe(
      inTemplate(`<form @submit.prevent.stop="\${(onSubmit) satisfies ThaneEventListener<'submit', 'form'>}"/>`),
    );
  });

  test('a handler in a .map() row is delegated like a repeat() row: typed without its element', () => {
    expect(rewritten('<ul>${items().map((i) => html`<li @click=${(e) => go(i, e)}>x</li>`)}</ul>')).toContain(
      "((e) => go(i, e)) satisfies ThaneEventListener<'click'>}",
    );
  });

  test("a row's handler with a listener of its element's own (.self, .once, .passive, .capture) is typed with it", () => {
    for (const modifier of ['self', 'once', 'passive', 'capture']) {
      expect(
        rewritten(`<ul>\${repeat(items(), (i) => html\`<li @click.${modifier}=\${(e) => go(i, e)}>x</li>\`)}</ul>`),
      ).toContain("((e) => go(i, e)) satisfies ThaneEventListener<'click', 'li'>}");
    }
    expect(rewritten('<ul>${repeat(items(), (i) => html`<li @click.stop=${(e) => go(i, e)}>x</li>`)}</ul>')).toContain(
      "((e) => go(i, e)) satisfies ThaneEventListener<'click'>}",
    );
  });

  test('the element is the tag still open before the attribute, past other substitutions', () => {
    expect(rewritten('<input class=${c} value=${v} @input=${onInput} />')).toContain(
      "satisfies ThaneEventListener<'input', 'input'>",
    );
    expect(rewritten('<p>a</p><my-widget @change=${onChange}></my-widget>')).toContain(
      "satisfies ThaneEventListener<'change', 'my-widget'>",
    );
  });

  test('a handler in a nested template (a row) is typed too, without its element: rows are delegated', () => {
    const source = 'const t = html`<ul>${repeat(items(), (it) => html`<li @click=${() => pick(it)}>x</li>`)}</ul>`;';
    expect(rewriteTemplates('x.ts', source)?.text).toContain(
      "@click=${(() => pick(it)) satisfies ThaneEventListener<'click'>}",
    );
  });

  test('an expression that runs on the event is checked not to be a function, which nothing would call', () => {
    expect(rewritten("<b @click=${navigate('/')}>x</b>")).toBe(
      inTemplate("<b @click=${__thaneEventCall(navigate('/'))}>x</b>"),
    );
    expect(rewritten('<b @click=${run(() => x)} @blur=${open() ? close : show}>x</b>')).toBe(
      inTemplate('<b @click=${__thaneEventCall(run(() => x))} @blur=${__thaneEventCall(open() ? close : show)}>x</b>'),
    );
  });

  test("a value in content is typed as what content shows; one in a tag, or not an event's whole value, as an attribute's", () => {
    expect(rewritten('<b title=${onClick} data-x="@click=${onClick}">${n}</b>')).toBe(
      inTemplate(
        '<b title=${(onClick) satisfies ThaneAttribute} data-x="@click=${(onClick) satisfies ThaneAttribute}">${(n) satisfies ThaneContent}</b>',
      ),
    );
    expect(rewritten('<p>mail @me=${name}</p>')).toBe(inTemplate('<p>mail @me=${(name) satisfies ThaneContent}</p>'));
    expect(rewritten('<b @click=${a}${b}>x</b><i ${when(on())}></i>')).toBe(
      inTemplate(
        '<b @click=${(a) satisfies ThaneAttribute}${(b) satisfies ThaneAttribute}>x</b><i ${(when(on())) satisfies ThaneAttribute}></i>',
      ),
    );
  });

  test('a value that holds a template is typed, and so are the values of the template', () => {
    expect(rewritten('${when(on(), html`<b class=${c}>${n}</b>`)}')).toBe(
      inTemplate(
        '${(when(on(), html`<b class=${(c) satisfies ThaneAttribute}>${(n) satisfies ThaneContent}</b>`)) satisfies ThaneContent}',
      ),
    );
    // A template that is a substitution's whole value: the inner one opens after the outer and closes before it
    expect(rewritten('${html`${n}`}')).toBe(
      inTemplate('${(html`${(n) satisfies ThaneContent}`) satisfies ThaneContent}'),
    );
  });

  test('left as written: other tags, and css', () => {
    expect(rewriteTemplates('x.ts', 'const s = css`@media (x) { a { b: ${c} } }`;')).toBeNull();
    expect(rewriteTemplates('x.ts', 'const t = other`<b @click=${onClick}></b>`;')).toBeNull();
    expect(rewriteTemplates('x.ts', 'const t = html`<b>static</b>`;')).toBeNull();
  });

  test('a span maps back to the source as written; one that starts in inserted text is the handler', () => {
    const source = inTemplate('<b @click=${onA} @blur=${onB}></b>');
    const result = rewriteTemplates('x.ts', source)!;
    for (const name of ['onA', 'onB', '></b>', 'const']) {
      expect(result.toOriginal(result.text.indexOf(name), name.length)).toEqual({
        start: source.indexOf(name),
        length: name.length,
      });
    }
    const onA = { start: source.indexOf('onA'), length: 'onA'.length };
    expect(result.toOriginal(result.text.indexOf('(onA'), 4)).toEqual(onA);
    expect(result.toOriginal(result.text.indexOf('ThaneEventListener'), 18)).toEqual(onA);
    // A span that ends in inserted text ends where the insertion is
    expect(result.toOriginal(result.text.indexOf('onA'), 5)).toEqual(onA);
    expect(result.toOriginal(0, result.text.length)).toEqual({ start: 0, length: source.length });
  });
});

describe('from the source to the rewritten text', () => {
  test('a position maps forward: before, inside and after a handler; inSlot covers its ends', () => {
    const source = inTemplate('<b @click=${onA} @blur=${(e) => e.type}></b>');
    const result = rewriteTemplates('x.ts', source)!;
    for (const name of ['onA', '(e) =>', 'e.type', '></b>', 'const']) {
      expect(result.text.slice(result.toRewritten(source.indexOf(name))).startsWith(name)).toBe(true);
    }
    const handler = source.indexOf('(e) => e.type');
    expect(result.inSlot(handler)).toBe(true);
    expect(result.inSlot(handler + '(e) => e.type'.length)).toBe(true);
    expect(result.inSlot(source.indexOf('></b>') + 1)).toBe(false);
  });
});
