# Event Handling

Bind DOM events using the `@event` syntax inside `html` templates.

## Basic Event Binding

```typescript
const handleClick = () => console.log('Clicked!');

template: html`<button @click=${handleClick}>Click me</button>`
```

The compiler transforms `@click=${handler}` into an `addEventListener('click', handler)` call.

## Inline Handlers

Use inline arrow functions directly:

```typescript
template: html`<button @click=${() => count(count() + 1)}>+1</button>`
```

## Event Object

Handlers receive the standard DOM event object. Type it explicitly for full IDE support:

```typescript
const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  query(target.value);
};

template: html`<input @input=${handleInput} />`
```

For mouse events:

```typescript
const handleClick = (event: MouseEvent) => {
  console.log(event.clientX, event.clientY);
};

template: html`<div @click=${handleClick}>Click anywhere</div>`
```

## Common Events

```typescript
template: html`
  <input @input=${onInput} @change=${onChange} @focus=${onFocus} @blur=${onBlur} />
  <form @submit=${onSubmit}>
    <button @click=${onClick}>Submit</button>
  </form>
  <div @keydown=${onKeyDown} @keyup=${onKeyUp}></div>
`
```

## Event Methods

Call `.stopPropagation()` or `.preventDefault()` inside the handler:

```typescript
const addCurrentToCart = (event: Event) => {
  event.stopPropagation(); // prevent click from bubbling to parent
  addToCart(productId);
};

template: html`<button @click=${addCurrentToCart}>Add to Cart</button>`
```

This pattern is used in the [e-commerce example app](examples/e-commerce-app.md) where a card click navigates to details, but the "Add to Cart" button inside the card needs to stop propagation.

## Prevent Default

```typescript
const handleSubmit = (event: Event) => {
  event.preventDefault();
  // custom form handling
};

template: html`<form @submit=${handleSubmit}>...</form>`
```

## Navigate on Click

When using the router, bind `navigate()` directly to click handlers:

```typescript
template: html`
  <a @click=${navigate('/')}>Home</a>
  <a @click=${navigate('/about')}>About</a>
`
```

Or with `preventDefault` for anchor elements:

```typescript
const goHome = (event: Event) => {
  event.preventDefault();
  navigate('/');
};

template: html`<a href="/" @click=${goHome}>Home</a>`
```

← [Back to Docs](README.md)
