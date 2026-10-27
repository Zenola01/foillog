import type { Flight, Track } from '../types'
import { MS_TO_KN } from '../units'
import { movingAverage, segmentIds } from './series'

const TAKEOFF_MS = 3000
const TOUCHDOWN_MS = 2000
const MIN_FLIGHT_S = 5
/** Below the take-off speed minus this margin (kn) the rider is off the foil. */
const HYSTERESIS_KN = 1.5

/**
 * Marks foiling points from speed alone: on the foil after holding the take-off speed for 3 s,
 * off after staying below it (minus a margin) for 2 s. The margin keeps a brief dip while
 * pumping from counting as a touchdown.
 */
export function detectFoil(tr: Track, onKn: number): { foil: Uint8Array; flights: Flight[] } {
  const { t, gap, dist } = tr
  const n = t.length
  const seg = segmentIds(gap)
  const s3 = movingAverage(tr, tr.spd, 1500, seg)
  const on = onKn / MS_TO_KN
  const off = Math.max(0.5, (onKn - HYSTERESIS_KN) / MS_TO_KN)
  const foil = new Uint8Array(n)
  let state = 0
  let cand = -1
  let drop = -1
  for (let i = 0; i < n; i++) {
    if (gap[i]) {
      if (state === 1 && drop >= 0) foil.fill(0, drop, i)
      state = 0
      cand = -1
      drop = -1
    }
    if (state === 0) {
      if (s3[i] >= on) {
        if (cand < 0) cand = i
        if (t[i] - t[cand] >= TAKEOFF_MS) {
          foil.fill(1, cand, i + 1)
          state = 1
          drop = -1
        }
      } else cand = -1
    } else {
      foil[i] = 1
      if (s3[i] < off) {
        if (drop < 0) drop = i
        if (t[i] - t[drop] >= TOUCHDOWN_MS) {
          foil.fill(0, drop, i + 1)
          state = 0
          cand = -1
          drop = -1
        }
      } else drop = -1
    }
  }
  if (state === 1 && drop >= 0) foil.fill(0, drop, n)

  const flights: Flight[] = []
  let s = -1
  for (let i = 0; i <= n; i++) {
    if (i < n && foil[i]) {
      if (s < 0) s = i
    } else if (s >= 0) {
      const e = i - 1
      const duration = (t[e] - t[s]) / 1000
      if (duration >= MIN_FLIGHT_S) flights.push({ i0: s, i1: e, duration, distance: dist[e] - dist[s] })
      s = -1
    }
  }
  return { foil, flights }
}
