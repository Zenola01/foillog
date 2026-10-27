import { processTrack } from '../src/lib/analysis/clean'
import { TrackBuilder } from '../src/lib/parsers/trackBuilder'
import { simulate, type SimOptions } from '../src/lib/sim'
import type { RawTrack, Track } from '../src/lib/types'

export const T0 = Date.UTC(2026, 6, 15, 12, 0, 0)

export function simRaw(o: Partial<SimOptions> & Pick<SimOptions, 'legs' | 'windFrom'>, withSpeed = false): RawTrack {
  const pts = simulate({ start: [45.605, 10.64], t0: T0, ...o })
  const b = new TrackBuilder()
  for (const p of pts) b.push(p.t, p.lat, p.lon, withSpeed ? { sog: p.speed } : undefined)
  return b.build()
}

export function simTrack(o: Partial<SimOptions> & Pick<SimOptions, 'legs' | 'windFrom'>, withSpeed = false): Track {
  return processTrack(simRaw(o, withSpeed)).track
}

export const kn = (ms: number | null | undefined) => (ms == null ? NaN : ms * (3600 / 1852))
