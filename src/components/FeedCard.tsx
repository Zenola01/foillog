import { useState } from 'react'
import { Link } from 'react-router-dom'
import { setKudos, type CloudSession } from '../lib/cloud'
import type { Settings } from '../lib/settings'
import { fmtDist, fmtDuration, fmtPct, fmtSpeed, fmtTime, SPEED_SHORT } from '../lib/units'
import { IconComment } from './icons'
import { Avatar } from './RequireAuth'
import { TrackThumb } from './TrackThumb'
import { card } from './ui'

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
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition ${
        mine ? 'border-[var(--series-1)] bg-surface-2 text-ink' : 'border-line text-ink-2 hover:bg-surface-2'
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
  const u = SPEED_SHORT[settings.speedUnit]
  const comments = s.comments[0]?.count ?? 0
  return (
    <li className={`${card} p-3 ${selected ? 'ring-2 ring-[var(--series-1)]' : ''}`}>
      <div className="flex items-center gap-2.5">
        <Link to={`/rider/${s.user_id}`}>
          <Avatar name={name} />
        </Link>
        <div className="min-w-0 flex-1 text-sm leading-tight">
          <Link to={`/rider/${s.user_id}`} className="font-semibold">
            {name}
          </Link>
          <p className="truncate text-ink-2">
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
          </p>
        </div>
        {onToggle && (
          <label className={`flex shrink-0 flex-col items-center gap-0.5 px-1 text-[11px] text-ink-2 ${blocked ? 'opacity-60' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={!!selected}
              disabled={!!blocked}
              onChange={onToggle}
              className="h-5 w-5 accent-[var(--series-1)]"
              aria-label={`Seleziona l'uscita di ${name} per il confronto`}
            />
            {blocked ?? 'confronta'}
          </label>
        )}
      </div>
      <Link to={`/c/${s.id}`} className="mt-2.5 flex items-center gap-3">
        <TrackThumb points={s.preview} className="h-16 w-[100px] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{s.title}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm">
            <span>{fmtDist(sum.distance, settings.distUnit)}</span>
            <span>{fmtDuration(sum.duration)}</span>
            <span>
              max {fmtSpeed(sum.records.s2, settings.speedUnit)} {u}
            </span>
            <span>{fmtPct(sum.foilShare)} in foil</span>
            {sum.jibes > 0 && (
              <span>
                strambate {sum.jibesFoiled}/{sum.jibes}
              </span>
            )}
          </p>
        </div>
      </Link>
      <div className="mt-2.5 flex items-center gap-2">
        <KudosButton s={s} userId={userId} />
        <Link
          to={`/c/${s.id}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm font-medium text-ink-2 hover:bg-surface-2"
          aria-label={`${comments} commenti`}
        >
          <IconComment width={16} height={16} />
          <span className="tabular">{comments}</span>
        </Link>
      </div>
    </li>
  )
}
