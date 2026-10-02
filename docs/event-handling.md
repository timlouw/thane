# Event Handling

Bind DOM events using the `@event` syntax inside `html` templates.

## Basic Event Binding

```typescript
const handleClick = () => console.log('Clicked!');

template: html`<button @click=${handleClick}>Click me</button>`;
```

The compiler transforms `@click=${handler}` into an `addEventListener('click', handler)` call.

A function (an arrow function or a function expression) or a reference (`handler`, `menu.close`) is the
listener: it receives the event. Any other expression, such as a call, runs on the event as written:
`@click=${navigate('/')}` navigates on click, and `@click=${select(item.id)}` selects the item.

Nothing reads the value of such an expression, so one whose value is a function is a type error: in
`@click=${makeHandler(item.id)}` the call would run on every click and the handler it returns would never be
called, and so would `@click=${open() ? close : show}`. Pass the handler itself, or call it in one:
`@click=${(e) => (open() ? close : show)(e)}`.

## Inline Handlers

Use inline arrow functions directly:

```typescript
template: html`<button @click=${() => count(count() + 1)}>+1</button>`;
```

## Event Object

Handlers receive the standard DOM event object. The type check that `thane build`, `thane dev` and
`thane typecheck` run gives it the event's type, as lib.dom defines it: in `@click=${(e) => …}`, `e` is a
`PointerEvent`, and in `@keydown=${(e) => …}` a `KeyboardEvent`. A handler written for another event is a
type error there:

```typescript
template: html`<button @click=${(e: KeyboardEvent) => e.key}>Go</button>`;
// error TS1360: Type '(e: KeyboardEvent) => string' does not satisfy the expected type 'ThaneEventListener<"click">'.
```

Outside a list row the handler is the element's own listener, so `e.currentTarget` is typed as the element: in `<input @input=${(e) => query(e.currentTarget.value)} />` it is an `HTMLInputElement`. A handler in a `repeat()` row is delegated to the list container, so there it stays `EventTarget | null`, unless a modifier gives the row's element a listener of its own (`.self`, `.once`, `.passive`, `.capture`; see [Modifiers](#modifiers)). An event that lib.dom does not know, such as a custom event, is typed `any`.

### In the Editor

The editor sees the same types with Thane's TypeScript plugin: hovers, completions and errors inside handlers.
Add it to `tsconfig.json`, and in VS Code choose "Use Workspace Version" of TypeScript:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "thane/ts-plugin" }]
  }
}
```

The plugin keeps a second language service over the sources with the handlers typed, and answers from it for
a file with handlers (its errors) and for a position inside a handler (hovers, completions, signature help);
everything else is the editor's own. Without the plugin an untyped parameter is `any` in the editor, and the
build's type check still reports a wrong one. A handler can also be typed explicitly:

```typescript
const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  query(target.value);
};

template: html`<input @input=${handleInput} />`;
```

For mouse events:

```typescript
const handleClick = (event: MouseEvent) => {
  console.log(event.clientX, event.clientY);
};

template: html`<div @click=${handleClick}>Click anywhere</div>`;
```

## Common Events

```typescript
template: html`
  <input @input=${onInput} @change=${onChange} @focus=${onFocus} @blur=${onBlur} />
  <form @submit=${onSubmit}>
    <button @click=${onClick}>Submit</button>
  </form>
  <div @keydown=${onKeyDown} @keyup=${onKeyUp}></div>
`;
```

## Modifiers

Modifiers after the event name do the common work of a handler, written once in the attribute:

```typescript
template: html`
  <form @submit.prevent=${save}>…</form>
  <button @click.stop=${() => addToCart(product.id)}>Add to Cart</button>
  <input @keydown.enter=${search} @keydown.esc=${() => query('')} />
  <div class="backdrop" @click.self=${close}>…</div>
  <button @click.once=${start}>Start</button>
`;
```

| Modifier | What it does |
|:---------|:-------------|
| `.prevent` | calls `event.preventDefault()` before the handler |
| `.stop` | calls `event.stopPropagation()` before the handler |
| `.self` | runs the handler only when the event's target is the element itself, not one of its children |
| `.enter`, `.tab`, `.delete` (Backspace or Delete), `.esc` or `.escape`, `.space`, `.up`, `.down`, `.left`, `.right` | runs the handler only for that key; several keys run it for any of them (`@keydown.enter.esc`) |
| `.once` | runs the handler once: on the first event the other modifiers let through, then the listener is removed |
| `.passive` | registers a passive listener, which the browser does not wait for (scroll and touch events); it cannot prevent the default |
| `.capture` | runs the handler in the capture phase, before the handlers of the element the event happened on |

Modifiers combine in any order: `@keydown.enter.prevent`, `@click.self.once`. The guards (`.self` and the keys) are checked
first, then `.prevent` and `.stop` run, then the handler. An unknown modifier is a build error that names the one it is
close to (THANE015: `'prevnet' is not an event modifier: did you mean 'prevent'?`), and so is `.passive` with
`.prevent`.

In a list row, a handler is delegated: the list has one listener on its container for each event. `.self`, `.once`,
`.passive` and `.capture` give each row's element a listener of its own instead, since each depends on the element
the listener is on.

The handler can still call the event's methods itself, for a condition the modifiers cannot express:

```typescript
const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === 's' && event.ctrlKey) {
    event.preventDefault();
    save();
  }
};
```

## Navigate on Click

With the router, a plain `<a href="/about">` to a route already navigates in the app ([Links](routing.md#links)). To navigate from a click on something else, bind `navigate()` directly:

```typescript
template: html`
  <a @click=${navigate('/')}>Home</a>
  <a @click=${navigate('/about')}>About</a>
`;
```

On a link with an `href`, add `.prevent` so the browser does not follow it as well:

```typescript
template: html`<a href="/" @click.prevent=${navigate('/')}>Home</a>`;
```

← [Back to Docs](README.md)
