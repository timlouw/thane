/**
 * Descriptive statistics and a significance test for benchmark samples.
 */

export interface Stats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
  values: number[];
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('Cannot compute the median of an empty array');
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 0 ? 0.5 * (sorted[n / 2 - 1]! + sorted[n / 2]!) : sorted[(n - 1) / 2]!;
}

export function stats(values: number[]): Stats {
  if (values.length === 0) throw new Error('Cannot compute stats on an empty array');
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((p, c) => p + c, 0) / n;
  const variance = n > 1 ? sorted.reduce((p, c) => p + (c - mean) ** 2, 0) / (n - 1) : 0;
  return { min: sorted[0]!, max: sorted[n - 1]!, mean, median: median(sorted), stddev: Math.sqrt(variance), values };
}

export function geometricMean(values: number[]): number {
  if (values.length === 0) return NaN;
  return Math.exp(values.reduce((p, c) => p + Math.log(c), 0) / values.length);
}

/**
 * Two-sided Mann-Whitney U test. Returns the probability that two samples this different
 * would arise from the same distribution (normal approximation with tie correction, which
 * is adequate for the 15-sample runs the harness produces). Benchmark timings are skewed
 * and contain outliers, so a rank test is safer than a t-test here.
 */
export function mannWhitneyP(a: number[], b: number[]): number {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return 1;

  const all = [...a.map((v) => ({ v, group: 0 })), ...b.map((v) => ({ v, group: 1 }))].sort((x, y) => x.v - y.v);
  const n = all.length;
  const ranks = new Array<number>(n);
  let tieTerm = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && all[j + 1]!.v === all[i]!.v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    const ties = j - i + 1;
    if (ties > 1) tieTerm += ties ** 3 - ties;
    i = j + 1;
  }

  let rankSum1 = 0;
  for (let i = 0; i < n; i++) if (all[i]!.group === 0) rankSum1 += ranks[i]!;
  const u1 = rankSum1 - (n1 * (n1 + 1)) / 2;
  const u = Math.min(u1, n1 * n2 - u1);
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  if (sigma === 0) return 1;
  const z = (u - mu) / sigma; // u <= mu, so z <= 0
  return Math.min(1, 2 * normalCdf(z));
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Abramowitz & Stegun 7.1.26, accurate to ~1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}
