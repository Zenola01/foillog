import { describe, expect, it } from 'vitest'
import { analyzeTrack } from '../src/lib/analysis/analyze'
import { bestManeuver, detailAverages, maneuverDetails, rateSeriesOf } from '../src/lib/analysis/maneuverDetail'
import type { SimLeg } from '../src/lib/sim'
import type { Track } from '../src/lib/types'
import { simTrack } from './helpers'

const WIND = 270

/** One manoeuvre between two long legs, at 5 Hz: a turn of known size and length. */
function oneTurn(twaA: number, twaB: number, seconds = 6, extra: (tr: Track) => Track = (x) => x) {
  const legs: SimLeg[] = [
    { twa: twaA, seconds: 40, kn: 20 },
    { twa: twaB, seconds: 40, kn: 20 },
  ]
  const tr = extra(simTrack({ windFrom: WIND, hz: 5, legs, turns: { 0: { seconds, minKn: 15 } } }))
  const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: WIND })
  expect(a.maneuvers).toHaveLength(1)
  return maneuverDetails(tr, a.maneuvers, WIND)[0]!
}

const at = (d: { t: number[] }, s: number) => d.t.reduce((best, x, i) => (Math.abs(x - s) < Math.abs(d.t[best] - s) ? i : best), 0)

describe('path of a manoeuvre', () => {
  it('draws a jibe with the wind from the top: going down, the turn on the side it starts from', () => {
    const d = oneTurn(140, -140)
    expect(d.maneuver.kind).toBe('jibe')
    const first = 0
    const last = d.t.length - 1
    // From starboard tack: it comes from the upper right, turns on the left and leaves to the lower right.
    expect(d.y[first]).toBeGreaterThan(20)
    expect(d.x[first]).toBeGreaterThan(10)
    expect(d.y[last]).toBeLessThan(-20)
    expect(d.x[last]).toBeGreaterThan(10)
    // The passage through dead downwind is the origin.
    const p = at(d, 0)
    expect(Math.abs(d.x[p])).toBeLessThan(3)
    expect(Math.abs(d.y[p])).toBeLessThan(3)
  })

  it('mirrors from the other tack, and a tack goes up', () => {
    const j = oneTurn(-140, 140)
    expect(j.x[0]).toBeLessThan(-10)
    expect(j.x[j.x.length - 1]).toBeLessThan(-10)
    const t = oneTurn(50, -50)
    expect(t.maneuver.kind).toBe('tack')
    expect(t.y[0]).toBeLessThan(-20)
    expect(t.y[t.y.length - 1]).toBeGreaterThan(20)
    expect(t.x[0]).toBeGreaterThan(10)
  })

  it('keeps the stretch around the turn and stops halfway to the next manoeuvre', () => {
    const d = oneTurn(140, -140)
    expect(d.t[0]).toBeLessThan(d.turnStart - 2)
    expect(d.t[d.t.length - 1]).toBeGreaterThan(d.turnEnd + 2)
    const legs: SimLeg[] = [
      { twa: 75, seconds: 60, kn: 18 },
      { twa: -110, seconds: 6, kn: 18 },
      { twa: 75, seconds: 60, kn: 18 },
    ]
    const tr = simTrack({ windFrom: 83, hz: 5, legs, turns: { 0: { seconds: 7, minKn: 14 }, 1: { seconds: 7, minKn: 14 } } })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: 83 })
    const [p, q] = maneuverDetails(tr, a.maneuvers, 83)
    const end = tr.t[a.maneuvers[0].at] + p!.t[p!.t.length - 1] * 1000
    const start = tr.t[a.maneuvers[1].at] + q!.t[0] * 1000
    expect(end).toBeLessThanOrEqual(start + 1000)
  })

  it('leaves out the falls', () => {
    const legs: SimLeg[] = [
      { twa: 140, seconds: 60, kn: 20 },
      { twa: -140, seconds: 60, kn: 20 },
    ]
    const tr = simTrack({ windFrom: WIND, legs, noiseM: 1, seed: 23, turns: { 0: { minKn: 0, seconds: 70 } } })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: WIND })
    expect(a.maneuvers[0].fell).toBe(true)
    expect(maneuverDetails(tr, a.maneuvers, WIND)).toEqual([null])
  })
})

describe('turn rate', () => {
  it('gives one figure for the whole turn: the angle turned over the time taken', () => {
    // 80° in 6 s on an S curve: 13°/s over the whole of it, a little more without its slow ends.
    const d = oneTurn(140, -140)
    expect(d.dir).toBe(-1)
    expect(d.turnEnd - d.turnStart).toBeGreaterThan(3.5)
    expect(d.turnEnd - d.turnStart).toBeLessThan(7.5)
    expect(d.turnRate).toBeGreaterThan(12)
    expect(d.turnRate).toBeLessThan(19)
    // The same turn in half the time is about twice as fast.
    const quick = oneTurn(140, -140, 3)
    expect(quick.turnRate! / d.turnRate!).toBeGreaterThan(1.6)
    expect(quick.turnRate! / d.turnRate!).toBeLessThan(2.4)
  })

  it('reads about the same at one point per second as at five', () => {
    for (const [twaA, twaB, seconds] of [
      [140, -140, 3],
      [140, -140, 6],
      [50, -50, 3],
      [50, -50, 5],
    ]) {
      const legs: SimLeg[] = [
        { twa: twaA, seconds: 40, kn: 20 },
        { twa: twaB, seconds: 40, kn: 20 },
      ]
      const rate = (hz: number) => {
        const tr = simTrack({ windFrom: WIND, hz, legs, turns: { 0: { seconds, minKn: 15 } } })
        return maneuverDetails(tr, analyzeTrack(tr, null, { foilOnKn: 7, windOverride: WIND }).maneuvers, WIND)[0]!.turnRate!
      }
      expect(rate(1) / rate(5)).toBeGreaterThan(0.8)
      expect(rate(1) / rate(5)).toBeLessThan(1.25)
    }
  })

  it('does the same for a tack, whatever the share before and after the passage', () => {
    const d = oneTurn(40, -120)
    expect(d.maneuver.kind).toBe('tack')
    // 160° in 6 s.
    expect(d.turnRate).toBeGreaterThan(25)
    expect(d.turnRate).toBeLessThan(38)
  })

  it('follows the turn second by second in the rate curve', () => {
    // At the passage an S curve of 80° in 6 s turns at 20°/s.
    const d = oneTurn(140, -140)
    const p = at(d, 0)
    expect(d.rate[p]).toBeGreaterThan(15)
    expect(d.rate[p]).toBeLessThan(23)
    // Well before the turn the track is straight.
    expect(Math.abs(d.rate[0])).toBeLessThan(2)
  })

  it('gives the radius of the turn', () => {
    // 80° at about 16 kn (8 m/s) in about 5 s: 40 m along an arc of 1.4 rad.
    const d = oneTurn(140, -140)
    expect(d.radius).toBeGreaterThan(20)
    expect(d.radius).toBeLessThan(40)
  })

  it('draws the rate curve from the compass when the device has one', () => {
    const d = oneTurn(140, -140, 6, (tr) => ({ ...tr, hdg: Float32Array.from(tr.crs) }))
    expect(d.yaw).not.toBeNull()
    expect(rateSeriesOf(d, 'compass')).toBe(d.yaw)
    expect(rateSeriesOf(d, 'track')).toBe(d.rate)
    // Without a compass both read the track.
    const g = oneTurn(140, -140)
    expect(g.yaw).toBeNull()
    expect(rateSeriesOf(g, 'compass')).toBe(g.rate)
  })
})

describe('heel in a manoeuvre', () => {
  it('counts the heel towards the inside of the turn as positive', () => {
    // Anticlockwise turn: port side down (negative roll) leans in.
    const inward = oneTurn(140, -140, 6, (tr) => ({ ...tr, roll: Float32Array.from(tr.t, () => -15) }))
    expect(inward.dir).toBe(-1)
    expect(inward.heelIn).toBeCloseTo(15, 1)
    expect(inward.heelAtPassage).toBeCloseTo(15, 1)
    expect(inward.heel![0]).toBeCloseTo(15, 1)
    const outward = oneTurn(140, -140, 6, (tr) => ({ ...tr, roll: Float32Array.from(tr.t, () => 15) }))
    expect(outward.heelIn).toBeCloseTo(-15, 1)
  })

  it('has none without the sensor', () => {
    const d = oneTurn(140, -140)
    expect(d.heel).toBeNull()
    expect(d.heelIn).toBeNull()
  })
})

describe('comparing manoeuvres', () => {
  it('averages the turn rate and picks the one that kept the most speed on the foil', () => {
    const a = oneTurn(140, -140)
    const b = oneTurn(140, -140, 3)
    const avg = detailAverages([a, b])
    expect(avg.turnRate).toBeCloseTo((a.turnRate! + b.turnRate!) / 2, 5)
    expect(avg.heelIn).toBeNull()
    const slow = { ...a, maneuver: { ...a.maneuver, minSpeed: 5 } }
    const fast = { ...b, maneuver: { ...b.maneuver, minSpeed: 8 } }
    const touched = { ...b, maneuver: { ...b.maneuver, minSpeed: 9, foiled: false } }
    expect(bestManeuver([slow, fast, touched])).toBe(fast)
    expect(bestManeuver([touched])).toBeNull()
  })
})
