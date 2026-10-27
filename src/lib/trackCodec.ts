import type { InstrumentWind, Track } from './types'

// Compact storage format for a processed track: integer columns (quantised, delta-encoded where
// values change slowly), JSON, then gzip. A 25-minute 5 Hz session comes to about 100 KB.

interface Packed {
  v: 1
  n: number
  /** Time, ms: first value then deltas. */
  t: number[]
  /** Latitude and longitude ×1e7 (1 cm): first value then deltas. */
  lat: number[]
  lon: number[]
  /** Speed, cm/s. */
  spd: number[]
  /** Course, tenths of a degree. */
  crs: number[]
  /** Cumulative distance ×100 (cm): first value then deltas. */
  dist: number[]
  /** Indices with a data gap before them. */
  gaps: number[]
  hr?: (number | null)[]
  /** Tenths of a degree. */
  hdg?: (number | null)[]
  roll?: (number | null)[]
  pitch?: (number | null)[]
  wind?: { t: number[]; awa: number[]; aws: number[] }
}

function encodeDelta(values: ArrayLike<number>, scale: number): number[] {
  const out = new Array<number>(values.length)
  let prev = 0
  for (let i = 0; i < values.length; i++) {
    const q = Math.round(values[i] * scale)
    out[i] = i === 0 ? q : q - prev
    prev = q
  }
  return out
}

function decodeDelta(values: number[], scale: number): Float64Array {
  const out = new Float64Array(values.length)
  let acc = 0
  for (let i = 0; i < values.length; i++) {
    acc = i === 0 ? values[0] : acc + values[i]
    out[i] = acc / scale
  }
  return out
}

const quant = (a: ArrayLike<number>, scale: number) => Array.from(a, (v) => Math.round(v * scale))
const quantOpt = (a: ArrayLike<number> | null, scale: number) =>
  a ? Array.from(a, (v) => (Number.isFinite(v) ? Math.round(v * scale) : null)) : undefined
const unquant = (a: number[], scale: number) => Float32Array.from(a, (v) => v / scale)
const unquantOpt = (a: (number | null)[] | undefined, scale: number) =>
  a ? Float32Array.from(a, (v) => (v == null ? NaN : v / scale)) : null

export function packTrack(tr: Track, wind: InstrumentWind | null): Packed {
  const gaps: number[] = []
  for (let i = 0; i < tr.gap.length; i++) if (tr.gap[i]) gaps.push(i)
  return {
    v: 1,
    n: tr.t.length,
    t: encodeDelta(tr.t, 1),
    lat: encodeDelta(tr.lat, 1e7),
    lon: encodeDelta(tr.lon, 1e7),
    spd: quant(tr.spd, 100),
    crs: quant(tr.crs, 10),
    dist: encodeDelta(tr.dist, 100),
    gaps,
    hr: quantOpt(tr.hr, 1),
    hdg: quantOpt(tr.hdg, 10),
    roll: quantOpt(tr.roll, 10),
    pitch: quantOpt(tr.pitch, 10),
    wind: wind ? { t: encodeDelta(wind.t, 1), awa: quant(wind.awa, 10), aws: quant(wind.aws, 100) } : undefined,
  }
}

export function unpackTrack(p: Packed): { track: Track; wind: InstrumentWind | null } {
  if (p.v !== 1) throw new Error('Formato della traccia non riconosciuto')
  const gap = new Uint8Array(p.n)
  for (const i of p.gaps) gap[i] = 1
  return {
    track: {
      t: decodeDelta(p.t, 1),
      lat: decodeDelta(p.lat, 1e7),
      lon: decodeDelta(p.lon, 1e7),
      spd: unquant(p.spd, 100),
      crs: unquant(p.crs, 10),
      dist: decodeDelta(p.dist, 100),
      gap,
      hr: unquantOpt(p.hr, 1),
      hdg: unquantOpt(p.hdg, 10),
      roll: unquantOpt(p.roll, 10),
      pitch: unquantOpt(p.pitch, 10),
    },
    wind: p.wind
      ? { t: decodeDelta(p.wind.t, 1), awa: unquant(p.wind.awa, 10), aws: unquant(p.wind.aws, 100) }
      : null,
  }
}

export async function encodeTrackFile(tr: Track, wind: InstrumentWind | null): Promise<Blob> {
  const json = new Blob([JSON.stringify(packTrack(tr, wind))])
  return new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob()
}

export async function decodeTrackFile(blob: Blob): Promise<{ track: Track; wind: InstrumentWind | null }> {
  let text: string
  try {
    text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  } catch {
    // Already decompressed on the way (served with Content-Encoding: gzip).
    text = await blob.text()
  }
  return unpackTrack(JSON.parse(text) as Packed)
}
