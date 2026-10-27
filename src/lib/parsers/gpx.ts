import type { ParsedFile } from '../types'
import { parseDateTime } from './time'
import { TrackBuilder } from './trackBuilder'

// GPX is parsed by scanning text rather than with DOMParser, which is unavailable in Web
// Workers. Child tags are matched by local name so that namespaced extensions
// (gpxtpx:speed, ns3:hr, …) are picked up whatever prefix the exporting app chose.
const child = (names: string) => new RegExp(`<(?:[\\w.-]+:)?(?:${names})\\b[^>]*>\\s*([^<]*?)\\s*<`, 'i')
const RE = {
  time: child('time'),
  ele: child('ele'),
  speed: child('speed'),
  course: child('course|cog'),
  hr: child('hr|heartrate|heart_rate'),
  // Exports converted from Vakaros logs carry these as plain tags.
  hdg: child('hdg_true|hdg|heading'),
  roll: child('heel|roll'),
  pitch: child('trim|pitch'),
}
const LAT = /\blat\s*=\s*["']\s*([-+0-9.eE]+)/
const LON = /\blon\s*=\s*["']\s*([-+0-9.eE]+)/

const num = (m: RegExpExecArray | null) => (m ? parseFloat(m[1]) : NaN)

export function parseGpx(text: string): ParsedFile {
  const b = new TrackBuilder()
  const head = text.slice(0, 4000)
  const creator = /<gpx\b[^>]*?\bcreator\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(head)
  let name: string | undefined
  const trk = text.indexOf('<trk')
  if (trk >= 0) {
    const m = /<name>\s*(?:<!\[CDATA\[)?([^<\]]*)/i.exec(text.slice(trk, trk + 600))
    if (m && m[1].trim()) name = m[1].trim()
  }

  let pos = 0
  let missingTime = 0
  for (;;) {
    const s = text.indexOf('<trkpt', pos)
    if (s < 0) break
    const close = text.indexOf('>', s)
    if (close < 0) break
    const open = text.slice(s, close + 1)
    let body = ''
    if (text.charCodeAt(close - 1) === 47 /* "/" */) {
      pos = close + 1
    } else {
      const e = text.indexOf('</trkpt>', close)
      if (e < 0) break
      body = text.slice(close + 1, e)
      pos = e + 8
    }
    const tm = RE.time.exec(body)
    const t = tm ? parseDateTime(tm[1]) : NaN
    if (!Number.isFinite(t)) {
      missingTime++
      continue
    }
    b.push(t, num(LAT.exec(open)), num(LON.exec(open)), {
      alt: num(RE.ele.exec(body)),
      sog: num(RE.speed.exec(body)),
      cog: num(RE.course.exec(body)),
      hr: num(RE.hr.exec(body)),
      hdg: num(RE.hdg.exec(body)),
      roll: num(RE.roll.exec(body)),
      pitch: num(RE.pitch.exec(body)),
    })
  }

  if (b.length === 0) {
    throw new Error(
      missingTime > 0
        ? 'Il file GPX non contiene gli orari dei punti, quindi non si può analizzare.'
        : 'Nel file GPX non ci sono punti traccia.',
    )
  }
  const warnings = missingTime > 0 ? [`${missingTime} punti senza orario ignorati`] : []
  return {
    format: 'gpx',
    device: creator ? (creator[1] ?? creator[2]).trim() || undefined : undefined,
    name,
    track: b.build(),
    wind: null,
    warnings,
  }
}

/** Writes a minimal GPX 1.1 file (used for the demo session and in tests). */
export function toGpx(
  points: { t: number; lat: number; lon: number; speed?: number; hr?: number }[],
  opts: { name?: string; creator?: string } = {},
): string {
  const rows = points.map((p) => {
    const ext =
      p.speed != null || p.hr != null
        ? `<extensions><gpxtpx:TrackPointExtension>${p.hr != null ? `<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>` : ''}${
            p.speed != null ? `<gpxtpx:speed>${p.speed.toFixed(2)}</gpxtpx:speed>` : ''
          }</gpxtpx:TrackPointExtension></extensions>`
        : ''
    return `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${new Date(p.t).toISOString()}</time>${ext}</trkpt>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${opts.creator ?? 'FoilLog'}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2">`,
    `<trk><name>${opts.name ?? 'Uscita'}</name><trkseg>`,
    ...rows,
    '</trkseg></trk></gpx>',
  ].join('\n')
}
