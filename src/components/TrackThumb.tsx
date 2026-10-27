import { useMemo } from 'react'

const W = 100
const H = 64
const PAD = 7

/** Mini map of a track (no tiles), from the simplified preview points. */
export function TrackThumb({ points, color = 'var(--series-1)', className }: { points: [number, number][]; color?: string; className?: string }) {
  const d = useMemo(() => {
    if (points.length < 2) return ''
    const k = Math.cos((points[0][0] * Math.PI) / 180)
    const xs = points.map((p) => p[1] * k)
    const ys = points.map((p) => -p[0])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const spanX = Math.max(...xs) - minX || 1e-9
    const spanY = Math.max(...ys) - minY || 1e-9
    const s = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY)
    const ox = (W - spanX * s) / 2
    const oy = (H - spanY * s) / 2
    return xs.map((x, i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * s).toFixed(1)} ${(oy + (ys[i] - minY) * s).toFixed(1)}`).join('')
  }, [points])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true">
      <rect width={W} height={H} rx="9" fill="var(--surface-2)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
