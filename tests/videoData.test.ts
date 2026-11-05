import { describe, expect, it } from 'vitest'
import type { Track } from '../src/lib/types'
import { exportSize } from '../src/lib/videoFile'
import { overlayValuesAt, parseCreationDate, valuesAt, videoInSession, videoStart, WHOLE_SECOND_SHIFT_MS } from '../src/lib/videoData'

const T0 = Date.UTC(2026, 10, 5, 13, 0, 0)

/** A track with one point per second by default: [seconds, speed m/s, course]. */
function track(points: [number, number, number][], gapAt: number[] = []): Track {
  const n = points.length
  const gap = new Uint8Array(n)
  for (const i of gapAt) gap[i] = 1
  return {
    t: Float64Array.from(points, (p) => T0 + p[0] * 1000),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    spd: Float32Array.from(points, (p) => p[1]),
    crs: Float32Array.from(points, (p) => p[2]),
    dist: new Float64Array(n),
    gap,
    hr: null,
    hdg: null,
    roll: null,
    pitch: null,
  }
}

describe('numbers at a moment of the video', () => {
  it('reads between the points of the track', () => {
    const v = valuesAt(track([[0, 8, 0], [1, 10, 10]]), 90, T0 + 500)!
    expect(v.sog).toBeCloseTo(9)
    // Course 5°, wind from 90°: 85° on starboard tack.
    expect(v.twa).toBeCloseTo(85)
    expect(v.vmg).toBeCloseTo(9 * Math.cos((85 * Math.PI) / 180))
  })

  it('turns the short way across north', () => {
    const v = valuesAt(track([[0, 8, 350], [1, 8, 10]]), 90, T0 + 500)!
    // Course 0°, not 180°.
    expect(v.twa).toBeCloseTo(90)
  })

  it('goes downwind with a negative VMG and on port tack with a negative angle', () => {
    const v = valuesAt(track([[0, 10, 240], [1, 10, 240]]), 90, T0)!
    // Wind from 90°, course 240°: 150° on port tack.
    expect(v.twa).toBeCloseTo(-150)
    expect(v.vmg).toBeLessThan(-8)
  })

  it('has nothing outside the track or across a data gap', () => {
    const tr = track([[0, 8, 0], [1, 8, 0], [30, 8, 0], [31, 8, 0]], [2])
    expect(valuesAt(tr, 90, T0 - 1)).toBeNull()
    expect(valuesAt(tr, 90, T0 + 31_001)).toBeNull()
    expect(valuesAt(tr, 90, T0 + 10_000)).toBeNull()
    expect(valuesAt(tr, 90, T0 + 30_500)).not.toBeNull()
    expect(valuesAt(tr, 90, T0 + 31_000)).not.toBeNull()
  })

  it('gives no wind angle when standing still or without a wind', () => {
    const still = valuesAt(track([[0, 0.3, 123], [1, 0.3, 200]]), 90, T0)!
    expect(still.sog).toBeCloseTo(0.3)
    expect(still.twa).toBeNull()
    expect(still.vmg).toBeNull()
    const noWind = valuesAt(track([[0, 8, 0], [1, 8, 0]]), null, T0)!
    expect(noWind.sog).toBe(8)
    expect(noWind.twa).toBeNull()
  })

  it('changes five times a second', () => {
    const tr = track([[0, 8, 0], [1, 10, 0]])
    expect(overlayValuesAt(tr, 90, T0 + 410)!.sog).toBeCloseTo(8.8)
    expect(overlayValuesAt(tr, 90, T0 + 590)!.sog).toBeCloseTo(8.8)
    expect(overlayValuesAt(tr, 90, T0 + 610)!.sog).toBeCloseTo(9.2)
  })
})

describe('when a video starts', () => {
  const session: [number, number] = [Date.parse('2026-11-05T12:55:44Z'), Date.parse('2026-11-05T13:44:43Z')]

  it('reads the date as iPhones write it', () => {
    expect(parseCreationDate('2026-11-05T14:42:13+0100')).toBe(Date.parse('2026-11-05T13:42:13Z'))
    expect(parseCreationDate('2026-11-05T14:42:13+01:00')).toBe(Date.parse('2026-11-05T13:42:13Z'))
    expect(parseCreationDate('non è una data')).toBeNull()
    expect(parseCreationDate(null)).toBeNull()
  })

  it('takes the video’s own date first, in the middle of its second', () => {
    const start = videoStart({ creationDate: '2026-11-05T14:42:13+0100', date: new Date('2020-01-01T00:00:00Z') }, 0, 75, session)
    expect(start).toBe(Date.parse('2026-11-05T13:42:13Z') + WHOLE_SECOND_SHIFT_MS)
    expect(videoStart({ date: new Date('2026-11-05T13:42:13Z') }, 0, 75, session)).toBe(Date.parse('2026-11-05T13:42:13Z') + WHOLE_SECOND_SHIFT_MS)
  })

  it('falls back on the file’s date only if it fits the session', () => {
    const modified = Date.parse('2026-11-05T13:43:28Z')
    expect(videoStart({}, modified, 75, session)).toBe(Date.parse('2026-11-05T13:42:13Z'))
    expect(videoStart({}, Date.parse('2026-12-25T10:00:00Z'), 75, session)).toBeNull()
  })

  it('tells whether a video falls in the session', () => {
    expect(videoInSession(Date.parse('2026-11-05T13:42:13Z'), 75, session)).toBe(true)
    expect(videoInSession(Date.parse('2026-11-05T12:55:00Z'), 75, session)).toBe(true)
    expect(videoInSession(Date.parse('2026-11-05T14:00:00Z'), 75, session)).toBe(false)
  })
})

describe('size of the exported video', () => {
  it('keeps the shape, at most 1920 on the long side, in even numbers', () => {
    expect(exportSize(2160, 3840)).toEqual([1080, 1920])
    expect(exportSize(3840, 2160)).toEqual([1920, 1080])
    expect(exportSize(1280, 720)).toEqual([1280, 720])
    expect(exportSize(1081, 1921).every((v) => v % 2 === 0)).toBe(true)
  })
})
