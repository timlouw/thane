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

## Formatting

```bash
# Check formatting
bun run format:check

# Auto-fix formatting
bun run format
```

---

← [Back to Contributing](README.md)
