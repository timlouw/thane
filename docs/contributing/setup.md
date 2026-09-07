# Setup

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Node.js](https://nodejs.org/) >= 18 (for Playwright E2E tests only)
- Git

## Clone & Install

```bash
git clone https://github.com/timlouw/thane.git
cd thane
bun install
```

## Build

```bash
bun run build
```

This compiles the compiler and runtime into `dist/`.

## Example Apps

The Thane store example in `example-apps/store/thane` depends on the framework through a `bun link`, so it always uses your local checkout without copying it. Link the repository once per machine, then install inside the app:

```bash
bun link                              # in the repository root, registers "thane"
cd example-apps/store/thane
bun install                           # creates node_modules/thane -> repository root
bun run start
```

The store app resolves `thane` from `dist/`, so run `bun run build` in the repository root after changing the framework. The React version in `example-apps/store/react` is a standalone Vite app with its own `bun install`. The benchmark in `example-apps/benchmark` installs a packed tarball; `bun run test:benchmark` packs and builds it.

## Dev Server

The dev server requires the **Bun** runtime — Node.js is not supported for this command:

```bash
bun thane dev
```

Default port is `4200`. Use `--port` to override.

---

← [Back to Contributing](README.md)
