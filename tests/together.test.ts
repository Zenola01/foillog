import { describe, expect, it } from 'vitest'
import { groupTogether, sharedTime, together } from '../src/lib/together'

const MIN = 60_000
const s = (id: string, from: number, to: number) => ({ id, start: from * MIN, end: to * MIN })

describe('sessions sailed together', () => {
  it('needs everybody on the water at once for a few minutes', () => {
    expect(sharedTime([s('a', 0, 60), s('b', 10, 70)])).toBe(50 * MIN)
    expect(together([s('a', 0, 60), s('b', 10, 70)])).toBe(true)
    expect(together([s('a', 0, 60), s('b', 57, 120)])).toBe(false)
    expect(together([s('a', 0, 60), s('b', 120, 180)])).toBe(false)
    expect(together([s('a', 0, 60)])).toBe(false)
    // Each pair overlaps, but never all three at once.
    expect(together([s('a', 0, 30), s('b', 20, 60), s('c', 50, 90)])).toBe(false)
  })

  it('groups the sessions sailed at the same time, most recent first', () => {
    const groups = groupTogether([
      s('morning', 600, 660),
      s('alone', 300, 360),
      s('zeno', 0, 62),
      s('adri', 8, 68),
      s('late', 640, 700),
      s('blip', 30, 32),
    ])
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([
      ['morning', 'late'],
      ['zeno', 'adri'],
    ])
  })
})
