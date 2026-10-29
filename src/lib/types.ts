// Shared data types. Internal units: time in Unix ms, speed in m/s,
// distance in metres, angles in degrees (true north, clockwise).

export type SourceFormat = 'gpx' | 'vkx' | 'csv'

/** Columnar track exactly as read from a file. NaN marks a missing value. */
export interface RawTrack {
  t: Float64Array
  lat: Float64Array
  lon: Float64Array
  /** Speed over ground reported by the device (m/s). */
  sog: Float32Array | null
  /** Course over ground reported by the device (deg). */
  cog: Float32Array | null
  alt: Float32Array | null
  /** Heart rate (bpm). */
  hr: Float32Array | null
  /** Heading from the IMU (deg). */
  hdg: Float32Array | null
  /** Heel (deg), positive = starboard side down. */
  roll: Float32Array | null
  /** Pitch (deg), positive = bow up. */
  pitch: Float32Array | null
}

/** Apparent wind from an instrument (e.g. Vakaros + Calypso). */
export interface InstrumentWind {
  t: Float64Array
  /** Apparent wind angle relative to the bow (deg). */
  awa: Float32Array
  /** Apparent wind speed (m/s). */
  aws: Float32Array
}

export interface ParsedFile {
  format: SourceFormat
  device?: string
  name?: string
  track: RawTrack
  wind: InstrumentWind | null
  warnings: string[]
}

/** Cleaned track at ≤ 5 Hz with smoothed speed and course: the unit every analysis runs on. */
export interface Track {
  t: Float64Array
  lat: Float64Array
  lon: Float64Array
  /** Speed (m/s). */
  spd: Float32Array
  /** Course over ground (deg). */
  crs: Float32Array
  /** Cumulative distance (m). */
  dist: Float64Array
  /** 1 when there is a data gap (> 10 s) before this point. */
  gap: Uint8Array
  hr: Float32Array | null
  hdg: Float32Array | null
  roll: Float32Array | null
  pitch: Float32Array | null
}

export interface SpeedRecord {
  /** Average speed over the window (m/s). */
  v: number
  i0: number
  i1: number
}

export type RecordKey = 's2' | 's10' | 's5x10' | 'm100' | 'm500' | 'nm'

export interface Flight {
  i0: number
  i1: number
  duration: number
  distance: number
}

export type Tack = 'S' | 'P'

export interface Leg {
  i0: number
  i1: number
  /** Mean course (deg). */
  course: number
  duration: number
  distance: number
  avgSpeed: number
  maxSpeed: number
  foilShare: number
  tack: Tack | null
  /** Signed true wind angle (deg), positive = starboard tack. */
  twa: number | null
  /** Mean velocity made good (m/s), positive = upwind. */
  vmg: number | null
}

export interface Maneuver {
  kind: 'tack' | 'jibe'
  from: Tack
  to: Tack
  i0: number
  i1: number
  /** Index used to place the marker on the map. */
  at: number
  duration: number
  entrySpeed: number
  minSpeed: number
  exitSpeed: number
  foiled: boolean
  /** Stopped (or lost GPS) during the turn: a fall and a water start. */
  fell: boolean
}

/** A stop after foiling outside any manoeuvre: a fall, or a rest. */
export interface Stop {
  i0: number
  i1: number
  duration: number
}

/** `mixed`: the track fixed the axis, the weather model its rotation (back-and-forth reaching). */
export type WindSource = 'manual' | 'instrument' | 'track' | 'model' | 'mixed'

export interface WindEstimate {
  /** Direction the true wind blows FROM (deg), or null when unknown. */
  dir: number | null
  source: WindSource | null
  /** 0..1. Below 0.6 the app asks the rider to confirm. */
  confidence: number
}

export interface ModelWind {
  /** Direction the wind blows FROM (deg), averaged over the session. */
  dir: number
  /** Mean wind speed (m/s). */
  speed: number
  /** Highest gust (m/s). */
  gust: number
  hourly: { t: number; dir: number; speed: number; gust: number }[]
  label: string
}

export interface SideStats {
  /** Median |TWA| (deg). */
  angle: number
  speed: number
  vmg: number
  seconds: number
}

export interface SailStats {
  upwind: { S: SideStats | null; P: SideStats | null }
  /** Across the wind, between upwind and downwind (VMG means little here). */
  reach: { S: SideStats | null; P: SideStats | null }
  downwind: { S: SideStats | null; P: SideStats | null }
  bestVmgUp: SpeedRecord | null
  /** v is positive (m/s made good downwind). */
  bestVmgDown: SpeedRecord | null
}

export interface PolarBin {
  /** Signed TWA at the bin centre (deg). */
  twa: number
  /** 90th percentile of speed (m/s). */
  speed: number
  seconds: number
}

export interface SessionSummary {
  start: number
  end: number
  duration: number
  movingTime: number
  distance: number
  foilTime: number
  foilDistance: number
  /** Foiling time over moving time, 0..1. */
  foilShare: number
  avgFoilSpeed: number | null
  takeoffs: number
  longestFlight: { duration: number; distance: number } | null
  records: Record<RecordKey, number | null>
  jibes: number
  jibesFoiled: number
  tacks: number
  tacksFoiled: number
  /** Falls and stops: failed manoeuvres plus stops outside manoeuvres. */
  falls: number
  windDir: number | null
  windSource: WindSource | null
  windConfidence: number
  modelWindSpeed: number | null
  modelGust: number | null
  upwindAngle: number | null
  downwindAngle: number | null
  bestVmgUp: number | null
  bestVmgDown: number | null
  avgHr: number | null
  maxHr: number | null
  /** [lat, lon] */
  center: [number, number]
  /** [minLat, minLon, maxLat, maxLon] */
  bbox: [number, number, number, number]
  points: number
}

export interface SessionAnalysis {
  summary: SessionSummary
  foil: Uint8Array
  flights: Flight[]
  records: Record<RecordKey, SpeedRecord | null>
  /** The five windows behind the 5×10 s record. */
  s5x10Windows: SpeedRecord[]
  legs: Leg[]
  maneuvers: Maneuver[]
  stops: Stop[]
  wind: WindEstimate
  /** Signed TWA per point, when the wind is known. */
  twa: Float32Array | null
  /** VMG per point (m/s), when the wind is known. */
  vmg: Float32Array | null
  sail: SailStats | null
  polar: PolarBin[] | null
}

export interface AnalysisOptions {
  /** Speed above which the rider counts as foiling (knots). */
  foilOnKn: number
  /** Wind direction set by hand; overrides any estimate. */
  windOverride?: number | null
  modelWind?: ModelWind | null
}
