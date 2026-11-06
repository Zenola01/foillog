import { useMemo } from 'react'
import { prefersReducedMotion } from '../lib/motion'

const W = 100
const H = 64
const PAD = 3

/**
 * Mini map of a track (no tiles), from the simplified preview points. `draw`: false keeps it hidden,
 * true draws it from start to finish. `runner` sends a dot along it. `fade` dims the line alone.
 */
export function TrackThumb({
  points,
  color = 'var(--track)',
  className,
  weight = 1.6,
  draw,
  runner,
  fade = 1,
}: {
  points: [number, number][]
  color?: string
  className?: string
  weight?: number
  draw?: boolean
  runner?: boolean
  fade?: number
}) {
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
      <path
        d={d}
        pathLength={draw === undefined ? undefined : 1}
        fill="none"
        stroke={color}
        strokeOpacity={fade}
        strokeWidth={weight}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={draw === undefined ? undefined : draw ? 'track-draw' : 'opacity-0'}
      />
      {runner && draw && d && !prefersReducedMotion() && (
        <circle r="1.4" fill={color}>
          <animateMotion dur="24s" repeatCount="indefinite" path={d} />
        </circle>
      )}
    </svg>
  )
}
