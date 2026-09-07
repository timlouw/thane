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
| `--prod`, `-p` | boolean | `false` | Production mode |
| `--gzip` | boolean | `false` | Enable gzip/brotli compression |
| `--app <name>` | string | `client` | Application name |
| `--entry <path>` | string | `./src/main.ts` | Entry point file |
| `--out <dir>` | string | `./dist` | Output directory |
| `--assets <dir>` | string | `./src/assets` | Static assets directory copied into the output |
| `--html <path>` | string | `./index.html` | Root HTML file |
| `--config <path>` | string | `./thane.config.json` | Config file path (see below) |
| `--port <number>` | number | `4200` | Dev server port |
| `--open` / `--no-open` | boolean | `false` | Auto-open browser on dev start |
| `--host <addr>` | string | `localhost` | Dev server host (`0.0.0.0` for LAN access) |
| `--sourcemap` / `--no-sourcemap` | boolean | `true` (dev) / `false` (prod) | Generate source maps |
| `--analyze` / `--no-analyze` | boolean | `false` | Write esbuild metafile for bundle analysis |
| `--target <targets>` | comma-separated | Thane defaults | Override esbuild browser/JS targets (e.g. `es2022,chrome120`) |
| `--env-prefix <prefix>` | string | `THANE_` | Env var prefix for automatic define injection |
| `--splitting` / `--no-splitting` | boolean | `true` | Enable code splitting |
| `--hash-file-names` / `--no-hash-file-names` | boolean | `true` | Content hashes in output filenames |
| `--drop-console` / `--no-drop-console` | boolean | `true` (prod) / `false` (dev) | Strip `console.*` calls |
| `--drop-debugger` / `--no-drop-debugger` | boolean | `true` (prod) / `false` (dev) | Strip `debugger` statements |
| `--base <path>` | string | `/` | Public base path for deployed assets |
| `--strict-type-check` | boolean | `false` | Fail build on TypeScript type errors |
| `--empty-out-dir` / `--no-empty-out-dir` | boolean | `true` | Clear output directory before building |
| `--legal-comments <mode>` | string | `none` | Legal comment handling: `none`, `eof`, `linked`, `external` |
| `--verbose`, `-V` / `--quiet`, `-q` | boolean | normal | Logging verbosity |

Compile-time constant replacements (`define`) can only be set in the config file.

## Configuration File

Create a `thane.config.json` (or `thane.config.jsonc`, which allows comments) in your project root. Keys use camelCase and mirror the CLI flags:

```jsonc
{
  "entry": "./src/main.ts",
  "outDir": "dist",
  "port": 3000,
  "open": true,
  "define": { "__VERSION__": "\"1.0.0\"" },

  "commands": {
    "build": { "prod": true, "gzip": true, "analyze": true },
    "dev": { "port": 4200, "sourcemap": true }
  }
}
```

Use `--config <path>` to load a file from somewhere else. Relative paths in the file are resolved against the file's own directory.

| Config key | CLI flag |
|:-----------|:---------|
| `entry` | `--entry` |
| `outDir` | `--out` |
| `assetsDir` | `--assets` |
| `html` | `--html` |
| `app` | `--app` |
| `hashFileNames`, `dropConsole`, `dropDebugger`, `strictTypeCheck`, `emptyOutDir`, `legalComments`, `envPrefix` | Same name in kebab-case (`--hash-file-names`, `--drop-console`, …) |
| `prod`, `gzip`, `port`, `open`, `host`, `base`, `sourcemap`, `analyze`, `splitting`, `target` | Same name |
| `define` | *(config only)* |

### Precedence

Options are resolved in this order (highest wins):

1. CLI flags
2. Per-command overrides (`commands.build`, `commands.dev`, etc.)
3. Top-level config file values
4. Built-in defaults

### Per-Command Overrides

The `commands` object lets you set different options for each CLI command (`build`, `dev`, `serve`, `types`, `typecheck`):

```jsonc
{
  // Shared defaults
  "entry": "./src/main.ts",

  "commands": {
    "build": { "prod": true, "gzip": true },
    "dev": { "port": 3000, "open": true },
    "serve": { "port": 8080 }
  }
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
