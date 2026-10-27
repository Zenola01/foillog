export type SpeedUnit = 'kn' | 'kmh' | 'ms'
export type DistUnit = 'km' | 'nm'

export const MS_TO_KN = 3600 / 1852
export const MS_TO_KMH = 3.6

export const SPEED_LABEL: Record<SpeedUnit, string> = { kn: 'nodi', kmh: 'km/h', ms: 'm/s' }
export const SPEED_SHORT: Record<SpeedUnit, string> = { kn: 'kn', kmh: 'km/h', ms: 'm/s' }

export function toUnit(ms: number, unit: SpeedUnit): number {
  return unit === 'kn' ? ms * MS_TO_KN : unit === 'kmh' ? ms * MS_TO_KMH : ms
}

export function fromUnit(value: number, unit: SpeedUnit): number {
  return unit === 'kn' ? value / MS_TO_KN : unit === 'kmh' ? value / MS_TO_KMH : value
}

const it1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const it0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
const it2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function fmtNum(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '–'
  return (digits === 0 ? it0 : digits === 2 ? it2 : it1).format(v)
}

export function fmtSpeed(ms: number | null | undefined, unit: SpeedUnit, digits = 1): string {
  if (ms == null || !Number.isFinite(ms)) return '–'
  return fmtNum(toUnit(ms, unit), digits)
}

export function fmtDist(m: number | null | undefined, unit: DistUnit): string {
  if (m == null || !Number.isFinite(m)) return '–'
  if (unit === 'nm') return `${fmtNum(m / 1852, m < 18520 ? 2 : 1)} mn`
  return m < 1000 ? `${fmtNum(m, 0)} m` : `${fmtNum(m / 1000, m < 10000 ? 2 : 1)} km`
}

/** "1 h 23 min", "12 min", "45 s" */
export function fmtDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '–'
  const total = Math.round(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min`
  return `${total} s`
}

/** "1:05:09" or "5:09" */
export function fmtClockDuration(s: number): string {
  const total = Math.max(0, Math.round(s))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

const dateFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const timeSecFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const fmtDate = (ms: number) => dateFmt.format(ms)
export const fmtShortDate = (ms: number) => shortDateFmt.format(ms)
export const fmtTime = (ms: number) => timeFmt.format(ms)
export const fmtTimeSec = (ms: number) => timeSecFmt.format(ms)

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']

/** Italian 16-point compass label. */
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

export function fmtPct(share: number | null | undefined): string {
  if (share == null || !Number.isFinite(share)) return '–'
  return `${Math.round(share * 100)}%`
}
