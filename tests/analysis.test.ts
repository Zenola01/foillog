import { describe, expect, it } from 'vitest'
import { analyzeTrack } from '../src/lib/analysis/analyze'
import { bestLegs } from '../src/lib/analysis/bestLegs'
import { processTrack } from '../src/lib/analysis/clean'
import { findLegs, findTurns } from '../src/lib/analysis/maneuvers'
import { estimateWind, sharedWind } from '../src/lib/analysis/wind'
import { angDiff, axialDist, bearing, haversine } from '../src/lib/geo'
import { TrackBuilder } from '../src/lib/parsers/trackBuilder'
import { simulate, type SimLeg } from '../src/lib/sim'
import { kn, simRaw, simTrack, T0 } from './helpers'

const KN = 1852 / 3600

describe('geo', () => {
  it('measures distances and angles', () => {
    expect(haversine(45, 10, 45, 10.01)).toBeCloseTo(786.3, 0)
    expect(angDiff(350, 10)).toBe(20)
    expect(angDiff(10, 350)).toBe(-20)
    expect(axialDist(10, 185)).toBe(5)
  })
})

describe('cleaning', () => {
  it('drops a GPS spike and averages a 25 Hz log down to 5 Hz', () => {
    const b = new TrackBuilder()
    for (let k = 0; k < 25 * 60; k++) {
      const spike = k === 700
      b.push(T0 + k * 40, 45.605 + (spike ? 0.05 : k * 2e-6), 10.64, { sog: 5 })
    }
    const { track, rateHz, warnings } = processTrack(b.build())
    expect(rateHz).toBeCloseTo(25, 0)
    expect(track.t.length).toBeGreaterThan(290)
    expect(track.t.length).toBeLessThan(310)
    expect(Math.max(...track.lat)).toBeLessThan(45.61)
    expect(warnings.join()).toMatch(/anomali/)
  })
})

describe('speed records', () => {
  it('a steady 20 kn run gives 20 kn on every record', () => {
    const tr = simTrack({ windFrom: 0, legs: [{ twa: 90, seconds: 300, kn: 20 }], noiseM: 0 })
    const a = analyzeTrack(tr, null, { foilOnKn: 7 })
    for (const key of ['s2', 's10', 's5x10', 'm100', 'm500', 'nm'] as const) {
      expect(kn(a.summary.records[key])).toBeCloseTo(20, 0)
    }
    expect(kn(a.summary.records.s10)).toBeGreaterThan(19.8)
  })

  it('uses device speed when the file has it', () => {
    const tr = simTrack({ windFrom: 0, legs: [{ twa: 90, seconds: 120, kn: 18 }], noiseM: 3, seed: 4 }, true)
    const a = analyzeTrack(tr, null, { foilOnKn: 7 })
    expect(kn(a.summary.records.s2)).toBeCloseTo(18, 0)
  })
})

describe('foil detection', () => {
  it('counts a single flight between slow sections', () => {
    const tr = simTrack({ windFrom: 0, legs: [{ twa: 90, seconds: 120, kn: 15 }], slowSeconds: 60, noiseM: 1 })
    const a = analyzeTrack(tr, null, { foilOnKn: 7 })
    expect(a.summary.takeoffs).toBe(1)
    expect(a.summary.foilTime).toBeGreaterThan(115)
    expect(a.summary.foilTime).toBeLessThan(130)
  })
})

// Upwind with tacks, then downwind with jibes, wind from 270°.
const zigzag: SimLeg[] = [
  { twa: 55, seconds: 40, kn: 16 },
  { twa: -55, seconds: 40, kn: 16 },
  { twa: 55, seconds: 40, kn: 16 },
  { twa: -55, seconds: 40, kn: 16 },
  { twa: -140, seconds: 35, kn: 20 },
  { twa: 140, seconds: 35, kn: 20 },
  { twa: -140, seconds: 35, kn: 20 },
  { twa: 140, seconds: 35, kn: 20 },
]

describe('wind and manoeuvres', () => {
  it('finds the wind axis from the turns and the direction with a model prior', () => {
    const tr = simTrack({ windFrom: 270, legs: zigzag, noiseM: 1.5, seed: 7 })
    const legs = findLegs(tr)
    const turns = findTurns(tr, legs)
    expect(turns.length).toBe(7)
    const w = estimateWind(tr, legs, turns, { modelDir: 250 })
    expect(w.source).toBe('track')
    expect(Math.abs(angDiff(w.dir!, 270))).toBeLessThan(5)
    expect(w.confidence).toBeGreaterThan(0.8)
  })

  it('classifies tacks and jibes and their foiling', () => {
    const tr = simTrack({
      windFrom: 270,
      legs: zigzag,
      noiseM: 1.5,
      seed: 3,
      turns: { 1: { minKn: 3, seconds: 12 }, 5: { minKn: 2, seconds: 14 } },
    })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: 270 })
    const tacks = a.maneuvers.filter((m) => m.kind === 'tack')
    const jibes = a.maneuvers.filter((m) => m.kind === 'jibe')
    expect(tacks.length).toBe(3)
    expect(jibes.length).toBe(3)
    expect(a.summary.tacksFoiled).toBe(2)
    expect(a.summary.jibesFoiled).toBe(2)
    expect(a.summary.upwindAngle!).toBeGreaterThan(50)
    expect(a.summary.upwindAngle!).toBeLessThan(60)
    expect(a.summary.downwindAngle!).toBeGreaterThan(134)
    expect(a.summary.downwindAngle!).toBeLessThan(146)
    expect(kn(a.summary.bestVmgUp)).toBeCloseTo(16 * Math.cos((55 * Math.PI) / 180), 0)
    // The bear-away between the upwind and downwind parts is on the same tack: not a manoeuvre.
    expect(a.maneuvers.length).toBe(6)
  })

  it('handles back-and-forth reaching with jibes only', () => {
    const legs: SimLeg[] = []
    for (let k = 0; k < 8; k++) legs.push({ twa: k % 2 ? -100 : 95, seconds: 50, kn: 19 })
    const tr = simTrack({ windFrom: 200, legs, noiseM: 1.5, seed: 11 })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, modelWind: { dir: 220, speed: 7, gust: 9, hourly: [], label: 'test' } })
    expect(Math.abs(angDiff(a.wind.dir!, 200))).toBeLessThan(8)
    expect(a.maneuvers.length).toBe(7)
    expect(a.maneuvers.every((m) => m.kind === 'jibe' && m.foiled)).toBe(true)
  })

  it('without a model it still guesses, but asks for confirmation', () => {
    const tr = simTrack({ windFrom: 270, legs: zigzag, noiseM: 1.5, seed: 9 })
    const a = analyzeTrack(tr, null, { foilOnKn: 7 })
    expect(a.wind.dir).not.toBeNull()
    expect(axialDist(a.wind.dir!, 270)).toBeLessThan(5)
    expect(a.wind.confidence).toBeLessThan(0.6)
  })

  it('reports per-tack upwind angles and a polar', () => {
    const tr = simTrack({ windFrom: 270, legs: zigzag, noiseM: 1, seed: 5 })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: 270 })
    expect(a.sail?.upwind.S?.angle).toBeCloseTo(55, -1)
    expect(a.sail?.upwind.P?.angle).toBeCloseTo(55, -1)
    expect(a.polar!.length).toBeGreaterThan(4)
    const up = a.polar!.find((b) => Math.abs(b.twa - 57.5) < 3)
    expect(kn(up?.speed)).toBeCloseTo(16, 0)
  })
})

describe('points of sail', () => {
  it('keeps the reaching (waiting for friends) out of the upwind and downwind numbers', () => {
    // Upwind at 55°, then a long while back and forth across the wind (75° and 105°), then downwind at 140°.
    const legs: SimLeg[] = [...zigzag.slice(0, 4)]
    for (let k = 0; k < 4; k++) legs.push({ twa: 75, seconds: 60, kn: 15 }, { twa: -105, seconds: 60, kn: 18 })
    legs.push(...zigzag.slice(4))
    const tr = simTrack({ windFrom: 270, legs, noiseM: 1, seed: 21 })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: 270 })
    expect(a.summary.upwindAngle!).toBeGreaterThan(50)
    expect(a.summary.upwindAngle!).toBeLessThan(60)
    expect(a.summary.downwindAngle!).toBeGreaterThan(134)
    expect(a.summary.downwindAngle!).toBeLessThan(146)
    expect(a.sail?.reach.S?.angle).toBeCloseTo(75, -1)
    expect(a.sail?.reach.P?.angle).toBeCloseTo(105, -1)
    expect(bestLegs(a.legs, 'reach', 1)?.legs).toBeGreaterThanOrEqual(6)
    expect(bestLegs(a.legs, 'up', 1)?.angle).toBeLessThan(60)
  })
})

describe('raw tracks', () => {
  it('positional speed matches the simulated speed', () => {
    const raw = simRaw({ windFrom: 0, legs: [{ twa: 60, seconds: 60, kn: 14 }], noiseM: 0 })
    const { track } = processTrack(raw)
    const mid = Math.floor(track.t.length / 2)
    expect(track.spd[mid] / KN).toBeCloseTo(14, 0)
  })
})

describe('back-and-forth reaching', () => {
  it('trusts the model rotation when the faster board is the broader one, and asks to confirm', () => {
    // Wind from 70°: one board sailed high (70°) and slow, the other broad (116°) and fast, turning by jibes.
    const legs: SimLeg[] = []
    for (let k = 0; k < 8; k++) legs.push(k % 2 ? { twa: -116, seconds: 50, kn: 24 } : { twa: 70, seconds: 50, kn: 17 })
    const tr = simTrack({ windFrom: 70, legs, noiseM: 1.5, seed: 13 })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, modelWind: { dir: 75, speed: 6, gust: 9, hourly: [], label: 'test' } })
    expect(a.wind.source).toBe('mixed')
    expect(Math.abs(angDiff(a.wind.dir!, 70))).toBeLessThan(8)
    expect(a.wind.confidence).toBeLessThan(0.6)
    expect(a.maneuvers.every((m) => m.kind === 'jibe')).toBe(true)
  })
})

describe('placeholder device data', () => {
  it('ignores a course column that is all zeros (Waterspeed) and still finds wind and manoeuvres', () => {
    const pts = simulate({ start: [45.61, 13.73], t0: T0, windFrom: 61, legs: zigzag.map((l) => ({ ...l })), noiseM: 1.5, seed: 17 })
    const b = new TrackBuilder()
    for (const p of pts) b.push(p.t, p.lat, p.lon, { sog: p.speed, cog: 0 })
    const { track, warnings } = processTrack(b.build())
    expect(warnings.join()).toMatch(/rotta del dispositivo ignorata/)
    const a = analyzeTrack(track, null, { foilOnKn: 7, modelWind: { dir: 61, speed: 8, gust: 14, hourly: [], label: 'test' } })
    expect(Math.abs(angDiff(a.wind.dir!, 61))).toBeLessThan(8)
    expect(a.maneuvers.filter((m) => m.kind === 'tack')).toHaveLength(3)
    expect(a.maneuvers.filter((m) => m.kind === 'jibe')).toHaveLength(3)
  })

  it('keeps a real device course', () => {
    const pts = simulate({ start: [45.61, 13.73], t0: T0, windFrom: 61, legs: zigzag, noiseM: 1, seed: 19 })
    const b = new TrackBuilder()
    for (let i = 0; i < pts.length; i++) {
      const j = Math.min(i + 1, pts.length - 1)
      const k = Math.max(i - 1, 0)
      b.push(pts[i].t, pts[i].lat, pts[i].lon, { cog: bearing(pts[k].lat, pts[k].lon, pts[j].lat, pts[j].lon) })
    }
    expect(processTrack(b.build()).warnings.join()).not.toMatch(/rotta/)
  })
})

describe('falls', () => {
  it('counts a change of tack with a long stop in the water as a failed manoeuvre', () => {
    // Second jibe: the rider falls and needs a minute to water start.
    const tr = simTrack({ windFrom: 270, legs: zigzag, noiseM: 1.5, seed: 23, turns: { 5: { minKn: 0, seconds: 70 } } })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: 270 })
    const jibes = a.maneuvers.filter((m) => m.kind === 'jibe')
    expect(jibes).toHaveLength(3)
    expect(jibes.filter((m) => m.fell)).toHaveLength(1)
    expect(jibes.filter((m) => m.foiled)).toHaveLength(2)
    expect(a.summary.falls).toBe(1)
  })

  it('marks a stop that does not change tack', () => {
    // Port downwind, stop, then port upwind: no tack or jibe, but a stop on the map.
    const legs: SimLeg[] = [
      { twa: -135, seconds: 60, kn: 19 },
      { twa: -57, seconds: 60, kn: 16 },
    ]
    const tr = simTrack({ windFrom: 270, legs, noiseM: 1, seed: 29, turns: { 0: { minKn: 0, seconds: 40 } } })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: 270 })
    expect(a.maneuvers).toHaveLength(0)
    expect(a.stops).toHaveLength(1)
    expect(a.summary.falls).toBe(1)
  })
})

describe('manoeuvres close together', () => {
  it('finds two jibes a few seconds apart with no straight leg between them', () => {
    const legs: SimLeg[] = [
      { twa: 75, seconds: 60, kn: 18 },
      { twa: -110, seconds: 6, kn: 18 },
      { twa: 75, seconds: 60, kn: 18 },
    ]
    const tr = simTrack({ windFrom: 83, legs, noiseM: 1, seed: 31, turns: { 0: { seconds: 7, minKn: 14 }, 1: { seconds: 7, minKn: 14 } } })
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: 83 })
    expect(a.maneuvers.map((m) => `${m.kind} ${m.from}>${m.to} ${m.foiled}`)).toEqual(['jibe S>P true', 'jibe P>S true'])
  })
})

describe('shared wind', () => {
  it('averages estimates that agree, across north', () => {
    const w = sharedWind([
      { dir: 350, weight: 1 },
      { dir: 10, weight: 1 },
    ])!
    expect(Math.abs(angDiff(w, 0))).toBeLessThan(0.5)
  })

  it('leans towards the more confident estimate', () => {
    const w = sharedWind([
      { dir: 80, weight: 0.9 },
      { dir: 100, weight: 0.3 },
    ])!
    expect(w).toBeGreaterThan(80)
    expect(w).toBeLessThan(90)
  })

  it('gives up when the riders disagree, and ignores unknown winds', () => {
    expect(sharedWind([{ dir: 80, weight: 1 }, { dir: 200, weight: 1 }])).toBeNull()
    expect(sharedWind([{ dir: null, weight: 1 }])).toBeNull()
    expect(sharedWind([{ dir: 82, weight: 0.6 }, { dir: null, weight: 0 }])).toBeCloseTo(82)
  })
})
