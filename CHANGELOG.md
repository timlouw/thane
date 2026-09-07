# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `when()` blocks now compile their content as a full sub-template. Event handlers on elements inside a `when()` block were never bound, a `whenElse()` or `repeat()` inside a `when()` block corrupted the surrounding template (a nested `repeat()` crashed at mount), an event handler inside a `when()` block truncated the content that followed it, and a binding inside a nested `when()` registered a phantom binding on the outer block.
- `whenElse()` initialises nested `when`/`whenElse` blocks from the branch they belong to; the else branch previously received none and the then branch received both.
- Conditions that cannot be evaluated at compile time (local non-signal values, signals without a known initializer) defer branch selection to mount instead of pre-rendering the else branch.
- Runtime helpers used only inside nested directive branches (for example a `when()` inside a `whenElse()` branch) are now imported.
- Child components mounted inside a directive nested in a `whenElse()` else branch are set up by the correct branch initializer.
- `computed()` no longer drops a change notification when another subscriber reads the computed before its deferred notification runs.
- The HTML parser tracks nested object-literal braces inside template-literal expressions.
- Template parse diagnostics no longer call an unbound logger method.

### Changed

- The benchmark app depends on `benchmark/thane.tgz`, produced by `bun run test:benchmark`, instead of a version-numbered tarball that went stale on every release.
- Documentation: the CLI reference now lists the real flag spellings and the JSON/JSONC config file format; directive docs describe nesting inside `when()` blocks and compile-time branch selection.

Entries for earlier releases were not recorded.
