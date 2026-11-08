import { angDiff, bearing, EARTH_RADIUS, norm180, RAD } from '../geo'
import type { Maneuver, Track } from '../types'

// What happens inside each manoeuvre: its path seen with the wind from the top, and how fast the
// rider turns. Worked out on demand for the manoeuvres tab.

/** Roughly, on the smoothed course: turning slower than this (°/s) is not part of the turn. */
const TURN_MIN_RATE = 5
/** A slower moment inside a turn, up to this long, does not end it. */
const TURN_MAX_DIP_MS = 1000
/** Then sharply, on the track: the turn runs while the rate is at least this (°/s)… */
const TURN_FLOOR_RATE = 8
/** …and at least this share of its peak. */
const TURN_FLOOR_SHARE = 0.2
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
/** Under this many degrees a turn has no rate or radius to speak of. */
const MIN_TURN_ANGLE = 30
/** The way in and the way out: the stretch of track just before the turn and just after it. */
const WAY_MS = 2000
/** Shorter than this (m), that stretch says nothing about the direction. */
const WAY_MIN_M = 3

/** What a rate curve follows: how the GPS track bends, or how the board itself rotates (compass). */
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
  /** How long it took: each point stands for its own step, which at 1 Hz is a whole second. */
  turnSeconds: number
  /**
   * How fast it turned (°/s): the angle turned over the time taken. Unlike a peak it hardly changes
   * between GPS and compass or with the sampling rate, so it compares across devices.
   */
  turnRate: number | null
  /** Angle from the wind (deg, 0–180) on the way into the turn and on the way out of it. */
  entryAngle: number | null
  exitAngle: number | null
  /** Speed (m/s) on the way in and on the way out. */
  entrySpeed: number | null
  exitSpeed: number | null
  /** VMG (m/s) on the way in and on the way out: towards the wind in a tack, away from it in a jibe. */
  entryVmg: number | null
  exitVmg: number | null
  /** Mean VMG (m/s) from the way in to the way out: the ground the whole manoeuvre made, or lost. */
  meanVmg: number | null
  /** Most heel towards the inside while turning (deg); negative if it never leaned in. */
  heelIn: number | null
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

  // The turn, roughly: outwards from the passage while the smoothed course keeps turning the same way.
  const turning = (i: number) => spd[i] >= MIN_COURSE_SPEED && angleRate(t, crs, i, lo, hi) * dir >= TURN_MIN_RATE
  let rough0 = at
  for (let i = at; i >= lo; i--) {
    if (turning(i)) rough0 = i
    else if (t[rough0] - t[i] > TURN_MAX_DIP_MS) break
  }
  let rough1 = at
  for (let i = at; i <= hi; i++) {
    if (turning(i)) rough1 = i
    else if (t[i] - t[rough1] > TURN_MAX_DIP_MS) break
  }

  // Then sharply, on the track itself: the smoothing stretches a short turn by a second or two, and
  // it would read slower than it was. How long it lasts then agrees between 5 Hz and 1 Hz.
  const rateAt = (i: number) => trackRate(tr, i, lo, hi) * dir
  let peak = 0
  for (let i = rough0; i <= rough1; i++) peak = Math.max(peak, rateAt(i) || 0)
  const floor = Math.max(TURN_FLOOR_RATE, peak * TURN_FLOOR_SHARE)
  let i0 = rough0
  while (i0 < rough1 && !(rateAt(i0) >= floor)) i0++
  let i1 = rough1
  while (i1 > i0 && !(rateAt(i1) >= floor)) i1--
  if (i1 === i0) {
    // Never really turning (a slow change of tack): the rough window is all there is.
    i0 = rough0
    i1 = rough1
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

  const d0 = reach(t, rough0, CONTEXT_MS, -1, lo, hi)
  const d1 = reach(t, rough1, CONTEXT_MS, 1, lo, hi)
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
    turnSeconds: i1 > i0 ? ((t[i1] - t[i0]) / 1000) * (1 + 1 / (i1 - i0)) : 0,
    turnRate: null,
    entryAngle: null,
    exitAngle: null,
    entrySpeed: null,
    exitSpeed: null,
    entryVmg: null,
    exitVmg: null,
    meanVmg: null,
    heelIn: null,
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
    out.rate.push(rateAt(i))
    out.yaw?.push(angleRate(t, tr.hdg!, i, lo, hi) * dir)
    out.heel?.push(heelAt(i))
  }

  if (tr.roll && i1 > i0) {
    let most = -Infinity
    for (let i = i0; i <= i1; i++) {
      const h = heelAt(i)
      if (h > most) most = h
    }
    out.heelIn = Number.isFinite(most) ? most : null
  }

  // Read from the track itself: the smoothed course already leans into the turn before it starts.
  const angleOf = (from: number, to: number) =>
    dist[to] - dist[from] >= WAY_MIN_M ? Math.abs(norm180(windDir - bearing(lat[from], lon[from], lat[to], lon[to]))) : null
  const wayIn = reach(t, i0, WAY_MS, -1, lo, hi)
  const wayOut = reach(t, i1, WAY_MS, 1, lo, hi)
  out.entryAngle = angleOf(wayIn, i0)
  out.exitAngle = angleOf(i1, wayOut)

  // Speed and VMG on the same stretches. VMG counts towards the wind in a tack, away from it in a jibe.
  const towards = m.kind === 'tack' ? 1 : -1
  const speedOf = (from: number, to: number) => {
    if (to <= from) return null
    let s = 0
    for (let i = from; i <= to; i++) s += spd[i]
    return s / (to - from + 1)
  }
  const vmgOf = (speed: number | null, angle: number | null) => (speed == null || angle == null ? null : towards * speed * Math.cos(angle * RAD))
  out.entrySpeed = speedOf(wayIn, i0)
  out.exitSpeed = speedOf(i1, wayOut)
  out.entryVmg = vmgOf(out.entrySpeed, out.entryAngle)
  out.exitVmg = vmgOf(out.exitSpeed, out.exitAngle)
  // Over the whole manoeuvre: how far it got up (or down) the wind, over the time it took.
  const upwind = (i: number) => (lon[i] - lon0) * kx * sinW + (lat[i] - lat0) * ky * cosW
  if (t[wayOut] > t[wayIn]) out.meanVmg = (towards * (upwind(wayOut) - upwind(wayIn))) / ((t[wayOut] - t[wayIn]) / 1000)

  // The angle turned, from the same rate as the turn's ends (the smoothed course lags behind them).
  let sum = 0
  let count = 0
  for (let i = i0; i <= i1; i++) {
    const r = rateAt(i)
    if (Number.isFinite(r)) {
      sum += r
      count++
    }
  }
  const secs = (t[i1] - t[i0]) / 1000
  const rate = count ? sum / count : 0
  if (secs > 0 && rate * secs >= MIN_TURN_ANGLE) {
    out.turnRate = rate
    out.radius = (dist[i1] - dist[i0]) / (rate * secs * RAD)
  }
  return out
}

export const rateSeriesOf = (d: ManeuverDetail, source: RateSource): number[] => (source === 'compass' && d.yaw) || d.rate

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** Averages over some manoeuvres, to compare one side with the other. */
export function detailAverages(ds: ManeuverDetail[]) {
  return {
    turnRate: meanOf(ds.flatMap((d) => d.turnRate ?? [])),
    entryAngle: meanOf(ds.flatMap((d) => d.entryAngle ?? [])),
    exitAngle: meanOf(ds.flatMap((d) => d.exitAngle ?? [])),
    entrySpeed: meanOf(ds.flatMap((d) => d.entrySpeed ?? [])),
    exitSpeed: meanOf(ds.flatMap((d) => d.exitSpeed ?? [])),
    entryVmg: meanOf(ds.flatMap((d) => d.entryVmg ?? [])),
    exitVmg: meanOf(ds.flatMap((d) => d.exitVmg ?? [])),
    meanVmg: meanOf(ds.flatMap((d) => d.meanVmg ?? [])),
    heelIn: meanOf(ds.flatMap((d) => d.heelIn ?? [])),
  }
}

/** The one that kept the most speed while staying on the foil: the reference to read the others against. */
export function bestManeuver(ds: ManeuverDetail[]): ManeuverDetail | null {
  let best: ManeuverDetail | null = null
  for (const d of ds) if (d.maneuver.foiled && (!best || d.maneuver.minSpeed > best.maneuver.minSpeed)) best = d
  return best
}
