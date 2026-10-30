import { describe, expect, it } from 'vitest'
import { bandOfSpeed, bandRange, bestPolar, bestVmg, comparePolar, fromPoints, parseWind, windText, type PolarSource } from '../src/lib/polars'
import type { PolarPoint } from '../src/lib/types'

const KN = 1852 / 3600
/** A polar in knots: [twa, speed kn, seconds]. */
const polar = (pts: [number, number, number][]): PolarPoint[] => pts.map(([twa, v, s]) => [twa, v * KN, s])
const src = (id: string, band: PolarSource['band'], pts: [number, number, number][], vmg: [number, number] = [0, 0]): PolarSource => ({
  id,
  start: Number(id.slice(1)),
  band,
  polar: polar(pts),
  vmgUp: vmg[0] * KN,
  vmgDown: vmg[1] * KN,
})

describe('wind strength', () => {
  it('puts the wind typed in for a session in a band from 7 kn up', () => {
    expect(bandOfSpeed(6.9 * KN)).toBe('calm')
    expect(bandOfSpeed(7 * KN)).toBe('light')
    expect(bandOfSpeed(11.9 * KN)).toBe('light')
    expect(bandOfSpeed(12 * KN)).toBe('medium')
    expect(bandOfSpeed(25 * KN)).toBe('strong')
    expect(bandOfSpeed(null)).toBeNull()
  })

  it('reads the wind as typed, in the rider’s unit', () => {
    expect(parseWind(' 16 ', 'kn')! / KN).toBeCloseTo(16)
    expect(parseWind('15,5', 'kn')! / KN).toBeCloseTo(15.5)
    expect(parseWind('30', 'kmh')).toBeCloseTo(30 / 3.6)
    expect(parseWind('', 'kn')).toBeNull()
    expect(parseWind('forte', 'kn')).toBeNull()
    expect(parseWind('0', 'kn')).toBeNull()
    expect(parseWind('120', 'kn')).toBeNull()
    expect(windText(16 * KN, 'kn')).toBe('16 kn')
    expect(windText(15.5 * KN, 'kn')).toBe('15,5 kn')
  })

  it('names the bands in the rider’s unit', () => {
    expect(bandRange('medium', 'kn')).toBe('12–18')
    expect(bandRange('calm', 'kn')).toBe('sotto 7')
    expect(bandRange('strong', 'kmh')).toBe('oltre 33')
    expect(bandRange('light', 'ms')).toBe('3,6–6,2')
  })
})

describe('best polars', () => {
  const a = src('s1', 'medium', [[47.5, 16, 60], [137.5, 22, 40], [-47.5, 15, 30], [92.5, 25, 8]], [9, 14])
  const b = src('s2', 'medium', [[47.5, 17, 20], [137.5, 21, 90], [-52.5, 15, 15]], [10, 12])
  const strong = src('s3', 'strong', [[47.5, 20, 60]], [12, 18])

  it('takes the fastest session in each sector, only in the same wind and with enough time there', () => {
    const best = bestPolar([a, b, strong], 'medium')
    expect(best.map((x) => x.twa)).toEqual([-52.5, -47.5, 47.5, 137.5])
    const at = (twa: number) => best.find((x) => x.twa === twa)!
    expect(at(47.5).speed / KN).toBeCloseTo(17)
    expect(at(47.5).from.id).toBe('s2')
    expect(at(137.5).from.id).toBe('s1')
    // 8 s on a reach are too few to count.
    expect(best.some((x) => x.twa === 92.5)).toBe(false)
    expect(bestPolar([a, b, strong], 'light')).toEqual([])
  })

  it('keeps the best VMG of each course with its session', () => {
    const v = bestVmg([a, b, strong], 'medium')
    expect(v.up?.id).toBe('s2')
    expect(v.down?.id).toBe('s1')
    expect(v.down!.v / KN).toBeCloseTo(14)
  })

  it('compares a session sector by sector, weighted by the time spent in each', () => {
    const best = bestPolar([a, b], 'medium')
    const today = fromPoints(polar([[47.5, 15.3, 30], [-47.5, 15, 10], [137.5, 24.2, 20], [-52.5, 30, 5], [7.5, 30, 60]]))
    const cmp = comparePolar(today, best)!
    // Upwind: 15.3/17 over 30 s and 15/15 over 10 s.
    expect(cmp.byCourse.up!.ratio).toBeCloseTo((0.9 * 30 + 1 * 10) / 40, 5)
    expect(cmp.byCourse.down!.ratio).toBeCloseTo(1.1, 5)
    expect(cmp.byCourse.reach).toBeNull()
    expect(cmp.faster).toBe(1)
    // 5 s at -52.5° are too few, and nobody has ever been at 7.5°.
    expect(cmp.sectors).toBe(3)
    expect(cmp.overall.seconds).toBe(60)
    expect(comparePolar(today, [])).toBeNull()
  })
})
