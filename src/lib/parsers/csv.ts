import { haversine } from '../geo'
import type { ParsedFile } from '../types'
import { MS_TO_KMH, MS_TO_KN } from '../units'
import { parseDateTime } from './time'
import { TrackBuilder } from './trackBuilder'

type SpeedScale = 'kn' | 'kmh' | 'ms' | null

const norm = (h: string) =>
  h
    .trim()
    .replace(/^"|"$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

function findCol(headers: string[], exact: string[], prefixes: string[] = []): number {
  for (const e of exact) {
    const i = headers.indexOf(e)
    if (i >= 0) return i
  }
  for (const p of prefixes) {
    const i = headers.findIndex((h) => h.startsWith(p))
    if (i >= 0) return i
  }
  return -1
}

function speedScaleFromName(h: string): SpeedScale {
  if (/(^|_)(kts?|kn|knots?)(_|$)/.test(h)) return 'kn'
  if (/(kmh|km_h|kph)/.test(h)) return 'kmh'
  if (/(^|_)(ms|m_s|mps)(_|$)/.test(h)) return 'ms'
  return null
}

function detectDelimiter(line: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, line.split(d).length] as const)
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][0]
}

/**
 * Reads CSV exports (Vakaros Connect or other loggers). Columns are matched by name; speed
 * units come from the header ("sog_kts", "speed (km/h)") or, failing that, are inferred by
 * comparing the column with the speed implied by the positions.
 */
export function parseCsv(text: string, fileTime?: number): ParsedFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'))
  if (lines.length < 3) throw new Error('Il file CSV è vuoto o quasi.')
  const delim = detectDelimiter(lines[0])
  const headers = lines[0].split(delim).map(norm)

  const c = {
    time: findCol(headers, ['timestamp', 'time', 'utc', 'time_utc', 'datetime', 'date_time', 'gps_time', 'ts', 'unix_time', 'epoch', 'timestamp_ms'], ['timestamp', 'time', 'utc']),
    date: findCol(headers, ['date', 'data']),
    lat: findCol(headers, ['lat', 'latitude', 'lat_deg', 'gps_lat'], ['lat']),
    lon: findCol(headers, ['lon', 'lng', 'long', 'longitude', 'lon_deg', 'gps_lon'], ['lon', 'lng']),
    sog: findCol(headers, ['sog', 'speed', 'gps_speed'], ['sog', 'speed', 'gps_speed', 'velocit']),
    cog: findCol(headers, ['cog', 'course', 'cog_deg', 'track'], ['cog', 'course']),
    hdg: findCol(headers, ['hdg', 'heading', 'hdg_true', 'true_heading', 'yaw'], ['hdg', 'heading']),
    roll: findCol(headers, ['roll', 'heel'], ['roll', 'heel']),
    pitch: findCol(headers, ['pitch', 'trim'], ['pitch', 'trim']),
    hr: findCol(headers, ['hr', 'heart_rate', 'heartrate', 'bpm'], ['heart']),
    alt: findCol(headers, ['alt', 'altitude', 'ele', 'elevation'], ['alt']),
  }
  if (c.lat < 0 || c.lon < 0) throw new Error('Nel CSV non trovo le colonne di latitudine e longitudine.')
  if (c.time < 0) throw new Error("Nel CSV non trovo la colonna dell'orario.")
  if (c.sog >= 0 && /wind|tws|aws|stw/.test(headers[c.sog])) c.sog = -1

  // With ";" as delimiter the decimal separator is often ",".
  const toNum = (s: string | undefined) => {
    if (s == null) return NaN
    const v = s.trim().replace(/^"|"$/g, '')
    return v === '' ? NaN : Number(delim === ';' ? v.replace(',', '.') : v)
  }

  const rows = lines.slice(1).map((l) => l.split(delim))
  const timeCells = rows.map((r) => (r[c.time] ?? '').trim().replace(/^"|"$/g, ''))
  const numericTime = timeCells.every((v) => v === '' || /^-?\d+(\.\d+)?$/.test(v))
  let relative = false
  const times = timeCells.map((v, k) => {
    if (numericTime) {
      const x = Number(v)
      if (x > 1e11) return x // ms
      if (x > 1e8) return x * 1000 // s
      relative = true
      return x * 1000
    }
    const withDate = c.date >= 0 && !/\d{4}/.test(v) ? `${(rows[k][c.date] ?? '').trim()} ${v}` : v
    return parseDateTime(withDate)
  })
  if (relative) {
    const end = fileTime ?? Date.now()
    const span = (times[times.length - 1] ?? 0) - (times[0] ?? 0)
    const base = end - span - (times[0] ?? 0)
    for (let i = 0; i < times.length; i++) times[i] += base
  }

  const b = new TrackBuilder()
  const sogRaw: number[] = []
  const cogRaw: number[] = []
  rows.forEach((r, k) => {
    const t = times[k]
    const lat = toNum(r[c.lat])
    const lon = toNum(r[c.lon])
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon)) return
    sogRaw.push(c.sog >= 0 ? toNum(r[c.sog]) : NaN)
    cogRaw.push(c.cog >= 0 ? toNum(r[c.cog]) : NaN)
    b.push(t, lat, lon, {
      hdg: c.hdg >= 0 ? toNum(r[c.hdg]) : NaN,
      roll: c.roll >= 0 ? toNum(r[c.roll]) : NaN,
      pitch: c.pitch >= 0 ? toNum(r[c.pitch]) : NaN,
      hr: c.hr >= 0 ? toNum(r[c.hr]) : NaN,
      alt: c.alt >= 0 ? toNum(r[c.alt]) : NaN,
    })
  })
  if (b.length < 2) throw new Error('Nel CSV non ci sono righe valide con orario e posizione.')

  const warnings: string[] = []
  if (relative) warnings.push('Orari relativi: la data della sessione è approssimata')

  // Speed unit: from the header if it says so, otherwise from the ratio with positional speed.
  if (c.sog >= 0) {
    let scale = speedScaleFromName(headers[c.sog])
    if (!scale) scale = inferSpeedScale(b, sogRaw)
    const f = scale === 'kn' ? 1 / MS_TO_KN : scale === 'kmh' ? 1 / MS_TO_KMH : 1
    b.opt.sog = sogRaw.map((v) => v * f)
  }
  if (c.cog >= 0) {
    const finite = cogRaw.filter(Number.isFinite)
    const radians = finite.length > 0 && Math.max(...finite.map(Math.abs)) <= 6.3
    b.opt.cog = cogRaw.map((v) => (radians ? (v * 180) / Math.PI : v))
  }

  return { format: 'csv', track: b.build(), wind: null, warnings }
}

function inferSpeedScale(b: TrackBuilder, sog: number[]): SpeedScale {
  const ratios: number[] = []
  for (let i = 1; i < b.length; i++) {
    const dt = (b.t[i] - b.t[i - 1]) / 1000
    if (!(dt > 0) || dt > 10) continue
    const v = haversine(b.lat[i - 1], b.lon[i - 1], b.lat[i], b.lon[i]) / dt
    const s = (sog[i] + sog[i - 1]) / 2
    if (v > 2 && Number.isFinite(s) && s > 0) ratios.push(s / v)
  }
  if (ratios.length < 5) return 'ms'
  ratios.sort((a, b) => a - b)
  const r = ratios[Math.floor(ratios.length / 2)]
  const options: [SpeedScale, number][] = [['ms', 1], ['kn', MS_TO_KN], ['kmh', MS_TO_KMH]]
  options.sort((a, b) => Math.abs(Math.log(r / a[1])) - Math.abs(Math.log(r / b[1])))
  return options[0][0]
}
