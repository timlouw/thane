# Getting Started

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Node.js](https://nodejs.org/) >= 18 *(only for Playwright E2E tests)*

## Installation

```bash
bun add thane
```

Add the Thane client types to your `tsconfig.json` so TypeScript recognizes `.css` imports:

```json
{
  "compilerOptions": {
    "types": ["thane/client"]
  }
}
```

## Project Structure

A minimal Thane app looks like this:

```
my-app/
  index.html
  main.ts
  counter.ts
  tsconfig.json
  package.json
```

### `index.html`

The HTML file is the build entry point. The compiler injects the compiled script automatically:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body></body>
</html>
```

### `main.ts`

The application entry point mounts the root component:

```typescript
import { mount } from 'thane';
import { Counter } from './counter.js';

mount({ component: Counter });
```

`mount()` appends the component to `document.body` by default. Pass a `target` option for a different element:

```typescript
mount({ component: Counter, target: document.getElementById('app')! });
```

### `counter.ts`

Define a component using `defineComponent`. The compiler auto-derives the CSS selector from the export name (`Counter` → `counter`):

```typescript
import { defineComponent, signal } from 'thane';

export const Counter = defineComponent(() => {
  const count = signal(0);
  const increment = () => count(count() + 1);
  const decrement = () => count(count() - 1);
  const reset = () => count(0);

  return {
    template: html`
      <div>
        <h1>Count: ${count()}</h1>
        <button @click=${increment}>+</button>
        <button @click=${decrement}>−</button>
        <button @click=${reset}>Reset</button>
      </div>
    `,
  };
});
```

## Running the Dev Server

```bash
thane dev
```

This starts a development server at `http://localhost:4200` with:

- Hot module replacement
- Source maps enabled
- Browser error overlay — compile errors appear directly in the browser
- All 12 lint rules active

## Building for Production

```bash
thane build --prod
```

Output goes to `dist/` by default. Production builds include:

- Template and selector minification
- `console.*` calls stripped
- Tree-shaking of unused exports
- Code splitting for lazy-loaded routes
- Content-hashed filenames

## Serving a Production Build

```bash
thane serve
```

Starts a static file server for the `dist/` directory.

## Type Checking

```bash
thane typecheck
```

Runs the TypeScript compiler in check-only mode against your project.

## What's Next?

- [Signals](signals.md) — reactive primitives
- [Components](components.md) — component model and lifecycle
- [Templates](templates.md) — template syntax and bindings

← [Back to Docs](README.md)
