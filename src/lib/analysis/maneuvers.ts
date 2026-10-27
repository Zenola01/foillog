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
  const { t, spd, crs } = tr
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
    let kind: Maneuver['kind']
    if (turn) {
      const up = inArc(a.course, turn.delta, windDir)
      const down = inArc(a.course, turn.delta, windDir + 180)
      kind = up && !down ? 'tack' : down && !up ? 'jibe' : Math.abs(angDiff(turn.apex, windDir)) < 90 ? 'tack' : 'jibe'
    } else {
      const meanTwa = (Math.abs(norm180(windDir - a.course)) + Math.abs(norm180(windDir - b.course))) / 2
      kind = meanTwa < 90 ? 'tack' : 'jibe'
    }

    const i0 = a.i1
    const i1 = b.i0
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
    // A stop (or a GPS gap) inside the turn means the rider went in the water. Which manoeuvre
    // it was then follows from the two legs: both downwind is a jibe, both upwind a tack.
    const fell = gap || stoppedSeconds(t, s3, i0, i1) >= 3
    if (fell) {
      at = minAt
      const meanTwa = (Math.abs(norm180(windDir - a.course)) + Math.abs(norm180(windDir - b.course))) / 2
      kind = meanTwa < 90 ? 'tack' : 'jibe'
    }
    out.push({
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
    })
  }
  return out
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
