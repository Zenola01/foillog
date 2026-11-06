import { useMemo } from 'react'
import { prefersReducedMotion, useInView } from '../lib/motion'

const PAD = 3
/** Room left above the track for the wind mark. */
const WIND_ROOM = 13

/**
 * A track drawn on its own (no tiles), from the simplified preview points. With `windDir` it is turned
 * so that the wind comes from the top, the way sailors read a race: every track can then be compared
 * at a glance. `box` is the shape it is drawn in. `draw`: false keeps it hidden, true draws it from
 * start to finish. `runner` sends a dot along it. `fade` dims the line alone.
 */
export function TrackThumb({
  points,
  windDir,
  box = [100, 64],
  color = 'var(--track)',
  className,
  weight = 1.6,
  draw,
  runner,
  fade = 1,
}: {
  points: [number, number][]
  /** Where the wind blows from, in degrees. */
  windDir?: number | null
  box?: [number, number]
  color?: string
  className?: string
  weight?: number
  draw?: boolean
  runner?: boolean
  fade?: number
}) {
  const [W, H] = box
  const windy = windDir != null
  const d = useMemo(() => {
    if (points.length < 2) return ''
    const k = Math.cos((points[0][0] * Math.PI) / 180)
    const a = ((windDir ?? 0) * Math.PI) / 180
    // East and north, turned so that the bearing of the wind points up (y grows downwards on screen).
    const xs = points.map((p) => p[1] * k * Math.cos(a) - p[0] * Math.sin(a))
    const ys = points.map((p) => -(p[1] * k * Math.sin(a) + p[0] * Math.cos(a)))
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const spanX = Math.max(...xs) - minX || 1e-9
    const spanY = Math.max(...ys) - minY || 1e-9
    const top = windy ? WIND_ROOM : PAD
    const s = Math.min((W - 2 * PAD) / spanX, (H - top - PAD) / spanY)
    const ox = (W - spanX * s) / 2
    const oy = top + (H - top - PAD - spanY * s) / 2
    return xs.map((x, i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * s).toFixed(1)} ${(oy + (ys[i] - minY) * s).toFixed(1)}`).join('')
  }, [points, windDir, windy, W, H])
  const [ref, inView] = useInView<SVGSVGElement>(!!runner)
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true">
      {windy && (
        <path
          d={`M${W / 2} 2.5V9M${W / 2 - 2.6} 6.4L${W / 2} 9.4L${W / 2 + 2.6} 6.4`}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="0.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
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
      {runner && draw && inView && d && !prefersReducedMotion() && (
        <circle r="1.6" fill="var(--ink)">
          <animateMotion dur="24s" repeatCount="indefinite" path={d} />
        </circle>
      )}
    </svg>
  )
}
