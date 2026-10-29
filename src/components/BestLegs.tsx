import type { ReactNode } from 'react'
import { bestLegs, DOWNWIND_MIN, MIN_LEG_SECONDS, UPWIND_MAX, type BestLegs, type Course, type LegAverages } from '../lib/analysis/bestLegs'
import { useSettings, type Settings } from '../lib/settings'
import type { Leg } from '../lib/types'
import { fmtDuration, fmtSpeed, SPEED_SHORT } from '../lib/units'
import { btnSecondary, card, LineKey, Segmented, StatTile } from './ui'

const SHARES = [
  { value: 1, label: 'Tutti' },
  { value: 0.5, label: 'Top 50%' },
  { value: 0.2, label: 'Top 20%' },
  { value: 0.1, label: 'Top 10%' },
]

const COURSE: Record<Course, string> = { up: 'Bolina', down: 'Poppa' }
const deg = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v)}°`)
const legsWord = (n: number) => (n === 1 ? 'bordo' : 'bordi')

/** Which legs the averages use: all of them, or the best share. The choice is kept in the settings. */
export function TopShareToggle() {
  const { settings, update } = useSettings()
  return <Segmented label="Quali bordi" value={settings.topShare} onChange={(topShare) => update({ topShare })} options={SHARES} />
}

const rule = `Bolina: bordi a meno di ${UPWIND_MAX}° dal vento; poppa: oltre ${DOWNWIND_MIN}°. Contano i bordi di almeno ${MIN_LEG_SECONDS} s, per più di metà in foil, ordinati per VMG.`

/** Session page: averages of the best upwind and downwind legs, with all the legs for reference. */
export function BestLegsCard({ legs, unit, onSetWind }: { legs: Leg[]; unit: Settings['speedUnit']; onSetWind?: () => void }) {
  const { settings } = useSettings()
  const share = settings.topShare
  const u = SPEED_SHORT[unit]
  const sp = (v: number | null | undefined) => fmtSpeed(v, unit)

  if (!legs.some((l) => l.twa != null)) {
    return (
      <div className={`${card} space-y-2 p-4 text-sm`}>
        <p className="text-ink-2">Per i bordi migliori di bolina e poppa serve la direzione del vento.</p>
        {onSetWind && (
          <button type="button" className={btnSecondary} onClick={onSetWind}>
            Imposta il vento
          </button>
        )}
      </div>
    )
  }
  const groups = (['up', 'down'] as const).map((course) => ({ course, best: bestLegs(legs, course, share), all: bestLegs(legs, course, 1) }))
  const ref = (all: BestLegs | null, text: (a: BestLegs) => string) => (share < 1 && all ? `tutti: ${text(all)}` : undefined)
  const sideRow = (label: string, s: LegAverages | null) => (
    <tr key={label} className="border-t border-line">
      <td className="px-3 py-2">{label}</td>
      <td className="px-2 py-2 text-right tabular">{deg(s?.angle)}</td>
      <td className="px-2 py-2 text-right tabular">{sp(s?.speed)}</td>
      <td className="px-2 py-2 text-right tabular">{sp(s?.vmg)}</td>
      <td className="px-3 py-2 text-right tabular">{s ? s.legs : '–'}</td>
    </tr>
  )

  return (
    <div className={`${card} space-y-3 p-3.5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">Bordi migliori</p>
          <p className="text-xs text-ink-2">La media dei bordi con il VMG più alto: gli angoli e le velocità a cui puntare.</p>
        </div>
        <TopShareToggle />
      </div>

      {groups.map(({ course, best, all }) => (
        <section key={course} className="space-y-1.5" aria-label={COURSE[course]}>
          <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
            <span className="font-semibold">{COURSE[course]}</span>
            <span className="text-xs text-ink-2">
              {best ? `${best.legs} ${legsWord(best.legs)} su ${best.of} · ${fmtDuration(best.seconds)}` : `nessun ${legsWord(1)} in foil`}
            </span>
          </p>
          {best && (
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="VMG" value={sp(best.vmg)} unit={u} sub={ref(all, (a) => sp(a.vmg))} />
              <StatTile label="Velocità" value={sp(best.speed)} unit={u} sub={ref(all, (a) => sp(a.speed))} />
              <StatTile label="Angolo" value={deg(best.angle)} sub={ref(all, (a) => deg(a.angle))} />
            </div>
          )}
        </section>
      ))}

      {groups.some((g) => g.best) && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[400px] text-sm">
            <caption className="px-3 pt-2.5 text-left text-sm font-semibold">Per mure ({u})</caption>
            <thead className="text-xs text-ink-2">
              <tr>
                <th className="px-3 py-2 text-left font-medium" />
                <th className="px-2 py-2 text-right font-medium">Angolo</th>
                <th className="px-2 py-2 text-right font-medium">Velocità</th>
                <th className="px-2 py-2 text-right font-medium">VMG</th>
                <th className="px-3 py-2 text-right font-medium">Bordi</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap(({ course, best }) => [
                sideRow(`${COURSE[course]}, mure a dritta`, best?.byTack.S ?? null),
                sideRow(`${COURSE[course]}, mure a sinistra`, best?.byTack.P ?? null),
              ])}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-2">
        {rule}
        {share < 1 && ' I bordi scelti sono evidenziati sulla mappa e segnati con ★ nella tabella.'}
      </p>
    </div>
  )
}

interface Row {
  label: string
  get: (s: { up: BestLegs | null; down: BestLegs | null }) => number | null
  fmt: (v: number | null) => ReactNode
  better?: 'max'
}

/** Compare page: each rider's best legs side by side. */
export function BestLegsCompare({
  riders,
  unit,
  sharedWind,
}: {
  riders: { id: string; name: string; color: string; legs: Leg[] }[]
  unit: Settings['speedUnit']
  /** True when the legs were measured against one wind for everybody. */
  sharedWind: boolean
}) {
  const { settings } = useSettings()
  const share = settings.topShare
  const u = SPEED_SHORT[unit]
  const sp = (v: number | null) => fmtSpeed(v, unit)
  const stats = riders.map((r) => ({ up: bestLegs(r.legs, 'up', share), down: bestLegs(r.legs, 'down', share) }))
  if (stats.every((s) => !s.up && !s.down)) return null
  const count = (b: BestLegs | null) => (b ? `${b.legs}/${b.of}` : '–')
  const rows: Row[] = [
    { label: 'Bolina · VMG', get: (s) => s.up?.vmg ?? null, fmt: sp, better: 'max' },
    { label: 'Bolina · velocità', get: (s) => s.up?.speed ?? null, fmt: sp, better: 'max' },
    { label: 'Bolina · angolo', get: (s) => s.up?.angle ?? null, fmt: deg },
    { label: 'Poppa · VMG', get: (s) => s.down?.vmg ?? null, fmt: sp, better: 'max' },
    { label: 'Poppa · velocità', get: (s) => s.down?.speed ?? null, fmt: sp, better: 'max' },
    { label: 'Poppa · angolo', get: (s) => s.down?.angle ?? null, fmt: deg },
  ]

  return (
    <div className={`${card} overflow-x-auto`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <p className="text-sm font-semibold">Bordi migliori a confronto ({u})</p>
        <TopShareToggle />
      </div>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr className="text-xs text-ink-2">
            <th className="px-3 py-2 text-left font-medium" />
            {riders.map((r) => (
              <th key={r.id} className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <LineKey color={r.color} />
                  <span className="max-w-[7rem] truncate text-ink">{r.name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const vals = stats.map(m.get)
            const finite = vals.filter((v): v is number => v != null && Number.isFinite(v))
            const best = m.better && finite.length > 1 ? Math.max(...finite) : null
            const unique = best != null && finite.filter((v) => v === best).length === 1
            return (
              <tr key={m.label} className="border-t border-line">
                <td className="px-3 py-2 text-ink-2">{m.label}</td>
                {vals.map((v, k) => (
                  <td key={k} className={`px-2 py-2 text-right tabular ${unique && v === best ? 'font-semibold text-ink' : ''}`}>
                    {m.fmt(v)}
                    {unique && v === best && <span className="sr-only"> (migliore)</span>}
                  </td>
                ))}
              </tr>
            )
          })}
          <tr className="border-t border-line">
            <td className="px-3 py-2 text-ink-2">Bordi bolina · poppa</td>
            {stats.map((s, k) => (
              <td key={k} className="px-2 py-2 text-right whitespace-nowrap tabular">
                {count(s.up)} · {count(s.down)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="px-3 pt-1 pb-3 text-xs text-ink-2">
        {share < 1 ? `Media del top ${Math.round(share * 100)}% dei bordi di ognuno. ` : 'Media di tutti i bordi. '}
        {rule}
        {sharedWind && ' Eravate in acqua insieme: angoli e VMG usano lo stesso vento per tutti.'} In grassetto il valore migliore.
      </p>
    </div>
  )
}
