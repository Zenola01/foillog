import { courseOf, type Course } from './analysis/pointsOfSail'
import type { PolarBin, PolarPoint, WindBand } from './types'
import { fmtNum, fromUnit, MS_TO_KN, SPEED_SHORT, toUnit, type SpeedUnit } from './units'

// The best polar over many sessions, kept apart by wind strength, and how one session compares
// with it. Pure helpers: the pages feed them what each session stores (polar, wind, best VMG).

/** Wind strengths the polars are kept apart by: each from its lower bound (kn) to the next one. */
export const WIND_BANDS: { id: Exclude<WindBand, 'calm'>; name: string; short: string; fromKn: number }[] = [
  { id: 'light', name: 'Vento leggero', short: 'Leggero', fromKn: 7 },
  { id: 'medium', name: 'Vento medio', short: 'Medio', fromKn: 12 },
  { id: 'strong', name: 'Vento forte', short: 'Forte', fromKn: 18 },
]

export type PolarBand = (typeof WIND_BANDS)[number]['id']

export const isPolarBand = (b: WindBand | null | undefined): b is PolarBand => b != null && b !== 'calm'

/**
 * The band of the mean wind the rider typed in for a session. Never the weather model's: near the
 * coast it is often far from the wind on the water, and one session in the wrong band would set a
 * best polar nobody can reach.
 */
export function bandOfSpeed(ms: number | null | undefined): WindBand | null {
  if (ms == null || !Number.isFinite(ms)) return null
  const kn = ms * MS_TO_KN
  let band: WindBand = 'calm'
  for (const b of WIND_BANDS) if (kn >= b.fromKn) band = b.id
  return band
}

/** Highest wind speed accepted as typed in (kn). */
const MAX_WIND_KN = 70

/** A wind speed typed in the rider's unit («15», «15,5»), in m/s; null when empty or not sensible. */
export function parseWind(text: string, unit: SpeedUnit): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const ms = fromUnit(Number(t), unit)
  return ms > 0 && ms * MS_TO_KN <= MAX_WIND_KN ? ms : null
}

/** «16», «15,5»: a wind speed as the rider would type it. */
export function windValue(ms: number, unit: SpeedUnit): string {
  const v = Math.round(toUnit(ms, unit) * 10) / 10
  return fmtNum(v, Number.isInteger(v) ? 0 : 1)
}

/** «16 kn» */
export const windText = (ms: number, unit: SpeedUnit) => `${windValue(ms, unit)} ${SPEED_SHORT[unit]}`

export const bandName = (b: WindBand) => (b === 'calm' ? 'Poco vento' : WIND_BANDS.find((x) => x.id === b)!.name)

/** «7–12», «sotto 7», «oltre 18», in the rider's unit (without it). */
export function bandRange(b: WindBand, unit: SpeedUnit): string {
  const v = (kn: number) => fmtNum(toUnit(kn / MS_TO_KN, unit), unit === 'ms' ? 1 : 0)
  if (b === 'calm') return `sotto ${v(WIND_BANDS[0].fromKn)}`
  const k = WIND_BANDS.findIndex((x) => x.id === b)
  const next = WIND_BANDS[k + 1]
  return next ? `${v(WIND_BANDS[k].fromKn)}–${v(next.fromKn)}` : `oltre ${v(WIND_BANDS[k].fromKn)}`
}

/** «vento medio (12–18 kn)» */
export const bandText = (b: WindBand, unit: SpeedUnit) => `${bandName(b).toLowerCase()} (${bandRange(b, unit)} ${SPEED_SHORT[unit]})`

export const fromPoints = (p: PolarPoint[]): PolarBin[] => p.map(([twa, speed, seconds]) => ({ twa, speed, seconds }))

/** One session, as the best polars see it. */
export interface PolarSource {
  id: string
  start: number
  band: WindBand | null
  /** Undefined: analysed before polars were kept. */
  polar: PolarPoint[] | null | undefined
  vmgUp: number | null
  vmgDown: number | null
}

/** Where a best value comes from. */
export interface Holder {
  id: string
  start: number
}

/** A sector of the best polar, with the session that holds it. */
export interface BestBin extends PolarBin {
  from: Holder
}

/**
 * Time a session must spend in a 5° sector before its speed there counts, for the best polar and
 * for comparing with it: a few seconds in a sector say little about the speed there.
 */
export const MIN_SECTOR_SECONDS = 10

/** Sector by sector, the fastest of the sessions sailed in `band`. */
export function bestPolar(sources: PolarSource[], band: PolarBand): BestBin[] {
  const best = new Map<number, BestBin>()
  for (const s of sources) {
    if (s.band !== band || !s.polar) continue
    for (const [twa, speed, seconds] of s.polar) {
      if (seconds < MIN_SECTOR_SECONDS) continue
      const cur = best.get(twa)
      if (!cur || speed > cur.speed) best.set(twa, { twa, speed, seconds, from: { id: s.id, start: s.start } })
    }
  }
  return [...best.values()].sort((a, b) => a.twa - b.twa)
}

/** Best 10 s VMG upwind and downwind over the sessions sailed in `band`. */
export function bestVmg(sources: PolarSource[], band: PolarBand): { up: (Holder & { v: number }) | null; down: (Holder & { v: number }) | null } {
  let up: (Holder & { v: number }) | null = null
  let down: (Holder & { v: number }) | null = null
  for (const s of sources) {
    if (s.band !== band) continue
    if (s.vmgUp != null && (!up || s.vmgUp > up.v)) up = { v: s.vmgUp, id: s.id, start: s.start }
    if (s.vmgDown != null && (!down || s.vmgDown > down.v)) down = { v: s.vmgDown, id: s.id, start: s.start }
  }
  return { up, down }
}

/** Speed over the best one, averaged on the time spent in each sector (1 = as fast). */
export interface Share {
  ratio: number
  seconds: number
}

export interface PolarComparison {
  byCourse: Record<Course, Share | null>
  overall: Share
  /** Sectors where this session went faster than the best. */
  faster: number
  /** Sectors compared. */
  sectors: number
}

/** A session's polar against a best one: where both have a speed, how close it came. */
export function comparePolar(session: PolarBin[], best: PolarBin[]): PolarComparison | null {
  const ref = new Map(best.map((b) => [b.twa, b.speed]))
  const sum: Record<Course, [number, number]> = { up: [0, 0], reach: [0, 0], down: [0, 0] }
  let faster = 0
  let sectors = 0
  for (const b of session) {
    const r = ref.get(b.twa)
    const c = courseOf(b.twa)
    if (r == null || !(r > 0) || !c || b.seconds < MIN_SECTOR_SECONDS) continue
    sum[c][0] += (b.speed / r) * b.seconds
    sum[c][1] += b.seconds
    sectors++
    if (b.speed > r) faster++
  }
  if (!sectors) return null
  const share = ([w, s]: [number, number]): Share | null => (s > 0 ? { ratio: w / s, seconds: s } : null)
  const all: [number, number] = [sum.up[0] + sum.reach[0] + sum.down[0], sum.up[1] + sum.reach[1] + sum.down[1]]
  return { byCourse: { up: share(sum.up), reach: share(sum.reach), down: share(sum.down) }, overall: share(all)!, faster, sectors }
}
