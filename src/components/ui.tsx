import { useRef, type ReactNode } from 'react'
import { useSeen, useSlidingMarker } from '../lib/motion'

export const btnPrimary =
  'press inline-flex items-center justify-center gap-2 rounded-full bg-accent-btn px-5 py-2.5 font-display text-[17px] font-semibold text-on-accent disabled:opacity-50'
export const btnSecondary =
  'press inline-flex items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 font-display text-[17px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-50'
export const btnGhost =
  'press inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 font-display text-[16px] font-semibold text-accent hover:bg-surface-2'
export const card = 'rounded-2xl border border-line bg-surface'
/** A small heading in the instrument's voice: «Bolina», «Gio 29 ott». */
export const instrumentLabel = 'font-display text-[15px] font-semibold text-ink-2 first-letter:uppercase'

/** A share (0..1) as a small ring that fills when it comes into view. */
export function MiniRing({ share, size = 40 }: { share: number; size?: number }) {
  const [ref, seen] = useSeen<SVGSVGElement>()
  return (
    <svg ref={ref} viewBox="0 0 100 100" width={size} height={size} className="-rotate-90" aria-hidden="true">
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--bar-track)" strokeWidth="14" />
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="var(--bar)"
        strokeWidth="14"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${seen ? share * 100 : 0} 100`}
        className="ring-fill"
      />
    </svg>
  )
}

/** A line of values drawing itself, with a soft fill under it. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const [ref, seen] = useSeen<SVGSVGElement>()
  const max = Math.max(...values, 1e-9)
  const points = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * 100).toFixed(1)} ${(38 - (v / max) * 36).toFixed(1)}`)
  const line = `M${points.join('L')}`
  return (
    <svg ref={ref} viewBox="0 0 100 40" preserveAspectRatio="none" className={`${className ?? ''} ${seen ? 'reveal-x' : 'opacity-0'}`} aria-hidden="true">
      <path d={`${line}L100 40L0 40Z`} fill="var(--bar)" fillOpacity={0.14} />
      <path d={line} fill="none" stroke="var(--bar)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Grey shapes that shimmer where a list is about to appear. */
export function Skeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="space-y-2.5" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className="skeleton h-[78px]" />
      ))}
    </div>
  )
}

export function StatTile({
  label,
  value,
  unit,
  sub,
  onClick,
  active,
  visual,
  wide,
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  onClick?: () => void
  active?: boolean
  /** A small picture of the number, in the corner. */
  visual?: ReactNode
  /** Across two columns. */
  wide?: boolean
}) {
  const body = (
    <>
      <p className="font-display text-[15px] leading-tight font-semibold text-ink-2">{label}</p>
      <p className="mt-1 font-display text-[30px] leading-none font-bold tabular">
        {value}
        {unit && <span className="ml-1 text-[15px] font-medium text-ink-2">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-xs leading-tight text-ink-2">{sub}</p>}
      {visual && <span className={wide ? 'absolute inset-y-3 right-3 w-[52%]' : 'absolute top-3 right-3'}>{visual}</span>}
    </>
  )
  const cls = `relative flex min-h-[88px] flex-col items-start justify-start overflow-hidden rounded-2xl border border-line bg-surface px-3.5 py-3 text-left ${wide ? 'col-span-2' : ''} ${active ? 'ring-2 ring-[var(--accent-text)]' : ''}`
  return onClick ? (
    <button type="button" onClick={onClick} className={`press ${cls}`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  compact = false,
}: {
  /** Null: none chosen yet. */
  value: T | null
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  /** Tighter, for four or more options on a phone. */
  compact?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const marker = useSlidingMarker(box, '[aria-checked="true"]', `${value}/${options.map((o) => o.label).join()}`)
  return (
    <div ref={box} role="radiogroup" aria-label={label} className="relative inline-flex max-w-full rounded-full bg-surface-2 p-1">
      {marker && (
        <span aria-hidden className="slide absolute top-1 bottom-1 left-0 rounded-full bg-accent-btn" style={{ width: marker.w, transform: `translateX(${marker.x}px)` }} />
      )}
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative rounded-full font-display font-semibold whitespace-nowrap transition-colors ${compact ? 'px-2.5 py-1 text-[15px]' : 'px-3.5 py-1.5 text-[16px]'} ${
            o.value === value ? 'text-on-accent' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Tabs with a line sliding under the open one. */
export function SlidingTabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const marker = useSlidingMarker(box, '[aria-selected="true"]', value)
  return (
    <div ref={box} role="tablist" aria-label={label} className="relative flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 px-1 py-2.5 font-display text-[16px] font-semibold transition-colors ${value === t.id ? 'text-accent' : 'text-ink-2'}`}
        >
          {t.label}
        </button>
      ))}
      {marker && <span aria-hidden className="slide absolute bottom-0 left-0 h-[3px] rounded-full bg-[var(--accent-text)]" style={{ width: marker.w, transform: `translateX(${marker.x}px)` }} />}
    </div>
  )
}

/** Short stroke in a series colour: the identity key beside a text label. */
export function LineKey({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-[3px] w-4 shrink-0 rounded-full align-middle" style={{ background: color }} />
}

/** Status shown with an icon and a word, never colour alone. */
export function Outcome({ ok, fell, okText = 'In foil', koText = 'Toccato' }: { ok: boolean; fell?: boolean; okText?: string; koText?: string }) {
  if (fell) koText = 'Caduta'
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${ok ? 'text-good-text' : 'text-critical'}`}>
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white"
        style={{ background: ok ? 'var(--good)' : 'var(--critical)' }}
      >
        {ok ? '✓' : '✕'}
      </span>
      {ok ? okText : koText}
    </span>
  )
}
