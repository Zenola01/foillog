import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EChart } from '../components/EChart'
import { LiveInfo, type LiveRider } from '../components/LiveInfo'
import { MapView, TrailToggle, type MapTrack } from '../components/MapView'
import { ReplayBar, useReplay } from '../components/ReplayBar'
import { RequireAuth } from '../components/RequireAuth'
import { btnGhost, card, LineKey, Segmented } from '../components/ui'
import { detectFoil } from '../lib/analysis/foil'
import { sharedWind } from '../lib/analysis/wind'
import { compareSpeedOption } from '../lib/charts'
import { loadTrack, sessionsBetween, type CloudSession } from '../lib/cloud'
import { dayKey, dayRange, groupByPlace, shiftDay } from '../lib/crewStats'
import { useSettings, type Settings } from '../lib/settings'
import type { SessionData } from '../lib/store'
import { isCoarsePointer, useTheme } from '../lib/theme'
import type { RecordKey, SessionSummary } from '../lib/types'
import { compass, fmtDate, fmtDist, fmtPct, fmtSpeed, fmtTime, SPEED_SHORT } from '../lib/units'

/** Riders shown on one map: the eight categorical colours, each with its name label. */
const MAX_RIDERS = 8

export default function DayPage() {
  return (
    <RequireAuth why="La giornata mostra le uscite della crew in un certo giorno.">
      <Day />
    </RequireAuth>
  )
}

function Day() {
  const { day = dayKey(Date.now()) } = useParams()
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [rows, setRows] = useState<CloudSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [place, setPlace] = useState(0)

  useEffect(() => {
    let alive = true
    setRows(null)
    setPlace(0)
    const [from, to] = dayRange(day)
    sessionsBetween(from, to)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [day])

  const groups = useMemo(() => (rows ? groupByPlace(rows) : []), [rows])
  const chosen = useMemo(() => (groups[place] ?? []).slice(0, MAX_RIDERS), [groups, place])
  const [from] = dayRange(day)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight first-letter:uppercase">La giornata</h1>
          <p className="text-sm text-ink-2 first-letter:uppercase">{fmtDate(from.getTime())}</p>
        </div>
        <button type="button" className={btnGhost} onClick={() => navigate(`/giornata/${shiftDay(day, -1)}`)} aria-label="Giorno prima">
          ← Prima
        </button>
        <input
          type="date"
          value={day}
          max={dayKey(Date.now())}
          onChange={(e) => e.target.value && navigate(`/giornata/${e.target.value}`)}
          aria-label="Scegli il giorno"
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
        />
        <button type="button" className={btnGhost} onClick={() => navigate(`/giornata/${shiftDay(day, 1)}`)} aria-label="Giorno dopo">
          Dopo →
        </button>
      </div>

      {error && <p className={`${card} p-4 text-sm text-critical`}>{error}</p>}
      {rows == null && !error && <p className="py-12 text-center text-ink-2">Carico le uscite…</p>}
      {rows?.length === 0 && (
        <p className={`${card} p-4 text-sm text-ink-2`}>Nessuna uscita della crew in questo giorno. Prova un altro giorno con le frecce.</p>
      )}
      {groups.length > 1 && (
        <Segmented
          label="Luogo"
          value={place}
          onChange={setPlace}
          options={groups.map((g, k) => ({ value: k, label: `${g[0].spot?.name ?? `Zona ${k + 1}`} (${g.length})` }))}
        />
      )}
      {chosen.length > 0 && <DayView key={chosen.map((r) => r.id).join()} rows={chosen} settings={settings} />}
    </div>
  )
}

const COLUMNS: { key: RecordKey | 'distance' | 'foil' | 'jibes'; label: string }[] = [
  { key: 's2', label: 'Max 2 s' },
  { key: 's10', label: 'Max 10 s' },
  { key: 'm500', label: '500 m' },
  { key: 'distance', label: 'Distanza' },
  { key: 'foil', label: 'In foil' },
  { key: 'jibes', label: 'Strambate' },
]

function valueOf(s: SessionSummary, key: (typeof COLUMNS)[number]['key']): number | null {
  if (key === 'distance') return s.distance
  if (key === 'foil') return s.foilShare
  if (key === 'jibes') return s.jibes ? s.jibesFoiled / s.jibes : null
  return s.records[key]
}

function DayView({ rows, settings }: { rows: CloudSession[]; settings: Settings }) {
  const { colors } = useTheme()
  const { update } = useSettings()
  const coarse = useMemo(isCoarsePointer, [])
  const [tracks, setTracks] = useState<(SessionData | null)[] | null>(null)
  const [sortKey, setSortKey] = useState<(typeof COLUMNS)[number]['key']>('s10')
  const unit = settings.speedUnit
  const u = SPEED_SHORT[unit]

  useEffect(() => {
    let alive = true
    Promise.all(rows.map((r) => loadTrack(r).catch(() => null))).then((t) => alive && setTracks(t))
    return () => {
      alive = false
    }
  }, [rows])

  // Same rider twice in a day: tell the sessions apart by their start time.
  const names = rows.map((r) => {
    const n = r.profile?.display_name ?? 'Rider'
    return rows.filter((x) => x.user_id === r.user_id).length > 1 ? `${n} ${fmtTime(Date.parse(r.started_at))}` : n
  })
  const riders = rows.map((r, k) => ({ row: r, name: names[k], color: colors.series[k % colors.series.length], data: tracks?.[k] ?? null }))
  const loaded = riders.filter((r) => r.data)

  const t0 = Math.min(...rows.map((r) => Date.parse(r.started_at)))
  const t1 = Math.max(...rows.map((r) => Date.parse(r.ended_at)))
  const replay = useReplay(t0, t1)
  // Foil state is not stored in the cloud: recomputed here (one pass per track) for the map and the live numbers.
  const foils = useMemo(
    () => loaded.map((r) => detectFoil(r.data!.track, settings.foilOnKn).foil),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, settings.foilOnKn],
  )
  const mapTracks = useMemo<MapTrack[]>(
    () => loaded.map((r, k) => ({ id: r.row.id, track: r.data!.track, foil: foils[k], color: r.color, label: r.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [foils, colors],
  )
  const wind = rows.find((r) => r.model_wind && r.model_wind.label !== 'esempio')?.model_wind
  // Everyone sailed the same water: one wind from their estimates (the weather model if none has one).
  const ownWind = (r: CloudSession) => r.wind_override ?? r.summary.windDir
  const shared = useMemo(() => {
    const est = rows.map((r) => ({ dir: ownWind(r), weight: r.wind_override != null ? 1 : r.summary.windConfidence }))
    return est.some((w) => w.dir != null) ? sharedWind(est) : (wind?.dir ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, wind])
  const windByRider =
    shared == null ? riders.flatMap((r) => (ownWind(r.row) == null ? [] : [{ dir: ownWind(r.row)!, color: r.color, label: r.name }])) : undefined
  const live = useMemo<LiveRider[]>(
    () =>
      loaded.map((r, k) => ({
        id: r.row.id,
        name: r.name,
        color: r.color,
        track: r.data!.track,
        offset: 0,
        windDir: shared ?? ownWind(r.row),
        foil: foils[k],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [foils, colors, shared],
  )
  const cursor = replay.touched || replay.playing ? replay.t : null
  const speedOpt = useMemo(
    () => compareSpeedOption(loaded.map((r) => ({ name: r.name, color: r.color, tr: r.data!.track, offset: 0 })), unit, colors, false, coarse),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, colors, unit, coarse],
  )
  const sorted = [...riders].sort((a, b) => (valueOf(b.row.summary, sortKey) ?? -1) - (valueOf(a.row.summary, sortKey) ?? -1))
  const best = Object.fromEntries(
    COLUMNS.map((c) => {
      const vals = riders.map((r) => valueOf(r.row.summary, c.key)).filter((v): v is number => v != null)
      return [c.key, vals.length > 1 ? Math.max(...vals) : null]
    }),
  )
  const fmt = (key: (typeof COLUMNS)[number]['key'], s: SessionSummary) => {
    const v = valueOf(s, key)
    if (key === 'distance') return fmtDist(v, settings.distUnit)
    if (key === 'foil') return fmtPct(v)
    if (key === 'jibes') return s.jibes ? `${s.jibesFoiled}/${s.jibes}` : '–'
    return v == null ? '–' : `${fmtSpeed(v, unit)}`
  }

  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Legenda">
        {riders.map((r) => (
          <li key={r.row.id} className="flex items-center gap-2 text-sm">
            <LineKey color={r.color} />
            <Link to={`/c/${r.row.id}`} className="font-medium underline-offset-2 hover:underline">
              {r.name}
            </Link>
            <span className="text-ink-2">
              {fmtTime(Date.parse(r.row.started_at))}–{fmtTime(Date.parse(r.row.ended_at))}
            </span>
          </li>
        ))}
      </ul>

      <div className="lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5">
        <div className="space-y-2 lg:sticky lg:top-[4.5rem] lg:self-start">
          {tracks ? (
            <MapView
              tracks={mapTracks}
              cursor={cursor}
              trail={settings.trailMode}
              windDir={shared}
              windByRider={windByRider}
              overlay={loaded.length > 1 ? <LiveInfo riders={live} cursor={cursor} /> : undefined}
              className="h-[46vh] min-h-[300px] rounded-2xl border border-line lg:h-[calc(100dvh-14rem)]"
            />
          ) : (
            <div className="flex h-[46vh] min-h-[300px] items-center justify-center rounded-2xl border border-line text-ink-2">Carico le tracce…</div>
          )}
          <ReplayBar replay={replay} t0={t0} t1={t1} />
          {loaded.length > 1 && <TrailToggle value={settings.trailMode} onChange={(trailMode) => update({ trailMode })} />}
          {wind && (
            <p className="px-1 text-sm text-ink-2">
              Vento del modello meteo: {fmtSpeed(wind.speed, unit)} {u}, raffiche {fmtSpeed(wind.gust, unit)} {u}, da {compass(wind.dir)}
            </p>
          )}
        </div>

        <div className="mt-4 space-y-4 lg:mt-0">
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full min-w-[480px] text-sm">
              <caption className="px-3 pt-3 text-left text-sm font-semibold">Classifica del giorno ({u})</caption>
              <thead>
                <tr className="text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">Rider</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => setSortKey(c.key)}
                        aria-pressed={sortKey === c.key}
                        className={`rounded px-1 ${sortKey === c.key ? 'text-ink underline underline-offset-4' : ''}`}
                      >
                        {c.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.row.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <LineKey color={r.color} />
                        <Link to={`/c/${r.row.id}`} className="font-medium">
                          {r.name}
                        </Link>
                      </span>
                    </td>
                    {COLUMNS.map((c) => {
                      const top = best[c.key] != null && valueOf(r.row.summary, c.key) === best[c.key]
                      return (
                        <td key={c.key} className={`px-2 py-2 text-right tabular ${top ? 'font-semibold text-ink' : ''}`}>
                          {fmt(c.key, r.row.summary)}
                          {top && <span className="sr-only"> (migliore)</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 pb-3 text-xs text-ink-2">Tocca un'intestazione per ordinare; in grassetto il migliore di ogni colonna.</p>
          </div>
          {tracks && loaded.length > 0 && (
            <div className={`${card} p-3`}>
              <p className="text-sm font-semibold">Velocità di tutti</p>
              <EChart option={speedOpt} height={280} label="Velocità dei rider durante la giornata" />
            </div>
          )}
          {tracks && loaded.length < riders.length && (
            <p className="px-1 text-xs text-ink-2">Alcune tracce non si sono caricate: controlla la connessione.</p>
          )}
        </div>
      </div>
    </div>
  )
}
