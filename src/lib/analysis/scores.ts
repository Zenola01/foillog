import { bandOfSpeed } from '../polars'
import type { CoursePerf, Leg, Maneuver, SessionPerf, SessionSummary, TurnPerf, WindBand } from '../types'
import { MS_TO_KN } from '../units'
import { bestLegs } from './bestLegs'

// Scores from 1 to 100 for each part of a session, against what the wind allowed. Upwind and
// downwind look at the average of all the legs really sailed that way (VMG above all, then speed
// and angle to the wind), tacks and jibes at the average lowest speed through the turn. Each number
// is measured as a share of a top value; the score is the square root of that share, so that points
// get dearer the higher they are.

/** Raised when what SessionPerf holds changes: sessions with an older one get analysed again. */
const PERF_VERSION = 2

/** Legs beyond these wind angles (deg) are reaches, and neither upwind nor downwind score counts them. */
const UPWIND_WITHIN = 60
const DOWNWIND_BEYOND = 130

/** With less sailing on a course, or fewer manoeuvres of a kind, there is nothing to score. */
const MIN_COURSE_SECONDS = 120
const MIN_TURNS = 3
/** With fewer parts than this, an overall score would only repeat them. */
const MIN_PARTS_FOR_OVERALL = 2

/**
 * The top values in a medium wind, in knots and degrees (the angle off the wind upwind, off dead
 * downwind downwind). Fitted on three real sessions with known scores, in the test file.
 */
const FULL_MARKS = {
  up: { vmg: 14.1, sog: 22.8, angle: 39.9 },
  down: { vmg: 27.2, sog: 35.6, angle: 27.4 },
  tack: 12.8,
  jibe: 20.9,
}

/**
 * How much of those top values each wind asks for. Strong comes from the same sessions; light is
 * an estimate, with no session to fit it on yet.
 */
const WIND_DEMAND: Record<WindBand, number> = { calm: 0.85, light: 0.85, medium: 1, strong: 1.1 }

/** Legs are most of the sailing, so they weigh more than the turns. */
const OVERALL_WEIGHT = { up: 0.3, down: 0.3, tack: 0.2, jibe: 0.2 }

const stored = (v: number) => Math.round(v * 100) / 100

function coursePerf(legs: Leg[], course: 'up' | 'down'): CoursePerf | null {
  const sailed = legs.filter((l) => l.twa != null && (course === 'up' ? Math.abs(l.twa) < UPWIND_WITHIN : Math.abs(l.twa) > DOWNWIND_BEYOND))
  const mean = bestLegs(sailed, course, 1)
  return mean && { vmg: stored(mean.vmg), sog: stored(mean.speed), twa: stored(mean.angle), seconds: Math.round(mean.seconds) }
}

function turnPerf(maneuvers: Maneuver[], kind: Maneuver['kind']): TurnPerf | null {
  const turns = maneuvers.filter((m) => m.kind === kind)
  return turns.length ? { n: turns.length, minSog: stored(turns.reduce((sum, m) => sum + m.minSpeed, 0) / turns.length) } : null
}

export function sessionPerf(legs: Leg[], maneuvers: Maneuver[]): SessionPerf {
  return {
    v: PERF_VERSION,
    up: coursePerf(legs, 'up'),
    down: coursePerf(legs, 'down'),
    tack: turnPerf(maneuvers, 'tack'),
    jibe: turnPerf(maneuvers, 'jibe'),
  }
}

/** Whether a stored summary still has to get what the scores need, or holds it in an older form. */
export const lacksPerf = (s: SessionSummary) => s.windDir != null && s.perf?.v !== PERF_VERSION

/** A key for what was worked out from a session, which an older form must not answer to. */
export const perfKey = (id: string, ...from: unknown[]) => [id, PERF_VERSION, ...from].join('|')

export interface SessionScores {
  /** Null when too few parts have a score. */
  overall: number | null
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
  if (perf?.v !== PERF_VERSION) return null
  const demand = WIND_DEMAND[bandOfSpeed(windSpeed) ?? 'medium']
  const shareOf = (ratio: number) => Math.min(1, ratio / demand)
  const course = (p: CoursePerf | null, full: { vmg: number; sog: number; angle: number }, angle: (twa: number) => number) =>
    p && p.seconds >= MIN_COURSE_SECONDS
      ? 100 * Math.sqrt(0.6 * shareOf((p.vmg * MS_TO_KN) / full.vmg) + 0.2 * shareOf((p.sog * MS_TO_KN) / full.sog) + 0.2 * shareOf(full.angle / angle(p.twa)))
      : null
  const turn = (p: TurnPerf | null, full: number) => (p && p.n >= MIN_TURNS ? 100 * Math.sqrt(shareOf((p.minSog * MS_TO_KN) / full)) : null)
  const parts = {
    up: course(perf.up, FULL_MARKS.up, (twa) => twa),
    down: course(perf.down, FULL_MARKS.down, (twa) => 180 - twa),
    tack: turn(perf.tack, FULL_MARKS.tack),
    jibe: turn(perf.jibe, FULL_MARKS.jibe),
  }
  let total = 0
  let weight = 0
  let count = 0
  for (const k of ['up', 'down', 'tack', 'jibe'] as const) {
    const v = parts[k]
    if (v == null) continue
    total += v * OVERALL_WEIGHT[k]
    weight += OVERALL_WEIGHT[k]
    count++
  }
  if (!count) return null
  const shown = (v: number | null) => (v == null ? null : Math.max(1, Math.round(v)))
  return {
    overall: count >= MIN_PARTS_FOR_OVERALL ? shown(total / weight) : null,
    up: shown(parts.up),
    down: shown(parts.down),
    tack: shown(parts.tack),
    jibe: shown(parts.jibe),
  }
}
