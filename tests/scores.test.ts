import { describe, expect, it } from 'vitest'
import { analyzeTrack } from '../src/lib/analysis/analyze'
import { sessionPerf, sessionScores } from '../src/lib/analysis/scores'
import type { SimLeg } from '../src/lib/sim'
import type { Leg, Maneuver, SessionPerf } from '../src/lib/types'
import { MS_TO_KN } from '../src/lib/units'
import { simTrack } from './helpers'

const kn = (v: number) => v / MS_TO_KN

const MEDIUM = kn(15)
const STRONG = kn(22)
const LIGHT = kn(9)

/** The sessions the scale was fitted on, as analysed, with their known scores. */
const known: { name: string; wind: number; perf: SessionPerf; scores: { up: number; down: number; tack: number; jibe: number } }[] = [
  {
    name: '22/10/2026, medium wind',
    wind: MEDIUM,
    perf: {
      up: { vmg: kn(12.747), sog: kn(17.864), twa: 44.27 },
      down: { vmg: kn(20.804), sog: kn(25.184), twa: 145.78 },
      tack: { n: 30, minSog: kn(10.202) },
      jibe: { n: 29, minSog: kn(14.594) },
    },
    scores: { up: 89, down: 83, tack: 89, jibe: 85 },
  },
  {
    name: '29/10/2026, medium wind',
    wind: MEDIUM,
    perf: {
      up: { vmg: kn(13.435), sog: kn(18.421), twa: 43.05 },
      down: { vmg: kn(19.787), sog: kn(25.158), twa: 141.83 },
      tack: { n: 28, minSog: kn(9.149) },
      jibe: { n: 39, minSog: kn(14.486) },
    },
    scores: { up: 90, down: 80, tack: 86, jibe: 80 },
  },
  {
    name: '18/10/2026, strong wind',
    wind: STRONG,
    perf: {
      up: { vmg: kn(13.444), sog: kn(17.445), twa: 39.09 },
      down: { vmg: kn(20.67), sog: kn(24.751), twa: 147 },
      tack: { n: 22, minSog: kn(9.277) },
      jibe: { n: 29, minSog: kn(12.462) },
    },
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
    const shallower = sessionScores({ ...reference, down: { ...reference.down!, twa: 130 } }, MEDIUM)!
    expect(deeper.down!).toBeGreaterThan(base.down!)
    expect(shallower.down!).toBeLessThan(base.down!)
  })

  it('stays low for a rider who falls in every turn', () => {
    const falls = sessionScores({ ...reference, tack: { n: 5, minSog: kn(0.9) } }, MEDIUM)!
    expect(falls.tack!).toBeLessThan(30)
  })

  it('stays between 1 and 100', () => {
    const fast: SessionPerf = {
      up: { vmg: kn(30), sog: kn(40), twa: 20 },
      down: { vmg: kn(50), sog: kn(60), twa: 180 },
      tack: { n: 5, minSog: kn(30) },
      jibe: { n: 5, minSog: kn(30) },
    }
    expect(sessionScores(fast, STRONG)).toEqual({ overall: 100, up: 100, down: 100, tack: 100, jibe: 100 })
    const stopped: SessionPerf = { up: null, down: null, tack: { n: 3, minSog: 0 }, jibe: null }
    expect(sessionScores(stopped, MEDIUM)).toEqual({ overall: 1, up: null, down: null, tack: 1, jibe: null })
  })

  it('leaves out of the overall what has no score, with the weights in proportion', () => {
    const all = sessionScores(reference, MEDIUM)!
    const s = sessionScores({ ...reference, tack: null, jibe: null }, MEDIUM)!
    expect(s.tack).toBeNull()
    expect(s.jibe).toBeNull()
    expect(Math.abs(s.overall - (all.up! + all.down!) / 2)).toBeLessThanOrEqual(1)
    const one = sessionScores({ up: reference.up, down: null, tack: null, jibe: null }, MEDIUM)!
    expect(one.overall).toBe(one.up)
  })

  it('has no scores without a wind direction or with nothing to score', () => {
    expect(sessionScores(null, MEDIUM)).toBeNull()
    expect(sessionScores(undefined, MEDIUM)).toBeNull()
    expect(sessionScores({ up: null, down: null, tack: null, jibe: null }, MEDIUM)).toBeNull()
  })
})

describe('what a session is scored on', () => {
  it('takes the best fifth of the legs of each course', () => {
    const legs = [leg(45, 20), ...Array.from({ length: 9 }, () => leg(60, 15)), leg(150, 25), ...Array.from({ length: 9 }, () => leg(130, 18))]
    const perf = sessionPerf(legs, [])
    // Two of ten legs each: the best one and one of the others.
    expect(perf.up!.twa).toBeCloseTo((45 + 60) / 2, 1)
    expect(perf.up!.sog * MS_TO_KN).toBeCloseTo((20 + 15) / 2, 1)
    expect(perf.down!.twa).toBeCloseTo((150 + 130) / 2, 1)
  })

  it('needs a minute on a course', () => {
    expect(sessionPerf([leg(45, 20, 50)], []).up).toBeNull()
    expect(sessionPerf([leg(45, 20, 30), leg(45, 20, 30)], []).up).not.toBeNull()
    expect(sessionPerf([leg(90, 20, 300)], [])).toEqual({ up: null, down: null, tack: null, jibe: null })
  })

  it('averages the lowest speed over every attempt, falls included, from three up', () => {
    const perf = sessionPerf([], [turn('tack', 12), turn('tack', 12), turn('tack', 0), turn('jibe', 15), turn('jibe', 15)])
    expect(perf.tack!.n).toBe(3)
    expect(perf.tack!.minSog * MS_TO_KN).toBeCloseTo(8, 1)
    expect(perf.jibe).toBeNull()
  })

  it('comes out of the analysis once the wind is known', () => {
    const legs: SimLeg[] = [
      ...Array.from({ length: 4 }, (_, k) => ({ twa: k % 2 ? -45 : 45, seconds: 40, kn: 18 })),
      ...Array.from({ length: 4 }, (_, k) => ({ twa: k % 2 ? 140 : -140, seconds: 40, kn: 24 })),
    ]
    const { perf } = analyzeTrack(simTrack({ windFrom: 270, legs, noiseM: 0 }), null, { foilOnKn: 7, windOverride: 270 }).summary
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
