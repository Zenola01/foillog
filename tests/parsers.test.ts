import { describe, expect, it } from 'vitest'
import { eulerToQuaternion } from '../src/lib/geo'
import { parseCsv } from '../src/lib/parsers/csv'
import { parseFile } from '../src/lib/parsers/detect'
import { parseGpx, toGpx } from '../src/lib/parsers/gpx'
import { parseDateTime } from '../src/lib/parsers/time'
import { buildVkx, parseVkx } from '../src/lib/parsers/vkx'

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WorkOutDoors 4.2" xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>Metadata name</name></metadata>
  <trk><name><![CDATA[Wing a Malcesine]]></name><trkseg>
    <trkpt lat="45.7630000" lon='10.8100000'><ele>65.2</ele><time>2026-07-15T12:00:00Z</time>
      <extensions><ns3:TrackPointExtension><ns3:hr>132</ns3:hr><ns3:speed>7.5</ns3:speed></ns3:TrackPointExtension></extensions></trkpt>
    <trkpt lat="45.7630600" lon="10.8100100"><time>2026-07-15T12:00:01.500Z</time></trkpt>
    <trkpt lat="45.7631200" lon="10.8100200"><time>2026-07-15T12:00:03</time></trkpt>
    <trkpt lat="45.7631800" lon="10.8100300"/>
  </trkseg></trk>
</gpx>`

describe('GPX', () => {
  it('reads points, namespaced extensions, creator and name', () => {
    const f = parseGpx(gpx)
    expect(f.format).toBe('gpx')
    expect(f.device).toBe('WorkOutDoors 4.2')
    expect(f.name).toBe('Wing a Malcesine')
    expect(f.track.t.length).toBe(3)
    expect(f.track.lat[0]).toBeCloseTo(45.763, 6)
    expect(f.track.lon[1]).toBeCloseTo(10.81001, 6)
    expect(f.track.hr?.[0]).toBe(132)
    expect(f.track.sog?.[0]).toBeCloseTo(7.5)
    expect(Number.isNaN(f.track.sog?.[1])).toBe(true)
    expect(f.track.alt?.[0]).toBeCloseTo(65.2)
    expect(f.track.t[1] - f.track.t[0]).toBe(1500)
    // No offset means UTC, as the GPX spec requires.
    expect(f.track.t[2]).toBe(Date.UTC(2026, 6, 15, 12, 0, 3))
    expect(f.warnings[0]).toMatch(/senza orario/)
  })

  it('round-trips through toGpx', () => {
    const pts = [0, 1, 2].map((k) => ({ t: Date.UTC(2026, 0, 1) + k * 1000, lat: 45 + k * 1e-4, lon: 10, speed: 5 + k, hr: 120 }))
    const f = parseGpx(toGpx(pts, { name: 'Test' }))
    expect(f.track.t.length).toBe(3)
    expect(f.track.sog?.[2]).toBeCloseTo(7)
    expect(f.name).toBe('Test')
  })

  it('rejects files without times', () => {
    expect(() => parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>')).toThrow(/orari/)
  })
})

describe('VKX', () => {
  const t0 = Date.UTC(2026, 6, 15, 12, 0, 0)
  const rows = Array.from({ length: 100 }, (_, k) => ({
    t: t0 + k * 40,
    lat: 45.605 + k * 1e-6,
    lon: 10.64,
    sog: 8.25,
    cogRad: Math.PI / 2,
    q: eulerToQuaternion(90, 3, -12),
  }))

  it('reads positions, speed, course and orientation per the spec', () => {
    const f = parseVkx(buildVkx(rows, { rateHz: 25 }))
    expect(f.format).toBe('vkx')
    expect(f.device).toContain('25 Hz')
    expect(f.track.t.length).toBe(100)
    expect(f.track.t[1] - f.track.t[0]).toBe(40)
    expect(f.track.lat[10]).toBeCloseTo(45.60501, 6)
    expect(f.track.sog?.[0]).toBeCloseTo(8.25, 5)
    expect(f.track.cog?.[0]).toBeCloseTo(90, 3)
    expect(f.track.hdg?.[0]).toBeCloseTo(90, 2)
    expect(f.track.pitch?.[0]).toBeCloseTo(3, 2)
    expect(f.track.roll?.[0]).toBeCloseTo(-12, 2)
  })

  it('skips internal rows and is detected by content', () => {
    const buf = buildVkx(rows, { extraUnknownRow: true })
    const f = parseFile('session-export.bin', buf)
    expect(f.format).toBe('vkx')
    expect(f.track.t.length).toBe(100)
  })
})

describe('CSV', () => {
  it('maps columns by name and converts knots', () => {
    const csv = [
      'timestamp,latitude,longitude,sog_kts,cog,heel,trim',
      '2026-07-15 12:00:00.000,45.605,10.64,10,90,-10,2',
      '2026-07-15 12:00:01.000,45.605,10.64007,10,90,-11,2',
      '2026-07-15 12:00:02.000,45.605,10.64014,10,90,-12,2',
    ].join('\n')
    const f = parseCsv(csv)
    expect(f.track.t[0]).toBe(Date.UTC(2026, 6, 15, 12, 0, 0))
    expect(f.track.sog?.[0]).toBeCloseTo(10 / (3600 / 1852), 4)
    expect(f.track.roll?.[2]).toBe(-12)
    expect(f.track.pitch?.[0]).toBe(2)
  })

  it('infers the speed unit from the positions when the header does not say', () => {
    // 0.0001° of longitude at 45.6° is about 7.79 m; one row per second, speed column in km/h.
    const kmh = 7.79 * 3.6
    const lines = ['time;lat;lon;speed']
    for (let k = 0; k < 20; k++) lines.push(`${1784116800 + k};45,605;${(10.64 + k * 1e-4).toFixed(4).replace('.', ',')};${kmh.toFixed(1).replace('.', ',')}`)
    const f = parseCsv(lines.join('\n'))
    expect(f.track.t[0]).toBe(1784116800 * 1000)
    expect(f.track.sog?.[5]).toBeCloseTo(7.79, 1)
  })

  it('parses European dates', () => {
    expect(parseDateTime('15/07/2026 14:30:05')).toBe(Date.UTC(2026, 6, 15, 14, 30, 5))
    expect(parseDateTime('2026-07-15T14:30:05+02:00')).toBe(Date.UTC(2026, 6, 15, 12, 30, 5))
  })
})
