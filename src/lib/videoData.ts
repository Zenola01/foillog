import { indexAtTime, MIN_HR } from './analysis/series'
import { angDiff, norm180, norm360, RAD } from './geo'
import type { Track } from './types'

// What a video overlay shows at each moment, worked out from the session's track, and when the
// video starts on the track's clock. Pure helpers, used by the live preview and by the export.

/** Below this speed (m/s) the rider is standing still: the course, and so the wind angle, mean nothing. */
const MIN_SAILING_SPEED = 1

/** The numbers change five times a second: often enough to follow, slow enough to read. */
export const OVERLAY_STEP_MS = 200

/**
 * A phone stores the start of a video in whole seconds, cut short: half a second is the middle of
 * what it can be off by. On test videos of a wing foil session, jibes then fall within a second.
 */
export const WHOLE_SECOND_SHIFT_MS = 500

/** Half a second each way: the heel shakes by several degrees from one point to the next. */
const HEEL_HALF_MS = 500

/** What the numbers are read from. */
export interface OverlaySource {
  track: Track
  /** Direction the wind blows from (deg), when known. */
  windDir: number | null
  /** Per point: on the foil or not. */
  foil: Uint8Array | null
}

export interface OverlayValues {
  /** Speed over ground (m/s). */
  sog: number
  /** Signed true wind angle (deg), positive = starboard tack; null when standing still or without a wind. */
  twa: number | null
  /** Velocity made good (m/s), positive = upwind. */
  vmg: number | null
  /** Course over ground (deg). */
  crs: number
  /** Distance sailed so far (m). */
  dist: number
  foil: boolean | null
  /** Heart rate (bpm), when there is a reading. */
  hr: number | null
  /** Heel to either side (deg), when the device measures it. */
  heel: number | null
}

/** A heart rate between two points: a missing or zero reading is not a reading. */
function heartRateAt(hr: Float32Array | null, i: number, j: number, f: number): number | null {
  if (!hr) return null
  const a = hr[i] > MIN_HR ? hr[i] : null
  const b = hr[j] > MIN_HR ? hr[j] : null
  if (a != null && b != null) return a + f * (b - a)
  return a ?? b
}

function heelAround(tr: Track, i: number, ms: number): number | null {
  const roll = tr.roll
  if (!roll) return null
  let s = 0
  let c = 0
  for (let k = i; k >= 0 && tr.t[k] >= ms - HEEL_HALF_MS; k--) {
    if (Number.isFinite(roll[k])) {
      s += roll[k]
      c++
    }
  }
  for (let k = i + 1; k < roll.length && tr.t[k] <= ms + HEEL_HALF_MS; k++) {
    if (Number.isFinite(roll[k])) {
      s += roll[k]
      c++
    }
  }
  if (!c && Number.isFinite(roll[i])) return Math.abs(roll[i])
  return c ? Math.abs(s / c) : null
}

/** The numbers at a moment of the track, between its points; null where the track has no data. */
export function valuesAt({ track: tr, windDir, foil }: OverlaySource, ms: number): OverlayValues | null {
  const { t, spd, crs, gap, dist } = tr
  const n = t.length
  if (!(ms >= t[0] && ms <= t[n - 1])) return null
  const i = indexAtTime(t, ms)
  const j = Math.min(i + 1, n - 1)
  if (j > i && gap[j]) return null
  const f = j > i ? (ms - t[i]) / (t[j] - t[i]) : 0
  const sog = spd[i] + f * (spd[j] - spd[i])
  const course = crs[i] + f * angDiff(crs[i], crs[j])
  const twa = windDir == null || sog < MIN_SAILING_SPEED ? null : norm180(windDir - course)
  return {
    sog,
    twa,
    vmg: twa == null ? null : sog * Math.cos(twa * RAD),
    crs: norm360(course),
    dist: dist[i] + f * (dist[j] - dist[i]),
    foil: foil ? foil[i] === 1 : null,
    hr: heartRateAt(tr.hr, i, j, f),
    heel: heelAround(tr, i, ms),
  }
}

/** The moment on the overlay's own beat, so preview and export show the same thing at the same frame. */
export const overlayBeat = (ms: number) => Math.floor(ms / OVERLAY_STEP_MS) * OVERLAY_STEP_MS

export const overlayValuesAt = (source: OverlaySource, ms: number) => valuesAt(source, overlayBeat(ms))

/** «2026-11-05T14:42:13+0100», as iPhones write it (Safari only reads the offset with a colon). */
export function parseCreationDate(text: string | null | undefined): number | null {
  if (!text) return null
  const ms = Date.parse(text.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(ms) ? ms : null
}

/**
 * When a video starts on the track's clock (ms). From its own date when it has one; otherwise from
 * the file's date, but only if that falls within the session, since copying a file changes it.
 */
export function videoStart(
  meta: { creationDate?: string | null; date?: Date | null },
  fileModified: number,
  duration: number,
  session: [number, number],
): number | null {
  const stored = parseCreationDate(meta.creationDate) ?? meta.date?.getTime()
  if (stored != null && Number.isFinite(stored)) return stored + WHOLE_SECOND_SHIFT_MS
  const fromFile = fileModified - duration * 1000
  return fromFile < session[1] && fileModified > session[0] ? fromFile : null
}

/** Whether a video starting at `start` overlaps the session. */
export const videoInSession = (start: number, duration: number, session: [number, number]) => start < session[1] && start + duration * 1000 > session[0]
