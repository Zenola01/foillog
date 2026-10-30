import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Course } from '../lib/analysis/pointsOfSail'
import { polarOption } from '../lib/charts'
import type { PastSession } from '../lib/history'
import {
  bandName,
  bandOfSpeed,
  bandRange,
  bandText,
  bestPolar,
  bestVmg,
  comparePolar,
  isPolarBand,
  MIN_SECTOR_SECONDS,
  parseWind,
  WIND_BANDS,
  windText,
  windValue,
  type BestBin,
  type PolarBand,
  type PolarComparison,
} from '../lib/polars'
import type { ThemeColors } from '../lib/theme'
import type { PolarBin, WindBand } from '../lib/types'
import { fmtNum, fmtPct, fmtShortDate, fmtSpeed, MS_TO_KN, SPEED_SHORT, toUnit, type SpeedUnit } from '../lib/units'
import { EChart } from './EChart'
import { btnGhost, btnPrimary, btnSecondary, card, Segmented, StatTile } from './ui'

const COURSE: Record<Course, string> = { up: 'Bolina', reach: 'Traverso', down: 'Poppa' }
const calmBelow = (unit: SpeedUnit) => `${fmtNum(toUnit(WIND_BANDS[0].fromKn / MS_TO_KN, unit), unit === 'ms' ? 1 : 0)} ${SPEED_SHORT[unit]}`

/** Whose best a session is compared with, in the words each sentence needs. */
export interface Whose {
  /** «Il tuo meglio» */
  title: string
  /** «il tuo meglio» */
  the: string
  /** «del tuo meglio» */
  of: string
  /** «tuo meglio» */
  short: string
}

export const whose = (mine: boolean, rider: string): Whose =>
  mine
    ? { title: 'Il tuo meglio', the: 'il tuo meglio', of: 'del tuo meglio', short: 'tuo meglio' }
    : { title: `Il meglio di ${rider}`, the: `il meglio di ${rider}`, of: `del meglio di ${rider}`, short: `meglio di ${rider}` }

export interface VsBest {
  band: PolarBand
  best: BestBin[]
  cmp: PolarComparison | null
  vmg: ReturnType<typeof bestVmg>
  /** Other sessions in the same wind with a polar. */
  count: number
}

/** A session against the best of the rider's other sessions in the same wind; null until those are known. */
export function useVsBest(polar: PolarBin[] | null, band: WindBand | null, others: PastSession[] | null): VsBest | null {
  return useMemo(() => {
    if (!isPolarBand(band) || !others) return null
    const best = bestPolar(others, band)
    return {
      band,
      best,
      cmp: polar && best.length ? comparePolar(polar, best) : null,
      vmg: bestVmg(others, band),
      count: others.filter((o) => o.band === band && o.polar?.length).length,
    }
  }, [polar, band, others])
}

/** «(fascia 12–18 kn)», «(sotto 7 kn)» */
export const bandNote = (band: WindBand, unit: SpeedUnit) => `(${band === 'calm' ? '' : 'fascia '}${bandRange(band, unit)} ${SPEED_SHORT[unit]})`

/**
 * The mean wind on the water, typed in by the rider: it picks the best polar a session is
 * compared with. The weather model is shown beside it, never used in its place.
 */
export function WindSpeedField({
  speed,
  unit,
  editing,
  onEdit,
  onClose,
  onSave,
}: {
  speed: number | null | undefined
  unit: SpeedUnit
  editing: boolean
  /** Absent on a crewmate's session. */
  onEdit?: () => void
  onClose: () => void
  onSave: (ms: number | null) => Promise<void>
}) {
  const band = bandOfSpeed(speed)
  if (editing) {
    return (
      <WindSpeedForm
        initial={speed ?? null}
        unit={unit}
        onCancel={onClose}
        onSave={async (ms) => {
          await onSave(ms)
          onClose()
        }}
      />
    )
  }
  return (
    <div className="flex items-center gap-3">
      <p className="min-w-0 flex-1 text-sm">
        <span className="text-ink-2">Vento in acqua: </span>
        {speed != null && band ? (
          <>
            <b>{windText(speed, unit)}</b> <span className="text-ink-2">{bandNote(band, unit)}</span>
          </>
        ) : (
          <span className="text-ink-2">non inserito</span>
        )}
      </p>
      {onEdit && (
        <button type="button" className={btnGhost} onClick={onEdit}>
          {speed != null ? 'Cambia' : 'Inserisci'}
        </button>
      )}
    </div>
  )
}

function WindSpeedForm({
  initial,
  unit,
  onCancel,
  onSave,
}: {
  initial: number | null
  unit: SpeedUnit
  onCancel: () => void
  onSave: (ms: number | null) => Promise<void>
}) {
  const u = SPEED_SHORT[unit]
  const [text, setText] = useState(initial != null ? windValue(initial, unit) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ms = parseWind(text, unit)
  const save = async (v: number | null) => {
    setBusy(true)
    setError(null)
    try {
      await onSave(v)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-2 rounded-xl bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ms != null) void save(ms)
      }}
    >
      <label className="block text-sm">
        <span className="font-semibold">Vento medio in acqua</span>
        <span className="block text-xs text-ink-2">
          Decide con quali uscite si confronta la polare:{' '}
          {WIND_BANDS.map((b) => `${b.short.toLowerCase()} ${bandRange(b.id, unit)}`).join(', ')} {u}. Sotto {calmBelow(unit)} resta fuori.
        </span>
        <span className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="decimal"
            placeholder="es. 15"
            aria-label={`Vento medio in acqua (${u})`}
            className="w-24 rounded-lg border border-line bg-surface px-3 py-2 text-base"
          />
          <span className="text-ink-2">{u}</span>
        </span>
      </label>
      {text.trim() !== '' && ms == null && <p className="text-xs text-critical">Scrivi un numero, per esempio 15.</p>}
      {error && <p className="text-sm text-critical">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={ms == null || busy}>
          Salva
        </button>
        <button type="button" className={btnSecondary} disabled={busy} onClick={onCancel}>
          Annulla
        </button>
        {initial != null && (
          <button type="button" className={btnGhost} disabled={busy} onClick={() => void save(null)}>
            Togli
          </button>
        )}
      </div>
    </form>
  )
}

/** Under the session's polar: how close it came to the best, course by course. */
export function VsBestSummary({
  vs,
  band,
  who,
  unit,
  onEditWind,
}: {
  vs: VsBest | null
  band: WindBand | null
  who: Whose
  unit: SpeedUnit
  /** Opens the wind input; absent on a crewmate's session. */
  onEditWind?: () => void
}) {
  const note = (text: ReactNode) => <p className="border-t border-line pt-3 text-sm text-ink-2">{text}</p>
  if (band === 'calm') return note(`Sotto i ${calmBelow(unit)} le uscite restano fuori dalle polari migliori.`)
  if (!isPolarBand(band)) {
    if (!onEditWind) return note('Manca il vento medio in acqua: senza, questa polare non si confronta.')
    return (
      <div className="space-y-2 border-t border-line pt-3">
        <p className="text-sm text-ink-2">Inserisci il vento medio che c’era in acqua: serve per confrontare questa polare con {who.the}.</p>
        <button type="button" className={btnSecondary} onClick={onEditWind}>
          Inserisci il vento
        </button>
      </div>
    )
  }
  if (!vs) return note('Carico le altre uscite…')
  if (!vs.best.length) return note(`Nessun’altra uscita con ${bandText(band, unit)}: questa farà da riferimento per le prossime.`)
  if (!vs.cmp) {
    return note(
      `Troppo pochi tratti in foil agli stessi angoli ${who.of} per un confronto: servono almeno ${MIN_SECTOR_SECONDS} secondi per angolo.`,
    )
  }
  const { cmp } = vs
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-sm">
        In tutto <b>{fmtPct(cmp.overall.ratio)}</b> {who.of} con {bandText(band, unit)}.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {(['up', 'reach', 'down'] as const).map((c) => (
          <StatTile key={c} label={COURSE[c]} value={cmp.byCourse[c] ? fmtPct(cmp.byCourse[c]!.ratio) : '–'} sub={cmp.byCourse[c] ? who.of : 'non confrontabile'} />
        ))}
      </div>
      <p className="text-xs text-ink-2">
        Angolo per angolo, la velocità di questa uscita rispetto {vs.count === 1 ? 'all’altra uscita' : `alla migliore delle altre ${vs.count} uscite`} con{' '}
        {bandName(band).toLowerCase()} (linea tratteggiata).
        {cmp.faster > 0 && ` Più veloce ${who.of} in ${cmp.faster === 1 ? '1 angolo' : `${cmp.faster} angoli`} su ${cmp.sectors}.`}
      </p>
    </div>
  )
}

/** Records page: the best polar of a rider, one wind strength at a time. */
export function BestPolarsCard({
  sessions,
  unit,
  colors,
  footer,
}: {
  sessions: PastSession[]
  unit: SpeedUnit
  colors: ThemeColors
  /** Extra notes (sessions to analyse again…). */
  footer?: ReactNode
}) {
  const u = SPEED_SHORT[unit]
  const counts = useMemo(() => {
    const c: Record<PolarBand, number> = { light: 0, medium: 0, strong: 0 }
    for (const s of sessions) if (isPolarBand(s.band) && s.polar?.length) c[s.band]++
    return c
  }, [sessions])
  const [picked, setPicked] = useState<PolarBand | null>(null)
  // Until the rider picks one, the wind they sail most.
  const band = picked ?? WIND_BANDS.reduce<PolarBand>((x, b) => (counts[b.id] > counts[x] ? b.id : x), 'medium')
  const best = useMemo(() => bestPolar(sessions, band), [sessions, band])
  const vmg = useMemo(() => bestVmg(sessions, band), [sessions, band])
  const option = useMemo(
    () =>
      best.length
        ? polarOption([{ name: 'Polare migliore', color: colors.series[0], bins: best.map((b) => ({ ...b, note: fmtShortDate(b.from.start) })) }], unit, colors)
        : null,
    [best, unit, colors],
  )
  // The sessions the best sectors come from, the one holding most first.
  const holders = useMemo(() => {
    const m = new Map<string, { id: string; start: number; n: number }>()
    for (const b of best) m.set(b.from.id, { ...b.from, n: (m.get(b.from.id)?.n ?? 0) + 1 })
    return [...m.values()].sort((a, b) => b.n - a.n)
  }, [best])
  const calm = sessions.filter((s) => s.band === 'calm').length
  const date = (h: { id: string; start: number }) => (
    <Link key={h.id} to={`/c/${h.id}`} className="font-medium text-accent">
      {fmtShortDate(h.start)}
    </Link>
  )

  return (
    <div className={`${card} space-y-3 p-3`}>
      <div>
        <p className="text-sm font-semibold">Polari migliori</p>
        <p className="text-xs text-ink-2">
          Per ogni angolo dal vento, la velocità migliore in foil (90° percentile, {u}) tra le uscite con lo stesso vento. Vento dall’alto.
        </p>
      </div>
      <Segmented label="Intensità del vento" value={band} onChange={setPicked} options={WIND_BANDS.map((b) => ({ value: b.id, label: b.short }))} />
      <p className="text-sm">
        {bandName(band)}, {bandRange(band, unit)} {u}: {counts[band] === 0 ? 'nessuna uscita' : counts[band] === 1 ? '1 uscita' : `${counts[band]} uscite`}
      </p>
      {option ? (
        <>
          <EChart option={option} height={320} label={`Polare migliore con ${bandName(band).toLowerCase()}`} />
          <p className="flex justify-between px-2 text-xs text-ink-2">
            <span>← mure a sinistra</span>
            <span>mure a dritta →</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Miglior VMG in bolina" value={fmtSpeed(vmg.up?.v, unit)} unit={u} sub={vmg.up ? date(vmg.up) : 'media su 10 s'} />
            <StatTile label="Miglior VMG in poppa" value={fmtSpeed(vmg.down?.v, unit)} unit={u} sub={vmg.down ? date(vmg.down) : 'media su 10 s'} />
          </div>
          <p className="text-xs text-ink-2">
            {holders.length === 1 ? 'Tutti gli angoli vengono da un’uscita: ' : 'Gli angoli migliori vengono da: '}
            {holders.slice(0, 4).map((h, k) => (
              <span key={h.id}>
                {k > 0 && ', '}
                {date(h)} ({h.n})
              </span>
            ))}
            {holders.length > 4 && ` e altre ${holders.length - 4} uscite`}. Tocca un punto per la data.
          </p>
        </>
      ) : (
        counts[band] > 0 && (
          <p className="text-sm text-ink-2">
            Ancora nessuna polare con {bandName(band).toLowerCase()}: servono tratti in foil di almeno {MIN_SECTOR_SECONDS} secondi allo stesso angolo dal vento.
          </p>
        )
      )}
      {calm > 0 && <p className="text-xs text-ink-2">{calm === 1 ? 'Un’uscita sotto' : `${calm} uscite sotto`} i {calmBelow(unit)} restano fuori.</p>}
      {footer}
    </div>
  )
}
