import { angDiff, axialDist, circularMean, norm180, norm360, RAD } from '../geo'
import type { InstrumentWind, Track, WindEstimate } from '../types'
import type { RawLeg, Turn } from './maneuvers'
import { indexAtTime } from './series'

// Wind direction from the track alone has a 180° ambiguity: tacks and jibes both happen on the
// wind axis (head to wind and dead downwind), so the turns reveal the axis but not which end the
// wind comes from. A weather model settles that; without one, a weak heuristic does and the rider
// is asked to confirm.

interface Axis {
  axis: number
  strength: number
}

/** Axis through the apexes of the turns (doubled-angle statistics, robust to bear-aways). */
export function axisFromTurns(turns: Turn[]): Axis | null {
  if (turns.length < 3) return null
  const bins = new Float64Array(36)
  for (const tu of turns) bins[Math.floor(norm360(2 * tu.apex) / 10) % 36] += 1
  let peak = 0
  let best = -1
  for (let b = 0; b < 36; b++) {
    const v = bins[(b + 35) % 36] + 2 * bins[b] + bins[(b + 1) % 36]
    if (v > best) {
      best = v
      peak = b
    }
  }
  const a0 = (peak * 10 + 5) / 2
  const inliers = turns.filter((tu) => axialDist(tu.apex, a0) <= 35)
  if (inliers.length < 2) return null
  let s = 0
  let c = 0
  for (const tu of inliers) {
    s += Math.sin(2 * tu.apex * RAD)
    c += Math.cos(2 * tu.apex * RAD)
  }
  const axis = norm360(Math.atan2(s, c) / RAD / 2) % 180
  const r = Math.hypot(s, c) / inliers.length
  return { axis, strength: (inliers.length / turns.length) * r }
}

/** Fallback when there are few turns: the axis about which the course distribution is most symmetric. */
export function axisFromSymmetry(tr: Track): Axis | null {
  const { t, crs, spd, gap } = tr
  const h = new Float64Array(72)
  let total = 0
  for (let i = 1; i < t.length; i++) {
    if (gap[i] || spd[i] < 2.5) continue
    const w = (t[i] - t[i - 1]) / 1000
    h[Math.floor(norm360(crs[i]) / 5) % 72] += w
    total += w
  }
  if (total < 120) return null
  let bestA = 0
  let bestScore = -1
  for (let a = 0; a < 180; a += 1) {
    let score = 0
    for (let b = 0; b < 72; b++) {
      const mirror = Math.floor(norm360(2 * a - (b * 5 + 2.5)) / 5) % 72
      score += Math.min(h[b], h[mirror])
    }
    if (score > bestScore) {
      bestScore = score
      bestA = a
    }
  }
  return { axis: bestA, strength: (bestScore / total) * 0.5 }
}

/** True wind from an apparent-wind instrument: add the board's velocity to the apparent wind vector. */
export function windFromInstrument(tr: Track, w: InstrumentWind): number | null {
  let sx = 0
  let sy = 0
  let used = 0
  for (let k = 0; k < w.t.length; k++) {
    const i = indexAtTime(tr.t, w.t[k])
    if (Math.abs(tr.t[i] - w.t[k]) > 2000 || !(w.aws[k] > 0)) continue
    const heading = tr.hdg && Number.isFinite(tr.hdg[i]) ? tr.hdg[i] : tr.crs[i]
    const toward = (heading + w.awa[k] + 180) * RAD // apparent wind blows toward this bearing
    const ax = w.aws[k] * Math.sin(toward)
    const ay = w.aws[k] * Math.cos(toward)
    const bx = tr.spd[i] * Math.sin(tr.crs[i] * RAD)
    const by = tr.spd[i] * Math.cos(tr.crs[i] * RAD)
    sx += ax + bx
    sy += ay + by
    used++
  }
  if (used < 60 || Math.hypot(sx, sy) < 1e-6) return null
  return norm360(Math.atan2(sx, sy) / RAD + 180)
}

interface Reach {
  /** Mean heading of the faster and the slower of the two directions (deg). */
  fast: number
  slow: number
  speedRatio: number
}

/** Legs that run along a single line in both directions (back-and-forth reaching), or null. */
export function reachingLegs(tr: Track, legs: RawLeg[]): Reach | null {
  let s = 0
  let c = 0
  let w = 0
  for (const l of legs) {
    const d = (tr.t[l.i1] - tr.t[l.i0]) / 1000
    s += d * Math.sin(2 * l.course * RAD)
    c += d * Math.cos(2 * l.course * RAD)
    w += d
  }
  if (w < 120 || Math.hypot(s, c) / w < 0.85) return null
  const line = Math.atan2(s, c) / RAD / 2
  const sides = [0, 1].map(() => ({ time: 0, dist: 0, hs: 0, hc: 0 }))
  for (const l of legs) {
    const k = Math.cos((l.course - line) * RAD) >= 0 ? 0 : 1
    const d = (tr.t[l.i1] - tr.t[l.i0]) / 1000
    sides[k].time += d
    sides[k].dist += tr.dist[l.i1] - tr.dist[l.i0]
    sides[k].hs += d * Math.sin(l.course * RAD)
    sides[k].hc += d * Math.cos(l.course * RAD)
  }
  if (sides[0].time < 30 || sides[1].time < 30) return null
  const v = sides.map((x) => x.dist / x.time)
  const h = sides.map((x) => norm360(Math.atan2(x.hs, x.hc) / RAD))
  const f = v[0] >= v[1] ? 0 : 1
  return { fast: h[f], slow: h[1 - f], speedRatio: v[f] / v[1 - f] }
}

/** With wind from `w`, is the faster board the one sailed further off the wind? */
function fasterIsBroader(w: number, r: Reach): boolean {
  const broad = Math.abs(norm180(w - r.fast))
  return broad > Math.abs(norm180(w - r.slow)) && broad < 150
}

export function estimateWind(
  tr: Track,
  legs: RawLeg[],
  turns: Turn[],
  prior: { modelDir?: number | null; instrument?: InstrumentWind | null } = {},
): WindEstimate {
  if (prior.instrument) {
    const dir = windFromInstrument(tr, prior.instrument)
    if (dir != null) return { dir, source: 'instrument', confidence: 0.95 }
  }
  const model = prior.modelDir ?? null
  const ax = axisFromTurns(turns) ?? axisFromSymmetry(tr)
  if (!ax) return model != null ? { dir: model, source: 'model', confidence: 0.5 } : { dir: null, source: null, confidence: 0 }

  const ends = [ax.axis, norm360(ax.axis + 180)]
  if (model != null) {
    const end = Math.abs(angDiff(ends[0], model)) <= Math.abs(angDiff(ends[1], model)) ? ends[0] : ends[1]
    const off = Math.abs(angDiff(end, model))
    const reach = reachingLegs(tr, legs)
    if (reach && off <= 45) {
      // Back and forth across the wind, the turns only give the bisector of the two headings, which
      // is off the wind axis whenever one board is sailed higher than the other. The faster board is
      // normally the broader one: when the model's rotation agrees with that, it is the better guess.
      // Either way the rider is asked to confirm.
      const useModel = reach.speedRatio > 1.12 && fasterIsBroader(model, reach)
      return useModel ? { dir: model, source: 'mixed', confidence: 0.55 } : { dir: end, source: 'track', confidence: 0.55 }
    }
    if (off <= 45 && ax.strength >= 0.35) return { dir: end, source: 'track', confidence: 0.85 }
    if (off <= 70) return { dir: end, source: 'track', confidence: 0.6 }
    return { dir: end, source: 'track', confidence: 0.35 }
  }

  // No model: riders jibe more often than they tack, and usually go faster downwind.
  const e = ends[0]
  let jibes = 0
  let tacks = 0
  for (const tu of turns) {
    if (Math.abs(angDiff(tu.apex, e + 180)) < 45) jibes++
    else if (Math.abs(angDiff(tu.apex, e)) < 45) tacks++
  }
  let up = 0
  let upT = 0
  let down = 0
  let downT = 0
  for (const l of legs) {
    const dur = (tr.t[l.i1] - tr.t[l.i0]) / 1000
    const v = (tr.dist[l.i1] - tr.dist[l.i0]) / Math.max(1, dur)
    const twa = Math.abs(norm180(e - l.course))
    if (twa < 80) {
      up += v * dur
      upT += dur
    } else if (twa > 100) {
      down += v * dur
      downT += dur
    }
  }
  let score = jibes + tacks > 0 ? (jibes - tacks) / (jibes + tacks) : 0
  if (upT > 30 && downT > 30) {
    const diff = down / downT - up / upT
    score += 0.5 * Math.sign(diff) * Math.min(1, Math.abs(diff) / 1.5)
  }
  return { dir: score >= 0 ? e : ends[1], source: 'track', confidence: 0.35 }
}

/**
 * One wind for riders on the same water: their estimates, weighted by confidence, when they agree
 * within `tolerance` degrees. Null when none is known or they disagree (e.g. sessions on different
 * days), in which case each rider keeps their own.
 */
export function sharedWind(winds: { dir: number | null; weight: number }[], tolerance = 25): number | null {
  const known = winds.filter((w): w is { dir: number; weight: number } => w.dir != null && Number.isFinite(w.dir))
  if (!known.length) return null
  const { mean } = circularMean(
    known.map((w) => w.dir),
    known.map((w) => Math.max(w.weight, 0.05)),
  )
  return known.every((w) => Math.abs(angDiff(w.dir, mean)) <= tolerance) ? mean : null
}
