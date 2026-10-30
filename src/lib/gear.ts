import type { GearItem, GearKind, SessionGear } from './types'

// The rider's gear (wings, boards, foils) and what each session was sailed with. Pure helpers;
// the list itself lives in gearList.tsx.

export const GEAR_KINDS: { id: GearKind; name: string; plural: string; unit: string; nameHint: string; sizeHint: string }[] = [
  { id: 'wing', name: 'Ala', plural: 'Ali', unit: 'm²', nameHint: 'Marca e modello', sizeHint: '5' },
  { id: 'board', name: 'Tavola', plural: 'Tavole', unit: 'L', nameHint: 'Marca e modello', sizeHint: '85' },
  { id: 'foil', name: 'Foil', plural: 'Foil', unit: 'cm²', nameHint: 'Ala anteriore: marca e modello', sizeHint: '1100' },
  { id: 'other', name: 'Altro', plural: 'Altro', unit: '', nameHint: 'Albero, stabilizzatore, trapezio…', sizeHint: '85 cm' },
]

export const kindInfo = (k: GearKind) => GEAR_KINDS.find((x) => x.id === k) ?? GEAR_KINDS[3]

const NUMBER = /^\d+(?:[.,]\d+)?$/

/** «5 m²» from «5»; anything else as typed. */
export function sizeText(g: Pick<GearItem, 'kind' | 'size'>): string {
  const s = g.size.trim()
  const unit = kindInfo(g.kind).unit
  return unit && NUMBER.test(s) ? `${s.replace('.', ',')} ${unit}` : s
}

/** «Duotone Unit 5 m²», or «Ala 5 m²» without a name. */
export const gearLabel = (g: SessionGear) => [g.name.trim() || kindInfo(g.kind).name, sizeText(g)].filter(Boolean).join(' ')

export const toSessionGear = ({ id, kind, name, size }: GearItem): SessionGear => ({ id, kind, name, size })

/** In list order: wings, boards, foils, the rest; by name within each. */
export function sortGear<T extends SessionGear>(items: T[]): T[] {
  const rank = (k: GearKind) => GEAR_KINDS.findIndex((x) => x.id === k)
  return [...items].sort((a, b) => rank(a.kind) - rank(b.kind) || gearLabel(a).localeCompare(gearLabel(b), 'it'))
}

/** A session's gear as it reads now: renamed items take their new name, removed ones keep the old. */
export const currentGear = (gear: SessionGear[], list: GearItem[]): SessionGear[] =>
  sortGear(gear.map((g) => {
    const now = list.find((x) => x.id === g.id)
    return now ? toSessionGear(now) : g
  }))

export interface GearUse {
  sessions: number
  foilTime: number
  distance: number
  /** Best 10 s speed (m/s). */
  best10s: number | null
  last: number
}

/** A session as the gear totals need it. */
export interface GearSession {
  gear?: SessionGear[] | null
  start: number
  foilTime: number
  distance: number
  s10: number | null
}

/** How much each piece of gear was used, by id. */
export function gearUse(items: GearSession[]): Map<string, GearUse> {
  const use = new Map<string, GearUse>()
  for (const it of items) {
    for (const g of it.gear ?? []) {
      const u = use.get(g.id) ?? { sessions: 0, foilTime: 0, distance: 0, best10s: null, last: 0 }
      use.set(g.id, {
        sessions: u.sessions + 1,
        foilTime: u.foilTime + it.foilTime,
        distance: u.distance + it.distance,
        best10s: it.s10 != null && (u.best10s == null || it.s10 > u.best10s) ? it.s10 : u.best10s,
        last: Math.max(u.last, it.start),
      })
    }
  }
  return use
}

/** Gear of the latest session before `start` that has some, keeping what is still in use. */
export function lastGear(items: { start: number; gear?: SessionGear[] | null }[], start: number, list: GearItem[]): SessionGear[] {
  const prev = items.filter((x) => x.start < start && x.gear?.length).sort((a, b) => b.start - a.start)[0]
  if (!prev) return []
  return sortGear(prev.gear!.flatMap((g) => {
    const now = list.find((x) => x.id === g.id && !x.retired)
    return now ? [toSessionGear(now)] : []
  }))
}
