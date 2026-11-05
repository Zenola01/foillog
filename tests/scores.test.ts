import { describe, expect, it } from 'vitest'
import { analyzeTrack } from '../src/lib/analysis/analyze'
import { lacksPerf, sessionPerf, sessionScores } from '../src/lib/analysis/scores'
import type { SimLeg } from '../src/lib/sim'
import type { Leg, Maneuver, SessionPerf, SessionSummary } from '../src/lib/types'
import { MS_TO_KN } from '../src/lib/units'
import { simTrack } from './helpers'

const kn = (v: number) => v / MS_TO_KN

const MEDIUM = kn(15)
const STRONG = kn(22)
const LIGHT = kn(9)

/** What a session holds, written in knots. */
function perfOf(up: [number, number, number] | null, down: [number, number, number] | null, tack: number | null, jibe: number | null): SessionPerf {
  const course = (p: [number, number, number] | null) => p && { vmg: kn(p[0]), sog: kn(p[1]), twa: p[2], seconds: 600 }
  return { v: 2, up: course(up), down: course(down), tack: tack == null ? null : { n: 10, minSog: kn(tack) }, jibe: jibe == null ? null : { n: 10, minSog: kn(jibe) } }
}

/** The sessions the scale was fitted on, as analysed, with their known scores. */
const known = [
  {
    name: '22/10/2026, medium wind',
    wind: MEDIUM,
    perf: perfOf([10.92, 17.66, 51.6], [18.66, 24.41, 140.0], 10.202, 14.594),
    scores: { up: 89, down: 83, tack: 89, jibe: 85 },
  },
  {
    name: '29/10/2026, medium wind',
    wind: MEDIUM,
    perf: perfOf([11.63, 17.68, 48.7], [17.44, 23.21, 138.7], 9.149, 14.486),
    scores: { up: 90, down: 80, tack: 86, jibe: 80 },
  },
  {
    name: '18/10/2026, strong wind',
    wind: STRONG,
    perf: perfOf([11.46, 17.27, 47.7], [18.55, 24.84, 138.9], 9.277, 12.462),
    scores: { up: 85, down: 79, tack: 80, jibe: 76 },
  },
]
const reference = known[0].perf

function leg(twa: number, knots: number, duration = 30): Leg {
  const speed = kn(knots)
  return {
    i0: 0,
    i1: 1,
    course: 0,
    duration,
    distance: speed * duration,
    avgSpeed: speed,
    maxSpeed: speed,
    foilShare: 1,
    tack: 'S',
    twa,
    vmg: speed * Math.cos((twa * Math.PI) / 180),
  }
}

const turn = (kind: Maneuver['kind'], knots: number) => ({ kind, minSpeed: kn(knots) }) as Maneuver

describe('session scores', () => {
  it.each(known)('stays close to the known scores of $name', ({ perf, wind, scores }) => {
    const s = sessionScores(perf, wind)!
    for (const k of ['up', 'down', 'tack', 'jibe'] as const) {
      expect(Math.abs(s[k]! - scores[k])).toBeLessThanOrEqual(3)
    }
  })

  it('gives the known overall', () => {
    expect(sessionScores(reference, MEDIUM)!.overall).toBe(86)
  })

  it('asks for more the stronger the wind', () => {
    const light = sessionScores(reference, LIGHT)!
    const medium = sessionScores(reference, MEDIUM)!
    const strong = sessionScores(reference, STRONG)!
    for (const k of ['overall', 'up', 'down', 'tack', 'jibe'] as const) {
      expect(light[k]!).toBeGreaterThan(medium[k]!)
      expect(medium[k]!).toBeGreaterThan(strong[k]!)
    }
  })

  it('counts a session without the wind typed in as a medium wind', () => {
    expect(sessionScores(reference, null)).toEqual(sessionScores(reference, MEDIUM))
    expect(sessionScores(reference, undefined)).toEqual(sessionScores(reference, MEDIUM))
  })

  it('rewards VMG the most, and speed and angle less', () => {
    const base = sessionScores(reference, MEDIUM)!
    const up = reference.up!
    const betterVmg = sessionScores({ ...reference, up: { ...up, vmg: up.vmg * 1.1 } }, MEDIUM)!
    const betterSpeed = sessionScores({ ...reference, up: { ...up, sog: up.sog * 1.1 } }, MEDIUM)!
    const higher = sessionScores({ ...reference, up: { ...up, twa: up.twa * 0.9 } }, MEDIUM)!
    expect(betterVmg.up! - base.up!).toBeGreaterThan(betterSpeed.up! - base.up!)
    expect(betterSpeed.up!).toBeGreaterThan(base.up!)
    expect(higher.up!).toBeGreaterThan(base.up!)
  })

  it('measures the downwind angle from dead downwind', () => {
    const base = sessionScores(reference, MEDIUM)!
    const deeper = sessionScores({ ...reference, down: { ...reference.down!, twa: 155 } }, MEDIUM)!
    const shallower = sessionScores({ ...reference, down: { ...reference.down!, twa: 131 } }, MEDIUM)!
    expect(deeper.down!).toBeGreaterThan(base.down!)
    expect(shallower.down!).toBeLessThan(base.down!)
  })

  it('stays low for a rider who falls in every turn', () => {
    const falls = sessionScores({ ...reference, tack: { n: 5, minSog: kn(0.9) } }, MEDIUM)!
    expect(falls.tack!).toBeLessThan(30)
  })

  it('stays between 1 and 100', () => {
    const fast = perfOf([30, 40, 20], [50, 60, 180], 30, 30)
    expect(sessionScores(fast, STRONG)).toEqual({ overall: 100, up: 100, down: 100, tack: 100, jibe: 100 })
    const stopped = perfOf(null, null, 0, 0)
    expect(sessionScores(stopped, MEDIUM)).toEqual({ overall: 1, up: null, down: null, tack: 1, jibe: 1 })
  })

  it('leaves out of the overall what has no score, with the weights in proportion', () => {
    const all = sessionScores(reference, MEDIUM)!
    const s = sessionScores({ ...reference, tack: null, jibe: null }, MEDIUM)!
    expect(s.tack).toBeNull()
    expect(s.jibe).toBeNull()
    expect(Math.abs(s.overall! - (all.up! + all.down!) / 2)).toBeLessThanOrEqual(1)
  })

  it('has no overall from a single part', () => {
    const jibesOnly = sessionScores(perfOf(null, null, null, 14), MEDIUM)!
    expect(jibesOnly.overall).toBeNull()
    expect(jibesOnly.jibe).toBeGreaterThan(1)
  })

  it('needs two minutes on a course and three manoeuvres of a kind', () => {
    const short: SessionPerf = {
      v: 2,
      up: { ...reference.up!, seconds: 119 },
      down: { ...reference.down!, seconds: 120 },
      tack: { n: 2, minSog: kn(10) },
      jibe: { n: 3, minSog: kn(14) },
    }
    const s = sessionScores(short, MEDIUM)!
    expect(s.up).toBeNull()
    expect(s.down).not.toBeNull()
    expect(s.tack).toBeNull()
    expect(s.jibe).not.toBeNull()
  })

  it('has no scores without a wind direction, with nothing to score or from an older form', () => {
    expect(sessionScores(null, MEDIUM)).toBeNull()
    expect(sessionScores(undefined, MEDIUM)).toBeNull()
    expect(sessionScores(perfOf(null, null, null, null), MEDIUM)).toBeNull()
    expect(sessionScores({ ...reference, v: 1 }, MEDIUM)).toBeNull()
  })

  it('asks for a new analysis of what is missing or in an older form, with a wind direction only', () => {
    const lacks = (windDir: number | null, perf?: SessionPerf | null) => lacksPerf({ windDir, perf } as SessionSummary)
    expect(lacks(90)).toBe(true)
    expect(lacks(90, { ...reference, v: 1 })).toBe(true)
    expect(lacks(90, reference)).toBe(false)
    expect(lacks(null)).toBe(false)
    expect(lacks(null, null)).toBe(false)
  })
})

describe('what a session is scored on', () => {
  it('takes the average of all the legs, not the best ones', () => {
    const legs = [leg(40, 20), leg(50, 16), leg(50, 16), leg(50, 16), leg(150, 25), leg(135, 17), leg(135, 17), leg(135, 17)]
    const perf = sessionPerf(legs, [])
    expect(perf.up!.twa).toBeCloseTo((40 + 3 * 50) / 4, 1)
    expect(perf.up!.sog * MS_TO_KN).toBeCloseTo((20 + 3 * 16) / 4, 1)
    expect(perf.up!.seconds).toBe(120)
    expect(perf.down!.twa).toBeCloseTo((150 + 3 * 135) / 4, 1)
    expect(perf.down!.seconds).toBe(120)
  })

  it('leaves reaches out, also close to upwind or downwind', () => {
    // The session of 7/9/2026: all reaches, the closest at 65°, with no upwind to speak of.
    const reaches = [leg(65, 20, 141), leg(68, 19, 285), leg(100, 22, 117), leg(115, 22, 180), leg(125, 24, 60)]
    const perf = sessionPerf(reaches, [])
    expect(perf.up).toBeNull()
    expect(perf.down).toBeNull()
    expect(sessionScores(perf, MEDIUM)).toBeNull()
  })

  it('averages the lowest speed over every attempt, falls included', () => {
    const perf = sessionPerf([], [turn('tack', 12), turn('tack', 12), turn('tack', 0), turn('jibe', 15), turn('jibe', 15)])
    expect(perf.tack!.n).toBe(3)
    expect(perf.tack!.minSog * MS_TO_KN).toBeCloseTo(8, 1)
    expect(perf.jibe!.n).toBe(2)
  })

  it('comes out of the analysis once the wind is known', () => {
    const legs: SimLeg[] = [
      ...Array.from({ length: 4 }, (_, k) => ({ twa: k % 2 ? -45 : 45, seconds: 40, kn: 18 })),
      ...Array.from({ length: 4 }, (_, k) => ({ twa: k % 2 ? 140 : -140, seconds: 40, kn: 24 })),
    ]
    const { perf } = analyzeTrack(simTrack({ windFrom: 270, legs, noiseM: 0 }), null, { foilOnKn: 7, windOverride: 270 }).summary
    expect(perf!.v).toBe(2)
    expect(perf!.up!.twa).toBeCloseTo(45, 0)
    expect(perf!.up!.sog * MS_TO_KN).toBeCloseTo(18, 0)
    expect(perf!.up!.vmg * MS_TO_KN).toBeCloseTo(18 * Math.SQRT1_2, 0)
    expect(perf!.down!.twa).toBeCloseTo(140, 0)
    expect(perf!.tack!.n).toBe(3)
    expect(perf!.jibe!.n).toBe(3)
    expect(sessionScores(perf, MEDIUM)!.overall).toBeGreaterThan(1)

    const adrift = simTrack({ windFrom: 0, legs: [{ twa: 90, seconds: 20, kn: 2 }], noiseM: 0 })
    const unknown = analyzeTrack(adrift, null, { foilOnKn: 7 }).summary
    expect(unknown.windDir).toBeNull()
    expect(unknown.perf).toBeNull()
  })
})
