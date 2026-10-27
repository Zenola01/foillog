import { norm180, RAD } from '../geo'
import type {
  AnalysisOptions,
  InstrumentWind,
  Leg,
  RecordKey,
  SessionAnalysis,
  SessionSummary,
  SpeedRecord,
  Track,
  WindEstimate,
} from '../types'
import { detectFoil } from './foil'
import { findLegs, findManeuvers, findStops, findTurns, tackOf, type RawLeg } from './maneuvers'
import { pointsOfSail } from './pointsOfSail'
import { segmentIds } from './series'
import { bestDistanceWindow, bestNTimeWindows, bestTimeWindow } from './speed'
import { estimateWind } from './wind'

export const DEFAULT_FOIL_KN = 7

/** Everything shown for a session, recomputed whenever the wind or the foil threshold changes. */
export function analyzeTrack(tr: Track, instrument: InstrumentWind | null, opts: AnalysisOptions): SessionAnalysis {
  const n = tr.t.length
  const seg = segmentIds(tr.gap)
  const { foil, flights } = detectFoil(tr, opts.foilOnKn)

  const five = bestNTimeWindows(tr, 10, 5, seg)
  const records: Record<RecordKey, SpeedRecord | null> = {
    s2: bestTimeWindow(tr, 2, seg),
    s10: bestTimeWindow(tr, 10, seg),
    s5x10: five ? { v: five.v, i0: five.windows[0].i0, i1: five.windows[0].i1 } : null,
    m100: bestDistanceWindow(tr, 100, seg),
    m500: bestDistanceWindow(tr, 500, seg),
    nm: bestDistanceWindow(tr, 1852, seg),
  }

  const rawLegs = findLegs(tr)
  const turns = findTurns(tr, rawLegs)
  const wind: WindEstimate =
    opts.windOverride != null
      ? { dir: opts.windOverride, source: 'manual', confidence: 1 }
      : estimateWind(tr, rawLegs, turns, { modelDir: opts.modelWind?.dir, instrument })

  const W = wind.dir
  const maneuvers = W != null ? findManeuvers(tr, rawLegs, turns, foil, W) : []
  const stops = findStops(tr, foil, maneuvers)
  const sail = W != null ? pointsOfSail(tr, foil, W, rawLegs) : null
  const legs = rawLegs.map((l) => describeLeg(tr, l, foil, W))

  // Totals.
  let moving = 0
  let foilTime = 0
  let foilDist = 0
  for (let i = 1; i < n; i++) {
    if (tr.gap[i]) continue
    const dt = (tr.t[i] - tr.t[i - 1]) / 1000
    if (tr.spd[i] >= 1) moving += dt
    if (foil[i] && foil[i - 1]) {
      foilTime += dt
      foilDist += tr.dist[i] - tr.dist[i - 1]
    }
  }
  let minLat = Infinity
  let minLon = Infinity
  let maxLat = -Infinity
  let maxLon = -Infinity
  let sLat = 0
  let sLon = 0
  for (let i = 0; i < n; i++) {
    minLat = Math.min(minLat, tr.lat[i])
    maxLat = Math.max(maxLat, tr.lat[i])
    minLon = Math.min(minLon, tr.lon[i])
    maxLon = Math.max(maxLon, tr.lon[i])
    sLat += tr.lat[i]
    sLon += tr.lon[i]
  }
  let hrSum = 0
  let hrN = 0
  let hrMax = -Infinity
  if (tr.hr) {
    for (const v of tr.hr) {
      if (!(v > 30)) continue
      hrSum += v
      hrN++
      hrMax = Math.max(hrMax, v)
    }
  }
  const longest = flights.reduce<(typeof flights)[number] | null>((a, f) => (!a || f.duration > a.duration ? f : a), null)
  const st = sail?.stats
  const angle = (a: { angle: number } | null, b: { angle: number } | null) => {
    const v = [a, b].filter((x): x is { angle: number } => x != null).map((x) => x.angle)
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
  }

  const summary: SessionSummary = {
    start: tr.t[0],
    end: tr.t[n - 1],
    duration: (tr.t[n - 1] - tr.t[0]) / 1000,
    movingTime: moving,
    distance: tr.dist[n - 1],
    foilTime,
    foilDistance: foilDist,
    foilShare: moving > 0 ? Math.min(1, foilTime / moving) : 0,
    avgFoilSpeed: foilTime > 0 ? foilDist / foilTime : null,
    takeoffs: flights.length,
    longestFlight: longest ? { duration: longest.duration, distance: longest.distance } : null,
    records: Object.fromEntries(Object.entries(records).map(([k, r]) => [k, r ? r.v : null])) as Record<RecordKey, number | null>,
    jibes: maneuvers.filter((m) => m.kind === 'jibe').length,
    jibesFoiled: maneuvers.filter((m) => m.kind === 'jibe' && m.foiled).length,
    tacks: maneuvers.filter((m) => m.kind === 'tack').length,
    tacksFoiled: maneuvers.filter((m) => m.kind === 'tack' && m.foiled).length,
    falls: maneuvers.filter((m) => m.fell).length + stops.length,
    windDir: W,
    windSource: wind.source,
    windConfidence: wind.confidence,
    modelWindSpeed: opts.modelWind?.speed ?? null,
    modelGust: opts.modelWind?.gust ?? null,
    upwindAngle: st ? angle(st.upwind.S, st.upwind.P) : null,
    downwindAngle: st ? angle(st.downwind.S, st.downwind.P) : null,
    bestVmgUp: st?.bestVmgUp?.v ?? null,
    bestVmgDown: st?.bestVmgDown?.v ?? null,
    avgHr: hrN ? hrSum / hrN : null,
    maxHr: hrN ? hrMax : null,
    center: [sLat / n, sLon / n],
    bbox: [minLat, minLon, maxLat, maxLon],
    points: n,
  }

  return {
    summary,
    foil,
    flights,
    records,
    s5x10Windows: five?.windows ?? [],
    legs,
    maneuvers,
    stops,
    wind,
    twa: sail?.twa ?? null,
    vmg: sail?.vmg ?? null,
    sail: st ?? null,
    polar: sail?.polar ?? null,
  }
}

function describeLeg(tr: Track, l: RawLeg, foil: Uint8Array, W: number | null): Leg {
  const duration = (tr.t[l.i1] - tr.t[l.i0]) / 1000
  const distance = tr.dist[l.i1] - tr.dist[l.i0]
  let maxSpeed = 0
  let onFoil = 0
  for (let i = l.i0; i <= l.i1; i++) {
    maxSpeed = Math.max(maxSpeed, tr.spd[i])
    if (foil[i]) onFoil++
  }
  const avgSpeed = duration > 0 ? distance / duration : 0
  const twa = W != null ? norm180(W - l.course) : null
  return {
    i0: l.i0,
    i1: l.i1,
    course: l.course,
    duration,
    distance,
    avgSpeed,
    maxSpeed,
    foilShare: onFoil / (l.i1 - l.i0 + 1),
    tack: W != null ? tackOf(W, l.course) : null,
    twa,
    vmg: twa != null ? avgSpeed * Math.cos(twa * RAD) : null,
  }
}

/** Statistics for a slice of the session (the range selected on a chart). */
export function rangeStats(tr: Track, a: SessionAnalysis, i0: number, i1: number) {
  let moving = 0
  let foilTime = 0
  let maxSpd = 0
  for (let i = i0 + 1; i <= i1; i++) {
    if (tr.gap[i]) continue
    const dt = (tr.t[i] - tr.t[i - 1]) / 1000
    if (tr.spd[i] >= 1) moving += dt
    if (a.foil[i] && a.foil[i - 1]) foilTime += dt
  }
  const sub: Track = {
    t: tr.t.subarray(i0, i1 + 1),
    lat: tr.lat.subarray(i0, i1 + 1),
    lon: tr.lon.subarray(i0, i1 + 1),
    spd: tr.spd.subarray(i0, i1 + 1),
    crs: tr.crs.subarray(i0, i1 + 1),
    dist: tr.dist.subarray(i0, i1 + 1),
    gap: tr.gap.subarray(i0, i1 + 1),
    hr: null,
    hdg: null,
    roll: null,
    pitch: null,
  }
  for (let i = i0; i <= i1; i++) maxSpd = Math.max(maxSpd, tr.spd[i])
  const duration = (tr.t[i1] - tr.t[i0]) / 1000
  const distance = tr.dist[i1] - tr.dist[i0]
  return {
    duration,
    distance,
    avgSpeed: duration > 0 ? distance / duration : 0,
    best2s: bestTimeWindow(sub, 2)?.v ?? null,
    best10s: bestTimeWindow(sub, 10)?.v ?? null,
    foilShare: moving > 0 ? Math.min(1, foilTime / moving) : 0,
    maneuvers: a.maneuvers.filter((m) => m.at >= i0 && m.at <= i1),
    maxSpd,
  }
}
