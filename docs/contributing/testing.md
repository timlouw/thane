# Testing

## Unit Tests

Run all unit tests under `src/` using Bun's built-in test runner:

```bash
bun run test
```

## E2E Browser Tests

E2E tests use [Playwright](https://playwright.dev/) and run across Chromium, Firefox, and WebKit.

```bash
# Install Playwright browsers (first time only)
bunx playwright install

# Run E2E tests
bun run e2e:test

# Run headed (visible browser)
bun run e2e:test:headed

# Run with Playwright UI
bun run e2e:ui
```

E2E tests live in `e2e/tests/` and cover rendering, directives, routing, component lifecycle, and the cart example app.

## Performance Benchmarks

The `bench/` folder holds a self-contained version of the js-framework-benchmark CPU and memory
benchmarks for comparing one Thane change against another. It needs Google Chrome installed.

```bash
# Capture a baseline, make a change, then compare
bun run bench --label baseline
bun run bench --label my-change --interleave baseline
bun run bench:compare baseline my-change
```

See [bench/README.md](../../bench/README.md) for the workflow and how to read the results.

## Formatting

```bash
# Check formatting
bun run format:check

# Auto-fix formatting
bun run format
```

---

← [Back to Contributing](README.md)
