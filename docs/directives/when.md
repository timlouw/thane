# when — Conditional Rendering

`when()` shows content while a condition is truthy. It has two forms:

```typescript
// In an element's tag: the element shows while the condition is truthy
html`<p ${when(open())}>Now you see me</p>`;

// In content: a template while the condition is truthy, and another (or nothing) while it is not
html`${when(open(), html`<p>Open</p>`, html`<p>Closed</p>`)}`;
html`${when(open(), html`<p>Open</p>`)}`;

// Narrowing: the branch is a function of the condition's value, typed without null
html`${when(user(), (u) => html`<p>${u.name}</p>`)}`;
```

Hidden content is not in the DOM: its nodes are removed and its bindings disposed. Showing it again clones
it back and binds it to the current signal values.

## In an Element's Tag

```typescript
import { defineComponent, signal, html, when } from 'thane';

export const Toggle = defineComponent(() => {
  const show = signal(true);

  return {
    template: html`
      <button @click=${() => show(!show())}>Toggle</button>
      <p ${when(show())}>Now you see me</p>
    `,
  };
});
```

When `show()` is `false`, the `<p>` element is removed from the DOM; two empty comments mark where it goes.
When `show()` becomes `true`, the element is cloned back between them. This form applies to the one element
that carries it: to show text, or several elements, use the content form.

## In Content

```typescript
export const LoginStatus = defineComponent(() => {
  const isLoggedIn = signal(false);

  return {
    template: html`
      ${when(
        isLoggedIn(),
        html`<p>Welcome back! <button @click=${() => isLoggedIn(false)}>Log out</button></p>`,
        html`<p>Please <button @click=${() => isLoggedIn(true)}>log in</button></p>`,
      )}
    `,
  };
});
```

The second argument shows while the condition is truthy, the third while it is not. Without a third argument
nothing shows while it is not. Only the branch on screen is in the DOM, and only it has live bindings.

A branch is an `html` template, a fragment (a `const` holding one, or one another module exports), or a child
component call: `when(open(), Dialog({ title }))`. It may hold any number of nodes, text included:

```typescript
template: html`
  ${when(
    isLoggedIn(),
    html`<h2>Welcome back, ${name()}</h2>
      <button @click=${logout}>Log out</button>`,
    html`Please log in to continue.`,
  )}
`;
```

When the condition changes, every node of the old branch goes, rows and child components at its top level
included, and every node of the new one comes in.

The content form can also be written with JavaScript's own operators: ``${open() ? html`…` : html`…`}`` and
``${open() && html`…`}`` compile to the same `when()` (see
[JavaScript Control Flow](../templates.md#javascript-control-flow)).

## Narrowing

The then-branch can be a function of the condition's value. It receives the value typed without `null`,
`undefined` and the other falsy types, so a branch about a value that may be missing reads it directly:

```typescript
const user = signal<User | null>(null);

template: html`
  ${when(
    user(),
    (u) => html`<h2>${u.name}</h2>
      <button @click=${() => greet(u)}>Greet</button>
      ${Avatar({ url: u.avatarUrl })}`,
    html`<p>Signed out</p>`,
  )}
`;
```

The function is not called at run time: the compiler reads its body as the branch, with each use of the
parameter replaced by the condition, `user()`. Each binding of the branch therefore follows the condition's
signals, and a handler reads the value when it runs. The condition is evaluated once for each use, so keep it a
signal read or a short expression of one; give a long one a `computed()`.

A signal that may be missing is a condition too: for `const found = products().find((p) => p().id === id)`, a
`Signal<Product> | undefined`, the branch reads the signal while there is one, and follows it:

```typescript
html`${when(found, (product) => html`<h1>${product().title}</h1>`, html`<p>No such product</p>`)}`;
```

Its bindings subscribe to the signal when the branch shows, so they never subscribe to one that is not there. Read
as `found?.()` in a binding instead, it is a build error (THANE018): that binding would subscribe as the component
mounts. A signal that is always there is still not a condition: `when(open)` is a type error; `when(open())` is
meant.

The function takes one parameter, a name, and its body is an `html` template (``(u) => html`…` ``); anything
else is a build error (THANE014). In a `repeat()` row the condition can read the row's item:
``when(row.owner, (owner) => html`<b>${owner.name}</b>`)``.

## Conditions

A condition is any expression; it is read for its truthiness, as in JavaScript:

```typescript
template: html`
  <div ${when(count() > 0)}>Count is positive</div>
  <div ${when(items().length === 0)}>No items</div>
  ${when(!isLoading() && error() === null, html`<p>Content loaded</p>`)}
`;
```

Pass the value, not the signal: `when(open())`. A signal is a function, which is always truthy and never
changes, so `when(open)` is a type error.

## How It Works

1. At **build time**, the compiler compiles the element or each branch as a template of its own, and puts
   comment anchors in its place: two around content with one branch, three between two branches.
2. At **runtime**, the binding code subscribes to the signals the condition reads.
3. When the condition changes, the content of the branch that hides is removed and its subscriptions disposed;
   the branch that shows is cloned between its anchors and bound.

The compiler pre-renders the branch the signals' initial values select into the static template. When the
condition cannot be evaluated at build time (it reads a plain local variable, not a signal), nothing is
pre-rendered and the runtime decides at mount.

A `when()` cannot be on the root element of a `repeat()` row (THANE008): filter the list instead, or put the
`when()` on an element inside the row. A content `when()` with only a condition, more than three arguments,
or a branch that is not a template is a build error (THANE014).

## Lifecycle

When `when()` hides a child component, that component's `onDestroy` runs. When shown again, it mounts as a new
instance:

```typescript
export const Timer = defineComponent(() => {
  const elapsed = signal(0);
  let id: number;

  return {
    template: html`<p>Elapsed: ${elapsed()}s</p>`,
    onMount: () => {
      id = setInterval(() => elapsed(elapsed() + 1), 1000);
    },
    onDestroy: () => clearInterval(id),
  };
});

export const Parent = defineComponent(() => {
  const showTimer = signal(true);

  return {
    template: html`
      <button @click=${() => showTimer(!showTimer())}>Toggle Timer</button>
      ${when(showTimer(), Timer())}
    `,
  };
});
```

Hiding the timer stops the interval. Showing it again starts a new interval from zero.

## Nesting

A branch can hold anything a template can: text, attribute and style bindings, event handlers, child
components, and other directives. A `when()` can in turn be inside `repeat()` rows and other `when()` branches,
at any depth:

```typescript
template: html`
  <div ${when(isLoggedIn())}>
    <p>Welcome back!</p>
    <button @click=${logout}>Log out</button>
    ${when(hasNotifications(), html`<ul>${repeat(notifications(), (n) => html`<li>${n.text}</li>`)}</ul>`)}
  </div>
`;
```

## Complex Example — Cart Page

From the [e-commerce app](../examples/e-commerce-app.md):

```typescript
template: html`
  <div class="cartContainer">
    ${when(
      cartCount() === 0,
      html`<p>Your cart is empty. <a href="/">Select some items first.</a></p>`,
      html`
        <ul class="cartList">
          ${repeat(
            cartProducts(),
            (product) => html`
              <li class="cartItem">
                <h3>${product().title}</h3>
                <p>Price: R${(product().price * product().cartCount).toFixed(2)}</p>
                <button @click=${() => removeItem(product().id)}>Remove</button>
              </li>
            `,
            { key: (product) => product().id },
          )}
        </ul>
        <h2>Total: R${totalPrice()}</h2>
      `,
    )}
  </div>
`;
```

When the cart becomes empty, the whole list and the total go, and the empty message comes in.

← [Back to Directives](README.md) · [Back to Docs](../README.md)
