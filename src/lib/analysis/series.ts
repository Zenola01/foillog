import type { Track } from '../types'

/** Segment id per point; a new segment starts after each data gap. */
export function segmentIds(gap: Uint8Array): Int32Array {
  const s = new Int32Array(gap.length)
  let id = 0
  for (let i = 0; i < gap.length; i++) {
    if (gap[i]) id++
    s[i] = id
  }
  return s
}

/** Time-centred moving average within a segment. */
export function movingAverage(tr: Track, values: ArrayLike<number>, halfWindowMs: number, seg = segmentIds(tr.gap)): Float32Array {
  const { t } = tr
  const n = t.length
  const out = new Float32Array(n)
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i]
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    while (t[lo] < t[i] - halfWindowMs || seg[lo] !== seg[i]) lo++
    if (hi < i) hi = i
    while (hi + 1 < n && t[hi + 1] <= t[i] + halfWindowMs && seg[hi + 1] === seg[i]) hi++
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1)
  }
  return out
}

/** Mean of `values` over [t0, t1], or NaN when no point falls in it. */
export function meanBetween(t: Float64Array, values: ArrayLike<number>, t0: number, t1: number, from = 0): number {
  let i = from
  while (i > 0 && t[i] > t0) i--
  while (i < t.length && t[i] < t0) i++
  let s = 0
  let c = 0
  for (; i < t.length && t[i] <= t1; i++) {
    s += values[i]
    c++
  }
  return c ? s / c : NaN
}

/** Index of the last point at or before time `ms` (binary search). */
export function indexAtTime(t: Float64Array, ms: number): number {
  let lo = 0
  let hi = t.length - 1
  if (ms <= t[0]) return 0
  if (ms >= t[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= ms) lo = mid
    else hi = mid
  }
  return lo
}

/** Weighted percentile (p in 0..1) of value/weight pairs. */
export function weightedPercentile(pairs: [number, number][], p: number): number {
  if (pairs.length === 0) return NaN
  pairs.sort((a, b) => a[0] - b[0])
  const total = pairs.reduce((s, x) => s + x[1], 0)
  let acc = 0
  for (const [v, w] of pairs) {
    acc += w
    if (acc >= p * total) return v
  }
  return pairs[pairs.length - 1][0]
}

/** Seconds each point stands for (half the interval on each side, capped at gaps). */
export function pointWeights(tr: Track): Float32Array {
  const { t, gap } = tr
  const n = t.length
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const before = i > 0 && !gap[i] ? (t[i] - t[i - 1]) / 2000 : 0
    const after = i < n - 1 && !gap[i + 1] ? (t[i + 1] - t[i]) / 2000 : 0
    w[i] = before + after
  }
  return w
}
