import { sessionScores, type SessionScores } from '../lib/analysis/scores'
import { useCountUp, useSeen } from '../lib/motion'
import type { Settings } from '../lib/settings'
import type { SessionPerf, SessionSummary } from '../lib/types'
import { fmtDist, fmtDuration, fmtPct, fmtSpeed, SPEED_SHORT } from '../lib/units'
import { TrackThumb } from './TrackThumb'
import { instrumentLabel } from './ui'

/** A score as a ring that fills, with its number climbing in the middle. */
export function ScoreGauge({ value, size, run }: { value: number | null; size: number; run: boolean }) {
  const shown = useCountUp(value ?? 0, run)
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--bar-track)" strokeWidth="9" />
        {value != null && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="var(--bar)"
            strokeWidth="9"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${run ? value : 0} 100`}
            className="ring-fill"
          />
        )}
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-display font-bold tabular ${value == null ? 'text-muted' : 'text-score'}`} style={{ fontSize: size * 0.4 }}>
        {value == null ? '–' : shown}
      </span>
    </span>
  )
}

/** The scores of a session: the overall in a ring, a bar for each part; over its own track if given. */
export function ScorePanel({ scores, caption, track }: { scores: SessionScores; caption: string; track?: [number, number][] }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const parts = [
    { label: 'Bolina', value: scores.up },
    { label: 'Poppa', value: scores.down },
    { label: 'Virate', value: scores.tack },
    { label: 'Strambate', value: scores.jibe },
  ]
  return (
    <div ref={ref} className="relative overflow-hidden rounded-3xl border border-line bg-surface p-4 lg:max-w-xl">
      <div aria-hidden className="score-glow" />
      <div className="relative flex items-start justify-between gap-3">
        <p className={`whitespace-nowrap ${instrumentLabel}`}>{caption}</p>
        {track && <TrackThumb points={track} draw={seen} runner fade={0.75} weight={0.7} className="h-24 w-1/2 shrink-0" />}
      </div>
      <div className={`relative flex items-center gap-4 ${track ? 'mt-1' : 'mt-2.5'}`}>
        <ScoreGauge value={scores.overall} size={122} run={seen} />
        <dl className="min-w-0 flex-1 space-y-2 font-display text-[16px] font-semibold">
          {parts.map((p, k) => (
            <div key={p.label}>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-ink-2">{p.label}</dt>
                <dd className="tabular">{p.value ?? '–'}</dd>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bar-track)]">
                <div
                  className="bar-fill h-full rounded-full bg-[var(--bar)]"
                  style={{ width: `${p.value ?? 0}%`, animationDelay: `${k * 90}ms`, animationPlayState: seen ? 'running' : 'paused' }}
                />
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
      <ScorePanel scores={scores} caption="Punteggio" />
      {windSpeed == null && <p className="px-1 text-xs text-ink-2">Vento in acqua non inserito: calcolato come vento medio.</p>}
    </div>
  )
}

/** A session in a list: its mini map drawing itself, what it was, and its overall score. Goes inside a link. */
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
  const [ref, seen] = useSeen<HTMLSpanElement>()
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
      <span ref={ref} className="block h-12 w-[72px] shrink-0">
        <TrackThumb points={s.preview} draw={seen} className="size-full" />
      </span>
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
        <span className="shrink-0">
          <span className="sr-only">Punteggio </span>
          <ScoreGauge value={score} size={54} run={seen} />
        </span>
      )}
    </>
  )
}
