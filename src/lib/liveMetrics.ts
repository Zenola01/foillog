import { hasHeartRate, MIN_HR } from './analysis/series'
import { norm180, RAD } from './geo'
import type { LiveMetric, Settings } from './settings'
import type { Track } from './types'
import { compass, fmtDist, fmtSpeed, SPEED_SHORT } from './units'

/** A rider replayed on the shared clock. */
export interface LiveRider {
  id: string
  name: string
  color: string
  track: Track
  /** Added to the track's own time to put it on the shared clock. */
  offset: number
  /** Direction the wind blows from (deg), when known. */
  windDir: number | null
  foil?: Uint8Array | null
}

interface MetricDef {
  key: LiveMetric
  /** Name in the menu. */
  label: string
  /** Column heading. */
  head: (s: Settings) => string
  available: (r: LiveRider) => boolean
  value: (r: LiveRider, i: number, s: Settings) => string
}

const twaAt = (r: LiveRider, i: number) => norm180(r.windDir! - r.track.crs[i])
const whole = (v: number, suffix = '') => (Number.isFinite(v) ? `${Math.round(v)}${suffix}` : '–')

/** The numbers that can be shown while replaying, in the order they are listed. */
export const METRICS: MetricDef[] = [
  {
    key: 'spd',
    label: 'Velocità',
    head: (s) => `Vel. ${SPEED_SHORT[s.speedUnit]}`,
    available: () => true,
    value: (r, i, s) => fmtSpeed(r.track.spd[i], s.speedUnit),
  },
  {
    key: 'vmg',
    label: 'VMG',
    head: (s) => `VMG ${SPEED_SHORT[s.speedUnit]}`,
    available: (r) => r.windDir != null,
    value: (r, i, s) => {
      const v = r.track.spd[i] * Math.cos(twaAt(r, i) * RAD)
      return `${fmtSpeed(Math.abs(v), s.speedUnit)} ${v >= 0 ? '↑' : '↓'}`
    },
  },
  {
    key: 'twa',
    label: 'Angolo al vento',
    head: () => 'Angolo',
    available: (r) => r.windDir != null,
    value: (r, i) => {
      const a = twaAt(r, i)
      return `${Math.round(Math.abs(a))}° ${a >= 0 ? 'dx' : 'sx'}`
    },
  },
  {
    key: 'crs',
    label: 'Rotta',
    head: () => 'Rotta',
    available: () => true,
    value: (r, i) => `${Math.round(r.track.crs[i])}° ${compass(r.track.crs[i])}`,
  },
  {
    key: 'dist',
    label: 'Distanza percorsa',
    head: () => 'Distanza',
    available: () => true,
    value: (r, i, s) => fmtDist(r.track.dist[i], s.distUnit),
  },
  {
    key: 'foil',
    label: 'In foil',
    head: () => 'Foil',
    available: (r) => r.foil != null,
    value: (r, i) => (r.foil![i] ? 'sì' : 'no'),
  },
  {
    key: 'hr',
    label: 'Battito',
    head: () => 'Battito',
    available: (r) => hasHeartRate(r.track),
    value: (r, i) => (r.track.hr![i] > MIN_HR ? whole(r.track.hr![i]) : '–'),
  },
  {
    key: 'heel',
    label: 'Sbandamento',
    head: () => 'Sband.',
    available: (r) => r.track.roll != null,
    value: (r, i) => whole(Math.abs(r.track.roll![i]), '°'),
  },
]

/**
 * One rider's chosen numbers, to write beside the board: picked once per choice, then read at each
 * point. Whether the board is foiling shows on the map already.
 */
export function boardRows(r: LiveRider, s: Settings): (i: number) => { label: string; value: string }[] {
  const chosen = METRICS.filter((m) => m.key !== 'foil' && s.liveMetrics.includes(m.key) && m.available(r))
  return (i) => chosen.map((m) => ({ label: m.head(s), value: m.value(r, i, s) }))
}
