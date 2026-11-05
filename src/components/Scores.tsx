import { sessionScores } from '../lib/analysis/scores'
import type { SessionPerf, SessionSummary } from '../lib/types'
import { TrackThumb } from './TrackThumb'
import { card } from './ui'

/** The scores of a session; nothing without a wind direction or with too little sailing to score. */
export function ScoreCard({ perf, windSpeed }: { perf: SessionPerf | null | undefined; windSpeed: number | null | undefined }) {
  const s = sessionScores(perf, windSpeed)
  if (!s) return null
  const parts = [
    { label: 'Bolina', value: s.up },
    { label: 'Poppa', value: s.down },
    { label: 'Virate', value: s.tack },
    { label: 'Strambate', value: s.jibe },
  ]
  return (
    <div className={`${card} space-y-2 p-3 lg:max-w-md`}>
      <dl className="flex items-center gap-3">
        <div className="flex shrink-0 flex-col-reverse border-r border-line pr-3 text-center">
          <dt className="mt-1 text-xs text-ink-2">Overall</dt>
          <dd className="text-[34px] leading-none font-semibold tabular">{s.overall ?? '–'}</dd>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-4 gap-1 text-center">
          {parts.map((p) => (
            <div key={p.label} className="flex min-w-0 flex-col-reverse">
              <dt className="mt-0.5 truncate text-[11px] text-ink-2">{p.label}</dt>
              <dd className="text-xl leading-tight font-semibold tabular">{p.value ?? '–'}</dd>
            </div>
          ))}
        </div>
      </dl>
      {windSpeed == null && <p className="text-xs text-ink-2">Vento in acqua non inserito: calcolato come vento medio.</p>}
    </div>
  )
}

/** The mini map of a session in a list, with its overall score on a corner. */
export function ScoredThumb({ s, windSpeed }: { s: { preview: [number, number][]; summary: SessionSummary }; windSpeed: number | null | undefined }) {
  const score = sessionScores(s.summary.perf, windSpeed)?.overall
  return (
    <span className="relative block h-16 w-[100px] shrink-0">
      <TrackThumb points={s.preview} className="h-16 w-[100px]" />
      {score != null && (
        <span className="absolute top-1 right-1 rounded-md bg-surface px-1.5 text-[13px] leading-5 font-semibold tabular">
          <span className="sr-only">Punteggio </span>
          {score}
        </span>
      )}
    </span>
  )
}
