import { useState } from 'react'
import { Link } from 'react-router-dom'
import { setKudos, type CloudSession } from '../lib/cloud'
import type { Settings } from '../lib/settings'
import { fmtTime } from '../lib/units'
import { IconComment } from './icons'
import { Avatar } from './RequireAuth'
import { SessionLine } from './Scores'

/** The 🤙 button: optimistic, reverts if the server says no. */
export function KudosButton({ s, userId }: { s: Pick<CloudSession, 'id' | 'kudos'>; userId: string }) {
  const [kudos, setK] = useState(s.kudos)
  const mine = kudos.some((k) => k.user_id === userId)
  return (
    <button
      type="button"
      aria-pressed={mine}
      aria-label={mine ? 'Togli il tuo 🤙' : 'Dai un 🤙'}
      onClick={async () => {
        const before = kudos
        const next = !mine
        setK(next ? [...kudos, { user_id: userId }] : kudos.filter((k) => k.user_id !== userId))
        try {
          await setKudos(s.id, userId, next)
        } catch {
          setK(before)
        }
      }}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 font-display text-[15px] font-semibold transition ${
        mine ? 'border-[var(--accent-text)] text-ink' : 'border-line text-ink-2 hover:bg-surface-2'
      }`}
    >
      <span aria-hidden>🤙</span>
      <span className="tabular">{kudos.length}</span>
    </button>
  )
}

export function FeedCard({
  s,
  userId,
  settings,
  selected,
  onToggle,
  blocked,
}: {
  s: CloudSession
  userId: string
  settings: Settings
  selected?: boolean
  /** Without it there is no compare box (nobody else on the water at the same time). */
  onToggle?: () => void
  /** Why it cannot join the sessions already ticked. */
  blocked?: string
}) {
  const sum = s.summary
  const name = s.profile?.display_name ?? 'Rider'
  const comments = s.comments[0]?.count ?? 0
  return (
    <li className={`py-3 ${selected ? 'bg-surface-2' : ''}`}>
      <div className="flex items-center gap-2">
        <Link to={`/rider/${s.user_id}`}>
          <Avatar name={name} size={26} />
        </Link>
        <p className="min-w-0 flex-1 truncate font-display text-[17px] leading-tight">
          <Link to={`/rider/${s.user_id}`} className="font-semibold">
            {name}
          </Link>
          <span className="font-medium text-ink-2">
            {' · '}
            {fmtTime(sum.start)}
            {s.spot && (
              <>
                {' · '}
                <Link to={`/spot/${s.spot.id}`} className="underline-offset-2 hover:underline">
                  {s.spot.name}
                </Link>
              </>
            )}
            {s.visibility === 'private' && ' · solo per te'}
          </span>
        </p>
        {onToggle && (
          <label className={`flex shrink-0 flex-col items-center gap-0.5 px-1 text-[11px] text-ink-2 ${blocked ? 'opacity-60' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={!!selected}
              disabled={!!blocked}
              onChange={onToggle}
              className="h-5 w-5 accent-[var(--accent-btn)]"
              aria-label={`Seleziona l'uscita di ${name} per il confronto`}
            />
            {blocked ?? 'confronta'}
          </label>
        )}
      </div>
      <Link to={`/c/${s.id}`} className="mt-2 flex items-center gap-3">
        <SessionLine s={s} windSpeed={s.wind_speed} about="" settings={settings} />
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <KudosButton s={s} userId={userId} />
        <Link
          to={`/c/${s.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-0.5 font-display text-[15px] font-semibold text-ink-2 hover:bg-surface-2"
          aria-label={`${comments} commenti`}
        >
          <IconComment width={16} height={16} />
          <span className="tabular">{comments}</span>
        </Link>
      </div>
    </li>
  )
}
