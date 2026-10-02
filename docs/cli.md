# CLI Reference

The Thane CLI is the build tool for compiling, serving, and type-checking Thane applications. It requires the **Bun** runtime.

## Commands

### `thane init`

Create a new project in a folder (the current one when none is given):

```bash
thane init my-app
cd my-app && bun install && bun run dev
```

It writes `package.json` (with the `dev`, `build`, `serve` and `typecheck` scripts), a `tsconfig.json` that extends
`thane/tsconfig.json`, `.gitignore`, `index.html`, `src/main.ts`, and the app component, `src/app/app.component.ts` with its
`app.component.css`. It writes over nothing: when one of those files exists, it stops and writes none.

### `thane generate component`

Create a component in a folder of its name, under the current directory:

```bash
thane generate component user-card        # user-card/user-card.component.ts and .css
thane generate component ui/user-card     # ui/user-card/user-card.component.ts and .css
```

The name is lowercase words joined by hyphens; the component is exported as `UserCard`, and its stylesheet is imported
as its `styles`. It writes over nothing.

### `thane dev`

Build in watch mode and start a development server.

```bash
thane dev
thane dev --port 3000 --open
thane dev --host 0.0.0.0
```

Default port: `4200`. Always a development build (`--prod` is ignored). Source maps are enabled. All 12 lint rules are active. `console.*` calls are preserved.

The build reruns when a source file changes. When the files that changed are component files, the open pages swap
those components in place: each instance of a changed component is mounted again with the new code and styles, in
its place and with its props, and the rest of the page keeps its state (its other components, its stores, the
route). Any other change reloads the pages: a module that is not a component file (a store, a helper), a component
file that exports something else too, a stylesheet file, an asset or `index.html`, and a component the page has not
loaded yet. A swapped component keeps its state: each `const` signal at the top level of its setup, or of its file,
starts from the old one's value, and the children it mounts from the old children's (see
[Known Limitations](known-limitations.md#hot-updates-keep-signals-by-name)).

Errors in the browser (`console.error`, uncaught errors and unhandled promise rejections) are printed in the terminal, with their locations in the built files.

### `thane build`

Compile the application into the output directory: a development build, or a production build with `--prod`.

```bash
thane build
thane build --prod --gzip --analyze
```

Production mode (`--prod`) enables:

- JavaScript minification (esbuild), and template and selector minification
- `console.*` call stripping
- `debugger` statement stripping
- Source maps disabled (unless `--sourcemap` is set)

Output file names carry content hashes in every build, unless `--no-hash-file-names` is set.

### `thane serve`

Build the application and serve the output directory, rebuilding on changes. Unlike `dev`, it keeps `--prod`, so it serves a production build when asked to.

```bash
thane serve
thane serve --prod --port 8080
```

### `thane typecheck`

Run TypeScript type checking without building. Type errors fail the command.

```bash
thane typecheck
```

`thane build`, `dev` and `serve` run the same check before they compile: there, type errors are printed as warnings, unless `--strict-type-check` makes them fail the build.

### `thane types`

Generate the hidden type files without building: `.thane/types/client.d.ts` (the `.css` import declarations) and, for each `defineRoutes()` table, the route types in `.thane/types/router/`.

```bash
thane types
```

## CLI Options

| Flag                                         | Type            | Default                       | Description                                                   |
| :------------------------------------------- | :-------------- | :---------------------------- | :------------------------------------------------------------ |
| `--prod`, `-p`                               | boolean         | `false`                       | Production mode                                               |
| `--gzip`                                     | boolean         | `false`                       | Enable gzip/brotli compression                                |
| `--entry <path>`                             | string          | `./src/main.ts`               | Entry point file                                              |
| `--out <dir>`                                | string          | `./dist`                      | Output directory                                              |
| `--assets <dir>`                             | string          | `./src/assets`                | Static assets directory copied into the output                |
| `--public <dir>`                             | string          | `./public`                    | Folder copied to the root of the output (see below)           |
| `--html <path>`                              | string          | `./index.html`                | Root HTML file                                                |
| `--config <path>`                            | string          | `./thane.config.json`         | Config file path (see below)                                  |
| `--port <number>`                            | number          | `4200`                        | Dev server port                                               |
| `--open` / `--no-open`                       | boolean         | `false`                       | Auto-open browser on dev start                                |
| `--host <addr>`                              | string          | `localhost`                   | Dev server host (`0.0.0.0` for LAN access)                    |
| `--sourcemap` / `--no-sourcemap`             | boolean         | `true` (dev) / `false` (prod) | Generate source maps                                          |
| `--analyze` / `--no-analyze`                 | boolean         | `false`                       | Write esbuild metafile for bundle analysis                    |
| `--target <targets>`                         | comma-separated | Thane defaults                | Override esbuild browser/JS targets (e.g. `es2022,chrome120`) |
| `--env-prefix <prefix>`                      | string          | `THANE_`                      | Env var prefix for automatic define injection                 |
| `--splitting` / `--no-splitting`             | boolean         | `true`                        | Enable code splitting                                         |
| `--hash-file-names` / `--no-hash-file-names` | boolean         | `true`                        | Content hashes in output filenames                            |
| `--drop-console` / `--no-drop-console`       | boolean         | `true` (prod) / `false` (dev) | Strip `console.*` calls                                       |
| `--drop-debugger` / `--no-drop-debugger`     | boolean         | `true` (prod) / `false` (dev) | Strip `debugger` statements                                   |
| `--base <path>`                              | string          | `/`                           | Public base path for deployed assets                          |
| `--strict-type-check`                        | boolean         | `false`                       | Fail build on TypeScript type errors                          |
| `--empty-out-dir` / `--no-empty-out-dir`     | boolean         | `true`                        | Clear output directory before building                        |
| `--legal-comments <mode>`                    | string          | `none`                        | Legal comment handling: `none`, `eof`, `linked`, `external`   |
| `--verbose`, `-V` / `--quiet`, `-q`          | boolean         | normal                        | Logging verbosity                                             |
| `--help`, `-h` / `--version`, `-v`           | boolean         |                               | Print the help text or the version, and exit                  |

Compile-time constant replacements (`define`) can only be set in the config file.

### The Public Folder

Files that must sit at the root of the site, such as `robots.txt`, `sitemap.xml`, `favicon.ico`, `manifest.webmanifest` or
`.well-known/`, go in `./public` (or the folder `--public` names). Every build copies its contents, folders included, to the
root of the output, and `thane dev` copies a changed file and reloads the page. A file the build writes itself wins: an
`index.html` at the root of the public folder is not copied (the build writes `index.html` from `--html`, and warns), and a
route's own page replaces a file of the same path. When `--assets` is `./public`, there is no default public folder.

### Flags That Take a Value

A value flag (`--entry`, `--out`, `--assets`, `--public`, `--html`, `--config`, `--port`, `--host`, `--base`, `--target`, `--env-prefix`, `--legal-comments`) takes the next argument as its value. The rules are the same with or without a config file:

- When the next argument is missing or starts with `-`, the flag is bare and takes no value: `thane dev --host --open` sets `open` and a bare `--host`.
- A bare flag stands for its fallback, which overrides the config file: `--host` means `0.0.0.0`, `--port` `4200`, `--base` `/`, `--env-prefix` `THANE_`, `--legal-comments` `none`, and `--target` the default targets. A bare `--entry`, `--out`, `--assets`, `--public`, `--html` or `--config` is ignored.
- `--port` accepts digits only. Anything else (`--port abc`, `--port 3000x`) stops with an error.

An unknown flag, or an argument that is neither a command nor a flag's value (`thane biuld`), prints a warning; the command then runs as if it were not there, so `thane biuld` runs `build`. `--help` and `--version` print and exit, whether or not a config file is present.

Colours in the output are switched off when it is not a terminal or when `NO_COLOR` is set, and forced on with `FORCE_COLOR=1`.

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
    "dev": { "port": 4200, "sourcemap": true },
  },
}
```

Use `--config <path>` to load a file from somewhere else. Relative paths in the file are resolved against the file's own directory.

A key that is not in the table below prints a warning and is ignored, with the key it most likely means (`Unknown key 'outdir' in thane.config.json is ignored; did you mean 'outDir'?`). So do an unknown command in `commands` and a section that is not an object. `$schema` is allowed.

| Config key                                                                                                     | CLI flag                                                           |
| :------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| `entry`                                                                                                        | `--entry`                                                          |
| `outDir`                                                                                                       | `--out`                                                            |
| `assetsDir`                                                                                                    | `--assets`                                                         |
| `publicDir`                                                                                                    | `--public`                                                         |
| `html`                                                                                                         | `--html`                                                           |
| `hashFileNames`, `dropConsole`, `dropDebugger`, `strictTypeCheck`, `emptyOutDir`, `legalComments`, `envPrefix` | Same name in kebab-case (`--hash-file-names`, `--drop-console`, …) |
| `prod`, `gzip`, `port`, `open`, `host`, `base`, `sourcemap`, `analyze`, `splitting`, `target`                  | Same name                                                          |
| `define`, `lint`                                                                                               | _(config only)_                                                    |

### Lint Severities

`lint` sets how each [lint rule](lint-rules.md) and compiler warning is reported, by its code: `"off"` leaves it
out, `"warning"` shows it without stopping the build, and `"error"` stops the build.

```jsonc
{
  "lint": {
    "THANE405": "off", // a ternary of templates in a const is fine in this project
    "THANE411": "error", // two mounts on one target stop the build
  },
}
```

A severity other than those three, or a key that is not a code such as `THANE405`, prints a warning and is
ignored. The compiler's own template errors (THANE006 to THANE012) cannot be turned off: the template they
report would not be compiled correctly.

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
    "serve": { "port": 8080 },
  },
}
```

## Environment Variables

Environment variables prefixed with `THANE_` (or your custom `--env-prefix`) are automatically injected as compile-time constants:

```bash
THANE_API_URL=https://api.example.com thane build
```

In your code:

```typescript
// Available at compile time via esbuild define
const apiUrl = import.meta.env.THANE_API_URL;
```

← [Back to Docs](README.md)
