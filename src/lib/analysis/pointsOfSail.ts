import { norm180, RAD } from '../geo'
import type { PolarBin, SailStats, SideStats, SpeedRecord, Tack, Track } from '../types'
import { movingAverage, pointWeights, segmentIds, weightedPercentile } from './series'

const POLAR_BIN = 5
const POLAR_MIN_SECONDS = 5

/**
 * Points of sail by |TWA|: upwind under UPWIND_MAX, downwind over DOWNWIND_MIN, a reach in between.
 * Reaching is kept apart: going back and forth across the wind (waiting for friends, say) would
 * otherwise drag down both the upwind and the downwind numbers.
 */
export const UPWIND_MAX = 70
export const DOWNWIND_MIN = 120

export type Course = 'up' | 'reach' | 'down'

export function courseOf(twa: number | null): Course | null {
  if (twa == null) return null
  const a = Math.abs(twa)
  return a < UPWIND_MAX ? 'up' : a > DOWNWIND_MIN ? 'down' : 'reach'
}

export interface SailResult {
  twa: Float32Array
  vmg: Float32Array
  stats: SailStats
  polar: PolarBin[]
}

/**
 * True wind angle (positive = starboard tack) and VMG for each point, plus per-tack statistics
 * and the polar. Statistics use only steady legs on the foil: through a tack the bow briefly
 * points into the wind at speed, which would inflate both VMG and the polar.
 */
export function pointsOfSail(tr: Track, foil: Uint8Array, windDir: number, legs: { i0: number; i1: number }[]): SailResult {
  const { spd, crs } = tr
  const n = spd.length
  const twa = new Float32Array(n)
  const vmg = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    twa[i] = norm180(windDir - crs[i])
    vmg[i] = spd[i] * Math.cos(twa[i] * RAD)
  }
  const w = pointWeights(tr)
  const steady = new Uint8Array(n)
  for (const l of legs) for (let i = l.i0; i <= l.i1; i++) if (foil[i]) steady[i] = 1
  // Smoothed speed for the polar: its 90th percentile would otherwise pick up GPS noise.
  const s3 = movingAverage(tr, spd, 1500)

  const side = (course: Course, tack: Tack): SideStats | null => {
    const angles: [number, number][] = []
    let secs = 0
    let sv = 0
    let svmg = 0
    for (let i = 0; i < n; i++) {
      if (!steady[i] || !(w[i] > 0)) continue
      if (courseOf(twa[i]) !== course) continue
      if ((twa[i] > 0 ? 'S' : 'P') !== tack) continue
      const a = Math.abs(twa[i])
      angles.push([a, w[i]])
      secs += w[i]
      sv += spd[i] * w[i]
      svmg += Math.abs(vmg[i]) * w[i]
    }
    if (secs < 20) return null
    return { angle: weightedPercentile(angles, 0.5), speed: sv / secs, vmg: svmg / secs, seconds: secs }
  }

  const stats: SailStats = {
    upwind: { S: side('up', 'S'), P: side('up', 'P') },
    reach: { S: side('reach', 'S'), P: side('reach', 'P') },
    downwind: { S: side('down', 'S'), P: side('down', 'P') },
    bestVmgUp: bestVmg(tr, vmg, 1, legs),
    bestVmgDown: bestVmg(tr, vmg, -1, legs),
  }

  const bins = new Map<number, [number, number][]>()
  for (let i = 0; i < n; i++) {
    if (!steady[i] || !(w[i] > 0)) continue
    const b = Math.floor((twa[i] + 180) / POLAR_BIN)
    if (!bins.has(b)) bins.set(b, [])
    bins.get(b)!.push([s3[i], w[i]])
  }
  const polar: PolarBin[] = []
  for (const [b, pairs] of [...bins.entries()].sort((x, y) => x[0] - y[0])) {
    const seconds = pairs.reduce((s, p) => s + p[1], 0)
    if (seconds < POLAR_MIN_SECONDS) continue
    polar.push({ twa: b * POLAR_BIN - 180 + POLAR_BIN / 2, speed: weightedPercentile(pairs, 0.9), seconds })
  }
  return { twa, vmg, stats, polar }
}

/** Best 10 s average VMG within a leg, upwind (sign 1) or downwind (sign -1, returned as a positive number). */
function bestVmg(tr: Track, vmg: Float32Array, sign: 1 | -1, legs: { i0: number; i1: number }[]): SpeedRecord | null {
  const { t } = tr
  const n = t.length
  const seg = segmentIds(tr.gap)
  const integ = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    integ[i] = integ[i - 1] + (tr.gap[i] ? 0 : ((vmg[i - 1] + vmg[i]) / 2) * ((t[i] - t[i - 1]) / 1000))
  }
  let best: SpeedRecord | null = null
  for (const l of legs) {
    let j = l.i0
    for (let i = l.i0; i <= l.i1; i++) {
      if (j < i) j = i
      while (j <= l.i1 && t[j] - t[i] < 10_000) j++
      if (j > l.i1) break
      if (seg[i] !== seg[j]) continue
      const v = (sign * (integ[j] - integ[i])) / ((t[j] - t[i]) / 1000)
      if (v > 0 && (!best || v > best.v)) best = { v, i0: i, i1: j }
    }
  }
  return best
}
