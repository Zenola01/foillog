import { describe, expect, it } from 'vitest'
import { bestOf, dayKey, dayRange, groupByPlace, leaderboard, shiftDay, totals } from '../src/lib/crewStats'
import type { SessionSummary } from '../src/lib/types'

const summary = (s2: number | null, distance = 1000): SessionSummary =>
  ({
    records: { s2, s10: s2 ? s2 - 1 : null, s5x10: null, m100: null, m500: null, nm: null },
    distance,
    foilTime: 600,
    jibes: 4,
    jibesFoiled: 3,
  }) as unknown as SessionSummary

describe('crew stats', () => {
  it('works with local calendar days', () => {
    const key = dayKey(new Date(2026, 8, 7, 7, 41).getTime())
    expect(key).toBe('2026-09-07')
    const [from, to] = dayRange(key)
    expect(to.getTime() - from.getTime()).toBe(24 * 3600 * 1000)
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('groups sessions by place', () => {
    const barcola = { center_lat: 45.6779, center_lon: 13.7527 }
    const barcola2 = { center_lat: 45.69, center_lon: 13.74 }
    const garda = { center_lat: 45.605, center_lon: 10.64 }
    const groups = groupByPlace([garda, barcola, barcola2])
    expect(groups.map((g) => g.length)).toEqual([2, 1])
    expect(groups[0]).toContain(barcola2)
  })

  it('finds bests, totals and the leaderboard', () => {
    const items = [
      { user_id: 'a', summary: summary(14) },
      { user_id: 'b', summary: summary(16, 2000) },
      { user_id: 'a', summary: summary(15) },
      { user_id: 'c', summary: summary(null) },
    ]
    expect(bestOf(items, 's2')?.value).toBe(16)
    expect(totals(items)).toMatchObject({ sessions: 4, distance: 5000, jibes: 16, jibesFoiled: 12 })
    const board = leaderboard(items, 's2')
    expect(board.map((r) => [r.userId, r.best!.value, r.sessions])).toEqual([
      ['b', 16, 1],
      ['a', 15, 2],
    ])
  })
})
