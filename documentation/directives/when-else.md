# whenElse — If/Else Rendering

`whenElse()` renders one of two template branches based on a boolean condition. Only the active branch exists in the DOM at any time, and only the active branch has live bindings.

## Syntax

```typescript
${whenElse(condition(), thenTemplate, elseTemplate)}
```

Both the `then` and `else` branches must be `html` tagged template results assigned to `const` variables (or inline template literals within the `whenElse` call).

## Basic Usage

```typescript
import { defineComponent, signal } from 'thane';

export const LoginStatus = defineComponent(() => {
  const isLoggedIn = signal(false);

  return {
    template: html`
      ${whenElse(
        isLoggedIn(),
        html`<p>Welcome back! <button @click=${() => isLoggedIn(false)}>Log out</button></p>`,
        html`<p>Please <button @click=${() => isLoggedIn(true)}>log in</button></p>`,
      )}
    `,
  };
});
```

## Branch Switching

When the condition changes:

1. The active branch is removed from the DOM.
2. All bindings in the removed branch are disposed.
3. The new branch is cloned and inserted.
4. Bindings in the new branch are initialized.

Only one branch is ever in the DOM — they are **mutually exclusive**.

## Bindings Inside Branches

Each branch can contain its own signals, events, and directives:

```typescript
const count = signal(0);

template: html`
  ${whenElse(
    count() === 0,
    html`
      <p>Cart is empty. <a @click=${navigate('/')}>Browse products</a></p>
    `,
    html`
      <p>You have ${count()} items</p>
      <button @click=${() => count(0)}>Clear cart</button>
    `,
  )}
`
```

Signals inside both branches remain reactive — `${count()}` in the `else` branch updates when `count` changes.

## Complex Example — Cart Page

From the [e-commerce app](../examples/e-commerce-app.md):

```typescript
template: html`
  <div class="cartContainer">
    ${whenElse(
      cartCount() === 0,
      html`<p>Your cart is empty. <a href="/" @click=${goHome}>Select some items first.</a></p>`,
      html`
        <ul class="cartList">
          ${repeat(
            cartProducts(),
            (productSignal) => html`
              <li class="cartItem">
                <h3>${productSignal().title}</h3>
                <p>Price: R${(productSignal().price * productSignal().cartCount).toFixed(2)}</p>
                <button @click=${() => removeItem(productSignal().id)}>Remove</button>
              </li>
            `,
            null,
            (productSignal) => productSignal().id,
          )}
        </ul>
        <h2>Total: R${totalPrice()}</h2>
      `,
    )}
  </div>
`
```

This nests `repeat()` inside the `else` branch of `whenElse()`. When the cart becomes empty, the entire list and total are removed and replaced with the empty message.

## Nesting

`whenElse` can be nested inside:

- `repeat()` items
- Other `whenElse()` branches
- `when()` blocks

And can contain:

- `when()` blocks
- `repeat()` directives
- Child components

← [Back to Directives](README.md) · [Back to Docs](../README.md)
