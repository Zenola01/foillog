import type { ReactNode } from 'react'

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-md bg-accent-btn px-4 py-2 font-display text-[17px] font-semibold text-on-accent transition active:opacity-80 disabled:opacity-50'
export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 py-2 font-display text-[17px] font-semibold text-ink transition hover:bg-surface-2 active:opacity-80 disabled:opacity-50'
export const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 font-display text-[16px] font-semibold text-accent transition hover:bg-surface-2'
export const card = 'rounded-lg border border-line bg-surface'
/** A small heading in the instrument's voice: «Bolina», «Gio 29 ott». */
export const instrumentLabel = 'font-display text-[15px] font-semibold text-ink-2 first-letter:uppercase'

export function StatTile({
  label,
  value,
  unit,
  sub,
  onClick,
  active,
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const body = (
    <>
      <p className="font-display text-[15px] leading-tight font-semibold text-ink-2">{label}</p>
      <p className="mt-1 font-display text-[28px] leading-none font-semibold tabular">
        {value}
        {unit && <span className="ml-1 text-[15px] font-medium text-ink-2">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-xs leading-tight text-ink-2">{sub}</p>}
    </>
  )
  const cls = `flex flex-col items-start justify-start rounded-md border border-line bg-surface px-3 py-2.5 text-left ${active ? 'ring-2 ring-[var(--accent-text)]' : ''}`
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition hover:brightness-[.97]`}>
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
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex max-w-full ${compact ? 'gap-2.5' : 'gap-3.5'}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`border-b-2 font-display font-semibold whitespace-nowrap transition ${compact ? 'py-1.5 text-[15px]' : 'py-2 text-[17px]'} ${
            o.value === value ? 'border-[var(--accent-text)] text-accent' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
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
