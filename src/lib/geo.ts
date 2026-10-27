export const EARTH_RADIUS = 6371008.8
export const RAD = Math.PI / 180

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD
  const p2 = lat2 * RAD
  const dp = p2 - p1
  const dl = (lon2 - lon1) * RAD
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Initial bearing from point 1 to point 2 (deg). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD
  const p2 = lat2 * RAD
  const dl = (lon2 - lon1) * RAD
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return norm360(Math.atan2(y, x) / RAD)
}

/** Point reached from (lat, lon) after `dist` metres on `brg` degrees. */
export function destination(lat: number, lon: number, brg: number, dist: number): [number, number] {
  const d = dist / EARTH_RADIUS
  const b = brg * RAD
  const p1 = lat * RAD
  const l1 = lon * RAD
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return [p2 / RAD, l2 / RAD]
}

export function norm360(a: number): number {
  const r = a % 360
  return r < 0 ? r + 360 : r
}

/** Angle in (-180, 180]. */
export function norm180(a: number): number {
  const r = norm360(a)
  return r > 180 ? r - 360 : r
}

/** Signed smallest rotation from a to b, in (-180, 180]. */
export function angDiff(a: number, b: number): number {
  return norm180(b - a)
}

/** Distance between two undirected axes (deg, 0..90). */
export function axialDist(a: number, b: number): number {
  const d = Math.abs(angDiff(a, b))
  return Math.min(d, 180 - d)
}

export function circularMean(
  angles: ArrayLike<number>,
  weights?: ArrayLike<number>,
  i0 = 0,
  i1 = angles.length - 1,
): { mean: number; r: number } {
  let s = 0
  let c = 0
  let w = 0
  for (let i = i0; i <= i1; i++) {
    const a = angles[i]
    if (!Number.isFinite(a)) continue
    const wi = weights ? weights[i] : 1
    if (!(wi > 0)) continue
    s += wi * Math.sin(a * RAD)
    c += wi * Math.cos(a * RAD)
    w += wi
  }
  if (w === 0) return { mean: NaN, r: 0 }
  return { mean: norm360(Math.atan2(s, c) / RAD), r: Math.hypot(s, c) / w }
}

/** Equirectangular projection around a reference point, in metres. Accurate over a session's extent. */
export function projector(lat0: number, lon0: number) {
  const kx = Math.cos(lat0 * RAD) * EARTH_RADIUS * RAD
  const ky = EARTH_RADIUS * RAD
  return {
    x: (lon: number) => (lon - lon0) * kx,
    y: (lat: number) => (lat - lat0) * ky,
  }
}

/** Euler angles (deg) from a body-to-NED quaternion, aerospace ZYX convention. */
export function quaternionToEuler(w: number, x: number, y: number, z: number): { yaw: number; pitch: number; roll: number } {
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
  const sp = Math.max(-1, Math.min(1, 2 * (w * y - z * x)))
  const pitch = Math.asin(sp)
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
  return { yaw: norm360(yaw / RAD), pitch: pitch / RAD, roll: roll / RAD }
}

/** Body-to-NED quaternion from Euler angles (deg), inverse of quaternionToEuler. */
export function eulerToQuaternion(yawDeg: number, pitchDeg: number, rollDeg: number): [number, number, number, number] {
  const cy = Math.cos((yawDeg * RAD) / 2)
  const sy = Math.sin((yawDeg * RAD) / 2)
  const cp = Math.cos((pitchDeg * RAD) / 2)
  const sp = Math.sin((pitchDeg * RAD) / 2)
  const cr = Math.cos((rollDeg * RAD) / 2)
  const sr = Math.sin((rollDeg * RAD) / 2)
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ]
}
