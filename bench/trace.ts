/**
 * Chrome trace analysis for the CPU benchmarks.
 *
 * This is a port of `webdriver-ts/src/timeline.ts` from krausest/js-framework-benchmark
 * (Apache License 2.0, https://github.com/krausest/js-framework-benchmark), so the numbers
 * produced here are computed the same way as the official results:
 *
 * - total:  from the start of the click event to the end of the compositor Commit that
 *           follows the last script or layout work the click triggered
 * - script: the union of JavaScript execution events inside that window
 * - paint:  the union of style, layout and paint events inside that window
 *
 * All timestamps in a trace are microseconds; results are reported in milliseconds.
 */

export interface TraceEvent {
  name: string;
  ph?: string;
  ts: number;
  dur?: number;
  pid: number;
  args?: { data?: { type?: string } };
}

interface Timed {
  type: string;
  ts: number;
  dur: number;
  end: number;
  pid: number;
}

export interface CpuWindow {
  tsStart: number;
  tsEnd: number;
  total: number;
  layouts: number;
  commits: number;
  rafLongDelay: number;
}

export interface CpuResult {
  total: number;
  script: number;
  paint: number;
  layouts: number;
  commits: number;
}

const JS_EVENTS = [
  'EventDispatch',
  'EvaluateScript',
  'v8.evaluateModule',
  'FunctionCall',
  'TimerFire',
  'FireIdleCallback',
  'FireAnimationFrame',
  'RunMicrotasks',
  'V8.Execute',
];

const PAINT_EVENTS = ['UpdateLayoutTree', 'Layout', 'Commit', 'Paint', 'Layerize', 'PrePaint'];

const CPU_EVENT_TYPES: Record<string, string> = {
  Layout: 'layout',
  FunctionCall: 'functioncall',
  HitTest: 'hittest',
  Commit: 'commit',
  Paint: 'paint',
  FireAnimationFrame: 'fireAnimationFrame',
};

function extractCpuEvents(entries: TraceEvent[], startLogicEvent: string): Timed[] {
  const out: Timed[] = [];
  for (const e of entries) {
    const push = (type: string, dur = e.dur ?? 0) =>
      out.push({ type, ts: +e.ts, dur: +dur, end: +e.ts + +dur, pid: e.pid });
    if (e.name === 'EventDispatch') {
      const kind = e.args?.data?.type;
      if (kind === startLogicEvent) push('startLogicEvent');
      if (kind === 'click') push('click');
      else if (kind === 'mousedown') push('mousedown');
      else if (kind === 'pointerup') push('pointerup');
    } else if (e.ph === 'X' && CPU_EVENT_TYPES[e.name] !== undefined) {
      push(CPU_EVENT_TYPES[e.name]!);
    } else if (e.name === 'TimerFire' && e.ph === 'X') {
      push('timerFire', 0);
    } else if (e.name === 'RequestAnimationFrame') {
      push('requestAnimationFrame', 0);
    }
  }
  return out;
}

/** Finds the measured window: click start to the end of the commit that paints its result. */
export function computeCpuWindow(entries: TraceEvent[], startLogicEvent = 'click'): CpuWindow {
  const events = extractCpuEvents(entries, startLogicEvent).sort((a, b) => a.end - b.end);

  const mousedowns = events.filter((e) => e.type === 'mousedown');
  if (mousedowns.length > 1) throw new Error(`at most one mousedown event is expected, found ${mousedowns.length}`);

  const clicks = events.filter((e) => e.type === 'startLogicEvent');
  if (clicks.length !== 1) throw new Error(`exactly one ${startLogicEvent} event is expected, found ${clicks.length}`);
  const click = clicks[0]!;

  // Only events after the click, from the renderer process that handled it.
  const during = events.filter((e) => (e.ts > click.end || e.type === 'click') && e.pid === click.pid);

  const startFromTypes = [startLogicEvent, 'fireAnimationFrame', 'timerFire', 'layout', 'functioncall'];
  const startFromEvent = during.filter((e) => startFromTypes.includes(e.type)).at(-1);
  if (!startFromEvent) throw new Error('no script or layout events were recorded after the click');

  const commits = during.filter((e) => e.type === 'commit');
  const commit = commits.find((e) => e.ts > startFromEvent.end) ?? commits.at(-1);
  if (!commit) throw new Error('no Commit event was recorded after the click');

  let total = (commit.end - click.ts) / 1000;
  const layouts = during.filter((e) => e.type === 'layout');

  // The official runner discounts one pathological case: a single requestAnimationFrame
  // issued inside the click whose callback the browser delayed by more than a frame.
  let rafLongDelay = 0;
  const rafsWithinClick = events.filter(
    (e) => e.type === 'requestAnimationFrame' && e.ts >= click.ts && e.ts <= click.end,
  );
  const fafs = events.filter((e) => e.type === 'fireAnimationFrame' && e.ts >= click.ts && e.ts < commit.ts);
  if (rafsWithinClick.length === 1 && fafs.length === 1) {
    const waitDelay = (fafs[0]!.ts - click.end) / 1000;
    if (waitDelay > 16 && !layouts.some((l) => l.ts < fafs[0]!.ts)) {
      rafLongDelay = waitDelay - 16;
      total -= rafLongDelay;
    }
  }

  return {
    tsStart: click.ts,
    tsEnd: commit.end,
    total,
    layouts: layouts.length,
    commits: commits.length,
    rafLongDelay,
  };
}

interface Interval {
  start: number;
  end: number;
}

/** Sums the given event kinds inside the window, counting nested events only once. */
function sumEventIntervals(entries: TraceEvent[], window: CpuWindow, names: string[], includeClick: boolean): number {
  const events: Interval[] = [];
  for (const e of entries) {
    if (e.name === 'EventDispatch') {
      if (includeClick && e.args?.data?.type === 'click') events.push({ start: +e.ts, end: +e.ts + (e.dur ?? 0) });
    } else if (e.ph === 'X' && names.includes(e.name)) {
      events.push({ start: +e.ts, end: +e.ts + (e.dur ?? 0) });
    }
  }

  let intervals: Interval[] = [];
  for (const outer of events) {
    if (outer.start < window.tsStart || outer.start > window.tsEnd) continue;
    const contained = intervals.some((iv) => outer.start >= iv.start && outer.end <= iv.end);
    const next = contained ? [] : [outer];
    for (const iv of intervals) if (iv.start < outer.start || iv.end > outer.end) next.push(iv);
    intervals = next;
  }
  return intervals.reduce((p, c) => p + (c.end - c.start), 0) / 1000;
}

export function analyseTrace(entries: TraceEvent[], startLogicEvent = 'click'): CpuResult {
  const window = computeCpuWindow(entries, startLogicEvent);
  return {
    total: window.total,
    script: sumEventIntervals(entries, window, JS_EVENTS, true),
    paint: sumEventIntervals(entries, window, PAINT_EVENTS, false),
    layouts: window.layouts,
    commits: window.commits,
  };
}
