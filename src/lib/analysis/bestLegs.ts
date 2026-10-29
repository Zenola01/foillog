import { norm180, RAD } from '../geo'
import type { Leg, Tack } from '../types'
import { tackOf } from './maneuvers'
import { courseOf, type Course } from './pointsOfSail'

// "Top 20% of the upwind legs": the legs sailed upwind (or downwind), ranked by the VMG each one
// made good, and the averages of the best of them: the angle and speed to aim for. Reaching legs,
// where VMG means little, are ranked by speed.

/** Shorter legs, or legs mostly off the foil, are not counted as a leg sailed. */
export const MIN_LEG_SECONDS = 10
export const MIN_LEG_FOIL = 0.5

/** Time-weighted averages of a set of legs. VMG is positive both ways (made good towards or away from the wind). */
export interface LegAverages {
  legs: number
  seconds: number
  distance: number
  speed: number
  vmg: number
  /** |TWA| (deg). */
  angle: number
}

export interface BestLegs extends LegAverages {
  /** The chosen legs, best first. */
  chosen: Leg[]
  /** Legs of this course that qualified. */
  of: number
  byTack: Record<Tack, LegAverages | null>
}

/** VMG made good on this course: towards the wind upwind, away from it downwind (either way on a reach). */
const made = (l: Leg, course: Course) => (course === 'up' ? l.vmg! : course === 'down' ? -l.vmg! : Math.abs(l.vmg!))
/** What ranks a leg: VMG, or speed on a reach. */
const score = (l: Leg, course: Course) => (course === 'reach' ? l.avgSpeed : made(l, course))

function averages(legs: Leg[], course: Course): LegAverages | null {
  if (!legs.length) return null
  let seconds = 0
  let distance = 0
  let vmg = 0
  let angle = 0
  for (const l of legs) {
    seconds += l.duration
    distance += l.distance
    vmg += made(l, course) * l.duration
    angle += Math.abs(l.twa!) * l.duration
  }
  return { legs: legs.length, seconds, distance, speed: distance / seconds, vmg: vmg / seconds, angle: angle / seconds }
}

/**
 * The best `share` (0..1] of the legs sailed on `course` (by VMG, or speed on a reach) with their
 * averages; at least one leg when any qualifies. Null without the wind or without such legs.
 */
export function bestLegs(legs: Leg[], course: Course, share: number): BestLegs | null {
  const pool = legs.filter(
    (l) => l.twa != null && l.vmg != null && courseOf(l.twa) === course && l.duration >= MIN_LEG_SECONDS && l.foilShare >= MIN_LEG_FOIL,
  )
  if (!pool.length) return null
  pool.sort((a, b) => score(b, course) - score(a, course))
  const chosen = pool.slice(0, Math.max(1, Math.ceil(pool.length * share - 1e-9)))
  return {
    ...averages(chosen, course)!,
    chosen,
    of: pool.length,
    byTack: {
      S: averages(chosen.filter((l) => l.tack === 'S'), course),
      P: averages(chosen.filter((l) => l.tack === 'P'), course),
    },
  }
}

/** The legs measured against another wind direction: riders compared on one shared wind. */
export function legsInWind(legs: Leg[], windDir: number): Leg[] {
  return legs.map((l) => {
    const twa = norm180(windDir - l.course)
    return { ...l, twa, vmg: l.avgSpeed * Math.cos(twa * RAD), tack: tackOf(windDir, l.course) }
  })
}
