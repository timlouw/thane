# CLI Reference

The Thane CLI is the build tool for compiling, serving, and type-checking Thane applications. It requires the **Bun** runtime.

## Commands

### `thane dev`

Start a development server with hot module replacement and browser error overlay.

```bash
thane dev
thane dev --port 3000 --open
thane dev --host 0.0.0.0
```

Default port: `4200`. Source maps are enabled. All 12 lint rules are active. `console.*` calls are preserved.

### `thane build`

Compile the application for production.

```bash
thane build
thane build --prod --gzip --analyze
```

Production mode (`--prod`) enables:
- Template and selector minification
- `console.*` call stripping
- `debugger` statement stripping
- Content-hashed filenames
- Source maps disabled (unless `--sourcemap` is set)

### `thane serve`

Serve the built output directory.

```bash
thane serve
thane serve --port 8080
```

### `thane typecheck`

Run TypeScript type checking without building.

```bash
thane typecheck
thane typecheck --strictTypeCheck
```

By default, type errors produce warnings. With `--strictTypeCheck`, they fail the build.

### `thane types`

Generate router type definitions. This runs the `router-typegen` plugin, which scans `defineRoutes()` and writes `.d.ts` files to `.thane/types/router/`.

```bash
thane types
```

## CLI Options

| Flag | Type | Default | Description |
|:-----|:-----|:--------|:------------|
| `--prod` | boolean | `false` | Production mode |
| `--gzip` | boolean | `false` | Enable gzip/brotli compression |
| `--entry` | string | auto-detect | Entry point file |
| `--outDir` | string | `dist` | Output directory |
| `--port` | number | `4200` | Dev server port |
| `--open` | boolean | `false` | Auto-open browser on dev start |
| `--host` | string/boolean | `localhost` | Dev server host (`true` or `0.0.0.0` for LAN) |
| `--sourcemap` | boolean | `true` (dev) / `false` (prod) | Generate source maps |
| `--analyze` | boolean | `false` | Write esbuild metafile for bundle analysis |
| `--target` | string[] | Thane defaults | Override esbuild browser/JS targets |
| `--define` | object | `{}` | Compile-time global constant replacements |
| `--envPrefix` | string | `THANE_` | Env var prefix for automatic define injection |
| `--splitting` | boolean | `true` | Enable code splitting |
| `--hashFileNames` | boolean | `true` | Content hashes in output filenames |
| `--dropConsole` | boolean | `true` (prod) / `false` (dev) | Strip `console.*` calls |
| `--dropDebugger` | boolean | `true` (prod) / `false` (dev) | Strip `debugger` statements |
| `--base` | string | `/` | Public base path for deployed assets |
| `--strictTypeCheck` | boolean | `false` | Fail build on TypeScript type errors |
| `--emptyOutDir` | boolean | `true` | Clear output directory before building |
| `--legalComments` | string | `none` | Legal comment handling: `none`, `eof`, `linked`, `external` |

## Configuration File

Create a `thane.config.ts` (or `thane.config.js`) in your project root:

```typescript
export default {
  entry: './src/main.ts',
  outDir: 'dist',
  port: 3000,
  open: true,

  commands: {
    build: {
      prod: true,
      gzip: true,
      analyze: true,
    },
    dev: {
      port: 4200,
      sourcemap: true,
    },
  },
};
```

### Precedence

Options are resolved in this order (highest wins):

1. CLI flags
2. Per-command overrides (`commands.build`, `commands.dev`, etc.)
3. Top-level config file values
4. Built-in defaults

### Per-Command Overrides

The `commands` object lets you set different options for each CLI command:

```typescript
{
  // Shared defaults
  entry: './src/main.ts',

  commands: {
    build: { prod: true, gzip: true },
    dev:   { port: 3000, open: true },
    serve: { port: 8080 },
  },
}
```

## Environment Variables

Environment variables prefixed with `THANE_` (or your custom `--envPrefix`) are automatically injected as compile-time constants:

```bash
THANE_API_URL=https://api.example.com thane build
```

In your code:

```typescript
// Available at compile time via esbuild define
const apiUrl = import.meta.env.THANE_API_URL;
```

← [Back to Docs](README.md)
