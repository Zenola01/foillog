import { norm360, RAD } from './geo'
import type { ModelWind } from './types'

const DAY = 86_400_000
const HOUR = 3_600_000
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)

interface HourlyResponse {
  hourly?: {
    time: string[]
    wind_speed_10m: (number | null)[]
    wind_direction_10m: (number | null)[]
    wind_gusts_10m: (number | null)[]
  }
}

/**
 * 10 m wind from Open-Meteo for the session's place and hours (free for non-commercial use).
 * Recent sessions use the forecast API's past days; older ones the historical forecast
 * archive (high-resolution models), then ERA5 reanalysis. The position is rounded to ~1 km:
 * that is plenty for weather and sends less than the exact spot.
 */
export async function fetchModelWind(lat: number, lon: number, start: number, end: number, timeoutMs = 8000): Promise<ModelWind | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const common =
    `latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=UTC'
  const recent = Date.now() - end < 3 * DAY
  const urls = recent
    ? [`https://api.open-meteo.com/v1/forecast?${common}&past_days=${Math.min(92, Math.ceil((Date.now() - start) / DAY) + 1)}&forecast_days=1`]
    : [
        `https://historical-forecast-api.open-meteo.com/v1/forecast?${common}&start_date=${ymd(start)}&end_date=${ymd(end)}`,
        `https://archive-api.open-meteo.com/v1/archive?${common}&start_date=${ymd(start)}&end_date=${ymd(end)}`,
      ]
  try {
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: ctrl.signal })
        if (!res.ok) continue
        const summary = summarize((await res.json()) as HourlyResponse, start, end)
        if (summary) return { ...summary, label: url.includes('archive-api') ? 'Open-Meteo (ERA5)' : 'Open-Meteo' }
      } catch {
        if (ctrl.signal.aborted) return null
      }
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

function summarize(j: HourlyResponse, start: number, end: number): Omit<ModelWind, 'label'> | null {
  const h = j.hourly
  if (!h) return null
  const hourly: ModelWind['hourly'] = []
  for (let k = 0; k < h.time.length; k++) {
    const t = Date.parse(`${h.time[k]}Z`)
    const speed = h.wind_speed_10m[k]
    const dir = h.wind_direction_10m[k]
    const gust = h.wind_gusts_10m[k]
    if (speed == null || dir == null || !Number.isFinite(t)) continue
    if (t < start - 3 * HOUR || t > end + 3 * HOUR) continue
    hourly.push({ t, speed, dir, gust: gust ?? speed })
  }
  // Hours that overlap the session, or the closest one for short sessions.
  let inSession = hourly.filter((x) => x.t + HOUR / 2 >= start && x.t - HOUR / 2 <= end)
  if (inSession.length === 0 && hourly.length > 0) {
    const mid = (start + end) / 2
    inSession = [hourly.reduce((a, b) => (Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a))]
  }
  if (inSession.length === 0) return null
  let sx = 0
  let sy = 0
  let sp = 0
  let gust = 0
  for (const x of inSession) {
    sx += x.speed * Math.sin(x.dir * RAD)
    sy += x.speed * Math.cos(x.dir * RAD)
    sp += x.speed
    gust = Math.max(gust, x.gust)
  }
  return {
    dir: norm360(Math.atan2(sx, sy) / RAD),
    speed: sp / inSession.length,
    gust,
    hourly,
  }
}
