import type { SpeedRecord, Track } from '../types'
import { segmentIds } from './series'

// Speed records follow the GPS speed-sailing conventions: best average over a time window
// (2 s, 10 s, five non-overlapping 10 s runs) or over a distance (100 m, 500 m, 1 nautical mile).
// Windows never span a data gap.

function timeWindows(tr: Track, seconds: number, seg: Int32Array, visit: (r: SpeedRecord) => void) {
  const { t, dist } = tr
  const n = t.length
  const T = seconds * 1000
  let j = 0
  for (let i = 0; i < n; i++) {
    if (j < i) j = i
    while (j < n && t[j] - t[i] < T) j++
    if (j >= n) break
    if (seg[j] !== seg[i]) continue
    const el = (t[j] - t[i]) / 1000
    if (el > seconds * 1.5 + 1) continue // samples too sparse for this window
    visit({ v: (dist[j] - dist[i]) / el, i0: i, i1: j })
  }
}

export function bestTimeWindow(tr: Track, seconds: number, seg = segmentIds(tr.gap)): SpeedRecord | null {
  let best: SpeedRecord | null = null
  timeWindows(tr, seconds, seg, (r) => {
    if (!best || r.v > best.v) best = r
  })
  return best
}

export function bestNTimeWindows(
  tr: Track,
  seconds: number,
  count: number,
  seg = segmentIds(tr.gap),
): { v: number; windows: SpeedRecord[] } | null {
  const all: SpeedRecord[] = []
  timeWindows(tr, seconds, seg, (r) => all.push(r))
  all.sort((a, b) => b.v - a.v)
  const { t } = tr
  const chosen: SpeedRecord[] = []
  for (const c of all) {
    if (chosen.every((w) => t[c.i1] <= t[w.i0] || t[c.i0] >= t[w.i1])) {
      chosen.push(c)
      if (chosen.length === count) break
    }
  }
  if (chosen.length < count) return null
  return { v: chosen.reduce((s, w) => s + w.v, 0) / count, windows: chosen }
}

export function bestDistanceWindow(tr: Track, meters: number, seg = segmentIds(tr.gap)): SpeedRecord | null {
  const { t, dist } = tr
  const n = t.length
  let best: SpeedRecord | null = null
  let j = 0
  for (let i = 0; i < n; i++) {
    if (j < i) j = i
    while (j < n && dist[j] - dist[i] < meters) j++
    if (j >= n) break
    if (seg[j] !== seg[i]) continue
    const v = (dist[j] - dist[i]) / ((t[j] - t[i]) / 1000)
    if (!best || v > best.v) best = { v, i0: i, i1: j }
  }
  return best
}
