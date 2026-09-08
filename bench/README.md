# Benchmark harness

A self-contained version of the CPU and memory benchmarks from
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), for comparing one
Thane change against another on the same machine. It builds the benchmark app from the current
working tree, serves it, drives it in Chrome, and records the same trace-derived metrics the
official runner reports.

Use it for A/B decisions while optimising. Use the official repository for cross-framework
comparison and for a final check before a release.

## Requirements

- Bun (the Thane compiler runs on it)
- Google Chrome installed. The official runner measures on Chrome, so the harness uses the same
  binary. Without it the harness falls back to the Chromium that Playwright bundles and says so;
  only compare runs taken on the same browser.

## Workflow

```bash
# 1. Capture the starting point before changing anything (full run, roughly 8 minutes)
bun run bench --label baseline

# 2. Make a change, then get a fast signal on the benchmarks it targets (about a minute)
bun run bench --label guard --quick --only 04,03

# 3. When it looks promising, take the definitive measurement: both builds, alternating
#    iterations, so drift on the machine affects them equally
bun run bench --label guard --interleave baseline

# 4. Print a comparison table from saved results at any time, for any labels
bun run bench:compare baseline guard
```

Each label owns a build in `bench/.build/<label>/` and results in `bench/results/<label>/`.
A label remembers the commit it was built from, so you can switch branches, build another label,
and interleave the two later. An interleaved run re-measures both labels and overwrites both
result folders, which is what you want: a comparison is only fair when both sides were measured
in the same session.

### Options

| Option                | Effect                                                                           |
| :-------------------- | :------------------------------------------------------------------------------- |
| `--label <name>`      | Name for this build and its results (default `current`)                          |
| `--interleave <name>` | Also re-measure an existing build, alternating iterations with this one          |
| `--only <ids>`        | Comma-separated benchmark ids or substrings: `04`, `swap`, `memory`, `01,07`     |
| `--iterations <n>`    | Iterations per CPU benchmark (default 15, the official count; select row adds 10) |
| `--quick`             | 5 iterations and no extras, for a fast signal while iterating                    |
| `--no-build`          | Reuse `bench/.build/<label>` instead of rebuilding from the working tree          |
| `--chrome <path>`     | Chrome executable (also `BENCH_CHROME` in the environment)                        |
| `--headed`            | Show the browser window                                                           |
| `--port <n>`          | Port for the local server (default 8787)                                          |

`--only` re-measures just those benchmarks and merges them into the label's existing results, so
you can refresh one row of a table without re-running everything.

## Reading the results

While a run is in progress you see one line per iteration and, after each benchmark, the medians:

```
  04_select1k              guard           1/25  total    7.20  script    0.80  paint    5.80
  ...
  04_select1k              guard          median of 25:  total    7.20  script    0.80  paint    5.80
```

`bench:compare` prints one table per metric. The first label is the baseline and every other
label is reported relative to it:

```
script time (ms) — JavaScript executed for the operation
benchmark                  baseline      guard     vs baseline
---------------------------------------------------------------
01_run1k                       2.00       1.95     0.98x same
03_update10th1k_x16            2.00       0.90   0.45x faster
04_select1k                    0.80       0.30   0.38x faster
...
geometric mean                                        0.71x
```

- **Values are medians** over the iterations, in milliseconds (memory in MB). Lower is better.
- **Ratio** is `label / baseline`, so 0.45x means the change takes 45% of the baseline time.
- **faster / slower / same** comes from a Mann-Whitney U test over the raw iterations of both
  labels, so it accounts for how noisy each benchmark is, not only how far the medians moved.
  `same` means the difference is within run-to-run noise. Do not act on a `same`, however
  tempting the ratio looks; take an interleaved run instead and see whether it becomes a verdict.
- **Geometric mean** summarises all ratios in the table into one number, the same way the
  official results page does.

### Which metric to watch

- **script** is the JavaScript time the operation caused, including event dispatch and
  microtasks. This is the part the compiler and runtime control, and it is where Thane trails the
  fastest implementations (see `framework analysis/ANALYSIS.md`). It is the metric to optimise
  against.
- **total** is click to the end of the frame that shows the result. It is dominated by style,
  layout and paint, which every framework pays roughly equally, so it moves much less than script
  and is what the public leaderboard sorts by.
- **paint** is the style, layout and paint work inside that window. It should stay flat; a change
  that moves it usually changed the DOM shape, not the script.
- **memory** is the JavaScript heap after the operation and a forced garbage collection. Memory
  benchmarks run once, as in the official runner, so treat small differences as noise.

CPU throttling is applied exactly as the official runner does it (4x for partial update, select
row, swap rows and clear rows; 2x for remove row), so those numbers are larger than the operation
takes on your machine but directly comparable with the public results.

### Files

- `bench/results/<label>/summary.json`: medians per benchmark, plus the commit, browser and time
  of the build. Read this when you want the numbers.
- `bench/results/<label>/<benchmark>.json`: every iteration's total, script and paint, with min,
  max, mean, median and standard deviation. Read this when a median looks odd and you want to see
  the spread.
- `bench/traces/<label>/<benchmark>_<n>.json`: the Chrome trace each iteration was computed
  from. Load one in the Chrome DevTools Performance panel or at https://ui.perfetto.dev to see
  exactly where the time went. This is the fastest way to understand a surprising number.

## How it maps to the official benchmark

- The app in `bench/app/` is the same source as `frameworks/keyed/thane` in the benchmark
  repository, styled with the same Bootstrap stylesheet (vendored under `bench/css/`).
- The operations, warm-up sequences, throttling factors, iteration counts, Chrome flags and trace
  categories are ported from `webdriver-ts`. The trace analysis in `trace.ts` is a port of its
  `timeline.ts`, so total, script and paint are computed the same way.
- Not included: the startup benchmark (Lighthouse) and the bundle size benchmark.
- Numbers drift with the Chrome version and differ between machines. Compare labels measured on
  the same machine and browser; `compare` warns when the browsers differ. For placement against
  other frameworks, run the official repository.

## Getting stable numbers

Plug the machine in, close anything heavy, and leave it alone during a run. Take the baseline and
the candidate in the same sitting, or use `--interleave`. Expect script times on the small
benchmarks to vary by about 0.1 to 0.2 ms between runs and totals by about 1 ms; the significance
test exists so you do not have to eyeball that.
