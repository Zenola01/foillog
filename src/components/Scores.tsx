import { sessionScores, type SessionScores } from '../lib/analysis/scores'
import { useCountUp, useSeen } from '../lib/motion'
import type { Settings } from '../lib/settings'
import type { SessionPerf, SessionSummary } from '../lib/types'
import { fmtDist, fmtDuration, fmtPct, fmtSpeed, SPEED_SHORT } from '../lib/units'
import { TrackThumb } from './TrackThumb'
import { instrumentLabel, LedBar } from './ui'

const TICKS = 50
/** One mark of the dial, in a 100×100 box: the k-th along a sweep from half past seven to half past four. */
const tick = (k: number, inner: number) => {
  const a = ((135 + (k / TICKS) * 270) * Math.PI) / 180
  const at = (r: number) => `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`
  return `M${at(inner)}L${at(47)}`
}
const MARKS = Array.from({ length: TICKS + 1 }, (_, k) => tick(k, k % 10 === 0 ? 37 : 40))
const ALL_MARKS = MARKS.join('')

/** The overall score as a rev counter: its marks light up to the number climbing in the middle. */
export function ScoreDial({ value, size, run }: { value: number | null; size: number; run: boolean }) {
  const shown = useCountUp(value ?? 0, run)
  const lit = Math.round((shown / 100) * TICKS)
  return (
    <span
      role="img"
      aria-label={value == null ? 'Punteggio overall non disponibile' : `Punteggio overall ${value} su 100`}
      className="relative block shrink-0"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="size-full" fill="none" strokeWidth="2.2" aria-hidden="true">
        <path d={ALL_MARKS} stroke="var(--bar-track)" />
        {value != null && <path d={MARKS.slice(0, lit + 1).join('')} stroke="var(--bar)" />}
        {value != null && run && <path d={tick(lit, 36)} stroke="var(--ink)" strokeWidth="2.8" />}
      </svg>
      <span aria-hidden className={`big-number absolute inset-0 flex items-center justify-center pb-[5%] ${value == null ? 'text-muted' : ''}`} style={{ fontSize: size * 0.42 }}>
        {value == null ? '–' : shown}
      </span>
      <span aria-hidden className="absolute inset-x-0 bottom-[5%] text-center font-display text-[14px] font-semibold text-ink-2">
        Overall
      </span>
    </span>
  )
}

/** The parts of a score, each with a row of segments lighting up one after the other. */
function ScoreParts({ scores, className }: { scores: SessionScores; className: string }) {
  const parts = [
    { label: 'Bolina', value: scores.up },
    { label: 'Poppa', value: scores.down },
    { label: 'Virate', value: scores.tack },
    { label: 'Strambate', value: scores.jibe },
  ]
  return (
    <dl className={`font-display text-[17px] leading-tight font-semibold ${className}`}>
      {parts.map((p, k) => (
        <div key={p.label}>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="truncate text-ink-2">{p.label}</dt>
            <dd className="tabular">{p.value ?? '–'}</dd>
          </div>
          <LedBar value={p.value ?? 0} delay={k * 90} className="mt-1" />
        </div>
      ))}
    </dl>
  )
}

/** A session's scores with its track turned to the wind: the head of the list. */
export function ScoreHero({ scores, caption, track, windDir }: { scores: SessionScores; caption: string; track: [number, number][]; windDir: number | null | undefined }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  return (
    <div ref={ref} className="rounded-3xl bg-surface p-4">
      <p className={instrumentLabel}>{caption}</p>
      <div className="mt-1 flex items-center gap-2">
        <ScoreDial value={scores.overall} size={152} run={seen} />
        <TrackThumb points={track} windDir={windDir} box={[100, 100]} draw={seen} runner weight={0.9} className="h-[152px] min-w-0 flex-1" />
      </div>
      <ScoreParts scores={scores} className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5" />
    </div>
  )
}

/** The scores on a session's page; nothing without a wind direction or with too little sailing to score. */
export function ScoreCard({ perf, windSpeed }: { perf: SessionPerf | null | undefined; windSpeed: number | null | undefined }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const scores = sessionScores(perf, windSpeed)
  if (!scores) return null
  return (
    <div className="space-y-1.5">
      <div ref={ref} className="flex items-center gap-4 rounded-3xl bg-surface p-4">
        <ScoreDial value={scores.overall} size={132} run={seen} />
        <ScoreParts scores={scores} className="min-w-0 flex-1 space-y-2" />
      </div>
      {windSpeed == null && <p className="px-1 text-xs text-ink-2">Vento in acqua non inserito: calcolato come vento medio.</p>}
    </div>
  )
}

/** A number climbing on its own, so that the rest of the row is not drawn again at every step. */
function Climbing({ to, run }: { to: number; run: boolean }) {
  return <>{useCountUp(to, run)}</>
}

/** A session in a list: its track turned to the wind and drawing itself, what it was, and its overall score. Goes inside a link. */
export function SessionLine({
  s,
  windSpeed,
  about,
  settings,
  heading,
}: {
  s: { title: string; preview: [number, number][]; summary: SessionSummary }
  windSpeed: number | null | undefined
  /** The line under the title. */
  about: string
  settings: Settings
  /** Instead of the title; empty for no first line at all. */
  heading?: string
}) {
  const [ref, seen] = useSeen<HTMLSpanElement>()
  const sum = s.summary
  const score = sessionScores(sum.perf, windSpeed)?.overall
  const title = heading ?? s.title.replace(/^Uscita del /, '')
  const stats = [
    `max ${fmtSpeed(sum.records.s2, settings.speedUnit)} ${SPEED_SHORT[settings.speedUnit]}`,
    fmtDist(sum.distance, settings.distUnit),
    fmtDuration(sum.duration),
    `${fmtPct(sum.foilShare)} foil`,
  ]
  return (
    <>
      <span ref={ref} className="block h-[84px] w-[92px] shrink-0 rounded-2xl bg-surface">
        <TrackThumb points={s.preview} windDir={sum.windDir} box={[92, 84]} draw={seen} weight={1.3} className="size-full" />
      </span>
      <span className="block min-w-0 flex-1">
        {title && <span className="block truncate font-display text-[20px] leading-tight font-semibold">{title}</span>}
        {about && <span className="block truncate text-sm leading-tight text-ink-2">{about}</span>}
        <span className="mt-1 flex flex-wrap gap-x-3 font-display text-[15px] leading-[1.2] font-medium text-ink-2 tabular">
          {stats.map((stat, k) => (
            <span key={stat} className={`whitespace-nowrap ${k % 2 ? '' : 'min-w-[4.5rem]'}`}>
              {stat}
            </span>
          ))}
        </span>
      </span>
      {score != null && (
        <span className="big-number shrink-0 text-[40px]">
          <span className="sr-only">Punteggio </span>
          <Climbing to={score} run={seen} />
        </span>
      )}
    </>
  )
}
