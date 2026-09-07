# Styling

Thane uses **Light DOM** — components render as regular DOM elements, not inside Shadow DOM. Styles are scoped automatically via CSS Nesting and `adoptedStyleSheets`.

## Scoped Styles

Return a `styles` property from your component using the `css` tagged template:

```typescript
export const Card = defineComponent('ui-card', () => ({
  template: html`<div class="card"><h1>Hello</h1></div>`,
  styles: css`
    .card {
      padding: 1rem;
      border: 1px solid #ddd;

      & h1 {
        color: blue;
      }
    }
  `,
}));
```

At runtime, the styles are automatically scoped to the component's selector class (`.ui-card`). The CSS becomes:

```css
.ui-card .card {
  padding: 1rem;
  border: 1px solid #ddd;

  & h1 {
    color: blue;
  }
}
```

This scoping uses `adoptedStyleSheets` — styles are registered once per component type, regardless of how many instances exist.

## `:host` Selector

Use `:host` to style the component's root element itself:

```typescript
styles: css`
  :host {
    display: block;
    max-width: 800px;
    margin: 0 auto;
  }
`
```

`:host` is rewritten to the component's selector class (e.g., `.ui-card`). This targets the element that has the component class applied.

### `:host()` with Conditions

```typescript
styles: css`
  :host(.active) {
    border-color: blue;
  }
`
```

Becomes `.ui-card.active { border-color: blue; }`.

## CSS Nesting

Thane relies on native CSS Nesting (the `&` selector). This requires modern browsers:

| Chrome | Firefox | Safari | Edge |
|:------:|:-------:|:------:|:----:|
| 120+   | 117+    | 17.2+  | 120+ |

Use `&` for nested selectors:

```typescript
styles: css`
  .nav {
    display: flex;

    & .link {
      color: inherit;

      &:hover {
        color: blue;
      }
    }
  }
`
```

## CSS File Imports

Import `.css` files as string exports:

```typescript
import styles from './Card.module.css';

export const Card = defineComponent('ui-card', () => ({
  template: html`<div class="card">...</div>`,
  styles,
}));
```

The compiler bundles the CSS file and exports its content as a string. Add `thane/client` to your `tsconfig.json` types to get proper TypeScript support for `.css` imports:

```json
{
  "compilerOptions": {
    "types": ["thane/client"]
  }
}
```

The `client.d.ts` file declares:

```typescript
declare module '*.css' {
  const css: string;
  export default css;
}
```

## Global Styles

Use `registerGlobalStyles()` for styles that apply globally — resets, typography, theme variables:

```typescript
import { registerGlobalStyles } from 'thane';

const resetStyles = css`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
`;

const themeStyles = css`
  :root {
    --primary: #2563eb;
    --surface: #ffffff;
  }
`;

registerGlobalStyles(resetStyles, themeStyles);
```

Global styles:

- Are **not scoped** — they apply to the entire document.
- Are **deduplicated** — calling `registerGlobalStyles` with the same CSS text twice has no effect.
- Use `adoptedStyleSheets` on the document for efficient application.

## Light DOM Implications

Because Thane uses Light DOM (no Shadow DOM):

- **Parent styles cascade into children.** A parent's `.card h1` rule applies to `<h1>` inside child components too.
- **Child styles don't leak to siblings or parents** (because they're scoped to the component's class).
- **Global CSS frameworks** (Tailwind, Bootstrap) work without any special integration.
- **CSS variables** work naturally across component boundaries.

## Selector Minification

In production builds (`thane build --prod`), component selectors are minified to shorter class names, reducing both CSS and HTML size.

## CSS Variables for Theming

Define variables in a parent or global style, and consume them in components:

```typescript
// Global theme
registerGlobalStyles(css`
  :root {
    --accent: #2563eb;
    --radius: 8px;
  }
`);

// Component uses theme variables
styles: css`
  .button {
    background: var(--accent);
    border-radius: var(--radius);
  }
`
```

← [Back to Docs](README.md)
