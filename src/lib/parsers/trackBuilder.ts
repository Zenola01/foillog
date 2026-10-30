import type { RawTrack } from '../types'

export const OPTIONAL_FIELDS = ['sog', 'cog', 'alt', 'hr', 'hdg', 'roll', 'pitch'] as const
export type OptionalField = (typeof OPTIONAL_FIELDS)[number]
export type OptionalValues = Partial<Record<OptionalField, number>>

/** Accumulates points column by column; optional columns that never get a value come out as null. */
export class TrackBuilder {
  t: number[] = []
  lat: number[] = []
  lon: number[] = []
  opt: Record<OptionalField, number[]> = { sog: [], cog: [], alt: [], hr: [], hdg: [], roll: [], pitch: [] }

  get length() {
    return this.t.length
  }

  push(t: number, lat: number, lon: number, values?: OptionalValues) {
    this.t.push(t)
    this.lat.push(lat)
    this.lon.push(lon)
    for (const k of OPTIONAL_FIELDS) this.opt[k].push(values?.[k] ?? NaN)
  }

  build(): RawTrack {
    // A heart rate of 0 is not a reading: apps write it when the watch has no sensor on.
    this.opt.hr = this.opt.hr.map((v) => (v > 0 ? v : NaN))
    const col = (k: OptionalField) => (this.opt[k].some(Number.isFinite) ? Float32Array.from(this.opt[k]) : null)
    return {
      t: Float64Array.from(this.t),
      lat: Float64Array.from(this.lat),
      lon: Float64Array.from(this.lon),
      sog: col('sog'),
      cog: col('cog'),
      alt: col('alt'),
      hr: col('hr'),
      hdg: col('hdg'),
      roll: col('roll'),
      pitch: col('pitch'),
    }
  }
}
