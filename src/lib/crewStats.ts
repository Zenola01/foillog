import { haversine } from './geo'
import type { RecordKey, SessionSummary } from './types'

// Pure helpers for the crew views (day grouping, records, leaderboards), kept apart so they can
// be tested without a server.

/** Local calendar day of a time, as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Local midnight-to-midnight range of a YYYY-MM-DD day. */
export function dayRange(key: string): [Date, Date] {
  const [y, m, d] = key.split('-').map(Number)
  return [new Date(y, m - 1, d), new Date(y, m - 1, d + 1)]
}

export function shiftDay(key: string, days: number): string {
  const [from] = dayRange(key)
  from.setDate(from.getDate() + days)
  return dayKey(from.getTime())
}

interface Placed {
  center_lat: number
  center_lon: number
}

/** Groups sessions sailed within `radiusM` of each other (greedy, around the first of each group). */
export function groupByPlace<T extends Placed>(items: T[], radiusM = 5000): T[][] {
  const groups: { lat: number; lon: number; items: T[] }[] = []
  for (const it of items) {
    const g = groups.find((x) => haversine(x.lat, x.lon, it.center_lat, it.center_lon) <= radiusM)
    if (g) g.items.push(it)
    else groups.push({ lat: it.center_lat, lon: it.center_lon, items: [it] })
  }
  return groups.map((g) => g.items).sort((a, b) => b.length - a.length)
}

export interface Ranked {
  summary: SessionSummary
}

/** Best value of a record over sessions, with the session it came from. */
export function bestOf<T extends Ranked>(items: T[], key: RecordKey): { value: number; item: T } | null {
  let best: { value: number; item: T } | null = null
  for (const it of items) {
    const v = it.summary.records[key]
    if (v != null && Number.isFinite(v) && (!best || v > best.value)) best = { value: v, item: it }
  }
  return best
}

export interface SeasonTotals {
  sessions: number
  distance: number
  foilTime: number
  jibes: number
  jibesFoiled: number
}

export function totals(items: Ranked[]): SeasonTotals {
  const t: SeasonTotals = { sessions: 0, distance: 0, foilTime: 0, jibes: 0, jibesFoiled: 0 }
  for (const { summary: s } of items) {
    t.sessions++
    t.distance += s.distance
    t.foilTime += s.foilTime
    t.jibes += s.jibes
    t.jibesFoiled += s.jibesFoiled
  }
  return t
}

/** One row per rider with their best numbers over the given sessions. */
export function leaderboard<T extends Ranked & { user_id: string }>(items: T[], key: RecordKey) {
  const byRider = new Map<string, T[]>()
  for (const it of items) {
    if (!byRider.has(it.user_id)) byRider.set(it.user_id, [])
    byRider.get(it.user_id)!.push(it)
  }
  return [...byRider.entries()]
    .map(([userId, list]) => ({ userId, best: bestOf(list, key), sessions: list.length }))
    .filter((r) => r.best != null)
    .sort((a, b) => b.best!.value - a.best!.value)
}
