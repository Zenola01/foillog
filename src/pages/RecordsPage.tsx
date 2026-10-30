import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EChart } from '../components/EChart'
import { BestPolarsCard } from '../components/Polars'
import { RequireAuth } from '../components/RequireAuth'
import { TrackThumb } from '../components/TrackThumb'
import { btnGhost, btnSecondary, card, Segmented, StatTile } from '../components/ui'
import { useAuth } from '../lib/auth'
import { progressOption } from '../lib/charts'
import { listSpots, loadTrack, sessionsAtSpot, sessionsOf, updateSession, type CloudSession } from '../lib/cloud'
import { bestOf, leaderboard, totals } from '../lib/crewStats'
import { analyzeInWorker } from '../lib/engine'
import { pastOfCloud } from '../lib/history'
import { useLibrary } from '../lib/library'
import { parseWind } from '../lib/polars'
import { useSettings, type Settings } from '../lib/settings'
import { useTheme } from '../lib/theme'
import type { RecordKey } from '../lib/types'
import { fmtDist, fmtDuration, fmtPct, fmtShortDate, fmtSpeed, SPEED_SHORT, type SpeedUnit } from '../lib/units'

const RECORDS: { key: RecordKey; label: string }[] = [
  { key: 's2', label: 'Velocità max (2 s)' },
  { key: 's10', label: 'Max su 10 s' },
  { key: 's5x10', label: '5×10 s' },
  { key: 'm500', label: 'Max su 500 m' },
  { key: 'nm', label: 'Max su 1 miglio' },
]

/** My records (/record) or a crewmate's (/rider/:id). */
export default function RecordsPage() {
  const { id } = useParams()
  return (
    <RequireAuth why="I record si calcolano dalle uscite caricate nella crew.">
      <Records key={id ?? 'me'} userId={id} />
    </RequireAuth>
  )
}

function Records({ userId }: { userId?: string }) {
  const { user, profile } = useAuth()
  const { settings } = useSettings()
  const { colors } = useTheme()
  const uid = userId ?? user!.id
  const me = uid === user!.id
  const [rows, setRows] = useState<CloudSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'season' | 'all'>('season')

  const load = useCallback(
    () =>
      sessionsOf(uid)
        .then(setRows)
        .catch((e: Error) => setError(e.message)),
    [uid],
  )
  useEffect(() => {
    void load()
  }, [load])

  const year = new Date().getFullYear()
  const shown = useMemo(
    () => (rows ?? []).filter((r) => period === 'all' || new Date(r.started_at).getFullYear() === year),
    [rows, period, year],
  )
  const tot = totals(shown)
  const progress = useMemo(
    () =>
      progressOption(
        [...shown]
          .filter((r) => r.summary.records.s10 != null)
          .map((r) => ({ t: Date.parse(r.started_at), v: r.summary.records.s10! }))
          .sort((a, b) => a.t - b.t),
        settings.speedUnit,
        colors,
      ),
    [shown, settings.speedUnit, colors],
  )
  const name = me ? (profile?.display_name ?? 'Io') : (rows?.[0]?.profile?.display_name ?? 'Rider')
  const u = SPEED_SHORT[settings.speedUnit]
  const past = useMemo(() => shown.map(pastOfCloud), [shown])
  // Sessions analysed before polars were kept (with a wind, so they would have one).
  const unpolared = useMemo(() => (rows ?? []).filter((r) => r.summary.polar === undefined && r.summary.windDir != null), [rows])
  // Sessions without the wind on the water: they stay out of the best polars until it is typed in.
  const noWind = useMemo(() => (rows ?? []).filter((r) => r.wind_speed == null), [rows])
  const windSaved = useCallback((id: string, ms: number) => setRows((rs) => rs && rs.map((r) => (r.id === id ? { ...r, wind_speed: ms } : r))), [])

  if (error) return <p className={`${card} p-4 text-sm text-critical`}>{error}</p>
  if (!rows) return <p className="py-16 text-center text-ink-2">Carico le uscite…</p>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{me ? 'I tuoi record' : `Record di ${name}`}</h1>
        <p className="text-sm text-ink-2">
          Dalle uscite condivise nella crew{me ? '' : ' che puoi vedere'}.
          {me && (
            <>
              {' '}
              <Link to="/attrezzatura" className="font-medium text-accent">
                La tua attrezzatura →
              </Link>
            </>
          )}
        </p>
      </div>
      <Segmented
        label="Periodo"
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'season', label: `Stagione ${year}` },
          { value: 'all', label: 'Sempre' },
        ]}
      />
      {shown.length === 0 ? (
        <p className={`${card} p-4 text-sm text-ink-2`}>
          {me ? 'Nessuna uscita condivisa in questo periodo: caricane una dalla pagina Uscite.' : 'Nessuna uscita in questo periodo.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Uscite" value={String(tot.sessions)} />
            <StatTile label="Distanza" value={fmtDist(tot.distance, settings.distUnit)} />
            <StatTile label="In foil" value={fmtDuration(tot.foilTime)} />
            <StatTile label="Strambate in foil" value={tot.jibes ? fmtPct(tot.jibesFoiled / tot.jibes) : '–'} sub={tot.jibes ? `${tot.jibesFoiled} su ${tot.jibes}` : undefined} />
          </div>
          <div className={`${card} overflow-hidden`}>
            <table className="w-full text-sm">
              <caption className="px-3 pt-3 text-left text-sm font-semibold">Record ({u})</caption>
              <tbody>
                {RECORDS.map((r) => {
                  const b = bestOf(shown, r.key)
                  return (
                    <tr key={r.key} className="border-t border-line first:border-t-0">
                      <td className="px-3 py-2 text-ink-2">{r.label}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular">{b ? fmtSpeed(b.value, settings.speedUnit) : '–'}</td>
                      <td className="px-3 py-2 text-right">
                        {b && (
                          <Link to={`/c/${b.item.id}`} className="text-accent">
                            {fmtShortDate(Date.parse(b.item.started_at))}
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <BestPolarsCard
            sessions={past}
            unit={settings.speedUnit}
            colors={colors}
            footer={
              me ? (
                <>
                  {noWind.length > 0 && <EnterWind rows={noWind} unit={settings.speedUnit} onSaved={windSaved} />}
                  {unpolared.length > 0 && <AddPolars rows={unpolared} onDone={load} />}
                </>
              ) : (
                (noWind.length > 0 || unpolared.length > 0) && (
                  <p className="text-xs text-ink-2">
                    {noWind.length > 0 &&
                      `${count(noWind.length)} di ${name} senza il vento in acqua ${noWind.length === 1 ? 'resta' : 'restano'} fuori finché ${name} non lo inserisce. `}
                    {unpolared.length > 0 &&
                      `${count(unpolared.length)} di ${name} non ${unpolared.length === 1 ? 'ha' : 'hanno'} ancora la polare: si aggiunge quando ${name} apre i suoi record.`}
                  </p>
                )
              )
            }
          />
          {shown.length > 1 && (
            <div className={`${card} p-3`}>
              <p className="text-sm font-semibold">Progressi</p>
              <p className="text-xs text-ink-2">Velocità massima su 10 secondi di ogni uscita ({u}).</p>
              <EChart option={progress} height={220} label="Velocità massima su 10 secondi nelle varie uscite" />
            </div>
          )}
          <SessionList rows={shown} settings={settings} />
        </>
      )}
    </div>
  )
}

const count = (n: number) => (n === 1 ? 'Un’uscita' : `${n} uscite`)

/** Your sessions without the wind on the water, to type it in one after the other. */
function EnterWind({ rows, unit, onSaved }: { rows: CloudSession[]; unit: SpeedUnit; onSaved: (id: string, ms: number) => void }) {
  const [open, setOpen] = useState(false)
  const n = rows.length
  return (
    <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
      <p>
        {n === 1 ? 'Un’uscita non ha' : `${n} uscite non hanno`} il vento medio in acqua: finché non lo inserisci {n === 1 ? 'resta fuori' : 'restano fuori'}{' '}
        dalle polari migliori.
      </p>
      {open ? (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <WindRow key={r.id} row={r} unit={unit} onSaved={onSaved} />
          ))}
        </ul>
      ) : (
        <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
          Inserisci il vento
        </button>
      )}
    </div>
  )
}

function WindRow({ row, unit, onSaved }: { row: CloudSession; unit: SpeedUnit; onSaved: (id: string, ms: number) => void }) {
  const library = useLibrary()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ms = parseWind(text, unit)
  const u = SPEED_SHORT[unit]
  const model = row.summary.modelWindSpeed
  return (
    <li className="py-2">
      <form
        className="flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (ms == null) return
          setBusy(true)
          setError(null)
          try {
            await updateSession(row.id, { wind_speed: ms })
            await library.mirror(row.id, { windSpeed: ms })
            onSaved(row.id, ms)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            setBusy(false)
          }
        }}
      >
        <Link to={`/c/${row.id}`} className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {fmtShortDate(Date.parse(row.started_at))} · {row.title}
          </span>
          {model != null && (
            <span className="block text-xs text-ink-2">
              modello meteo {fmtSpeed(model, unit)} {u}
            </span>
          )}
        </Link>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          inputMode="decimal"
          placeholder="15"
          aria-label={`Vento medio in acqua il ${fmtShortDate(Date.parse(row.started_at))} (${u})`}
          className="w-16 rounded-lg border border-line bg-surface px-2 py-1.5 text-base"
        />
        <span className="text-ink-2">{u}</span>
        <button type="submit" className={btnGhost} disabled={ms == null || busy}>
          Salva
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-critical">{error}</p>}
    </li>
  )
}

/** Analyses again the sessions uploaded before polars were kept, so they join the best polars. */
function AddPolars({ rows, onDone }: { rows: CloudSession[]; onDone: () => void }) {
  const { settings } = useSettings()
  const library = useLibrary()
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setError(null)
    setDone(0)
    try {
      for (const [k, r] of rows.entries()) {
        const d = await loadTrack(r)
        const a = await analyzeInWorker(d.track, d.wind, { foilOnKn: settings.foilOnKn, windOverride: r.wind_override, modelWind: r.model_wind })
        await updateSession(r.id, { summary: a.summary })
        await library.mirror(r.id, { summary: a.summary, foilOnKn: settings.foilOnKn })
        setDone(k + 1)
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDone(null)
    }
  }
  const n = rows.length
  return (
    <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
      <p>
        {n === 1 ? 'Un’uscita è stata caricata' : `${n} uscite sono state caricate`} prima delle polari: per aggiungerle, FoilLog ne scarica le tracce e le
        analizza di nuovo.
      </p>
      <button type="button" className={btnSecondary} disabled={done != null} onClick={run}>
        {done == null ? `Aggiungi ${n === 1 ? 'l’uscita' : `le ${n} uscite`}` : `Analizzo ${done + 1} di ${n}…`}
      </button>
      {error && <p className="text-critical">{error}</p>}
    </div>
  )
}

function SessionList({ rows, settings, showName }: { rows: CloudSession[]; settings: Settings; showName?: boolean }) {
  const u = SPEED_SHORT[settings.speedUnit]
  return (
    <ul className="space-y-2">
      {rows.slice(0, 50).map((r) => (
        <li key={r.id}>
          <Link to={`/c/${r.id}`} className={`${card} flex items-center gap-3 p-2.5`}>
            <TrackThumb points={r.preview} className="h-12 w-[76px] shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{showName ? `${r.profile?.display_name ?? 'Rider'} · ${r.title}` : r.title}</span>
              <span className="block text-sm text-ink-2">
                {fmtShortDate(Date.parse(r.started_at))} · {fmtDist(r.summary.distance, settings.distUnit)} · max {fmtSpeed(r.summary.records.s2, settings.speedUnit)} {u}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** /spot/:id — the crew's sessions at one spot and who holds its records. */
export function SpotPage() {
  const { id = '' } = useParams()
  return (
    <RequireAuth why="Le classifiche degli spot si vedono dopo l'accesso.">
      <SpotView key={id} id={id} />
    </RequireAuth>
  )
}

function SpotView({ id }: { id: string }) {
  const { settings } = useSettings()
  const [rows, setRows] = useState<CloudSession[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'month' | 'season' | 'all'>('season')
  const [key, setKey] = useState<RecordKey>('s10')

  useEffect(() => {
    sessionsAtSpot(id)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
    listSpots()
      .then((s) => setName(s.find((x) => x.id === id)?.name ?? 'Spot'))
      .catch(() => {})
  }, [id])

  const now = Date.now()
  const shown = (rows ?? []).filter((r) => {
    const t = Date.parse(r.started_at)
    if (period === 'month') return now - t < 31 * 86_400_000
    if (period === 'season') return new Date(t).getFullYear() === new Date(now).getFullYear()
    return true
  })
  const board = leaderboard(shown, key)
  const nameOf = (uid: string) => shown.find((r) => r.user_id === uid)?.profile?.display_name ?? 'Rider'

  if (error) return <p className={`${card} p-4 text-sm text-critical`}>{error}</p>
  if (!rows) return <p className="py-16 text-center text-ink-2">Carico lo spot…</p>
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="text-sm text-ink-2">{rows.length} uscite della crew in questo spot.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Segmented
          label="Periodo"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'month', label: 'Ultimo mese' },
            { value: 'season', label: 'Stagione' },
            { value: 'all', label: 'Sempre' },
          ]}
        />
        <Segmented
          label="Classifica"
          value={key}
          onChange={setKey}
          options={[
            { value: 's10', label: '10 s' },
            { value: 's2', label: '2 s' },
            { value: 'm500', label: '500 m' },
          ]}
        />
      </div>
      <div className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <caption className="px-3 pt-3 text-left text-sm font-semibold">Classifica ({SPEED_SHORT[settings.speedUnit]})</caption>
          <tbody>
            {board.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-ink-2">Nessuna uscita in questo periodo.</td>
              </tr>
            )}
            {board.map((r, k) => (
              <tr key={r.userId} className="border-t border-line first:border-t-0">
                <td className="w-8 px-3 py-2 text-ink-2 tabular">{k + 1}</td>
                <td className="px-2 py-2">
                  <Link to={`/rider/${r.userId}`} className="font-medium">
                    {nameOf(r.userId)}
                  </Link>
                  <span className="text-xs text-ink-2"> · {r.sessions} uscite</span>
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular">{fmtSpeed(r.best!.value, settings.speedUnit)}</td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/c/${r.best!.item.id}`} className="text-accent">
                    {fmtShortDate(Date.parse(r.best!.item.started_at))}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SessionList rows={shown} settings={settings} showName />
    </div>
  )
}
