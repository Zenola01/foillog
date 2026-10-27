import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EChart } from '../components/EChart'
import { RequireAuth } from '../components/RequireAuth'
import { TrackThumb } from '../components/TrackThumb'
import { card, Segmented, StatTile } from '../components/ui'
import { useAuth } from '../lib/auth'
import { progressOption } from '../lib/charts'
import { listSpots, sessionsAtSpot, sessionsOf, type CloudSession } from '../lib/cloud'
import { bestOf, leaderboard, totals } from '../lib/crewStats'
import { useSettings, type Settings } from '../lib/settings'
import { useTheme } from '../lib/theme'
import type { RecordKey } from '../lib/types'
import { fmtDist, fmtDuration, fmtPct, fmtShortDate, fmtSpeed, SPEED_SHORT } from '../lib/units'

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

  useEffect(() => {
    sessionsOf(uid)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [uid])

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

  if (error) return <p className={`${card} p-4 text-sm text-critical`}>{error}</p>
  if (!rows) return <p className="py-16 text-center text-ink-2">Carico le uscite…</p>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{me ? 'I tuoi record' : `Record di ${name}`}</h1>
        <p className="text-sm text-ink-2">Dalle uscite condivise nella crew{me ? '' : ' che puoi vedere'}.</p>
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
