import { describe, expect, it } from 'vitest'
import { analyzeTrack } from '../src/lib/analysis/analyze'
import { sessionPerf, sessionScores } from '../src/lib/analysis/scores'
import type { SimLeg } from '../src/lib/sim'
import type { Leg, Maneuver, SessionPerf } from '../src/lib/types'
import { MS_TO_KN } from '../src/lib/units'
import { simTrack } from './helpers'

const kn = (v: number) => v / MS_TO_KN

/** The session the scale was set on: 22 October 2026, as analysed. */
const reference: SessionPerf = {
  up: { vmg: kn(12.747), sog: kn(17.864), twa: 44.27 },
  down: { vmg: kn(20.804), sog: kn(25.184), twa: 145.78 },
  tack: { n: 30, minSog: kn(10.202) },
  jibe: { n: 29, minSog: kn(14.594) },
}

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
  it('gives the known scores on the session the scale was set on', () => {
    expect(sessionScores(reference)).toEqual({ overall: 86, up: 89, down: 83, tack: 89, jibe: 85 })
  })

  it('rewards VMG the most, and speed and angle less', () => {
    const base = sessionScores(reference)!
    const up = reference.up!
    const betterVmg = sessionScores({ ...reference, up: { ...up, vmg: up.vmg * 1.1 } })!
    const betterSpeed = sessionScores({ ...reference, up: { ...up, sog: up.sog * 1.1 } })!
    const higher = sessionScores({ ...reference, up: { ...up, twa: up.twa * 0.9 } })!
    expect(betterVmg.up! - base.up!).toBeGreaterThan(betterSpeed.up! - base.up!)
    expect(betterSpeed.up!).toBeGreaterThan(base.up!)
    expect(higher.up!).toBeGreaterThan(base.up!)
  })

  it('measures the downwind angle from dead downwind', () => {
    const base = sessionScores(reference)!
    const deeper = sessionScores({ ...reference, down: { ...reference.down!, twa: 155 } })!
    const shallower = sessionScores({ ...reference, down: { ...reference.down!, twa: 130 } })!
    expect(deeper.down!).toBeGreaterThan(base.down!)
    expect(shallower.down!).toBeLessThan(base.down!)
  })

  it('stays between 1 and 100', () => {
    const fast: SessionPerf = {
      up: { vmg: kn(30), sog: kn(40), twa: 20 },
      down: { vmg: kn(50), sog: kn(60), twa: 180 },
      tack: { n: 5, minSog: kn(30) },
      jibe: { n: 5, minSog: kn(30) },
    }
    expect(sessionScores(fast)).toEqual({ overall: 100, up: 100, down: 100, tack: 100, jibe: 100 })
    const stopped: SessionPerf = { up: null, down: null, tack: { n: 3, minSog: 0 }, jibe: null }
    expect(sessionScores(stopped)).toEqual({ overall: 1, up: null, down: null, tack: 1, jibe: null })
  })

  it('leaves out of the overall what has no score, with the weights in proportion', () => {
    const s = sessionScores({ ...reference, tack: null, jibe: null })!
    expect(s.tack).toBeNull()
    expect(s.jibe).toBeNull()
    expect(s.overall).toBe(86)
    const legsOnly = sessionScores({ ...reference, down: null, jibe: null })!
    expect(legsOnly.overall).toBe(89)
  })

  it('has no scores without a wind or with nothing to score', () => {
    expect(sessionScores(null)).toBeNull()
    expect(sessionScores(undefined)).toBeNull()
    expect(sessionScores({ up: null, down: null, tack: null, jibe: null })).toBeNull()
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
    expect(sessionScores(perf)!.overall).toBeGreaterThan(1)

    const adrift = simTrack({ windFrom: 0, legs: [{ twa: 90, seconds: 20, kn: 2 }], noiseM: 0 })
    const unknown = analyzeTrack(adrift, null, { foilOnKn: 7 }).summary
    expect(unknown.windDir).toBeNull()
    expect(unknown.perf).toBeNull()
  })
})
