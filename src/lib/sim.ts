import { angDiff, destination, norm180, norm360 } from './geo'
import { MS_TO_KN } from './units'

// Simulates a wing foil session from a list of legs at given true wind angles. Used for the
// demo sessions and as ground truth in the analysis tests.

export interface SimLeg {
  /** Signed true wind angle (deg): positive = starboard tack. */
  twa: number
  seconds: number
  kn: number
}

export interface SimTurn {
  seconds?: number
  /** Lowest speed through the turn (kn): below the foil threshold it is a touchdown. */
  minKn?: number
}

export interface SimOptions {
  start: [number, number]
  t0: number
  hz?: number
  windFrom: number
  legs: SimLeg[]
  /** Overrides for the turn that follows leg k. */
  turns?: Record<number, SimTurn>
  noiseM?: number
  seed?: number
  /** Slow drift before the first leg and after the last (s). */
  slowSeconds?: number
  /** Adds a speed wobble of about ±1 kn so the session looks real. */
  wobble?: boolean
  heartRate?: boolean
}

export interface SimPoint {
  t: number
  lat: number
  lon: number
  speed: number
  hr?: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function simulate(o: SimOptions): SimPoint[] {
  const hz = o.hz ?? 1
  const dt = 1 / hz
  const rand = mulberry32(o.seed ?? 1)
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
  const courseOf = (twa: number) => norm360(o.windFrom - twa)
  const pts: SimPoint[] = []
  let [lat, lon] = o.start
  let t = o.t0
  let phase = rand() * 10

  const step = (course: number, kn: number) => {
    const ms = kn / MS_TO_KN
    const noise = o.noiseM ?? 0
    const [nl, no] = noise > 0 ? destination(lat, lon, rand() * 360, Math.abs(gauss()) * noise) : [lat, lon]
    pts.push({
      t,
      lat: nl,
      lon: no,
      speed: ms,
      hr: o.heartRate ? 105 + 2.2 * kn + 4 * gauss() : undefined,
    })
    ;[lat, lon] = destination(lat, lon, course, ms * dt)
    t += dt * 1000
  }

  const slow = o.slowSeconds ?? 20
  const first = o.legs[0]
  for (let s = 0; s < slow * hz; s++) step(courseOf(first.twa), 2)
  for (let s = 0; s < 4 * hz; s++) step(courseOf(first.twa), 2 + ((first.kn - 2) * s) / (4 * hz))

  o.legs.forEach((leg, k) => {
    const course = courseOf(leg.twa)
    for (let s = 0; s < leg.seconds * hz; s++) {
      phase += dt
      const kn = leg.kn + (o.wobble ? Math.sin(phase / 3) * 0.8 + gauss() * 0.15 : 0)
      step(course, kn)
    }
    const next = o.legs[k + 1]
    if (!next) return
    const turn = o.turns?.[k] ?? {}
    const seconds = turn.seconds ?? 6
    const minKn = turn.minKn ?? Math.min(leg.kn, next.kn) * 0.75
    const from = course
    const to = courseOf(next.twa)
    const delta = turnDelta(o.windFrom, leg.twa, next.twa, from, to)
    const steps = Math.max(1, Math.round(seconds * hz))
    for (let s = 0; s < steps; s++) {
      const f = s / steps
      const ease = f * f * (3 - 2 * f)
      const base = leg.kn + (next.kn - leg.kn) * f
      const kn = base - (base - minKn) * Math.sin(Math.PI * f)
      step(norm360(from + delta * ease), kn)
    }
  })

  const last = o.legs[o.legs.length - 1]
  for (let s = 0; s < slow * hz; s++) step(courseOf(last.twa), 2)
  return pts
}

/** Rotation from one leg to the next: through the wind for a tack, through downwind for a jibe. */
function turnDelta(windFrom: number, twaA: number, twaB: number, from: number, to: number): number {
  const short = angDiff(from, to)
  if (Math.sign(twaA) === Math.sign(twaB)) return short
  const pass = (Math.abs(twaA) + Math.abs(twaB)) / 2 < 90 ? windFrom : windFrom + 180
  const long = short > 0 ? short - 360 : short + 360
  const contains = (d: number) => {
    const u = norm360((pass - from) * Math.sign(d))
    return u <= Math.abs(d)
  }
  return contains(short) ? short : long
}

/** Course for a given TWA, exported for tests. */
export const courseForTwa = (windFrom: number, twa: number) => norm360(windFrom - norm180(twa))
