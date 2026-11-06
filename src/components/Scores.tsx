import { sessionScores, type SessionScores } from '../lib/analysis/scores'
import type { SessionPerf, SessionSummary } from '../lib/types'
import { fmtDist, fmtDuration, fmtPct, fmtSpeed, SPEED_SHORT } from '../lib/units'
import type { Settings } from '../lib/settings'
import { TrackThumb } from './TrackThumb'
import { instrumentLabel } from './ui'

/** The big overall number with a bar for each part, as on an instrument's display. */
export function ScorePanel({ scores, caption }: { scores: SessionScores; caption: string }) {
  const parts = [
    { label: 'Bolina', value: scores.up },
    { label: 'Poppa', value: scores.down },
    { label: 'Virate', value: scores.tack },
    { label: 'Strambate', value: scores.jibe },
  ]
  return (
    <div className="border-y border-line py-2.5 lg:max-w-md">
      <p className={instrumentLabel}>{caption}</p>
      <div className="flex items-center gap-4">
        <p className={`font-display text-[96px] leading-[.95] font-bold tabular ${scores.overall == null ? 'text-muted' : 'text-score'}`}>{scores.overall ?? '–'}</p>
        <dl className="min-w-0 flex-1 space-y-1.5 font-display text-[15px] font-semibold">
          {parts.map((p) => (
            <div key={p.label}>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-ink-2">{p.label}</dt>
                <dd className="tabular">{p.value ?? '–'}</dd>
              </div>
              <div className="mt-0.5 h-[3px] bg-[var(--bar-track)]">
                <div className="h-[3px] bg-[var(--bar)]" style={{ width: `${p.value ?? 0}%` }} />
              </div>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

/** The scores on a session's page; nothing without a wind direction or with too little sailing to score. */
export function ScoreCard({ perf, windSpeed }: { perf: SessionPerf | null | undefined; windSpeed: number | null | undefined }) {
  const scores = sessionScores(perf, windSpeed)
  if (!scores) return null
  return (
    <div className="space-y-1.5">
      <ScorePanel scores={scores} caption="Overall" />
      {windSpeed == null && <p className="text-xs text-ink-2">Vento in acqua non inserito: calcolato come vento medio.</p>}
    </div>
  )
}

/** A session in a list: its mini map, what it was, and its overall score. Goes inside a link. */
export function SessionLine({
  s,
  windSpeed,
  about,
  settings,
}: {
  s: { title: string; preview: [number, number][]; summary: SessionSummary }
  windSpeed: number | null | undefined
  /** The line under the title. */
  about: string
  settings: Settings
}) {
  const sum = s.summary
  const score = sessionScores(sum.perf, windSpeed)?.overall
  const stats = [
    fmtDist(sum.distance, settings.distUnit),
    fmtDuration(sum.duration),
    `max ${fmtSpeed(sum.records.s2, settings.speedUnit)} ${SPEED_SHORT[settings.speedUnit]}`,
    `${fmtPct(sum.foilShare)} foil`,
  ]
  return (
    <>
      <TrackThumb points={s.preview} className="h-11 w-[68px] shrink-0" />
      <span className="block min-w-0 flex-1">
        <span className="block truncate font-display text-[19px] leading-tight font-semibold">{s.title.replace(/^Uscita del /, '')}</span>
        {about && <span className="block truncate text-sm leading-tight text-ink-2">{about}</span>}
        <span className="mt-0.5 flex flex-wrap gap-x-2.5 font-display text-[15px] leading-tight font-medium text-ink-2 tabular">
          {stats.map((stat) => (
            <span key={stat} className="whitespace-nowrap">
              {stat}
            </span>
          ))}
        </span>
      </span>
      {score != null && (
        <span className="shrink-0 font-display text-[34px] leading-none font-bold text-score tabular">
          <span className="sr-only">Punteggio </span>
          {score}
        </span>
      )}
    </>
  )
}
