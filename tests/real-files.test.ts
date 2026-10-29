import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeTrack } from '../src/lib/analysis/analyze'
import { processTrack } from '../src/lib/analysis/clean'
import { tracksFromText } from '../src/lib/clipboardTracks'
import { parseFile } from '../src/lib/parsers/detect'

// Real sessions kept on this computer only: the folder is git-ignored, so these tests are
// skipped anywhere else (including the online build).
const DIR = process.env.FOILLOG_TRACKS ?? join(import.meta.dirname, '..', 'tracce test')
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.(gpx|vkx|csv)$/i.test(f)) : []

function load(name: string) {
  const buf = readFileSync(join(DIR, name))
  const parsed = parseFile(name, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  const { track } = processTrack(parsed.track)
  return { parsed, track, a: analyzeTrack(track, parsed.wind, { foilOnKn: 7, windOverride: 60 }) }
}

describe.skipIf(files.length === 0)('real sessions', () => {
  it.each(files)('%s parses and gives plausible numbers', (name) => {
    const { track, a } = load(name)
    expect(track.t.length).toBeGreaterThan(100)
    const kn = (a.summary.records.s2 ?? 0) * (3600 / 1852)
    expect(kn).toBeGreaterThan(3)
    expect(kn).toBeLessThan(45)
    expect(a.summary.distance).toBeGreaterThan(100)
  })

  it.each(files)('%s pasted as base64 (the «FoilLog» shortcut) reads like the file itself', async (name) => {
    const buf = readFileSync(join(DIR, name))
    const [f] = tracksFromText(buf.toString('base64').replace(/(.{76})/g, '$1\n'))
    expect(f.name.split('.').pop()).toBe(name.split('.').pop()!.toLowerCase())
    const pasted = parseFile(f.name, await f.arrayBuffer())
    const direct = parseFile(name, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    expect(pasted.track.t.length).toBe(direct.track.t.length)
  })

  it('a VKX and its GPX export give the same analysis', () => {
    const pairs = files
      .filter((f) => f.toLowerCase().endsWith('.vkx'))
      .map((v) => [v, files.find((g) => g.toLowerCase() === v.toLowerCase().replace(/\.vkx$/, '.gpx'))] as const)
      .filter((p): p is readonly [string, string] => p[1] != null)
    for (const [vkx, gpx] of pairs) {
      const x = load(vkx)
      const y = load(gpx)
      expect(y.track.t.length).toBe(x.track.t.length)
      expect(y.a.summary.distance).toBeCloseTo(x.a.summary.distance, -1)
      expect(y.a.summary.records.s2).toBeCloseTo(x.a.summary.records.s2!, 1)
      expect(y.a.summary.jibes).toBe(x.a.summary.jibes)
      // Orientation from the quaternion must match the heel/trim the converter wrote.
      if (x.track.roll && y.track.roll && x.track.pitch && y.track.pitch) {
        for (let i = 0; i < x.track.t.length; i += 97) {
          expect(Math.abs(x.track.roll[i] - y.track.roll[i])).toBeLessThan(0.6)
          expect(Math.abs(x.track.pitch[i] - y.track.pitch[i])).toBeLessThan(0.6)
        }
      }
    }
  })
})
