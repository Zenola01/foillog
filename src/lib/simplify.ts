import { projector } from './geo'

/** Douglas–Peucker simplification to at most `maxPoints` points, returned as [lat, lon]. */
export function simplifyTrack(lat: ArrayLike<number>, lon: ArrayLike<number>, maxPoints = 160): [number, number][] {
  const n = lat.length
  if (n === 0) return []
  // Thin very long tracks first; DP on 5 000 points is instant.
  const step = Math.max(1, Math.ceil(n / 5000))
  const idx: number[] = []
  for (let i = 0; i < n; i += step) idx.push(i)
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1)
  if (idx.length <= maxPoints) return idx.map((i) => [lat[i], lon[i]])

  const p = projector(lat[0], lon[0])
  const xs = idx.map((i) => p.x(lon[i]))
  const ys = idx.map((i) => p.y(lat[i]))
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  let tol = Math.hypot(w, h) / 500
  for (let iter = 0; iter < 20; iter++) {
    const keep = douglasPeucker(xs, ys, tol)
    if (keep.length <= maxPoints) return keep.map((k) => [lat[idx[k]], lon[idx[k]]])
    tol *= 1.5
  }
  return [
    [lat[0], lon[0]],
    [lat[n - 1], lon[n - 1]],
  ]
}

function douglasPeucker(xs: number[], ys: number[], tol: number): number[] {
  const n = xs.length
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const dx = xs[b] - xs[a]
    const dy = ys[b] - ys[a]
    const len = Math.hypot(dx, dy) || 1
    let maxD = -1
    let maxI = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * xs[i] - dx * ys[i] + xs[b] * ys[a] - ys[b] * xs[a]) / len
      if (d > maxD) {
        maxD = d
        maxI = i
      }
    }
    if (maxD > tol) {
      keep[maxI] = 1
      stack.push([a, maxI], [maxI, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}
