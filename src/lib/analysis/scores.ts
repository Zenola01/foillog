import type { CoursePerf, Leg, Maneuver, SessionPerf, TurnPerf } from '../types'
import { MS_TO_KN } from '../units'
import { bestLegs } from './bestLegs'
import type { Course } from './pointsOfSail'

// Scores from 1 to 100 for each part of a session. Upwind and downwind look at the best legs (VMG
// above all, then speed and angle to the wind), tacks and jibes at the lowest speed through the
// turn. Each number is worth its share of what would score 100.

/** The legs that count: the best ones, as in the Bordi tab, since waiting about must not lower a score. */
const BEST_SHARE = 0.2
/** With less sailing on a course, or fewer manoeuvres of a kind, there is nothing to score. */
const MIN_COURSE_SECONDS = 60
const MIN_TURNS = 3

/**
 * What scores 100, in knots and degrees (the angle off the wind upwind, off dead downwind downwind).
 * Set so that a real session with known scores gets them: 22 October 2026, with upwind 89,
 * downwind 83, tacks 89, jibes 85, overall 86. The wind strength plays no part.
 */
const FULL_MARKS = {
  up: { vmg: 14.3, sog: 20.1, angle: 39.4 },
  down: { vmg: 25.1, sog: 30.3, angle: 28.4 },
  tack: 11.5,
  jibe: 17.2,
}

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

const shareOf = (value: number, full: number) => Math.min(1, value / full)

function courseScore(p: CoursePerf, full: { vmg: number; sog: number; angle: number }, angle: number): number {
  return 100 * (0.6 * shareOf(p.vmg * MS_TO_KN, full.vmg) + 0.2 * shareOf(p.sog * MS_TO_KN, full.sog) + 0.2 * shareOf(full.angle, angle))
}

const turnScore = (p: TurnPerf, full: number) => 100 * shareOf(p.minSog * MS_TO_KN, full)

export interface SessionScores {
  overall: number
  up: number | null
  down: number | null
  tack: number | null
  jibe: number | null
}

/** Null when there is nothing to score. The overall counts only the parts that have a score. */
export function sessionScores(perf: SessionPerf | null | undefined): SessionScores | null {
  if (!perf) return null
  const parts = {
    up: perf.up && courseScore(perf.up, FULL_MARKS.up, perf.up.twa),
    down: perf.down && courseScore(perf.down, FULL_MARKS.down, 180 - perf.down.twa),
    tack: perf.tack && turnScore(perf.tack, FULL_MARKS.tack),
    jibe: perf.jibe && turnScore(perf.jibe, FULL_MARKS.jibe),
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
