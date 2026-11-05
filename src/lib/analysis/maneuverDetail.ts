import { angDiff, bearing, EARTH_RADIUS, RAD } from '../geo'
import type { Maneuver, Track } from '../types'

// What happens inside each manoeuvre: its path seen with the wind from the top, and how fast the
// rider bears away and luffs up. Worked out on demand for the manoeuvres tab.

/** Turning slower than this (°/s) is not part of the turn. */
const TURN_MIN_RATE = 5
/** A slower moment inside a turn, up to this long, does not end it. */
const TURN_MAX_DIP_MS = 1000
/** Stretch kept before and after the turn, to show the way in and out. */
const CONTEXT_MS = 3000
/** Furthest point kept from the passage through the wind. */
const MAX_SIDE_MS = 30_000
/** Half window of a turn rate: a °/s read over about a second (at 1 Hz, across the neighbours). */
const RATE_HALF_MS = 600
/** Half window of the heel: board and chop shake it by several degrees from one point to the next. */
const HEEL_HALF_MS = 500
/** Below this speed (m/s) positions say nothing about the course. */
const MIN_COURSE_SPEED = 1.5
/** Under this many degrees a side of the turn is too small to speak of a rate. */
const MIN_PHASE_ANGLE = 10
/** Under this many degrees a turn has no radius to speak of. */
const MIN_RADIUS_ANGLE = 30

export interface PhaseRate {
  /** Highest rate (°/s), read over about a second. */
  peak: number
  /** Angle turned over the time taken (°/s). */
  mean: number
}

export interface TurnRates {
  /** Bearing away: the angle from the wind growing. */
  bearAway: PhaseRate | null
  /** Luffing up: the angle from the wind shrinking. */
  luff: PhaseRate | null
}

/** Where the rate comes from: how the GPS track bends, or how the board itself rotates (compass). */
export type RateSource = 'track' | 'compass'

export interface ManeuverDetail {
  /** Position in the session's list of manoeuvres. */
  index: number
  maneuver: Maneuver
  /** Turning clockwise (1) or anticlockwise (-1). */
  dir: 1 | -1
  /** Per point: seconds from the passage through the wind (dead downwind, or head to wind). */
  t: number[]
  /** Per point: metres from the passage, wind from +y. */
  x: number[]
  y: number[]
  /** Per point (m/s). */
  speed: number[]
  /** Per point: how fast the track bends (°/s), positive in the manoeuvre's direction; NaN when too slow to tell. */
  rate: number[]
  /** The same from the compass, when the device has one. */
  yaw: number[] | null
  /** Per point: heel (deg), positive towards the inside of the turn, when the device measures it. */
  heel: number[] | null
  /** Seconds from the passage at which the turn starts (negative) and ends. */
  turnStart: number
  turnEnd: number
  rates: TurnRates
  yawRates: TurnRates | null
  /** Most heel towards the inside while turning (deg); negative if it never leaned in. */
  heelIn: number | null
  heelAtPassage: number | null
  /** Mean radius of the turn (m). */
  radius: number | null
}

/** Nearest point at least `ms` away from i in the direction of `step`, staying within [lo, hi]. */
function reach(t: Float64Array, i: number, ms: number, step: 1 | -1, lo: number, hi: number): number {
  let j = i
  while (j + step >= lo && j + step <= hi) {
    j += step
    if (Math.abs(t[j] - t[i]) >= ms) break
  }
  return j
}

/** How fast an angle changes around point i (°/s), read across the window. */
function angleRate(t: Float64Array, angle: ArrayLike<number>, i: number, lo: number, hi: number): number {
  const a = reach(t, i, RATE_HALF_MS, -1, lo, hi)
  const b = reach(t, i, RATE_HALF_MS, 1, lo, hi)
  if (a === b) return NaN
  return angDiff(angle[a], angle[b]) / ((t[b] - t[a]) / 1000)
}

/**
 * How fast the track bends at point i (°/s): the turn between the stretch before the point and the
 * stretch after it. Taken from the positions, because the smoothed course lags and blunts the peaks.
 */
function trackRate(tr: Track, i: number, lo: number, hi: number): number {
  const a = reach(tr.t, i, RATE_HALF_MS, -1, lo, hi)
  const b = reach(tr.t, i, RATE_HALF_MS, 1, lo, hi)
  if (a === i || b === i || tr.spd[i] < MIN_COURSE_SPEED) return NaN
  const before = bearing(tr.lat[a], tr.lon[a], tr.lat[i], tr.lon[i])
  const after = bearing(tr.lat[i], tr.lon[i], tr.lat[b], tr.lon[b])
  return angDiff(before, after) / ((tr.t[b] - tr.t[a]) / 2000)
}

/** Angle turned in the manoeuvre's direction (deg) between two points. */
function swept(angle: ArrayLike<number>, from: number, to: number, dir: number): number {
  let sum = 0
  let prev = angle[from]
  for (let i = from + 1; i <= to; i++) {
    if (!Number.isFinite(angle[i])) continue
    sum += angDiff(prev, angle[i]) * dir
    prev = angle[i]
  }
  return sum
}

/** Rates of one side of the turn: the angle over [from, to], the peak over the points that belong to this side. */
function phaseRate(
  t: Float64Array,
  angle: ArrayLike<number>,
  rate: (i: number) => number,
  from: number,
  to: number,
  peakFrom: number,
  peakTo: number,
  dir: number,
): PhaseRate | null {
  const secs = (t[to] - t[from]) / 1000
  const turned = secs > 0 ? swept(angle, from, to, dir) : 0
  if (turned < MIN_PHASE_ANGLE) return null
  let peak = -Infinity
  for (let i = peakFrom; i <= peakTo; i++) {
    const r = rate(i)
    if (r > peak) peak = r
  }
  return { peak: Number.isFinite(peak) ? peak : turned / secs, mean: turned / secs }
}

/**
 * The details of every manoeuvre, in the same order; null for a fall, whose path says nothing about
 * how to turn. `windDir` is the direction the wind blows from.
 */
export function maneuverDetails(tr: Track, maneuvers: Maneuver[], windDir: number): (ManeuverDetail | null)[] {
  return maneuvers.map((m, k) => (m.fell ? null : detail(tr, maneuvers, k, windDir)))
}

function detail(tr: Track, maneuvers: Maneuver[], k: number, windDir: number): ManeuverDetail {
  const { t, crs, lat, lon, spd, dist, gap } = tr
  const m = maneuvers[k]
  const at = m.at

  // What belongs to this manoeuvre: up to halfway to its neighbours, and not across a data gap.
  let lo = k > 0 ? Math.ceil((maneuvers[k - 1].at + at) / 2) : 0
  let hi = k < maneuvers.length - 1 ? Math.floor((at + maneuvers[k + 1].at) / 2) : t.length - 1
  for (let i = at; i > lo; i--) {
    if (gap[i] || t[at] - t[i - 1] > MAX_SIDE_MS) {
      lo = i
      break
    }
  }
  for (let i = at + 1; i <= hi; i++) {
    if (gap[i] || t[i] - t[at] > MAX_SIDE_MS) {
      hi = i - 1
      break
    }
  }

  const dir: 1 | -1 = swept(crs, m.i0, m.i1, 1) < 0 ? -1 : 1

  // The turn itself: outwards from the passage while the course keeps turning the same way.
  const turning = (i: number) => spd[i] >= MIN_COURSE_SPEED && angleRate(t, crs, i, lo, hi) * dir >= TURN_MIN_RATE
  let i0 = at
  for (let i = at; i >= lo; i--) {
    if (turning(i)) i0 = i
    else if (t[i0] - t[i] > TURN_MAX_DIP_MS) break
  }
  let i1 = at
  for (let i = at; i <= hi; i++) {
    if (turning(i)) i1 = i
    else if (t[i] - t[i1] > TURN_MAX_DIP_MS) break
  }

  // The passage through the wind, between two points when the course crosses it there.
  const target = m.kind === 'tack' ? windDir : windDir + 180
  let u = at
  let v = at
  let f = 0
  for (const [p, q] of [
    [at - 1, at],
    [at, at + 1],
  ]) {
    if (p < lo || q > hi) continue
    const a = angDiff(target, crs[p])
    const b = angDiff(target, crs[q])
    if (a !== b && a * b <= 0 && Math.abs(a - b) < 90) {
      u = p
      v = q
      f = a / (a - b)
      break
    }
  }
  const t0 = t[u] + f * (t[v] - t[u])
  const lat0 = lat[u] + f * (lat[v] - lat[u])
  const lon0 = lon[u] + f * (lon[v] - lon[u])

  // Metres from the passage, turned so that the wind comes from the top.
  const kx = Math.cos(lat0 * RAD) * RAD * EARTH_RADIUS
  const ky = RAD * EARTH_RADIUS
  const cosW = Math.cos(windDir * RAD)
  const sinW = Math.sin(windDir * RAD)

  const d0 = reach(t, i0, CONTEXT_MS, -1, lo, hi)
  const d1 = reach(t, i1, CONTEXT_MS, 1, lo, hi)
  const out: ManeuverDetail = {
    index: k,
    maneuver: m,
    dir,
    t: [],
    x: [],
    y: [],
    speed: [],
    rate: [],
    yaw: tr.hdg ? [] : null,
    heel: tr.roll ? [] : null,
    turnStart: (t[i0] - t0) / 1000,
    turnEnd: (t[i1] - t0) / 1000,
    rates: { bearAway: null, luff: null },
    yawRates: null,
    heelIn: null,
    heelAtPassage: null,
    radius: null,
  }

  const heelAt = (i: number) => {
    const to = reach(t, i, HEEL_HALF_MS, 1, lo, hi)
    let s = 0
    let c = 0
    for (let j = reach(t, i, HEEL_HALF_MS, -1, lo, hi); j <= to; j++) {
      if (Number.isFinite(tr.roll![j])) {
        s += tr.roll![j]
        c++
      }
    }
    return c ? (s / c) * dir : NaN
  }
  for (let i = d0; i <= d1; i++) {
    const dx = (lon[i] - lon0) * kx
    const dy = (lat[i] - lat0) * ky
    out.t.push((t[i] - t0) / 1000)
    out.x.push(dx * cosW - dy * sinW)
    out.y.push(dx * sinW + dy * cosW)
    out.speed.push(spd[i])
    out.rate.push(trackRate(tr, i, lo, hi) * dir)
    out.yaw?.push(angleRate(t, tr.hdg!, i, lo, hi) * dir)
    out.heel?.push(heelAt(i))
  }

  // Before the passage a jibe bears away and a tack luffs up; after it, the other way round. The
  // point at the passage counts on one side only: at 1 Hz it would often be the peak of both.
  const lastBefore = v === at && u < at ? at - 1 : at
  const sides = (angle: ArrayLike<number>, rate: (i: number) => number): TurnRates => {
    const before = phaseRate(t, angle, rate, i0, at, i0, lastBefore, dir)
    const after = phaseRate(t, angle, rate, at, i1, lastBefore + 1, i1, dir)
    return m.kind === 'jibe' ? { bearAway: before, luff: after } : { bearAway: after, luff: before }
  }
  out.rates = sides(crs, (i) => trackRate(tr, i, lo, hi) * dir)
  if (tr.hdg) out.yawRates = sides(tr.hdg, (i) => angleRate(t, tr.hdg!, i, lo, hi) * dir)

  if (tr.roll && i1 > i0) {
    let most = -Infinity
    for (let i = i0; i <= i1; i++) {
      const h = heelAt(i)
      if (h > most) most = h
    }
    out.heelIn = Number.isFinite(most) ? most : null
    const h = heelAt(at)
    out.heelAtPassage = Number.isFinite(h) ? h : null
  }

  const turned = swept(crs, i0, i1, dir)
  if (turned >= MIN_RADIUS_ANGLE) out.radius = (dist[i1] - dist[i0]) / (turned * RAD)
  return out
}

export const ratesOf = (d: ManeuverDetail, source: RateSource): TurnRates => (source === 'compass' && d.yawRates) || d.rates

export const rateSeriesOf = (d: ManeuverDetail, source: RateSource): number[] => (source === 'compass' && d.yaw) || d.rate

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

export interface RateAverages {
  /** Mean of the peaks (°/s). */
  bearAway: number | null
  luff: number | null
  /** Mean of the most heel into each turn (deg). */
  heelIn: number | null
}

/** Averages over some manoeuvres, to compare one side with the other. */
export function rateAverages(ds: ManeuverDetail[], source: RateSource): RateAverages {
  const of = (pick: (r: TurnRates) => PhaseRate | null) => meanOf(ds.flatMap((d) => pick(ratesOf(d, source))?.peak ?? []))
  return { bearAway: of((r) => r.bearAway), luff: of((r) => r.luff), heelIn: meanOf(ds.flatMap((d) => d.heelIn ?? [])) }
}

/** The one that kept the most speed while staying on the foil: the reference to read the others against. */
export function bestManeuver(ds: ManeuverDetail[]): ManeuverDetail | null {
  let best: ManeuverDetail | null = null
  for (const d of ds) if (d.maneuver.foiled && (!best || d.maneuver.minSpeed > best.maneuver.minSpeed)) best = d
  return best
}
