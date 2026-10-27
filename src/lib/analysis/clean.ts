import { bearing, haversine, norm360, RAD } from '../geo'
import type { RawTrack, Track } from '../types'

export const GAP_MS = 10_000
/** No wing foiler gets near 58 kn: faster jumps between fixes are GPS spikes. */
const MAX_SPEED = 30
/** Upward speed jumps faster than this (m/s²) are glitches; decelerations are allowed (crashes are real). */
const MAX_ACCEL = 8
/** Logs faster than 5 Hz (Vakaros records at 25 Hz) are averaged down to 5 Hz. */
const BIN_MS = 200
const COURSE_HALF_WINDOW = 1000

export interface ProcessResult {
  track: Track
  /** Sampling rate of the original file (Hz). */
  rateHz: number
  warnings: string[]
}

type Opt = 'sog' | 'cog' | 'hr' | 'hdg' | 'roll' | 'pitch'
const ANGULAR: Opt[] = ['cog', 'hdg']
const LINEAR: Opt[] = ['sog', 'hr', 'roll', 'pitch']

export function processTrack(raw: RawTrack): ProcessResult {
  const warnings: string[] = []
  const n0 = raw.t.length
  const order = Array.from({ length: n0 }, (_, i) => i)
  for (let i = 1; i < n0; i++) {
    if (raw.t[i] < raw.t[i - 1]) {
      order.sort((a, b) => raw.t[a] - raw.t[b])
      break
    }
  }

  // Valid, strictly increasing, without position spikes.
  const keep: number[] = []
  let lastT = -Infinity
  let spikes = 0
  let run = 0
  for (const i of order) {
    const t = raw.t[i]
    const la = raw.lat[i]
    const lo = raw.lon[i]
    if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo)) continue
    if (Math.abs(la) > 90 || Math.abs(lo) > 180 || (Math.abs(la) < 1e-6 && Math.abs(lo) < 1e-6)) continue
    if (t <= lastT) continue
    if (keep.length > 0) {
      const k = keep[keep.length - 1]
      const dt = (t - raw.t[k]) / 1000
      const v = haversine(raw.lat[k], raw.lon[k], la, lo) / dt
      if (v > MAX_SPEED && dt * 1000 < GAP_MS && run < 5) {
        run++
        spikes++
        continue
      }
    }
    run = 0
    keep.push(i)
    lastT = t
  }
  // A bad very first fix would make the next points look like spikes.
  if (keep.length > 2) {
    const [a, b] = keep
    const dt = (raw.t[b] - raw.t[a]) / 1000
    if (haversine(raw.lat[a], raw.lon[a], raw.lat[b], raw.lon[b]) / dt > MAX_SPEED) keep.shift()
  }
  if (keep.length < 10) throw new Error('La traccia ha troppi pochi punti validi per essere analizzata.')
  if (spikes > 0) warnings.push(`${spikes} punti GPS anomali scartati`)

  const dts: number[] = []
  for (let k = 1; k < keep.length; k++) dts.push(raw.t[keep[k]] - raw.t[keep[k - 1]])
  dts.sort((a, b) => a - b)
  const medianDt = dts[Math.floor(dts.length / 2)] || 1000
  const rateHz = 1000 / medianDt

  // Resample (or copy) into plain columns.
  const cols = medianDt < BIN_MS * 0.9 ? binTrack(raw, keep) : copyTrack(raw, keep)
  const n = cols.t.length
  const t = Float64Array.from(cols.t)
  const lat = Float64Array.from(cols.lat)
  const lon = Float64Array.from(cols.lon)
  const gap = new Uint8Array(n)
  for (let i = 1; i < n; i++) if (t[i] - t[i - 1] > GAP_MS) gap[i] = 1

  // Speed: the device's Doppler speed when it reports one, otherwise from positions.
  const sog = cols.opt.sog
  const useSog = sog != null && finiteShare(sog) >= 0.7
  const spd = new Float32Array(n)
  if (useSog) {
    const s = sog.slice()
    let prev = -1
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(s[i]) || s[i] < 0 || s[i] > MAX_SPEED) {
        s[i] = NaN
        continue
      }
      if (prev >= 0 && !gap[i] && (s[i] - s[prev]) / ((t[i] - t[prev]) / 1000) > MAX_ACCEL) {
        s[i] = NaN
        continue
      }
      prev = i
    }
    for (let i = 0; i < n; i++) spd[i] = Number.isFinite(s[i]) ? s[i] : positionalSpeed(t, lat, lon, gap, i)
  } else {
    for (let i = 0; i < n; i++) spd[i] = positionalSpeed(t, lat, lon, gap, i)
  }

  const dist = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const d =
      useSog && !gap[i]
        ? ((spd[i - 1] + spd[i]) / 2) * ((t[i] - t[i - 1]) / 1000)
        : haversine(lat[i - 1], lon[i - 1], lat[i], lon[i])
    dist[i] = dist[i - 1] + d
  }

  // Course: device COG when available, otherwise the bearing across neighbours; then smoothed.
  const cog = cols.opt.cog
  const useCog = cog != null && finiteShare(cog) >= 0.7
  const rawCrs = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (useCog && Number.isFinite(cog[i])) {
      rawCrs[i] = norm360(cog[i])
      continue
    }
    const a = i > 0 && !gap[i] ? i - 1 : i
    const b = i < n - 1 && !gap[i + 1] ? i + 1 : i
    rawCrs[i] = a !== b && haversine(lat[a], lon[a], lat[b], lon[b]) > 0.3 ? bearing(lat[a], lon[a], lat[b], lon[b]) : NaN
  }
  const crs = smoothCourse(t, rawCrs, spd, gap)

  const opt = (k: Opt) => (cols.opt[k] && finiteShare(cols.opt[k]!) > 0.1 ? Float32Array.from(cols.opt[k]!) : null)
  return {
    track: { t, lat, lon, spd, crs, dist, gap, hr: opt('hr'), hdg: opt('hdg'), roll: opt('roll'), pitch: opt('pitch') },
    rateHz,
    warnings,
  }
}

interface Columns {
  t: number[]
  lat: number[]
  lon: number[]
  opt: Partial<Record<Opt, number[]>>
}

function copyTrack(raw: RawTrack, keep: number[]): Columns {
  const out: Columns = { t: [], lat: [], lon: [], opt: {} }
  for (const k of [...ANGULAR, ...LINEAR]) if (raw[k]) out.opt[k] = []
  for (const i of keep) {
    out.t.push(raw.t[i])
    out.lat.push(raw.lat[i])
    out.lon.push(raw.lon[i])
    for (const k of [...ANGULAR, ...LINEAR]) out.opt[k]?.push(raw[k]![i])
  }
  return out
}

/** Averages points into 200 ms bins; angles use a vector mean so that 359° and 1° average to 0°. */
function binTrack(raw: RawTrack, keep: number[]): Columns {
  const out: Columns = { t: [], lat: [], lon: [], opt: {} }
  const lin = LINEAR.filter((k) => raw[k])
  const ang = ANGULAR.filter((k) => raw[k])
  for (const k of [...lin, ...ang]) out.opt[k] = []
  let bin = -1
  let cnt = 0
  let st = 0
  let sla = 0
  let slo = 0
  const ls: Record<string, [number, number]> = {}
  const as: Record<string, [number, number, number]> = {}
  const flush = () => {
    if (cnt === 0) return
    out.t.push(st / cnt)
    out.lat.push(sla / cnt)
    out.lon.push(slo / cnt)
    for (const k of lin) out.opt[k]!.push(ls[k][1] > 0 ? ls[k][0] / ls[k][1] : NaN)
    for (const k of ang) out.opt[k]!.push(as[k][2] > 0 ? norm360(Math.atan2(as[k][0], as[k][1]) / RAD) : NaN)
  }
  const reset = () => {
    cnt = st = sla = slo = 0
    for (const k of lin) ls[k] = [0, 0]
    for (const k of ang) as[k] = [0, 0, 0]
  }
  reset()
  for (const i of keep) {
    const b = Math.floor(raw.t[i] / BIN_MS)
    if (b !== bin) {
      flush()
      reset()
      bin = b
    }
    cnt++
    st += raw.t[i]
    sla += raw.lat[i]
    slo += raw.lon[i]
    for (const k of lin) {
      const v = raw[k]![i]
      if (Number.isFinite(v)) {
        ls[k][0] += v
        ls[k][1]++
      }
    }
    for (const k of ang) {
      const v = raw[k]![i]
      if (Number.isFinite(v)) {
        as[k][0] += Math.sin(v * RAD)
        as[k][1] += Math.cos(v * RAD)
        as[k][2]++
      }
    }
  }
  flush()
  return out
}

function finiteShare(a: ArrayLike<number>): number {
  let c = 0
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) c++
  return a.length ? c / a.length : 0
}

/** Central-difference speed across the neighbouring points (one-sided at gaps and ends). */
function positionalSpeed(t: Float64Array, lat: Float64Array, lon: Float64Array, gap: Uint8Array, i: number): number {
  const n = t.length
  const a = i > 0 && !gap[i] ? i - 1 : i
  const b = i < n - 1 && !gap[i + 1] ? i + 1 : i
  if (a === b) return 0
  return haversine(lat[a], lon[a], lat[b], lon[b]) / ((t[b] - t[a]) / 1000)
}

/** Speed-weighted vector average of the course over ±1 s; gaps in the course are carried forward. */
function smoothCourse(t: Float64Array, c: Float32Array, spd: Float32Array, gap: Uint8Array): Float32Array {
  const n = t.length
  const out = new Float32Array(n)
  let lo = 0
  let hi = 0
  let seg = 0
  const segOf = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    if (gap[i]) seg++
    segOf[i] = seg
  }
  let last = NaN
  for (let i = 0; i < n; i++) {
    while (t[lo] < t[i] - COURSE_HALF_WINDOW || segOf[lo] !== segOf[i]) lo++
    if (hi < i) hi = i
    while (hi + 1 < n && t[hi + 1] <= t[i] + COURSE_HALF_WINDOW && segOf[hi + 1] === segOf[i]) hi++
    let s = 0
    let co = 0
    for (let k = lo; k <= hi; k++) {
      if (!Number.isFinite(c[k])) continue
      const w = 0.2 + spd[k]
      s += w * Math.sin(c[k] * RAD)
      co += w * Math.cos(c[k] * RAD)
    }
    const v = s === 0 && co === 0 ? NaN : norm360(Math.atan2(s, co) / RAD)
    out[i] = Number.isFinite(v) ? v : last
    if (Number.isFinite(v)) last = v
  }
  // Leading points without a course take the first known one.
  const first = out.findIndex(Number.isFinite)
  for (let i = 0; i < first; i++) out[i] = out[first]
  if (first < 0) out.fill(0)
  return out
}
