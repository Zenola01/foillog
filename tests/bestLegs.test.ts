import { describe, expect, it } from 'vitest'
import { bestLegs, legsInWind } from '../src/lib/analysis/bestLegs'
import { tackOf } from '../src/lib/analysis/maneuvers'
import { norm180, RAD } from '../src/lib/geo'
import type { Leg } from '../src/lib/types'

/** A leg sailed on `course` at `speed` m/s, with the wind from the north. */
function leg(course: number, speed: number, duration = 30, foilShare = 1, wind = 0): Leg {
  const twa = norm180(wind - course)
  return {
    i0: 0,
    i1: 1,
    course,
    duration,
    distance: speed * duration,
    avgSpeed: speed,
    maxSpeed: speed,
    foilShare,
    tack: tackOf(wind, course),
    twa,
    vmg: speed * Math.cos(twa * RAD),
  }
}

describe('best legs', () => {
  // Ten upwind legs at 50° off the wind, speeds 6..15 m/s, alternating tacks.
  const upwind = Array.from({ length: 10 }, (_, k) => leg(k % 2 ? 50 : 310, 6 + k))
  const others = [leg(90, 20), leg(160, 12), leg(200, 13), leg(50, 30, 5), leg(310, 30, 30, 0.2)]

  it('ranks the upwind legs by VMG and keeps the top share', () => {
    const b = bestLegs([...others, ...upwind], 'up', 0.2)!
    expect(b.of).toBe(10)
    expect(b.chosen.map((l) => l.avgSpeed)).toEqual([15, 14])
    expect(b.speed).toBeCloseTo(14.5)
    expect(b.angle).toBeCloseTo(50)
    expect(b.vmg).toBeCloseTo(14.5 * Math.cos(50 * RAD))
    // 15 m/s on port (course 50° with the wind from the north), 14 on starboard.
    expect(b.byTack.P?.speed).toBeCloseTo(15)
    expect(b.byTack.S?.speed).toBeCloseTo(14)
  })

  it('weights the averages by time and makes downwind VMG positive', () => {
    const b = bestLegs([leg(160, 12, 60), leg(200, 13, 20), ...upwind], 'down', 1)!
    expect(b.legs).toBe(2)
    expect(b.seconds).toBe(80)
    expect(b.speed).toBeCloseTo((12 * 60 + 13 * 20) / 80)
    expect(b.vmg).toBeGreaterThan(0)
    expect(b.angle).toBeCloseTo(160)
  })

  it('keeps at least one leg, and nothing without the wind', () => {
    expect(bestLegs(upwind, 'up', 0.01)!.chosen).toHaveLength(1)
    expect(bestLegs(upwind.map((l) => ({ ...l, twa: null, vmg: null })), 'up', 0.2)).toBeNull()
    expect(bestLegs(upwind, 'down', 0.2)).toBeNull()
  })

  it('measures the legs against a shared wind', () => {
    const [l] = legsInWind([leg(50, 10)], 20)
    expect(l.twa).toBeCloseTo(-30)
    expect(l.vmg).toBeCloseTo(10 * Math.cos(30 * RAD))
    expect(l.tack).toBe('P')
  })
})
