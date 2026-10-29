import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { sessionsBetween, type CloudSession } from '../lib/cloud'
import { dayKey, dayRange } from '../lib/crewStats'
import { useLibrary } from '../lib/library'
import { sharedTime, together, type Span } from '../lib/together'
import { fmtTime } from '../lib/units'
import { IconCompare } from './icons'

/** Sessions on one map at most, this one included (the compare page's limit). */
const MAX = 4

/**
 * Who else was on the water at the same time, from the crew and from this device, with a link that
 * overlays the tracks. Nothing when the session was sailed alone: comparing needs riders together.
 */
export function TogetherBanner({ id, start, end }: { id: string; start: number; end: number }) {
  const { sessions } = useLibrary()
  const { user } = useAuth()
  const [crew, setCrew] = useState<CloudSession[]>([])
  const userId = user?.id

  useEffect(() => {
    if (!userId) {
      setCrew([])
      return
    }
    let alive = true
    const [from, to] = dayRange(dayKey(start))
    sessionsBetween(from, to)
      .then((rows) => alive && setCrew(rows))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [userId, start])

  const me: Span = { start, end }
  const others = [
    ...crew.map((r) => ({ id: `c:${r.id}`, name: r.profile?.display_name ?? 'Rider', start: Date.parse(r.started_at), end: Date.parse(r.ended_at) })),
    ...(sessions ?? []).filter((s) => !s.cloudId).map((s) => ({ id: s.id, name: s.rider, start: s.summary.start, end: s.summary.end })),
  ].filter((o) => o.id !== id && together([me, o]))
  // Longest together first, keeping only riders all on the water at once with this session.
  const chosen: typeof others = []
  for (const o of others.sort((a, b) => sharedTime([me, b]) - sharedTime([me, a]))) {
    if (chosen.length < MAX - 1 && together([me, ...chosen, o])) chosen.push(o)
  }
  if (!chosen.length) return null

  return (
    <Link
      to={`/confronta?ids=${[id, ...chosen.map((o) => o.id)].join(',')}`}
      className="mt-2.5 flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm transition hover:brightness-[.97]"
    >
      <IconCompare width={20} height={20} className="shrink-0 text-ink-2" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-ink-2">In acqua nello stesso momento</span>
        <span className="block truncate font-medium">
          {chosen.map((o) => `${o.name} (${fmtTime(o.start)}–${fmtTime(o.end)})`).join(', ')}
        </span>
      </span>
      <span className="shrink-0 font-semibold text-accent">Sovrapponi →</span>
    </Link>
  )
}
