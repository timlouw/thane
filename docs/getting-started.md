# Getting Started

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Node.js](https://nodejs.org/) >= 18 _(only for Playwright E2E tests)_

## A New Project

```bash
bunx thane init my-app
cd my-app
bun install
bun run dev
```

`thane init` writes the files below, and an app component that counts clicks; `thane generate component user-card` adds a
component ([CLI](cli.md#thane-init)).

## Installation

In a project of your own:

```bash
bun add thane
```

Extend Thane's TypeScript configuration in your `tsconfig.json`:

```json
{ "extends": "thane/tsconfig.json" }
```

It holds the strict options, the editor plugin, and the folders a project's code is in: `src`, and `.thane/types`, where every
`thane` command writes hidden type files (the route types that make `navigate()` and `route.params` type-safe). The
editor plugin gives the editor the template types the build checks: each handler's event, and the values a template
takes (see [Event Handling](event-handling.md#in-the-editor)). The types of `.css` imports come with `thane` itself.
Your own options go next to `extends`, and override its.

## Project Structure

A minimal Thane app looks like this:

```
my-app/
  index.html
  src/
    main.ts
    counter.ts
  tsconfig.json
  package.json
```

`src/main.ts` and `index.html` are where the CLI looks by default; `--entry` and `--html` (or the config file) point elsewhere.

### `index.html`

The page that loads the app. The build writes it to `dist/` with a `<script>` for the compiled entry, so you don't add one yourself:

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

### `src/main.ts`

The application entry point mounts the root component:

```typescript
import { mount } from 'thane';
import { Counter } from './counter.js';

mount(Counter);
```

`mount()` appends the component to `document.body` by default. Pass a `target` option for a different element:

```typescript
mount(Counter, { target: document.getElementById('app')! });
```

### `src/counter.ts`

Define a component using `defineComponent`. The compiler auto-derives the CSS selector from the export name (`Counter` → `counter`):

```typescript
import { defineComponent, signal, html } from 'thane';

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

`html` is imported like the rest: it and the other template markers (`css`, `when`, `repeat`) exist only at build time, where the compiler turns them into DOM code, so they add nothing to the bundle.

## Running the Dev Server

```bash
thane dev
```

This starts a development server at `http://localhost:4200` with:

- A rebuild whenever a source file changes, after which the open pages reload
- Source maps enabled
- Browser errors relayed to the terminal — `console.error`, uncaught errors and unhandled rejections
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
thane serve --prod
```

Builds the app and serves the `dist/` directory, rebuilding on changes.

## Type Checking

```bash
thane typecheck
```

Runs the TypeScript compiler in check-only mode against your project. Type errors fail the command; during `thane dev` and `thane build` they are printed as warnings unless `--strict-type-check` is set.

## What's Next?

- [Signals](signals.md) — reactive primitives
- [Components](components.md) — component model and lifecycle
- [Templates](templates.md) — template syntax and bindings

← [Back to Docs](README.md)
