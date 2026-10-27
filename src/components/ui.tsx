import type { ReactNode } from 'react'

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-accent-btn px-4 py-2.5 text-[15px] font-semibold text-white transition active:opacity-80 disabled:opacity-50'
export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[15px] font-medium text-ink transition hover:bg-surface-2 active:opacity-80 disabled:opacity-50'
export const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-accent transition hover:bg-surface-2'
export const card = 'rounded-2xl border border-line bg-surface'

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
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className="mt-0.5 text-xl leading-tight font-semibold">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-ink-2">{unit}</span>}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink-2">{sub}</p>}
    </>
  )
  const cls = `rounded-xl px-3 py-2.5 text-left ${active ? 'bg-surface ring-2 ring-[var(--series-1)]' : 'bg-surface-2'}`
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
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
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
export function Outcome({ ok, okText = 'In foil', koText = 'Toccato' }: { ok: boolean; okText?: string; koText?: string }) {
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
