import { describe, expect, it } from 'vitest'
import { currentGear, gearLabel, gearUse, lastGear, sizeText } from '../src/lib/gear'
import type { GearItem } from '../src/lib/types'

const wing5: GearItem = { id: 'w5', kind: 'wing', name: 'Duotone Unit', size: '5' }
const wing4: GearItem = { id: 'w4', kind: 'wing', name: '', size: '4.2' }
const board: GearItem = { id: 'b', kind: 'board', name: 'Sky', size: '85' }
const mast: GearItem = { id: 'm', kind: 'other', name: 'Albero', size: '85 cm' }

describe('gear', () => {
  it('writes sizes with their unit and names the gear', () => {
    expect(sizeText(wing5)).toBe('5 m²')
    expect(sizeText(wing4)).toBe('4,2 m²')
    expect(sizeText({ kind: 'wing', size: '5 m2' })).toBe('5 m2')
    expect(sizeText(mast)).toBe('85 cm')
    expect(gearLabel(wing5)).toBe('Duotone Unit 5 m²')
    expect(gearLabel(wing4)).toBe('Ala 4,2 m²')
  })

  it('shows renamed gear with its new name and keeps removed gear as the session saved it', () => {
    const saved = [{ ...board, name: 'Vecchio nome' }, { id: 'gone', kind: 'foil' as const, name: 'Foil venduto', size: '1100' }, wing5]
    expect(currentGear(saved, [wing5, board]).map(gearLabel)).toEqual(['Duotone Unit 5 m²', 'Sky 85 L', 'Foil venduto 1100 cm²'])
  })

  it('offers the gear of the previous session, without what is no longer used', () => {
    const past = [
      { start: 100, gear: [wing5, board] },
      { start: 300, gear: [wing4, board, mast] },
      { start: 500, gear: [wing5] },
    ]
    const list = [wing5, { ...wing4, retired: true }, board, mast]
    expect(lastGear(past, 400, list).map((g) => g.id)).toEqual(['b', 'm'])
    expect(lastGear(past, 50, list)).toEqual([])
  })

  it('adds up sessions, time on the foil and the best speed for each piece', () => {
    const use = gearUse([
      { gear: [wing5, board], start: 100, foilTime: 1800, distance: 20_000, s10: 10 },
      { gear: [wing5], start: 200, foilTime: 600, distance: 5000, s10: 12 },
      { gear: null, start: 300, foilTime: 900, distance: 9000, s10: 13 },
    ])
    expect(use.get('w5')).toEqual({ sessions: 2, foilTime: 2400, distance: 25_000, best10s: 12, last: 200 })
    expect(use.get('b')?.sessions).toBe(1)
    expect(use.has('m')).toBe(false)
  })
})
