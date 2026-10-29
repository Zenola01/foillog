import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BestLegsCompare } from '../components/BestLegs'
import { EChart } from '../components/EChart'
import { LiveInfo, type LiveRider } from '../components/LiveInfo'
import { MapView, TrailToggle, type MapTrack } from '../components/MapView'
import { ReplayBar, useReplay } from '../components/ReplayBar'
import { TrackThumb } from '../components/TrackThumb'
import { btnPrimary, btnSecondary, card, LineKey } from '../components/ui'
import { legsInWind } from '../lib/analysis/bestLegs'
import { sharedWind } from '../lib/analysis/wind'
import { compareSpeedOption, polarOption } from '../lib/charts'
import { useAuth } from '../lib/auth'
import { asRecord, feed, getSession, loadTrack } from '../lib/cloud'
import { analyzeInWorker } from '../lib/engine'
import { useLibrary } from '../lib/library'
import { useSettings, type Settings } from '../lib/settings'
import { getSessionData, type SessionData, type SessionRecord } from '../lib/store'
import { groupTogether, together, type Span } from '../lib/together'
import { isCoarsePointer, useTheme } from '../lib/theme'
import type { SessionAnalysis, SessionSummary } from '../lib/types'
import { fmtDate, fmtDist, fmtDuration, fmtPct, fmtSpeed, fmtTime, SPEED_SHORT } from '../lib/units'

const MAX = 4

export default function ComparePage() {
  const [params, setParams] = useSearchParams()
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, MAX)
  const [picking, setPicking] = useState(ids.length < 2)
  if (picking || ids.length < 2) {
    return (
      <Picker
        initial={ids}
        onConfirm={(sel) => {
          setParams({ ids: sel.join(',') })
          setPicking(false)
        }}
      />
    )
  }
  return <CompareView ids={ids} onChange={() => setPicking(true)} />
}

interface PickItem extends Span {
  id: string
  title: string
  rider: string
  preview: [number, number][]
}

/** Only sessions sailed at the same time can be compared: the picker offers them in groups. */
function Picker({ initial, onConfirm }: { initial: string[]; onConfirm: (ids: string[]) => void }) {
  const { sessions } = useLibrary()
  const { user } = useAuth()
  const [crew, setCrew] = useState<PickItem[] | null>(null)
  const userId = user?.id
  useEffect(() => {
    if (!userId) {
      setCrew([])
      return
    }
    let alive = true
    feed(60)
      .then((rows) => {
        if (!alive) return
        setCrew(
          rows.map((r) => ({
            id: `c:${r.id}`,
            title: r.title,
            rider: r.profile?.display_name ?? 'Rider',
            start: Date.parse(r.started_at),
            end: Date.parse(r.ended_at),
            preview: r.preview,
          })),
        )
      })
      .catch(() => alive && setCrew([]))
    return () => {
      alive = false
    }
  }, [userId])
  const opened = initial.join(',')
  const groups = useMemo(() => {
    const local = (sessions ?? [])
      .filter((s) => !s.cloudId)
      .map((s) => ({ id: s.id, title: s.title, rider: s.rider, start: s.summary.start, end: s.summary.end, preview: s.preview }))
    const all = groupTogether<PickItem>([...(crew ?? []), ...local])
    // The group of the session the page was opened from comes first.
    const first = (g: PickItem[]) => g.some((it) => initial.includes(it.id))
    return [...all.filter(first), ...all.filter((g) => !first(g))]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, crew, opened])
  const loading = sessions == null || crew == null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Confronta</h1>
        <p className="text-sm text-ink-2">Sovrapponi le tracce di chi era in acqua nello stesso momento: stesso vento, stesso campo, un solo replay.</p>
      </div>
      {loading && <p className="py-8 text-center text-ink-2">Cerco le uscite nello stesso orario…</p>}
      {!loading && groups.length === 0 && (
        <div className={`${card} space-y-2 p-4 text-sm`}>
          <p className="font-medium">Nessuna uscita nello stesso orario</p>
          <p className="text-ink-2">
            Il confronto mette insieme solo le tracce di chi era in acqua nello stesso momento. Carica anche la traccia di un amico (in Uscite
            scegli «Di un amico») oppure chiedigli di condividere le sue uscite con la crew.
          </p>
          <Link to="/" className={btnSecondary}>
            Vai alle uscite
          </Link>
        </div>
      )}
      {groups.map((g) => (
        <TogetherGroup key={g.map((it) => it.id).join()} items={g} initial={initial} onConfirm={onConfirm} />
      ))}
      {!loading && groups.length > 0 && (
        <p className="px-1 text-xs text-ink-2">Le uscite senza nessun altro in acqua nello stesso momento non compaiono qui.</p>
      )}
    </div>
  )
}

/** One group of sessions sailed together. The chosen ones must all have been on the water at once. */
function TogetherGroup({ items, initial, onConfirm }: { items: PickItem[]; initial: string[]; onConfirm: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(() => {
    const out = items.filter((it) => initial.includes(it.id)).slice(0, MAX)
    for (const it of items) if (out.length < MAX && !out.includes(it) && (!out.length || together([...out, it]))) out.push(it)
    return out.map((it) => it.id)
  })
  const chosen = items.filter((it) => sel.includes(it.id))
  const canAdd = (it: PickItem) => chosen.length < MAX && (!chosen.length || together([...chosen, it]))
  const toggle = (it: PickItem) => setSel((s) => (s.includes(it.id) ? s.filter((x) => x !== it.id) : canAdd(it) ? [...s, it.id] : s))
  const start = Math.min(...items.map((it) => it.start))
  const end = Math.max(...items.map((it) => it.end))

  return (
    <section className={`${card} space-y-2 p-3`}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 px-1">
        <span className="font-semibold first-letter:uppercase">{fmtDate(start)}</span>
        <span className="text-sm text-ink-2 tabular">
          {fmtTime(start)}–{fmtTime(end)}
        </span>
      </p>
      <ul className="space-y-1">
        {items.map((it) => {
          const on = sel.includes(it.id)
          const blocked = !on && !canAdd(it)
          return (
            <li key={it.id}>
              <label className={`flex items-center gap-3 rounded-xl p-2 ${on ? 'bg-surface-2' : ''} ${blocked ? 'opacity-60' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={blocked}
                  onChange={() => toggle(it)}
                  aria-label={`${it.rider}, ${fmtTime(it.start)}–${fmtTime(it.end)}`}
                  className="h-5 w-5 shrink-0 accent-[var(--series-1)]"
                />
                <TrackThumb points={it.preview} className="h-12 w-[76px] shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{it.rider}</span>
                  <span className="block truncate text-sm text-ink-2">
                    {fmtTime(it.start)}–{fmtTime(it.end)} · {it.title}
                  </span>
                  {blocked && (
                    <span className="block text-xs text-ink-2">
                      {chosen.length >= MAX ? `Al massimo ${MAX} uscite insieme.` : 'Non era in acqua insieme alle uscite scelte.'}
                    </span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <button type="button" className={btnPrimary} disabled={chosen.length < 2} onClick={() => onConfirm(chosen.map((it) => it.id))}>
        Sovrapponi le tracce{chosen.length >= 2 ? ` (${chosen.length})` : ''}
      </button>
    </section>
  )
}

interface Loaded {
  rec: SessionRecord
  data: SessionData
  a: SessionAnalysis
  /** Page of the session: on this device (/s/…) or in the crew (/c/…). */
  link: string
}

function CompareView({ ids, onChange }: { ids: string[]; onChange: () => void }) {
  const { sessions } = useLibrary()
  const { settings } = useSettings()
  const [loaded, setLoaded] = useState<Loaded[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = ids.join(',')

  useEffect(() => {
    if (!sessions) return
    let alive = true
    setLoaded(null)
    ;(async () => {
      const out: Loaded[] = []
      for (const id of ids) {
        // «c:…» ids are crew sessions; the rest live on this device.
        if (id.startsWith('c:')) {
          const row = await getSession(id.slice(2))
          if (!row) continue
          const data = await loadTrack(row)
          const a = await analyzeInWorker(data.track, data.wind, {
            foilOnKn: settings.foilOnKn,
            windOverride: row.wind_override,
            modelWind: row.model_wind,
          })
          out.push({ rec: asRecord(row), data, a, link: `/c/${row.id}` })
          continue
        }
        const rec = sessions.find((s) => s.id === id)
        const data = rec ? await getSessionData(id) : null
        if (!rec || !data) continue
        const a = await analyzeInWorker(data.track, data.wind, {
          foilOnKn: settings.foilOnKn,
          windOverride: rec.windOverride,
          modelWind: rec.modelWind,
        })
        out.push({ rec, data, a, link: rec.cloudId ? `/c/${rec.cloudId}` : `/s/${rec.id}` })
      }
      if (!alive) return
      if (out.length < 2) setError('Non trovo abbastanza uscite da confrontare: alcune potrebbero essere state eliminate.')
      else setLoaded(out)
    })().catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
    // Sessions are read once per selection; renaming one does not need a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sessions == null, settings.foilOnKn])

  if (error) return <p className={`${card} p-4 text-sm`}>{error}</p>
  if (!loaded) return <p className="py-16 text-center text-ink-2">Preparo il confronto…</p>
  // An old link, or a session edited since: only sessions sailed together are compared.
  if (!together(loaded.map((x) => x.a.summary))) {
    return (
      <div className={`${card} space-y-3 p-4 text-sm`}>
        <p className="font-medium">Queste uscite non sono nello stesso orario</p>
        <p className="text-ink-2">Si possono sovrapporre solo le tracce di chi era in acqua nello stesso momento.</p>
        <button type="button" className={btnSecondary} onClick={onChange}>
          Scegli altre uscite
        </button>
      </div>
    )
  }
  return <Comparison items={loaded} settings={settings} onChange={onChange} />
}

function Comparison({ items, settings, onChange }: { items: Loaded[]; settings: Settings; onChange: () => void }) {
  const { colors } = useTheme()
  const { update } = useSettings()
  const coarse = useMemo(isCoarsePointer, [])
  const unit = settings.speedUnit
  const u = SPEED_SHORT[unit]

  // Colour follows the entity: the k-th chosen session keeps slot k whatever else happens.
  const series = items.map((x, k) => ({
    ...x,
    color: colors.series[k],
    // The same rider twice (two devices on one outing): told apart by the start time.
    name: items.filter((y) => y.rec.rider === x.rec.rider).length > 1 ? `${x.rec.rider} · ${fmtTime(x.a.summary.start)}` : x.rec.rider,
  }))
  const clockStart = Math.min(...series.map((s) => s.a.summary.start))
  const clockEnd = Math.max(...series.map((s) => s.a.summary.end))
  const replay = useReplay(clockStart, clockEnd)

  const mapTracks = useMemo<MapTrack[]>(
    () => series.map((s) => ({ id: s.rec.id, track: s.data.track, foil: s.a.foil, color: s.color, label: s.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, colors],
  )
  // Riders on the water together read one wind, so live VMG and angles compare fairly; if their
  // estimates disagree, each keeps their own, listed in the map's wind box.
  const wind = useMemo(
    () => sharedWind(items.map((x) => ({ dir: x.a.wind.dir, weight: x.a.wind.source === 'manual' ? 1 : x.a.wind.confidence }))),
    [items],
  )
  const windByRider = wind == null ? series.flatMap((s) => (s.a.wind.dir == null ? [] : [{ dir: s.a.wind.dir, color: s.color, label: s.name }])) : undefined
  // Best legs: measured against the shared wind when there is one, so angles and VMG compare fairly.
  const legRiders = useMemo(
    () => series.map((s) => ({ id: s.rec.id, name: s.name, color: s.color, legs: wind != null ? legsInWind(s.a.legs, wind) : s.a.legs })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, colors, wind],
  )
  const riders = useMemo<LiveRider[]>(
    () => series.map((s) => ({ id: s.rec.id, name: s.name, color: s.color, track: s.data.track, offset: 0, windDir: wind ?? s.a.wind.dir, foil: s.a.foil })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, colors, wind],
  )
  const speedOpt = useMemo(
    () => compareSpeedOption(series.map((s) => ({ name: s.name, color: s.color, tr: s.data.track, offset: 0 })), unit, colors, false, coarse),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, colors, unit, coarse],
  )
  const polarSessions = series.filter((s) => s.a.polar && s.a.polar.length > 0)
  const polarOpt = useMemo(
    () => polarOption(polarSessions.map((s) => ({ name: s.name, color: s.color, bins: s.a.polar! })), unit, colors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, colors, unit],
  )
  const cursor = replay.touched || replay.playing ? replay.t : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Confronto</h1>
          <p className="text-sm text-ink-2 first-letter:uppercase">
            {fmtDate(clockStart)} · in acqua nello stesso momento
          </p>
        </div>
        <button type="button" className={btnSecondary} onClick={onChange}>
          Cambia uscite
        </button>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Legenda">
        {series.map((s) => (
          <li key={s.rec.id} className="flex items-center gap-2 text-sm">
            <LineKey color={s.color} />
            <span className="font-medium">{s.name}</span>
            <Link to={s.link} className="text-ink-2 tabular underline-offset-2 hover:underline">
              {fmtTime(s.a.summary.start)}–{fmtTime(s.a.summary.end)}
            </Link>
          </li>
        ))}
      </ul>

      <div className="lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5">
        <div className="space-y-2 lg:sticky lg:top-[4.5rem] lg:self-start">
          <MapView
            tracks={mapTracks}
            cursor={cursor}
            trail={settings.trailMode}
            windDir={wind}
            windByRider={windByRider}
            overlay={<LiveInfo riders={riders} cursor={cursor} />}
            className="h-[46vh] min-h-[300px] rounded-2xl border border-line lg:h-[calc(100dvh-13rem)]"
          />
          <ReplayBar replay={replay} t0={clockStart} t1={clockEnd} />
          <TrailToggle value={settings.trailMode} onChange={(trailMode) => update({ trailMode })} />
        </div>

        <div className="mt-4 space-y-4 lg:mt-0">
          <CompareTable series={series} settings={settings} />
          <BestLegsCompare riders={legRiders} unit={unit} sharedWind={wind != null} />
          <div className={`${card} p-3`}>
            <p className="text-sm font-semibold">Velocità</p>
            <p className="text-xs text-ink-2">Ora del giorno.</p>
            <EChart option={speedOpt} height={280} label="Velocità delle uscite a confronto" />
          </div>
          {polarSessions.length > 0 && (
            <div className={`${card} p-3`}>
              <p className="text-sm font-semibold">Polari a confronto</p>
              <p className="text-xs text-ink-2">Velocità in foil ({u}) per angolo dal vento. Vento dall'alto.</p>
              <EChart option={polarOpt} height={340} label="Diagrammi polari a confronto" />
              <p className="flex justify-between px-2 text-xs text-ink-2">
                <span>← mure a sinistra</span>
                <span>mure a dritta →</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type Metric = {
  label: string
  get: (s: SessionSummary) => number | null
  fmt: (v: number | null) => ReactNode
  /** Which way is better; ties and missing values get no mark. */
  better?: 'max' | 'min'
}

function CompareTable({ series, settings }: { series: (Loaded & { color: string; name: string })[]; settings: Settings }) {
  const unit = settings.speedUnit
  const u = SPEED_SHORT[unit]
  const sp = (v: number | null) => (v == null ? '–' : `${fmtSpeed(v, unit)} ${u}`)
  const ratio = (ok: number, n: number) => (n ? ok / n : null)
  const metrics: Metric[] = [
    { label: 'Data', get: (s) => s.start, fmt: (v) => (v == null ? '–' : `${fmtDate(v)}, ${fmtTime(v)}`) },
    { label: 'Durata', get: (s) => s.duration, fmt: (v) => fmtDuration(v) },
    { label: 'Distanza', get: (s) => s.distance, fmt: (v) => fmtDist(v, settings.distUnit), better: 'max' },
    { label: 'In foil', get: (s) => s.foilShare, fmt: (v) => fmtPct(v), better: 'max' },
    { label: 'Velocità max (2 s)', get: (s) => s.records.s2, fmt: sp, better: 'max' },
    { label: 'Max su 10 s', get: (s) => s.records.s10, fmt: sp, better: 'max' },
    { label: '5×10 s', get: (s) => s.records.s5x10, fmt: sp, better: 'max' },
    { label: 'Max su 500 m', get: (s) => s.records.m500, fmt: sp, better: 'max' },
    { label: 'Media in foil', get: (s) => s.avgFoilSpeed, fmt: sp, better: 'max' },
    { label: 'Strambate in foil', get: (s) => ratio(s.jibesFoiled, s.jibes), fmt: (v) => fmtPct(v), better: 'max' },
    { label: 'Virate in foil', get: (s) => ratio(s.tacksFoiled, s.tacks), fmt: (v) => fmtPct(v), better: 'max' },
    { label: 'Angolo di bolina', get: (s) => s.upwindAngle, fmt: (v) => (v == null ? '–' : `${Math.round(v)}°`), better: 'min' },
    { label: 'Miglior VMG bolina', get: (s) => s.bestVmgUp, fmt: sp, better: 'max' },
    { label: 'Miglior VMG poppa', get: (s) => s.bestVmgDown, fmt: sp, better: 'max' },
    { label: 'Decolli', get: (s) => s.takeoffs, fmt: (v) => (v == null ? '–' : String(v)) },
  ]
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <caption className="px-3 pt-3 text-left text-sm font-semibold">Numeri a confronto</caption>
        <thead>
          <tr className="text-xs text-ink-2">
            <th className="px-3 py-2 text-left font-medium" />
            {series.map((s) => (
              <th key={s.rec.id} className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <LineKey color={s.color} />
                  <span className="max-w-[7rem] truncate text-ink">{s.name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const vals = series.map((s) => m.get(s.a.summary))
            const finite = vals.filter((v): v is number => v != null && Number.isFinite(v))
            const best = m.better && finite.length > 1 ? (m.better === 'max' ? Math.max(...finite) : Math.min(...finite)) : null
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
        </tbody>
      </table>
      <p className="px-3 pb-3 text-xs text-ink-2">In grassetto il valore migliore di ogni riga.</p>
    </div>
  )
}
