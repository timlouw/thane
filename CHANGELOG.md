# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `bench/`: a self-contained benchmark harness that builds the js-framework-benchmark app from the working tree, drives it in Chrome, and records the same trace-derived total, script, paint and memory metrics as the official runner. `bun run bench --label <name>` measures a build and `bun run bench:compare <a> <b>` compares saved labels with a significance test; `--interleave` measures two builds in alternating iterations for a fair A/B.

### Performance

Measured with the in-repo harness against the previous release on the js-framework-benchmark operations, both builds interleaved in one session (script time, medians): select row 0.26x, partial update 0.59x, append rows 0.83x, replace rows 0.91x, create rows 0.93x, clear rows 0.93x, create 10,000 rows 1.02x; geometric mean 0.77x. Heap after creating 1,000 rows 0.95x.

- Every write compiled into a `repeat()` row (and expression bindings at component level and inside conditionals) keeps the last value it wrote and skips the DOM write when a re-evaluation produces the same value. Creating rows no longer issues `setAttribute('class', '')` per row when the class starts empty.
- A row attribute of the form `signal() === item.<key> ? 'on' : 'off'` (also `!==`, or the operands swapped), where `<key>` is the repeat's trackBy property, is driven by one subscription on the list that rewrites only the two affected rows, instead of one subscription per row. Rows still compute the value when created.
- Sole-content text bindings in rows write `Text.nodeValue` on update, resolving the text node lazily on the row's first update; creation still uses `textContent`.
- Dynamic `class` attributes on HTML elements are written through `className`; inside `<svg>` they stay on `setAttribute`.
- Appending items to a non-empty `repeat()` list takes a fast path that creates only the new rows, and the container is no longer detached and re-attached for appends.
- Unsubscribing from a signal is constant time; tearing down a list of subscribed rows no longer moves O(n²) array elements.
- Delegated row event listeners dispatch by the row child the event came through instead of running a containment probe per handler.

A second round, measured the same way against the build above: create 10,000 rows 0.88x, append rows 0.91x, partial update 0.86x, create rows 0.97x (30 interleaved iterations), everything else the same; geometric mean 0.96x. Heap after creating 1,000 rows 0.97x. Combined with the round above, script time is about 0.74x of the previous release.

- `repeat()` rows that need no per-row cleanups (no subscriptions, nested directives or child components) are cloned in batches of 16 from a fragment built once per list, and bound and inserted per batch instead of per row.
- Those rows no longer carry an update closure. The row's record holds the last-written value per binding and its lazily resolved text nodes, and one update function per list re-navigates from the row element; rows also share one empty cleanups array. Heap after creating 1,000 rows drops by about 5%.
- Reconciling a list against an array of the same length matches rows by position before deriving keys: an identical item needs nothing, an item whose key matches the row at that index is updated in place, and only a moved row falls through to the keyed paths.
- Unsubscribing from a `computed()` is constant time, like plain signals.

A third round, measured the same way: swap rows 0.70x (0.60 to 0.41 ms), partial update 0.83x, everything else the same; geometric mean 0.94x. Across the three rounds, script time is about 0.70x of the previous release.

- Reordering a list of the same length compares each row with the item at its index before deriving a key, so a swap of two rows in a list of 1,000 costs two lookups instead of a key derivation and a lookup per row.
- The shared update function of lean rows navigates to a bound element only inside the guard of a binding that changed; an unchanged binding costs one compare.

A fourth round, measured the same way against the build above (30 interleaved iterations on the creation and update benchmarks): every operation "same"; geometric mean 0.98x. The bug fixes above cost nothing on the benchmark app, whose bundle is byte-identical through the fallback removal, developer-id and props changes.

- The keyed reconciler builds its key map lazily: creating rows no longer inserts every row into a Map; the map is built the first time an operation needs many lookups, and a handful of lookups (a selection, a swap) scan the rows instead.

### Fixed

- `repeat()` rows with an attribute binding on an item element, such as `<tr data-id=${item.id}>` or `<a href=${item.url}>`, compiled to the fallback renderer, which re-renders every row's HTML on each change. They now use the optimised row path, and an attribute that mixes a signal with item data on an element below the row root is written to that element instead of the row element.
- A developer `id` on a bound element inside a `repeat()` row no longer forces the list onto the fallback renderer; the `id` is kept.
- The build no longer fails with `ENOENT` when emptying an existing output directory given as a `./`-prefixed path under Bun 1.4 on Windows.
- `when()` blocks now compile their content as a full sub-template. Event handlers on elements inside a `when()` block were never bound, a `whenElse()` or `repeat()` inside a `when()` block corrupted the surrounding template (a nested `repeat()` crashed at mount), an event handler inside a `when()` block truncated the content that followed it, and a binding inside a nested `when()` registered a phantom binding on the outer block.
- `whenElse()` initialises nested `when`/`whenElse` blocks from the branch they belong to; the else branch previously received none and the then branch received both.
- Conditions that cannot be evaluated at compile time (local non-signal values, signals without a known initializer) defer branch selection to mount instead of pre-rendering the else branch.
- Runtime helpers used only inside nested directive branches (for example a `when()` inside a `whenElse()` branch) are now imported.
- Child components mounted inside a directive nested in a `whenElse()` else branch are set up by the correct branch initializer.
- `computed()` no longer drops a change notification when another subscriber reads the computed before its deferred notification runs.
- The HTML parser tracks nested object-literal braces inside template-literal expressions.
- Template parse diagnostics no longer call an unbound logger method.
- `when()`, `whenElse()` and nested `repeat()` inside a `repeat()` row now see the row's item and index: conditions, branch templates and inner lists read them through row-scoped signals, so a row updates its nested directives when its item changes. Row event handlers that do not mention the item (a plain function reference, or an arrow that only calls a component function) are attached and called with the event.
- Form and state attributes (`value`, `checked`, `selected`, `disabled`, `open`, `hidden`, `readonly`, `required`, `multiple`, `indeterminate`, `muted`) are written as DOM properties, so `checked=${false}` unchecks and `value=${name()}` moves the field's live value; the static template ships no attribute for a bound boolean. `null` and `undefined` render as empty text instead of the words.
- One attribute grammar: static text around an expression is kept (`class="btn ${kind()}"` writes `btn primary`), `style=${expr}` writes `cssText`, `style="color: ${c()}"` binds the property, and a `:`-prefixed attribute is a build error (THANE006) instead of a literal attribute named `:src`.
- The string fallback row renderer is gone. Every `repeat()` list, including one inside a `when()` or `whenElse()` branch, uses the keyed row path with cloned templates, guarded updates and delegated events. A row template with more than one root element, or none, is a build error (THANE007) that says what to wrap; a row that is only a `whenElse()` is named as such. Rows whose only binding is a component signal were left unbound by the clone-only path; they are bound now.
- Developer `id` attributes are kept on attribute- and style-bound elements and on `whenElse()` branch roots (previously the compiler's id won, or the branch never hid). Generated code refers to such elements through a derived variable, so an id can neither shadow a component variable nor need to be a valid identifier.
- `props.count()` read directly in a template is a tracked signal read, as the Components doc shows; `const count = props.count` is no longer needed.
- `${index}` bindings follow the row: after a reorder or a removal, every row at a new position is refreshed. Lists without an index binding do no extra work.
- The router mounts the route again when only the query changes (`navigate('/a?x=2')` from `/a?x=1`), so `route.searchParams` is current; a hash-only change keeps the instance. Persisting the scroll position no longer rewrites the history entry's URL to the bare pathname, so browser back returns to the full URL.
- Compiler exceptions fail the build with the diagnostic instead of shipping the component uncompiled.

### Changed

- TypeScript updated from 5.9 to 6.0.3, the last release that ships the JavaScript compiler API the Thane compiler and linter are built on. TypeScript 7 (the Go-native compiler) does not expose that API until 7.1 and is not yet a drop-in replacement.
- Toolchain: Bun 1.4.2, esbuild 0.28, Playwright 1.63, Prettier 3.9, `@types/bun` 1.4 and `@types/node` 26.
- Repository layout: documentation lives in `docs/` with the contributing guides under `docs/contributing/`; the benchmark and both store example apps live under `example-apps/`; e2e builds and Playwright output stay under `e2e/`.
- The Thane store example depends on the framework through `bun link` instead of copying the repository into its `node_modules`.
- Compiler: type sync and type checking are scoped to the project that owns the entry point instead of the current working directory, so building from the repository root no longer writes `.thane` folders into unrelated projects.
- The benchmark app depends on `example-apps/benchmark/thane.tgz`, produced by `bun run test:benchmark`, instead of a version-numbered tarball that went stale on every release.
- Documentation: the CLI reference now lists the real flag spellings and the JSON/JSONC config file format; directive docs describe nesting inside `when()` blocks and compile-time branch selection.

Entries for earlier releases were not recorded.
