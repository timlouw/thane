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

## Dev Server

The dev server requires the **Bun** runtime — Node.js is not supported for this command:

```bash
bun thane dev
```

Default port is `4200`. Use `--port` to override.

---

← [Back to Contributing](README.md)
