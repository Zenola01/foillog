import { angDiff, circularMean, norm180, norm360 } from '../geo'
import type { Maneuver, Stop, Tack, Track } from '../types'
import { meanBetween, movingAverage, segmentIds } from './series'

const LEG_MIN_SPEED = 2.0 // m/s, about 4 kn
const LEG_HALF_WINDOW = 3000
const LEG_SPREAD = 20 // deg
const LEG_MIN_MS = 8000
const LEG_MERGE_MS = 3000
/** Longest transition between two legs read as one continuous turn (used for the wind estimate). */
export const TURN_MAX_MS = 45_000
/** Longest change of tack still counted as a manoeuvre: a fall and the water start can take two minutes. */
export const MANEUVER_MAX_MS = 150_000
/** Below this 3 s average speed (m/s) the rider is stopped: in the water or standing. */
const STOP_SPEED = 1.2

/** Seconds spent stopped between two indices (3 s average speed, so GPS jitter does not count as moving). */
function stoppedSeconds(t: Float64Array, s3: Float32Array, i0: number, i1: number): number {
  let secs = 0
  for (let i = i0 + 1; i <= i1; i++) if (s3[i] < STOP_SPEED) secs += (t[i] - t[i - 1]) / 1000
  return secs
}
const TURN_MIN_ANGLE = 60

/** A stretch on a steady course. */
export interface RawLeg {
  i0: number
  i1: number
  course: number
}

/** The transition between two consecutive legs. */
export interface Turn {
  leg: number
  i0: number
  i1: number
  /** Signed course change (deg), positive = turned clockwise (to starboard). */
  delta: number
  /** Course halfway through the turn: head to wind for a tack, dead downwind for a jibe. */
  apex: number
}

export function findLegs(tr: Track): RawLeg[] {
  const { t, crs, spd, gap } = tr
  const n = t.length
  const seg = segmentIds(gap)
  const stable = new Uint8Array(n)
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    while (t[lo] < t[i] - LEG_HALF_WINDOW || seg[lo] !== seg[i]) lo++
    if (hi < i) hi = i
    while (hi + 1 < n && t[hi + 1] <= t[i] + LEG_HALF_WINDOW && seg[hi + 1] === seg[i]) hi++
    if (spd[i] < LEG_MIN_SPEED) continue
    let ok = true
    for (let k = lo; k <= hi; k++) {
      if (spd[k] < LEG_MIN_SPEED * 0.75 || Math.abs(angDiff(crs[i], crs[k])) > LEG_SPREAD) {
        ok = false
        break
      }
    }
    if (ok) stable[i] = 1
  }

  const runs: RawLeg[] = []
  let s = -1
  for (let i = 0; i <= n; i++) {
    const inRun = i < n && stable[i] === 1 && (s < 0 || seg[i] === seg[s])
    if (inRun) {
      if (s < 0) s = i
      continue
    }
    if (s >= 0) runs.push({ i0: s, i1: i - 1, course: circularMean(crs, undefined, s, i - 1).mean })
    s = i < n && stable[i] === 1 ? i : -1
  }

  // Join runs split by a brief wobble on the same course, then drop the short ones.
  const merged: RawLeg[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (
      last &&
      seg[last.i1] === seg[r.i0] &&
      t[r.i0] - t[last.i1] <= LEG_MERGE_MS &&
      Math.abs(angDiff(last.course, r.course)) <= LEG_SPREAD
    ) {
      last.i1 = r.i1
      last.course = circularMean(crs, undefined, last.i0, last.i1).mean
    } else merged.push({ ...r })
  }
  return merged.filter((l) => t[l.i1] - t[l.i0] >= LEG_MIN_MS)
}

function transitionOk(tr: Track, a: RawLeg, b: RawLeg): boolean {
  if (tr.t[b.i0] - tr.t[a.i1] > TURN_MAX_MS) return false
  for (let i = a.i1 + 1; i <= b.i0; i++) if (tr.gap[i]) return false
  return true
}

export function findTurns(tr: Track, legs: RawLeg[]): Turn[] {
  const { crs, spd } = tr
  const s3 = movingAverage(tr, spd, 1500)
  const turns: Turn[] = []
  for (let k = 0; k + 1 < legs.length; k++) {
    const a = legs[k]
    const b = legs[k + 1]
    if (!transitionOk(tr, a, b)) continue
    // After a fall the board's heading while getting going again says nothing about the turn.
    if (stoppedSeconds(tr.t, s3, a.i1, b.i0) >= 3) continue
    const short = angDiff(a.course, b.course)
    // Which way did the rider actually turn? Follow the course through the transition.
    let integ = 0
    let used = 0
    let prev = a.course
    for (let i = a.i1; i <= b.i0; i++) {
      if (spd[i] < 1) continue
      integ += angDiff(prev, crs[i])
      prev = crs[i]
      used++
    }
    integ += angDiff(prev, b.course)
    let delta = short
    if (used >= 2) {
      const long = short > 0 ? short - 360 : short + 360
      if (Math.abs(integ - long) < Math.abs(integ - short)) delta = long
    }
    if (Math.abs(delta) < TURN_MIN_ANGLE) continue
    turns.push({ leg: k, i0: a.i1, i1: b.i0, delta, apex: norm360(a.course + delta / 2) })
  }
  return turns
}

/** Starboard when the wind comes over the right side. Near dead up/downwind the tack is undefined. */
export function tackOf(windDir: number, course: number): Tack | null {
  const twa = norm180(windDir - course)
  if (Math.abs(twa) < 12 || Math.abs(twa) > 168) return null
  return twa > 0 ? 'S' : 'P'
}

/** True when sweeping `delta` degrees from `from` passes through direction `x`. */
function inArc(from: number, delta: number, x: number): boolean {
  const u = norm360((x - from) * Math.sign(delta))
  return u <= Math.abs(delta)
}

/** A manoeuvre is a change of tack between two legs; it is a tack if the bow passed through the wind. */
export function findManeuvers(tr: Track, legs: RawLeg[], turns: Turn[], foil: Uint8Array, windDir: number): Maneuver[] {
  const { t, spd } = tr
  const s3 = movingAverage(tr, spd, 1500)
  const byLeg = new Map(turns.map((x) => [x.leg, x]))
  const out: Maneuver[] = []
  for (let k = 0; k + 1 < legs.length; k++) {
    const a = legs[k]
    const b = legs[k + 1]
    // Gaps are allowed here: a watch under water during a fall loses the GPS.
    if (t[b.i0] - t[a.i1] > MANEUVER_MAX_MS) continue
    const from = tackOf(windDir, a.course)
    const to = tackOf(windDir, b.course)
    if (!from || !to || from === to) continue

    const turn = byLeg.get(k)
    const meanTwa = (Math.abs(norm180(windDir - a.course)) + Math.abs(norm180(windDir - b.course))) / 2
    let kind: Maneuver['kind']
    if (turn) {
      const up = inArc(a.course, turn.delta, windDir)
      const down = inArc(a.course, turn.delta, windDir + 180)
      kind = up && !down ? 'tack' : down && !up ? 'jibe' : Math.abs(angDiff(turn.apex, windDir)) < 90 ? 'tack' : 'jibe'
    } else kind = meanTwa < 90 ? 'tack' : 'jibe'
    out.push(measure(tr, s3, foil, windDir, a.i1, b.i0, kind, from, to, meanTwa))
  }

  // Second pass, point by point: changes of tack with no straight leg on one side (two jibes a few
  // seconds apart, the first turn of the session) never show up between legs.
  for (const c of tackChanges(tr, s3, windDir)) {
    if (out.some((m) => m.i0 - 3 <= c.i1 && c.i0 <= m.i1 + 3)) continue
    out.push(measure(tr, s3, foil, windDir, c.i0, c.i1, c.through, c.from, c.to, c.meanTwa))
  }
  out.sort((x, y) => x.i0 - y.i0)
  return out
}

/** Metrics of a manoeuvre between i0 and i1, shared by both ways of finding it. */
function measure(
  tr: Track,
  s3: Float32Array,
  foil: Uint8Array,
  windDir: number,
  i0: number,
  i1: number,
  kind: Maneuver['kind'],
  from: Tack,
  to: Tack,
  meanTwa: number,
): Maneuver {
  const { t, spd, crs } = tr
  let minSpeed = Infinity
  let minAt = i0
  let foiled = true
  let at = Math.round((i0 + i1) / 2)
  let bestApex = Infinity
  let gap = false
  const target = kind === 'tack' ? windDir : windDir + 180
  for (let i = i0; i <= i1; i++) {
    if (spd[i] < minSpeed) {
      minSpeed = spd[i]
      minAt = i
    }
    if (!foil[i]) foiled = false
    if (i > i0 && tr.gap[i]) gap = true
    const d = Math.abs(angDiff(crs[i], target))
    if (d < bestApex) {
      bestApex = d
      at = i
    }
  }
  // A stop (or a GPS gap) inside the turn means the rider went in the water. Which manoeuvre it
  // was then follows from the two sides: both downwind is a jibe, both upwind a tack.
  const fell = gap || stoppedSeconds(t, s3, i0, i1) >= 3
  if (fell) {
    at = minAt
    kind = meanTwa < 90 ? 'tack' : 'jibe'
  }
  return {
    kind,
    from,
    to,
    i0,
    i1,
    at,
    duration: (t[i1] - t[i0]) / 1000,
    entrySpeed: meanBetween(t, spd, t[i0] - 3000, t[i0], i0),
    minSpeed,
    exitSpeed: meanBetween(t, spd, t[i1], t[i1] + 3000, i1),
    foiled: foiled && !fell,
    fell,
  }
}

/** Wind angles counted as clearly on one tack (deg): away from head to wind and dead downwind. */
const CLEAR_MIN = 15
const CLEAR_MAX = 165
/** Seconds on the new tack before a change counts. */
const SETTLE_S = 5
/** Sailing speed (3 s average, m/s, about 6 kn): slower, the rider may be swimming or walking the board out. */
const SAILING_SPEED = 3

interface TackChange {
  i0: number
  i1: number
  from: Tack
  to: Tack
  through: Maneuver['kind']
  meanTwa: number
}

/**
 * Changes of tack followed point by point: a change counts once the rider has been clearly on the
 * other tack, at sailing speed, for 5 s. The window is then widened to the whole turn, as long as the course keeps
 * turning the same way.
 */
function tackChanges(tr: Track, s3: Float32Array, windDir: number): TackChange[] {
  const { t, crs } = tr
  const n = t.length
  const twa = new Float32Array(n)
  const side = new Int8Array(n)
  for (let i = 0; i < n; i++) {
    twa[i] = norm180(windDir - crs[i])
    const x = Math.abs(twa[i])
    if (s3[i] >= SAILING_SPEED && x >= CLEAR_MIN && x <= CLEAR_MAX) side[i] = twa[i] > 0 ? 1 : -1
  }
  const out: TackChange[] = []
  let cur = 0
  let lastCur = -1
  let cand = -1
  let candPrev = -1
  let candSecs = 0
  for (let i = 0; i < n; i++) {
    const sd = side[i]
    if (sd === 0) continue
    if (sd === cur) {
      lastCur = i
      cand = -1
      continue
    }
    if (cand < 0 || side[cand] !== sd) {
      cand = i
      candPrev = i
      candSecs = 0
      continue
    }
    candSecs += (t[i] - t[candPrev]) / 1000
    candPrev = i
    if (candSecs < SETTLE_S) continue
    if (cur !== 0 && t[cand] - t[lastCur] <= MANEUVER_MAX_MS) {
      const a = lastCur
      const b = cand
      // Which way it crossed: through head to wind (small angles) or through dead downwind.
      let through: Maneuver['kind'] = 'jibe'
      let flipped = false
      let prev = NaN
      let turned = 0
      let prevCrs = crs[a]
      for (let k = a; k <= b; k++) {
        if (s3[k] < STOP_SPEED) continue
        turned += angDiff(prevCrs, crs[k])
        prevCrs = crs[k]
        if (!flipped && !Number.isNaN(prev) && twa[k] !== 0 && Math.sign(twa[k]) !== Math.sign(prev)) {
          through = Math.abs(twa[k]) + Math.abs(prev) < 180 ? 'tack' : 'jibe'
          flipped = true
        }
        prev = twa[k]
      }
      const dir = Math.sign(turned) || 1
      out.push({
        i0: widen(tr, a, dir, -1),
        i1: widen(tr, b, dir, 1),
        from: cur > 0 ? 'S' : 'P',
        to: sd > 0 ? 'S' : 'P',
        through,
        meanTwa: (Math.abs(twa[a]) + Math.abs(twa[b])) / 2,
      })
    }
    cur = sd
    lastCur = i
    cand = -1
  }
  return out
}

/** Moves from index i in `step` direction while the course keeps turning in `dir` (≥ 2°/s), up to 10 s. */
function widen(tr: Track, i: number, dir: number, step: -1 | 1): number {
  const { t, crs, gap } = tr
  let k = i
  for (;;) {
    const nk = k + step
    if (nk < 0 || nk >= t.length || Math.abs(t[nk] - t[i]) > 10_000) break
    const lo = Math.min(k, nk)
    const hi = Math.max(k, nk)
    if (gap[hi]) break
    const d = angDiff(crs[lo], crs[hi])
    const rate = Math.abs(d) / ((t[hi] - t[lo]) / 1000)
    if (Math.sign(d) !== dir || rate < 2) break
    k = nk
  }
  return k
}

/**
 * Stops after foiling (a fall, or a rest) that are not part of a manoeuvre: at least 5 s below
 * walking pace within 40 s of having been on the foil. The window is that long because a watch
 * under water after a fall loses the GPS for 10–30 s before the stop shows up in the data.
 */
export function findStops(tr: Track, foil: Uint8Array, maneuvers: Maneuver[]): Stop[] {
  const { t, gap } = tr
  const n = t.length
  const s3 = movingAverage(tr, tr.spd, 1500)
  const inManeuver = new Uint8Array(n)
  for (const m of maneuvers) inManeuver.fill(1, m.i0, m.i1 + 1)
  const out: Stop[] = []
  let lastFoil = -Infinity
  let s = -1
  for (let i = 0; i <= n; i++) {
    const slow = i < n && s3[i] < STOP_SPEED && !gap[i]
    if (i < n && foil[i]) lastFoil = t[i]
    if (slow) {
      if (s < 0) s = i
      continue
    }
    if (s >= 0) {
      const e = i - 1
      const duration = (t[e] - t[s]) / 1000
      if (duration >= 5 && t[s] - lastFoil <= 40_000 && !inManeuver[s] && !inManeuver[e]) out.push({ i0: s, i1: e, duration })
      s = -1
    }
  }
  return out
}
