import { useRef } from 'react'
import { norm360 } from '../lib/geo'
import { compass } from '../lib/units'

/** Compass for setting the wind direction: tap or drag where the wind comes from. Snaps to 5°. */
export function WindDial({ value, onChange, size = 200 }: { value: number; onChange: (deg: number) => void; size?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const fromPointer = (x: number, y: number) => {
    const r = ref.current!.getBoundingClientRect()
    const dx = x - (r.left + r.width / 2)
    const dy = y - (r.top + r.height / 2)
    onChange(norm360(Math.round((Math.atan2(dx, -dy) * 180) / Math.PI / 5) * 5))
  }
  const ticks = Array.from({ length: 36 }, (_, k) => k * 10)
  return (
    <svg
      ref={ref}
      viewBox="-100 -100 200 200"
      width={size}
      height={size}
      role="slider"
      tabIndex={0}
      aria-label="Direzione da cui arriva il vento"
      aria-valuemin={0}
      aria-valuemax={355}
      aria-valuenow={value}
      aria-valuetext={`${value}° ${compass(value)}`}
      style={{ touchAction: 'none', cursor: 'pointer' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        fromPointer(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (e.buttons) fromPointer(e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(norm360(value + 5))
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(norm360(value - 5))
      }}
    >
      <circle r="94" fill="var(--surface-2)" stroke="var(--axis)" />
      {ticks.map((d) => (
        <line
          key={d}
          x1="0"
          y1={-94}
          x2="0"
          y2={d % 90 === 0 ? -82 : -88}
          stroke="var(--muted)"
          strokeWidth={d % 90 === 0 ? 2 : 1}
          transform={`rotate(${d})`}
        />
      ))}
      {(['N', 'E', 'S', 'O'] as const).map((l, k) => (
        <text
          key={l}
          x={Math.sin((k * Math.PI) / 2) * 68}
          y={-Math.cos((k * Math.PI) / 2) * 68 + 5}
          textAnchor="middle"
          fontSize="15"
          fontWeight="600"
          fill="var(--ink-2)"
        >
          {l}
        </text>
      ))}
      <g transform={`rotate(${value})`}>
        <path d="M0 -92 L0 -46" stroke="var(--series-1)" strokeWidth="5" strokeLinecap="round" />
        <path d="M-10 -56 L0 -42 L10 -56" fill="none" stroke="var(--series-1)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text y="6" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--ink)">
        {value}°
      </text>
      <text y="26" textAnchor="middle" fontSize="13" fill="var(--ink-2)">
        {compass(value)}
      </text>
    </svg>
  )
}
