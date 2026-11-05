import { bandOfSpeed } from '../polars'
import type { CoursePerf, Leg, Maneuver, SessionPerf, TurnPerf, WindBand } from '../types'
import { MS_TO_KN } from '../units'
import { bestLegs } from './bestLegs'
import type { Course } from './pointsOfSail'

// Scores from 1 to 100 for each part of a session, against what the wind allowed. Upwind and
// downwind look at the best legs (VMG above all, then speed and angle to the wind), tacks and
// jibes at the lowest speed through the turn. Each number is measured as a share of a top value;
// the score is the square root of that share, so that points get dearer the higher they are.

/** The legs that count: the best ones, as in the Bordi tab, since waiting about must not lower a score. */
const BEST_SHARE = 0.2
/** With less sailing on a course, or fewer manoeuvres of a kind, there is nothing to score. */
const MIN_COURSE_SECONDS = 60
const MIN_TURNS = 3

/**
 * The top values in a medium wind, in knots and degrees (the angle off the wind upwind, off dead
 * downwind downwind). Fitted on three real sessions with known scores, in the test file.
 */
const FULL_MARKS = {
  up: { vmg: 16.5, sog: 23.1, angle: 34.3 },
  down: { vmg: 30.5, sog: 36.9, angle: 23.4 },
  tack: 12.8,
  jibe: 20.8,
}

/**
 * How much of those top values each wind asks for. Strong comes from the same sessions; light is
 * an estimate, with no session to fit it on yet.
 */
const WIND_DEMAND: Record<WindBand, number> = { calm: 0.85, light: 0.85, medium: 1, strong: 1.1 }

/** Legs are most of the sailing, so they weigh more than the turns. */
const OVERALL_WEIGHT = { up: 0.3, down: 0.3, tack: 0.2, jibe: 0.2 }

const stored = (v: number) => Math.round(v * 100) / 100

function coursePerf(legs: Leg[], course: Course): CoursePerf | null {
  const sailed = bestLegs(legs, course, 1)
  if (!sailed || sailed.seconds < MIN_COURSE_SECONDS) return null
  const best = bestLegs(legs, course, BEST_SHARE)!
  return { vmg: stored(best.vmg), sog: stored(best.speed), twa: stored(best.angle) }
}

function turnPerf(maneuvers: Maneuver[], kind: Maneuver['kind']): TurnPerf | null {
  const turns = maneuvers.filter((m) => m.kind === kind)
  if (turns.length < MIN_TURNS) return null
  return { n: turns.length, minSog: stored(turns.reduce((sum, m) => sum + m.minSpeed, 0) / turns.length) }
}

export function sessionPerf(legs: Leg[], maneuvers: Maneuver[]): SessionPerf {
  return {
    up: coursePerf(legs, 'up'),
    down: coursePerf(legs, 'down'),
    tack: turnPerf(maneuvers, 'tack'),
    jibe: turnPerf(maneuvers, 'jibe'),
  }
}

export interface SessionScores {
  overall: number
  up: number | null
  down: number | null
  tack: number | null
  jibe: number | null
}

/**
 * `windSpeed`: the mean wind the rider typed in (m/s); without it the session counts as a medium
 * wind. Null when there is nothing to score. The overall counts only the parts that have a score.
 */
export function sessionScores(perf: SessionPerf | null | undefined, windSpeed: number | null | undefined): SessionScores | null {
  if (!perf) return null
  const demand = WIND_DEMAND[bandOfSpeed(windSpeed) ?? 'medium']
  const shareOf = (ratio: number) => Math.min(1, ratio / demand)
  const course = (p: CoursePerf, full: { vmg: number; sog: number; angle: number }, angle: number) =>
    0.6 * shareOf((p.vmg * MS_TO_KN) / full.vmg) + 0.2 * shareOf((p.sog * MS_TO_KN) / full.sog) + 0.2 * shareOf(full.angle / angle)
  const turn = (p: TurnPerf, full: number) => shareOf((p.minSog * MS_TO_KN) / full)
  const parts = {
    up: perf.up && 100 * Math.sqrt(course(perf.up, FULL_MARKS.up, perf.up.twa)),
    down: perf.down && 100 * Math.sqrt(course(perf.down, FULL_MARKS.down, 180 - perf.down.twa)),
    tack: perf.tack && 100 * Math.sqrt(turn(perf.tack, FULL_MARKS.tack)),
    jibe: perf.jibe && 100 * Math.sqrt(turn(perf.jibe, FULL_MARKS.jibe)),
  }
  let total = 0
  let weight = 0
  for (const k of ['up', 'down', 'tack', 'jibe'] as const) {
    const v = parts[k]
    if (v == null) continue
    total += v * OVERALL_WEIGHT[k]
    weight += OVERALL_WEIGHT[k]
  }
  if (!weight) return null
  const shown = (v: number) => Math.max(1, Math.round(v))
  const part = (v: number | null) => (v == null ? null : shown(v))
  return { overall: shown(total / weight), up: part(parts.up), down: part(parts.down), tack: part(parts.tack), jibe: part(parts.jibe) }
}
