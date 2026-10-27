import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useConfirm } from '../components/Confirm'
import { EChart, type Chart } from '../components/EChart'
import { IconBack, IconEdit, IconTrash } from '../components/icons'
import { MapView, type MapTrack } from '../components/MapView'
import { ReplayBar, useReplay } from '../components/ReplayBar'
import { btnGhost, btnPrimary, btnSecondary, card, Outcome, StatTile } from '../components/ui'
import { WindDial } from '../components/WindDial'
import { rangeStats } from '../lib/analysis/analyze'
import { indexAtTime } from '../lib/analysis/series'
import { heartRateOption, histogramOption, orientationOption, polarOption, speedOption } from '../lib/charts'
import { analyzeInWorker } from '../lib/engine'
import { norm360 } from '../lib/geo'
import { useLibrary } from '../lib/library'
import { useSettings, type Settings } from '../lib/settings'
import { getSessionData, type SessionData, type SessionRecord } from '../lib/store'
import { isCoarsePointer, useTheme, type ThemeColors } from '../lib/theme'
import type { Maneuver, SessionAnalysis, SideStats, WindSource } from '../lib/types'
import {
  compass,
  fmtDate,
  fmtDist,
  fmtDuration,
  fmtNum,
  fmtPct,
  fmtSpeed,
  fmtTime,
  fmtTimeSec,
  SPEED_SHORT,
} from '../lib/units'

type Tab = 'grafici' | 'manovre' | 'andature' | 'bordi'
const TABS: { id: Tab; label: string }[] = [
  { id: 'grafici', label: 'Grafici' },
  { id: 'manovre', label: 'Manovre' },
  { id: 'andature', label: 'Andature' },
  { id: 'bordi', label: 'Bordi' },
]

const WIND_SOURCE: Record<WindSource, string> = {
  manual: 'impostato da te',
  instrument: 'dallo strumento del vento',
  track: 'stimato dalla traccia',
  model: 'dal modello meteo',
  mixed: 'stimato da traccia e meteo',
}

export default function SessionPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { sessions, updateSession, removeSession } = useLibrary()
  const { settings } = useSettings()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const rec = sessions?.find((s) => s.id === id) ?? null
  const [data, setData] = useState<SessionData | null>(null)
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setAnalysis(null)
    setError(null)
    getSessionData(id).then((d) => {
      if (!alive) return
      if (d) setData(d)
      else setError('Non trovo i dati di questa uscita su questo dispositivo.')
    })
    return () => {
      alive = false
    }
  }, [id])

  // Re-run the analysis when the wind or the foil threshold changes; keep the stored summary in step.
  const recRef = useRef(rec)
  recRef.current = rec
  const haveRec = rec != null
  const windOverride = rec?.windOverride ?? null
  const modelDir = rec?.modelWind?.dir ?? null
  useEffect(() => {
    const r = recRef.current
    if (!data || !r) return
    let alive = true
    analyzeInWorker(data.track, data.wind, { foilOnKn: settings.foilOnKn, windOverride: r.windOverride, modelWind: r.modelWind })
      .then((a) => {
        if (!alive) return
        setAnalysis(a)
        const s = r.summary
        const changed =
          r.foilOnKn !== settings.foilOnKn ||
          s.windDir !== a.summary.windDir ||
          s.jibes !== a.summary.jibes ||
          s.tacks !== a.summary.tacks ||
          s.foilTime !== a.summary.foilTime
        if (changed) void updateSession(r.id, { summary: a.summary, foilOnKn: settings.foilOnKn })
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [data, haveRec, windOverride, modelDir, settings.foilOnKn, updateSession])

  if (error) {
    return (
      <div className={`${card} space-y-3 p-5`}>
        <p className="font-semibold">Qualcosa non va</p>
        <p className="text-sm text-ink-2">{error}</p>
        <Link to="/" className={btnSecondary}>
          Torna alle uscite
        </Link>
      </div>
    )
  }
  if (sessions && !rec) {
    return (
      <div className={`${card} space-y-3 p-5`}>
        <p className="font-semibold">Uscita non trovata</p>
        <Link to="/" className={btnSecondary}>
          Torna alle uscite
        </Link>
      </div>
    )
  }
  if (rec?.cloudId) return <Navigate to={`/c/${rec.cloudId}`} replace />
  if (!rec || !data || !analysis) return <p className="py-16 text-center text-ink-2">Analisi in corso…</p>

  return (
    <SessionView
      key={rec.id}
      rec={rec}
      data={data}
      a={analysis}
      settings={settings}
      colors={colors}
      onUpdate={(patch) => updateSession(rec.id, patch)}
      onDelete={async () => {
        if (!(await confirm('Eliminare questa uscita da questo dispositivo?', { confirmLabel: 'Elimina', danger: true }))) return
        await removeSession(rec.id)
        navigate('/')
      }}
    />
  )
}

export function SessionView({
  rec,
  data,
  a,
  settings,
  colors,
  onUpdate,
  onDelete,
  readOnly = false,
  riderEditable = true,
  compareId,
  meta,
  below,
}: {
  rec: SessionRecord
  data: SessionData
  a: SessionAnalysis
  settings: Settings
  colors: ThemeColors
  onUpdate: (patch: Partial<SessionRecord>) => Promise<void>
  onDelete: () => void
  /** A crewmate's session: nothing to edit. */
  readOnly?: boolean
  /** Crew sessions take the rider name from the account. */
  riderEditable?: boolean
  /** Id used by the compare page (crew sessions are prefixed «c:»). */
  compareId?: string
  /** Extra line under the title (spot, visibility…). */
  meta?: ReactNode
  /** Shown after the details (kudos, comments…). */
  below?: ReactNode
}) {
  const tr = data.track
  const n = tr.t.length
  const t0 = tr.t[0]
  const t1 = tr.t[n - 1]
  const sum = a.summary
  const unit = settings.speedUnit
  const u = SPEED_SHORT[unit]
  const sp = (ms: number | null | undefined) => fmtSpeed(ms, unit)
  const coarse = useMemo(isCoarsePointer, [])

  const replay = useReplay(t0, t1)
  const [hoverT, setHoverT] = useState<number | null>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [selMnv, setSelMnv] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('grafici')
  const [windEdit, setWindEdit] = useState(false)
  const [editing, setEditing] = useState(false)

  const cursor = replay.playing ? replay.t : (hoverT ?? (replay.touched ? replay.t : null))

  // Speed chart and its zoom, which doubles as the range selection.
  const chartRef = useRef<Chart | null>(null)
  const rangeRef = useRef(range)
  rangeRef.current = range
  const speed = useMemo(
    () => speedOption({ tr, a, unit, c: colors, foilKn: settings.foilOnKn, coarse }),
    [tr, a, unit, colors, settings.foilOnKn, coarse],
  )
  const zoomTo = (c: Chart, r: [number, number] | null) =>
    c.dispatchAction(r ? { type: 'dataZoom', startValue: r[0], endValue: r[1] } : { type: 'dataZoom', start: 0, end: 100 })
  const onSpeedInit = useCallback((c: Chart) => {
    chartRef.current = c
    c.on('updateAxisPointer', (e: unknown) => {
      const v = (e as { axesInfo?: { value: number }[] }).axesInfo?.[0]?.value
      if (typeof v === 'number') setHoverT(v)
    })
    c.getZr().on('globalout', () => setHoverT(null))
    c.on('datazoom', () => {
      const z = (c.getOption() as { dataZoom?: { start?: number; end?: number; startValue?: number; endValue?: number }[] }).dataZoom?.[0]
      if (!z) return
      const next: [number, number] | null =
        (z.start ?? 0) <= 0.05 && (z.end ?? 100) >= 99.95 ? null : z.startValue != null && z.endValue != null ? [z.startValue, z.endValue] : null
      const cur = rangeRef.current
      const same = (!cur && !next) || (cur && next && Math.abs(cur[0] - next[0]) < 500 && Math.abs(cur[1] - next[1]) < 500)
      if (!same) setRange(next)
    })
  }, [])
  const onSpeedOption = useCallback((c: Chart) => {
    if (rangeRef.current) zoomTo(c, rangeRef.current)
  }, [])
  useEffect(() => () => void (chartRef.current = null), [tab])

  const selectRange = (r: [number, number] | null) => {
    setRange(r)
    if (chartRef.current) zoomTo(chartRef.current, r)
  }
  const focus = (i0: number, i1: number, pad = 8000) => {
    selectRange([Math.max(t0, tr.t[i0] - pad), Math.min(t1, tr.t[i1] + pad)])
    replay.setT(tr.t[i0])
  }
  const pickManeuver = (k: number) => {
    const m = a.maneuvers[k]
    if (!m) return
    setSelMnv(k)
    focus(m.i0, m.i1, 6000)
  }

  const rangeIdx = range ? ([indexAtTime(tr.t, range[0]), indexAtTime(tr.t, range[1])] as const) : null
  const rangeInfo = rangeIdx && rangeIdx[1] > rangeIdx[0] ? rangeStats(tr, a, rangeIdx[0], rangeIdx[1]) : null

  const mapTracks = useMemo<MapTrack[]>(() => [{ id: rec.id, track: tr, foil: a.foil }], [rec.id, tr, a.foil])
  const stopPoints = useMemo(() => a.stops.map((s) => s.i0), [a.stops])
  const domain = useMemo<[number, number]>(() => {
    const s = Array.from(tr.spd)
      .filter((v) => v > 1)
      .sort((x, y) => x - y)
    return s.length ? [s[Math.floor(s.length * 0.05)], s[Math.floor(s.length * 0.98)]] : [0, 10]
  }, [tr])
  const pin = useMemo(
    () => (a.records.s2 ? { i: a.records.s2.i0, text: `Max ${sp(a.records.s2.v)} ${u}` } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.records.s2, unit],
  )

  const readout = (() => {
    if (cursor == null) return undefined
    const i = indexAtTime(tr.t, cursor)
    const twa = a.twa ? Math.round(a.twa[i]) : null
    return `${sp(tr.spd[i])} ${u} · ${a.foil[i] ? 'in foil' : 'giù'}${twa != null ? ` · ${Math.abs(twa)}° ${twa >= 0 ? 'dritta' : 'sinistra'}` : ''}`
  })()

  const wind = a.wind
  const lowConfidence = !readOnly && rec.windOverride == null && wind.dir != null && wind.confidence < 0.6

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-accent">
          <IconBack width={18} height={18} /> Uscite
        </Link>
        {editing ? (
          <EditDetails rec={rec} riderEditable={riderEditable} onCancel={() => setEditing(false)} onSave={async (p) => {
            await onUpdate(p)
            setEditing(false)
          }} />
        ) : (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl leading-tight font-semibold tracking-tight">{rec.title}</h1>
              <p className="mt-0.5 text-sm text-ink-2 first-letter:uppercase">
                {fmtDate(sum.start)} · {fmtTime(sum.start)}–{fmtTime(sum.end)} · {rec.rider}
                {rec.device ? ` · ${rec.device}` : ''}
              </p>
              {meta}
            </div>
            {!readOnly && (
              <button type="button" className={btnGhost} onClick={() => setEditing(true)} aria-label="Modifica titolo e rider">
                <IconEdit width={18} height={18} />
              </button>
            )}
            <Link to={`/confronta?ids=${compareId ?? rec.id}`} className={btnGhost}>
              Confronta
            </Link>
            {!readOnly && (
              <button type="button" className={`${btnGhost} text-critical`} onClick={onDelete} aria-label="Elimina uscita">
                <IconTrash width={18} height={18} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5">
        {/* Map and replay */}
        <div className="space-y-2 lg:sticky lg:top-[4.5rem] lg:self-start">
          <MapView
            tracks={mapTracks}
            cursor={cursor}
            range={range}
            maneuvers={a.maneuvers}
            stops={stopPoints}
            selectedManeuver={selMnv}
            onManeuverClick={(k) => {
              pickManeuver(k)
              setTab('manovre')
            }}
            pin={pin}
            windDir={wind.dir}
            speedDomain={domain}
            legend={{ min: sp(domain[0]), max: sp(domain[1]), unit: u }}
            className="h-[46vh] min-h-[300px] rounded-2xl border border-line lg:h-[calc(100dvh-11rem)]"
          />
          <ReplayBar replay={replay} t0={t0} t1={t1} readout={readout} />
          {(a.maneuvers.length > 0 || a.stops.length > 0) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-ink-2">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--good)' }} /> manovra in foil
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--critical)' }} /> manovra toccata o caduta
              </span>
              {a.stops.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: 'var(--critical)' }} /> caduta o sosta
                </span>
              )}
              <span>Tocca un pallino per i dettagli.</span>
            </p>
          )}
        </div>

        <div className="mt-4 space-y-4 lg:mt-0">
          {/* Wind */}
          {windEdit ? (
            <WindEditor
              initial={Math.round(wind.dir ?? rec.modelWind?.dir ?? 0)}
              canReset={rec.windOverride != null}
              onCancel={() => setWindEdit(false)}
              onSave={async (dir) => {
                await onUpdate({ windOverride: dir })
                setWindEdit(false)
              }}
            />
          ) : (
            <div className={`${card} space-y-2 p-3.5`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink-2">Vento</p>
                  {wind.dir != null ? (
                    <p className="font-semibold">
                      da {compass(wind.dir)} · {Math.round(wind.dir)}°{' '}
                      <span className="font-normal text-ink-2">{wind.source ? WIND_SOURCE[wind.source] : ''}</span>
                    </p>
                  ) : (
                    <p className="font-semibold">sconosciuto</p>
                  )}
                  {rec.modelWind && rec.modelWind.label !== 'esempio' && (
                    <p className="text-sm text-ink-2">
                      Modello meteo: {sp(rec.modelWind.speed)} {u}, raffiche {sp(rec.modelWind.gust)} {u}, da {compass(rec.modelWind.dir)}
                    </p>
                  )}
                </div>
                {!readOnly && (
                  <button type="button" className={btnGhost} onClick={() => setWindEdit(true)}>
                    {wind.dir == null ? 'Imposta' : 'Correggi'}
                  </button>
                )}
              </div>
              {lowConfidence && (
                <div className="rounded-xl bg-surface-2 p-3 text-sm">
                  <p>
                    Non sono sicuro della direzione del vento. Il vento arrivava davvero da <b>{compass(wind.dir!)}</b> ({Math.round(wind.dir!)}°)?
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={btnPrimary} onClick={() => onUpdate({ windOverride: Math.round(wind.dir!) })}>
                      Sì, è giusto
                    </button>
                    <button type="button" className={btnSecondary} onClick={() => onUpdate({ windOverride: Math.round(norm360(wind.dir! + 180)) })}>
                      No, era l'opposto ({compass(norm360(wind.dir! + 180))})
                    </button>
                    <button type="button" className={btnSecondary} onClick={() => setWindEdit(true)}>
                      Correggi a mano
                    </button>
                  </div>
                </div>
              )}
              {wind.dir == null && !readOnly && (
                <p className="text-sm text-ink-2">Imposta la direzione del vento per vedere manovre, andature e polare.</p>
              )}
            </div>
          )}

          {/* Key numbers */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile label="Distanza" value={fmtDist(sum.distance, settings.distUnit)} sub={`in foil ${fmtDist(sum.foilDistance, settings.distUnit)}`} />
            <StatTile label="Durata" value={fmtDuration(sum.duration)} sub={`in movimento ${fmtDuration(sum.movingTime)}`} />
            <StatTile label="In foil" value={fmtPct(sum.foilShare)} sub={`${fmtDuration(sum.foilTime)} · ${sum.takeoffs} decolli`} />
            <StatTile
              label="Velocità max (2 s)"
              value={sp(sum.records.s2)}
              unit={u}
              onClick={a.records.s2 ? () => focus(a.records.s2!.i0, a.records.s2!.i1) : undefined}
            />
            <StatTile
              label="Max su 10 s"
              value={sp(sum.records.s10)}
              unit={u}
              sub={`5×10 s: ${sp(sum.records.s5x10)} ${u}`}
              onClick={a.records.s10 ? () => focus(a.records.s10!.i0, a.records.s10!.i1) : undefined}
            />
            <StatTile
              label="Max su 500 m"
              value={sp(sum.records.m500)}
              unit={u}
              sub={`1 miglio: ${sp(sum.records.nm)} ${u}`}
              onClick={a.records.m500 ? () => focus(a.records.m500!.i0, a.records.m500!.i1, 3000) : undefined}
            />
            <StatTile label="Media in foil" value={sp(sum.avgFoilSpeed)} unit={u} sub={`100 m: ${sp(sum.records.m100)} ${u}`} />
            <StatTile
              label="Strambate in foil"
              value={sum.jibes ? `${sum.jibesFoiled}/${sum.jibes}` : '–'}
              sub={sum.jibes ? fmtPct(sum.jibesFoiled / sum.jibes) : wind.dir == null ? 'serve il vento' : 'nessuna'}
              onClick={sum.jibes ? () => setTab('manovre') : undefined}
            />
            <StatTile
              label="Virate in foil"
              value={sum.tacks ? `${sum.tacksFoiled}/${sum.tacks}` : '–'}
              sub={sum.tacks ? fmtPct(sum.tacksFoiled / sum.tacks) : wind.dir == null ? 'serve il vento' : 'nessuna'}
              onClick={sum.tacks ? () => setTab('manovre') : undefined}
            />
            {sum.upwindAngle != null && (
              <StatTile
                label="Bolina"
                value={`${Math.round(sum.upwindAngle)}°`}
                sub={`VMG max ${sp(sum.bestVmgUp)} ${u}`}
                onClick={() => setTab('andature')}
              />
            )}
            {sum.downwindAngle != null && (
              <StatTile
                label="Poppa"
                value={`${Math.round(sum.downwindAngle)}°`}
                sub={`VMG max ${sp(sum.bestVmgDown)} ${u}`}
                onClick={() => setTab('andature')}
              />
            )}
            {sum.longestFlight && (
              <StatTile
                label="Volo più lungo"
                value={fmtDuration(sum.longestFlight.duration)}
                sub={fmtDist(sum.longestFlight.distance, settings.distUnit)}
              />
            )}
            {sum.avgHr != null && <StatTile label="Battito medio" value={fmtNum(sum.avgHr, 0)} unit="bpm" sub={`max ${fmtNum(sum.maxHr ?? NaN, 0)} bpm`} />}
          </div>

          {rangeInfo && range && (
            <div className={`${card} p-3.5`}>
              <div className="mb-2 flex items-center gap-2">
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">Tratto selezionato</span>{' '}
                  <span className="text-ink-2 tabular">
                    {fmtTimeSec(range[0])}–{fmtTimeSec(range[1])}
                  </span>
                </p>
                <button type="button" className={btnGhost} onClick={() => selectRange(null)}>
                  Tutta l'uscita
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Durata" value={fmtDuration(rangeInfo.duration)} />
                <StatTile label="Distanza" value={fmtDist(rangeInfo.distance, settings.distUnit)} />
                <StatTile label="Media" value={sp(rangeInfo.avgSpeed)} unit={u} />
                <StatTile label="Max 2 s" value={sp(rangeInfo.best2s)} unit={u} />
                <StatTile label="In foil" value={fmtPct(rangeInfo.foilShare)} />
                <StatTile label="Manovre" value={String(rangeInfo.maneuvers.length)} />
              </div>
            </div>
          )}

          {/* Tabs */}
          <div role="tablist" aria-label="Dettagli" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-medium transition ${tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-2'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'grafici' && (
            <div className="space-y-4">
              <div className={`${card} p-3`}>
                <p className="text-sm font-semibold">Velocità</p>
                <p className="text-xs text-ink-2">
                  {coarse ? 'Tocca il grafico per i valori; ' : 'Passa sopra il grafico per i valori; '}trascina le maniglie in basso per
                  selezionare un tratto.
                </p>
                <EChart option={speed.option} height={280} label="Velocità nel tempo" onInit={onSpeedInit} onOption={onSpeedOption} />
              </div>
              <Histogram tr={tr} a={a} unit={unit} colors={colors} />
              {(tr.roll || tr.pitch) && <Orientation data={data} colors={colors} coarse={coarse} />}
              {tr.hr && <HeartRate data={data} colors={colors} coarse={coarse} />}
            </div>
          )}

          {tab === 'manovre' && <ManeuversTab a={a} unit={unit} selected={selMnv} onPick={pickManeuver} tr={tr} />}
          {tab === 'andature' && <SailTab a={a} unit={unit} colors={colors} onSetWind={() => setWindEdit(true)} />}
          {tab === 'bordi' && <LegsTab a={a} tr={tr} unit={unit} distUnit={settings.distUnit} onPick={(i0, i1) => focus(i0, i1, 2000)} />}

          {below}
          {readOnly ? (
            rec.notes && (
              <div className={`${card} p-3.5`}>
                <p className="text-sm font-semibold">Note</p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{rec.notes}</p>
              </div>
            )
          ) : (
            <Notes rec={rec} onSave={(notes) => onUpdate({ notes })} />
          )}
          {rec.warnings.length > 0 && <p className="px-1 text-xs text-ink-2">Note sul file: {rec.warnings.join(' · ')}.</p>}
        </div>
      </div>
    </div>
  )
}

function EditDetails({
  rec,
  riderEditable,
  onSave,
  onCancel,
}: {
  rec: SessionRecord
  riderEditable: boolean
  onSave: (p: Partial<SessionRecord>) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(rec.title)
  const [rider, setRider] = useState(rec.rider)
  return (
    <form
      className={`${card} space-y-3 p-3.5`}
      onSubmit={(e) => {
        e.preventDefault()
        onSave(riderEditable ? { title: title.trim() || rec.title, rider: rider.trim() || rec.rider } : { title: title.trim() || rec.title })
      }}
    >
      <label className="block text-sm">
        <span className="text-ink-2">Titolo</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base" />
      </label>
      {riderEditable && (
        <label className="block text-sm">
          <span className="text-ink-2">Rider (di chi è questa uscita)</span>
          <input value={rider} onChange={(e) => setRider(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base" />
        </label>
      )}
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary}>
          Salva
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel}>
          Annulla
        </button>
      </div>
    </form>
  )
}

function WindEditor({ initial, canReset, onSave, onCancel }: { initial: number; canReset: boolean; onSave: (dir: number | null) => void; onCancel: () => void }) {
  const [dir, setDir] = useState(initial)
  return (
    <div className={`${card} space-y-3 p-3.5`}>
      <p className="font-semibold">Da dove arrivava il vento?</p>
      <p className="text-sm text-ink-2">Tocca o trascina sul bordo della bussola il punto da cui soffiava il vento.</p>
      <div className="flex justify-center">
        <WindDial value={dir} onChange={setDir} />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={btnSecondary} onClick={() => setDir((d) => norm360(d - 5))} aria-label="5 gradi in senso antiorario">
          −5°
        </button>
        <button type="button" className={btnSecondary} onClick={() => setDir((d) => norm360(d + 180))}>
          Opposto
        </button>
        <button type="button" className={btnSecondary} onClick={() => setDir((d) => norm360(d + 5))} aria-label="5 gradi in senso orario">
          +5°
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} onClick={() => onSave(dir)}>
          Salva
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel}>
          Annulla
        </button>
        {canReset && (
          <button type="button" className={btnGhost} onClick={() => onSave(null)}>
            Torna alla stima automatica
          </button>
        )}
      </div>
    </div>
  )
}

function Histogram({ tr, a, unit, colors }: { tr: SessionData['track']; a: SessionAnalysis; unit: Settings['speedUnit']; colors: ThemeColors }) {
  const option = useMemo(() => histogramOption(tr, a, unit, colors), [tr, a, unit, colors])
  return (
    <div className={`${card} p-3`}>
      <p className="text-sm font-semibold">Velocità in foil</p>
      <p className="text-xs text-ink-2">Minuti passati in ogni fascia di velocità.</p>
      <EChart option={option} height={220} label="Distribuzione della velocità in foil" />
    </div>
  )
}

function Orientation({ data, colors, coarse }: { data: SessionData; colors: ThemeColors; coarse: boolean }) {
  const option = useMemo(() => orientationOption(data.track, colors, coarse), [data, colors, coarse])
  return (
    <div className={`${card} p-3`}>
      <p className="text-sm font-semibold">Sbandamento e beccheggio</p>
      <p className="text-xs text-ink-2">Dall'orientamento registrato dal Vakaros, in gradi.</p>
      <EChart option={option} height={240} label="Sbandamento e beccheggio nel tempo" />
    </div>
  )
}

function HeartRate({ data, colors, coarse }: { data: SessionData; colors: ThemeColors; coarse: boolean }) {
  const option = useMemo(() => heartRateOption(data.track, colors, coarse), [data, colors, coarse])
  return (
    <div className={`${card} p-3`}>
      <p className="text-sm font-semibold">Battito cardiaco</p>
      <EChart option={option} height={220} label="Battito cardiaco nel tempo" />
    </div>
  )
}

function sideRate(ms: Maneuver[], kind: Maneuver['kind'], from: 'S' | 'P') {
  const xs = ms.filter((m) => m.kind === kind && m.from === from)
  return { n: xs.length, ok: xs.filter((m) => m.foiled).length }
}

function ManeuversTab({
  a,
  unit,
  selected,
  onPick,
  tr,
}: {
  a: SessionAnalysis
  unit: Settings['speedUnit']
  selected: number | null
  onPick: (k: number) => void
  tr: SessionData['track']
}) {
  const u = SPEED_SHORT[unit]
  const ms = a.maneuvers
  if (a.wind.dir == null) return <p className={`${card} p-4 text-sm text-ink-2`}>Imposta il vento per riconoscere strambate e virate.</p>
  if (!ms.length) return <p className={`${card} p-4 text-sm text-ink-2`}>Nessuna strambata o virata riconosciuta in questa uscita.</p>
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
  const jibes = ms.filter((m) => m.kind === 'jibe')
  const rows = [
    { label: 'Strambate da mure a dritta', ...sideRate(ms, 'jibe', 'S') },
    { label: 'Strambate da mure a sinistra', ...sideRate(ms, 'jibe', 'P') },
    { label: 'Virate da mure a dritta', ...sideRate(ms, 'tack', 'S') },
    { label: 'Virate da mure a sinistra', ...sideRate(ms, 'tack', 'P') },
  ].filter((r) => r.n > 0)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Velocità minima in strambata" value={fmtSpeed(avg(jibes.filter((m) => !m.fell).map((m) => m.minSpeed)), unit)} unit={u} sub="media, senza le cadute" />
        <StatTile label="Durata media strambata" value={jibes.length ? `${fmtNum(avg(jibes.filter((m) => !m.fell).map((m) => m.duration)), 0)} s` : '–'} sub="senza le cadute" />
        <StatTile label="Cadute o soste" value={String(a.summary.falls)} sub={`${ms.filter((m) => m.fell).length} durante una manovra`} />
      </div>
      <div className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <caption className="px-3 pt-3 text-left text-sm font-semibold">Riuscita per lato</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line first:border-t-0">
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right tabular">
                  {r.ok}/{r.n}
                </td>
                <td className="w-16 px-3 py-2 text-right font-semibold tabular">{fmtPct(r.ok / r.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[520px] text-sm">
          <caption className="px-3 pt-3 text-left text-sm font-semibold">Tutte le manovre ({u})</caption>
          <thead className="text-xs text-ink-2">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Ora</th>
              <th className="px-2 py-2 text-left font-medium">Tipo</th>
              <th className="px-2 py-2 text-left font-medium">Esito</th>
              <th className="px-2 py-2 text-right font-medium">Minima</th>
              <th className="px-2 py-2 text-right font-medium">Entrata</th>
              <th className="px-2 py-2 text-right font-medium">Uscita</th>
              <th className="px-3 py-2 text-right font-medium">Durata</th>
            </tr>
          </thead>
          <tbody>
            {ms.map((m, k) => (
              <tr
                key={k}
                onClick={() => onPick(k)}
                className={`cursor-pointer border-t border-line ${selected === k ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
              >
                <td className="px-3 py-2 tabular">{fmtTimeSec(tr.t[m.i0])}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {m.kind === 'jibe' ? 'Strambata' : 'Virata'}{' '}
                  <span className="text-ink-2">{m.from === 'S' ? 'D→S' : 'S→D'}</span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <Outcome ok={m.foiled} fell={m.fell} />
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular">{fmtSpeed(m.minSpeed, unit)}</td>
                <td className="px-2 py-2 text-right tabular">{fmtSpeed(m.entrySpeed, unit)}</td>
                <td className="px-2 py-2 text-right tabular">{fmtSpeed(m.exitSpeed, unit)}</td>
                <td className="px-3 py-2 text-right tabular">{fmtNum(m.duration, 0)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 pb-3 text-xs text-ink-2">D→S: da mure a dritta a mure a sinistra. Tocca una riga per vederla sulla mappa.</p>
      </div>
    </div>
  )
}

function SailTab({ a, unit, colors, onSetWind }: { a: SessionAnalysis; unit: Settings['speedUnit']; colors: ThemeColors; onSetWind: () => void }) {
  const u = SPEED_SHORT[unit]
  const option = useMemo(
    () => (a.polar ? polarOption([{ name: 'Questa uscita', color: colors.series[0], bins: a.polar }], unit, colors) : null),
    [a.polar, unit, colors],
  )
  if (!a.sail || !option) {
    return (
      <div className={`${card} space-y-2 p-4 text-sm`}>
        <p className="text-ink-2">Per bolina, poppa e polare serve la direzione del vento.</p>
        <button type="button" className={btnSecondary} onClick={onSetWind}>
          Imposta il vento
        </button>
      </div>
    )
  }
  const row = (label: string, s: SideStats | null) => (
    <tr className="border-t border-line">
      <td className="px-3 py-2">{label}</td>
      <td className="px-2 py-2 text-right tabular">{s ? `${Math.round(s.angle)}°` : '–'}</td>
      <td className="px-2 py-2 text-right tabular">{s ? fmtSpeed(s.speed, unit) : '–'}</td>
      <td className="px-2 py-2 text-right tabular">{s ? fmtSpeed(s.vmg, unit) : '–'}</td>
      <td className="px-3 py-2 text-right tabular">{s ? fmtDuration(s.seconds) : '–'}</td>
    </tr>
  )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Miglior VMG in bolina" value={fmtSpeed(a.sail.bestVmgUp?.v, unit)} unit={u} sub="media su 10 s" />
        <StatTile label="Miglior VMG in poppa" value={fmtSpeed(a.sail.bestVmgDown?.v, unit)} unit={u} sub="media su 10 s" />
      </div>
      <div className={`${card} p-3`}>
        <p className="text-sm font-semibold">Polare</p>
        <p className="text-xs text-ink-2">Velocità in foil (90° percentile, {u}) per angolo dal vento. Vento dall'alto.</p>
        <EChart option={option} height={320} label="Diagramma polare della velocità rispetto al vento" />
        <p className="flex justify-between px-2 text-xs text-ink-2">
          <span>← mure a sinistra</span>
          <span>mure a dritta →</span>
        </p>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[420px] text-sm">
          <caption className="px-3 pt-3 text-left text-sm font-semibold">Per mure (solo tratti in foil)</caption>
          <thead className="text-xs text-ink-2">
            <tr>
              <th className="px-3 py-2 text-left font-medium" />
              <th className="px-2 py-2 text-right font-medium">Angolo</th>
              <th className="px-2 py-2 text-right font-medium">Velocità</th>
              <th className="px-2 py-2 text-right font-medium">VMG</th>
              <th className="px-3 py-2 text-right font-medium">Tempo</th>
            </tr>
          </thead>
          <tbody>
            {row('Bolina, mure a dritta', a.sail.upwind.S)}
            {row('Bolina, mure a sinistra', a.sail.upwind.P)}
            {row('Poppa, mure a dritta', a.sail.downwind.S)}
            {row('Poppa, mure a sinistra', a.sail.downwind.P)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function pointOfSail(twa: number | null): string {
  if (twa == null) return '–'
  const x = Math.abs(twa)
  return x < 70 ? 'Bolina' : x <= 110 ? 'Traverso' : 'Poppa'
}

function LegsTab({
  a,
  tr,
  unit,
  distUnit,
  onPick,
}: {
  a: SessionAnalysis
  tr: SessionData['track']
  unit: Settings['speedUnit']
  distUnit: Settings['distUnit']
  onPick: (i0: number, i1: number) => void
}) {
  const u = SPEED_SHORT[unit]
  if (!a.legs.length) return <p className={`${card} p-4 text-sm text-ink-2`}>Nessun tratto rettilineo riconosciuto.</p>
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full min-w-[560px] text-sm">
        <caption className="px-3 pt-3 text-left text-sm font-semibold">Tratti rettilinei ({u})</caption>
        <thead className="text-xs text-ink-2">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Ora</th>
            <th className="px-2 py-2 text-left font-medium">Andatura</th>
            <th className="px-2 py-2 text-right font-medium">Angolo</th>
            <th className="px-2 py-2 text-right font-medium">Media</th>
            <th className="px-2 py-2 text-right font-medium">Max</th>
            <th className="px-2 py-2 text-right font-medium">VMG</th>
            <th className="px-2 py-2 text-right font-medium">Durata</th>
            <th className="px-3 py-2 text-right font-medium">Foil</th>
          </tr>
        </thead>
        <tbody>
          {a.legs.map((l, k) => (
            <tr key={k} onClick={() => onPick(l.i0, l.i1)} className="cursor-pointer border-t border-line hover:bg-surface-2">
              <td className="px-3 py-2 tabular">{fmtTimeSec(tr.t[l.i0])}</td>
              <td className="px-2 py-2">
                {pointOfSail(l.twa)}
                {l.tack && <span className="text-ink-2"> · {l.tack === 'S' ? 'dritta' : 'sinistra'}</span>}
              </td>
              <td className="px-2 py-2 text-right tabular">{l.twa != null ? `${Math.abs(Math.round(l.twa))}°` : '–'}</td>
              <td className="px-2 py-2 text-right tabular">{fmtSpeed(l.avgSpeed, unit)}</td>
              <td className="px-2 py-2 text-right tabular">{fmtSpeed(l.maxSpeed, unit)}</td>
              <td className="px-2 py-2 text-right tabular">{l.vmg != null ? fmtSpeed(Math.abs(l.vmg), unit) : '–'}</td>
              <td className="px-2 py-2 text-right tabular">{fmtDuration(l.duration)}</td>
              <td className="px-3 py-2 text-right tabular">{fmtPct(l.foilShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 pb-3 text-xs text-ink-2">
        Distanza totale dei tratti: {fmtDist(a.legs.reduce((s, l) => s + l.distance, 0), distUnit)}. Tocca una riga per vederla sulla mappa.
      </p>
    </div>
  )
}

function Notes({ rec, onSave }: { rec: SessionRecord; onSave: (notes: string) => void }) {
  const [v, setV] = useState(rec.notes)
  return (
    <label className={`${card} block p-3.5`}>
      <span className="text-sm font-semibold">Note</span>
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== rec.notes && onSave(v)}
        rows={2}
        placeholder="Attrezzatura, condizioni, sensazioni…"
        className="mt-1.5 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-base"
      />
    </label>
  )
}
