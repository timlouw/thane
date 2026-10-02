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

E2E tests live in `e2e/tests/` and cover rendering, directives, routing, route heads, component lifecycle, the hardening probes (one per fixed defect), the dev server's error relay and hot updates, and the cart example app. The hot update and error relay tests run in Chromium only.

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

## Package, Size and Output Checks

```bash
# The package entries export exactly the documented names (packs and installs the package)
bun run check:exports

# Runtime and app sizes, raw and gzip; --json <file> saves a report, --compare <file> diffs one
bun run size

# Compiled-output snapshots of every build-through fixture and app, dev and prod
bun run snapshot:output --out .tmp-snap-before
bun run snapshot:output --out .tmp-snap-after
bun run snapshot:compare .tmp-snap-before .tmp-snap-after
```

A refactor that should not change the compiled output is checked with two snapshots, one before and one after. Run `bun run test:benchmark` once in a fresh checkout first: the snapshot set includes the benchmark example, which builds from its installed package. `.tmp-*` folders are ignored by git.

## Formatting

```bash
# Check formatting
bun run format:check

# Auto-fix formatting
bun run format
```

---

← [Back to Contributing](README.md)
