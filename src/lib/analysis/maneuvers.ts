import { angDiff, circularMean, norm180, norm360 } from '../geo'
import type { Maneuver, Tack, Track } from '../types'
import { meanBetween, segmentIds } from './series'

const LEG_MIN_SPEED = 2.0 // m/s, about 4 kn
const LEG_HALF_WINDOW = 3000
const LEG_SPREAD = 20 // deg
const LEG_MIN_MS = 8000
const LEG_MERGE_MS = 3000
/** Longest transition between two legs that still counts as one manoeuvre (a fall and water start included). */
export const TURN_MAX_MS = 45_000
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
  const turns: Turn[] = []
  for (let k = 0; k + 1 < legs.length; k++) {
    const a = legs[k]
    const b = legs[k + 1]
    if (!transitionOk(tr, a, b)) continue
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
  const byLeg = new Map(turns.map((x) => [x.leg, x]))
  const out: Maneuver[] = []
  for (let k = 0; k + 1 < legs.length; k++) {
    const a = legs[k]
    const b = legs[k + 1]
    if (!transitionOk(tr, a, b)) continue
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
    let foiled = true
    let at = Math.round((i0 + i1) / 2)
    let bestApex = Infinity
    const target = kind === 'tack' ? windDir : windDir + 180
    for (let i = i0; i <= i1; i++) {
      if (spd[i] < minSpeed) minSpeed = spd[i]
      if (!foil[i]) foiled = false
      const d = Math.abs(angDiff(crs[i], target))
      if (d < bestApex) {
        bestApex = d
        at = i
      }
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
      foiled,
    })
  }
  return out
}
