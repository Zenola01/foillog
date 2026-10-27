import { quaternionToEuler } from '../geo'
import type { ParsedFile } from '../types'
import { TrackBuilder } from './trackBuilder'

// Vakaros VKX log, per the public spec at https://github.com/vakaros/vkx (format 1.4, R06).
// The file is a stream of rows: a one-byte key followed by a fixed-size, little-endian payload.
// Rows are grouped in ~2 kB pages that open with 0xFF and close with 0xFE.
const PAYLOAD: Record<number, number> = {
  0xff: 7, // page header
  0xfe: 2, // page terminator
  0x01: 32, // internal
  0x02: 44, // position, velocity, orientation
  0x03: 20, // declination
  0x04: 13, // race timer event
  0x05: 17, // line position
  0x06: 18, // shift angle
  0x07: 12, // internal
  0x08: 13, // device configuration
  0x0a: 16, // wind
  0x0b: 16, // speed through water
  0x0c: 12, // depth
  0x0e: 16, // internal
  0x0f: 16, // load
  0x10: 12, // temperature
  0x20: 13, // internal
  0x21: 52, // internal
}

const u64 = (dv: DataView, o: number) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296

export function parseVkx(buf: ArrayBuffer): ParsedFile {
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  const len = buf.byteLength
  const b = new TrackBuilder()
  const wt: number[] = []
  const awa: number[] = []
  const aws: number[] = []
  let rate = 0
  let skipped = 0
  let hasOrientation = false

  let o = 0
  while (o < len) {
    const key = u8[o]
    const size = PAYLOAD[key]
    if (size === undefined) {
      // Unknown row: its size is unknown too, so jump to the next page header (0xFE, U2, 0xFF).
      let q = o + 1
      while (q < len && !(u8[q] === 0xff && q >= 3 && u8[q - 3] === 0xfe)) q++
      skipped += q - o
      o = q
      continue
    }
    const p = o + 1
    if (p + size > len) break
    switch (key) {
      case 0x02: {
        const t = u64(dv, p)
        const lat = dv.getInt32(p + 8, true) * 1e-7
        const lon = dv.getInt32(p + 12, true) * 1e-7
        const sog = dv.getFloat32(p + 16, true)
        const cog = (dv.getFloat32(p + 20, true) * 180) / Math.PI
        const alt = dv.getFloat32(p + 24, true)
        const qw = dv.getFloat32(p + 28, true)
        const qx = dv.getFloat32(p + 32, true)
        const qy = dv.getFloat32(p + 36, true)
        const qz = dv.getFloat32(p + 40, true)
        const qn = Math.hypot(qw, qx, qy, qz)
        let e: ReturnType<typeof quaternionToEuler> | null = null
        if (qn > 0.5 && qn < 1.5) {
          e = quaternionToEuler(qw / qn, qx / qn, qy / qn, qz / qn)
          hasOrientation = true
        }
        if (lat === 0 && lon === 0) break // no GPS fix yet
        b.push(t, lat, lon, {
          sog: sog >= 0 ? sog : NaN,
          cog: ((cog % 360) + 360) % 360,
          alt,
          hdg: e?.yaw,
          roll: e?.roll,
          pitch: e?.pitch,
        })
        break
      }
      case 0x08:
        rate = u8[p + 12]
        break
      case 0x0a:
        wt.push(u64(dv, p))
        awa.push(dv.getFloat32(p + 8, true))
        aws.push(dv.getFloat32(p + 12, true))
        break
    }
    o = p + size
  }

  if (b.length === 0) throw new Error('Nel file Vakaros non ci sono posizioni GPS.')
  const warnings: string[] = []
  if (skipped > 0) warnings.push(`${skipped} byte non riconosciuti saltati`)
  if (!hasOrientation) warnings.push('Il file non contiene dati di orientamento')
  return {
    format: 'vkx',
    device: `Vakaros${rate ? ` · ${rate} Hz` : ''}`,
    track: b.build(),
    wind:
      wt.length > 0
        ? { t: Float64Array.from(wt), awa: Float32Array.from(awa), aws: Float32Array.from(aws) }
        : null,
    warnings,
  }
}

/** Builds a VKX buffer from position rows (used in tests and to check the parser against the spec). */
export function buildVkx(
  rows: { t: number; lat: number; lon: number; sog: number; cogRad: number; q?: [number, number, number, number] }[],
  opts: { rateHz?: number; extraUnknownRow?: boolean } = {},
): ArrayBuffer {
  const chunks: Uint8Array[] = []
  const row = (key: number, size: number, fill: (dv: DataView) => void) => {
    const a = new Uint8Array(1 + size)
    a[0] = key
    fill(new DataView(a.buffer, 1))
    chunks.push(a)
  }
  const setU64 = (dv: DataView, o: number, v: number) => {
    dv.setUint32(o, v % 4294967296, true)
    dv.setUint32(o + 4, Math.floor(v / 4294967296), true)
  }
  let pageStart = 0
  let pageBytes = 0
  const sizeOf = () => chunks.reduce((s, c) => s + c.length, 0)
  const header = () => {
    pageStart = sizeOf()
    row(0xff, 7, (dv) => dv.setUint8(0, 4))
  }
  const terminator = () => {
    pageBytes = sizeOf() - pageStart + 3
    row(0xfe, 2, (dv) => dv.setUint16(0, pageBytes, true))
  }
  header()
  row(0x08, 13, (dv) => {
    dv.setUint32(8, 1, true)
    dv.setUint8(12, opts.rateHz ?? 25)
  })
  rows.forEach((r, i) => {
    if (i > 0 && i % 40 === 0) {
      // An undocumented key with no known size forces the parser to resync on the next page.
      if (opts.extraUnknownRow) row(0x09, 5, () => {})
      terminator()
      header()
      if (opts.extraUnknownRow) row(0x01, 32, () => {})
    }
    row(0x02, 44, (dv) => {
      setU64(dv, 0, r.t)
      dv.setInt32(8, Math.round(r.lat * 1e7), true)
      dv.setInt32(12, Math.round(r.lon * 1e7), true)
      dv.setFloat32(16, r.sog, true)
      dv.setFloat32(20, r.cogRad, true)
      dv.setFloat32(24, 0, true)
      const q = r.q ?? [1, 0, 0, 0]
      q.forEach((v, k) => dv.setFloat32(28 + 4 * k, v, true))
    })
  })
  terminator()
  const out = new Uint8Array(sizeOf())
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out.buffer
}
