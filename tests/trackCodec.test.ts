import { describe, expect, it } from 'vitest'
import { analyzeTrack } from '../src/lib/analysis/analyze'
import { decodeTrackFile, encodeTrackFile } from '../src/lib/trackCodec'
import { simTrack } from './helpers'

describe('track storage format', () => {
  it('round-trips a track with centimetre precision and the same analysis', async () => {
    const tr = simTrack(
      {
        windFrom: 270,
        legs: [
          { twa: 55, seconds: 60, kn: 16 },
          { twa: -55, seconds: 60, kn: 16 },
          { twa: -140, seconds: 50, kn: 20 },
          { twa: 140, seconds: 50, kn: 20 },
        ],
        noiseM: 1,
        hz: 5,
      },
      true,
    )
    tr.roll = Float32Array.from(tr.t, (_, i) => (i % 7 === 0 ? NaN : Math.sin(i / 20) * 25))
    const blob = await encodeTrackFile(tr, null)
    expect(blob.size).toBeLessThan(tr.t.length * 12)
    const { track } = await decodeTrackFile(blob)
    expect(track.t.length).toBe(tr.t.length)
    for (let i = 0; i < tr.t.length; i += 37) {
      expect(Math.abs(track.lat[i] - tr.lat[i])).toBeLessThan(2e-7)
      expect(Math.abs(track.spd[i] - tr.spd[i])).toBeLessThan(0.006)
      expect(Math.abs(track.dist[i] - tr.dist[i])).toBeLessThan(0.02 * (i + 1))
    }
    expect(Number.isNaN(track.roll![0])).toBe(true)
    expect(track.roll![1]).toBeCloseTo(tr.roll[1], 1)
    const a = analyzeTrack(tr, null, { foilOnKn: 7, windOverride: 270 })
    const b = analyzeTrack(track, null, { foilOnKn: 7, windOverride: 270 })
    expect(b.summary.records.s10).toBeCloseTo(a.summary.records.s10!, 2)
    expect(b.maneuvers.length).toBe(a.maneuvers.length)
  })
})
