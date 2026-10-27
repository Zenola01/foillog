import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { KudosButton } from '../components/FeedCard'
import { Avatar, RequireAuth } from '../components/RequireAuth'
import { btnGhost, btnPrimary, btnSecondary, card, Segmented } from '../components/ui'
import { useAuth } from '../lib/auth'
import {
  addComment,
  asRecord,
  createSpot,
  deleteComment,
  deleteSession,
  getSession,
  listComments,
  listSpots,
  loadTrack,
  updateSession,
  type CloudSession,
  type Comment,
  type SessionPatch,
  type Spot,
} from '../lib/cloud'
import { dayKey } from '../lib/crewStats'
import { analyzeInWorker } from '../lib/engine'
import { haversine } from '../lib/geo'
import { useLibrary } from '../lib/library'
import { useSettings } from '../lib/settings'
import type { SessionData } from '../lib/store'
import { useTheme } from '../lib/theme'
import type { SessionAnalysis } from '../lib/types'
import { fmtDate, fmtDist, fmtTime } from '../lib/units'
import { SessionView } from './SessionPage'

export default function CloudSessionPage() {
  return (
    <RequireAuth why="Le uscite della crew si vedono dopo l'accesso.">
      <CloudSessionLoader />
    </RequireAuth>
  )
}

function CloudSessionLoader() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const { settings } = useSettings()
  const { colors } = useTheme()
  const library = useLibrary()
  const navigate = useNavigate()
  const [row, setRow] = useState<CloudSession | null | undefined>(undefined)
  const [data, setData] = useState<SessionData | null>(null)
  const [a, setA] = useState<SessionAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(
    () =>
      getSession(id)
        .then(setRow)
        .catch((e: Error) => setError(e.message)),
    [id],
  )
  useEffect(() => {
    setRow(undefined)
    setData(null)
    setA(null)
    setError(null)
    void reload()
  }, [reload])

  const trackKey = row ? `${row.id}:${row.track_path}` : ''
  useEffect(() => {
    if (!row) return
    let alive = true
    loadTrack(row)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey])

  const owner = !!row && row.user_id === user?.id
  const windOverride = row?.wind_override ?? null
  const modelDir = row?.model_wind?.dir ?? null
  useEffect(() => {
    if (!row || !data) return
    let alive = true
    analyzeInWorker(data.track, data.wind, { foilOnKn: settings.foilOnKn, windOverride: row.wind_override, modelWind: row.model_wind })
      .then((res) => {
        if (!alive) return
        setA(res)
        const s = row.summary
        // The owner's copy keeps the stored numbers in step with the analysis (wind, threshold).
        if (owner && (s.windDir !== res.summary.windDir || s.jibes !== res.summary.jibes || s.foilTime !== res.summary.foilTime)) {
          void updateSession(row.id, { summary: res.summary }).catch(() => {})
        }
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, windOverride, modelDir, settings.foilOnKn, owner])

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
  if (row === null) {
    return (
      <div className={`${card} space-y-3 p-5`}>
        <p className="font-semibold">Uscita non trovata</p>
        <p className="text-sm text-ink-2">È stata eliminata, oppure non sei nella crew di chi l'ha caricata.</p>
        <Link to="/" className={btnSecondary}>
          Torna alle uscite
        </Link>
      </div>
    )
  }
  if (!row || !data || !a) return <p className="py-16 text-center text-ink-2">Carico l'uscita…</p>

  const meta = (
    <p className="mt-0.5 text-sm text-ink-2">
      {row.spot ? (
        <Link to={`/spot/${row.spot.id}`} className="font-medium text-accent">
          {row.spot.name}
        </Link>
      ) : (
        'Spot non indicato'
      )}
      {row.visibility === 'private' ? ' · visibile solo a te' : ' · visibile alla crew'}
    </p>
  )

  return (
    <SessionView
      key={row.id}
      rec={asRecord(row)}
      data={data}
      a={a}
      settings={settings}
      colors={colors}
      readOnly={!owner}
      riderEditable={false}
      compareId={`c:${row.id}`}
      meta={meta}
      onUpdate={async (patch) => {
        const p: SessionPatch = {}
        if (patch.title !== undefined) p.title = patch.title
        if (patch.notes !== undefined) p.notes = patch.notes
        if ('windOverride' in patch) p.wind_override = patch.windOverride ?? null
        await updateSession(row.id, p)
        await library.mirror(row.id, patch)
        await reload()
      }}
      onDelete={async () => {
        if (!window.confirm('Eliminare questa uscita dalla crew e da questo dispositivo?')) return
        await deleteSession(row)
        await library.removeByCloudId(row.id)
        navigate('/')
      }}
      below={
        <>
          <Social row={row} userId={user!.id} />
          {owner && <OwnerControls row={row} onChanged={reload} />}
          <Link to={`/giornata/${dayKey(Date.parse(row.started_at))}`} className={`${card} flex items-center gap-3 p-3.5`}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">La giornata</span>
              <span className="block text-sm text-ink-2">Chi era in acqua il {fmtDate(Date.parse(row.started_at))}, con il replay di tutti</span>
            </span>
            <span aria-hidden className="text-accent">
              →
            </span>
          </Link>
        </>
      }
    />
  )
}

function Social({ row, userId }: { row: CloudSession; userId: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    listComments(row.id)
      .then(setComments)
      .catch((e: Error) => setError(e.message))
  }, [row.id])
  useEffect(load, [load])
  return (
    <section className={`${card} space-y-3 p-3.5`} id="commenti">
      <div className="flex items-center gap-2">
        <KudosButton s={row} userId={userId} />
        <span className="text-sm text-ink-2">Dai un 🤙 se l'uscita ti piace</span>
      </div>
      <div className="space-y-2.5">
        <p className="text-sm font-semibold">Commenti</p>
        {comments?.length === 0 && <p className="text-sm text-ink-2">Nessun commento: scrivi tu il primo.</p>}
        {comments?.map((c) => (
          <div key={c.id} className="flex gap-2.5">
            <Avatar name={c.profile?.display_name ?? '?'} size={30} />
            <div className="min-w-0 flex-1 text-sm">
              <p>
                <span className="font-semibold">{c.profile?.display_name ?? 'Rider'}</span>{' '}
                <span className="text-xs text-ink-2">
                  {fmtDate(Date.parse(c.created_at))}, {fmtTime(Date.parse(c.created_at))}
                </span>
              </p>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </div>
            {c.user_id === userId && (
              <button
                type="button"
                className={`${btnGhost} self-start text-critical`}
                onClick={() => deleteComment(c.id).then(load).catch((e: Error) => setError(e.message))}
              >
                Elimina
              </button>
            )}
          </div>
        ))}
        {error && <p className="text-sm text-critical">{error}</p>}
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!text.trim()) return
            try {
              await addComment(row.id, text)
              setText('')
              load()
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            }
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder="Scrivi un commento…"
            aria-label="Nuovo commento"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base"
          />
          <button type="submit" className={btnPrimary} disabled={!text.trim()}>
            Invia
          </button>
        </form>
      </div>
    </section>
  )
}

function OwnerControls({ row, onChanged }: { row: CloudSession; onChanged: () => Promise<void> }) {
  const [spots, setSpots] = useState<(Spot & { d: number })[] | null>(null)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await onChanged()
      setSpots(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <section className={`${card} space-y-3 p-3.5`}>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">Chi la vede</p>
        <Segmented
          label="Visibilità"
          value={row.visibility}
          onChange={(v) => run(() => updateSession(row.id, { visibility: v }))}
          options={[
            { value: 'crew', label: 'La crew' },
            { value: 'private', label: 'Solo io' },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Spot</span>{' '}
            <span className="text-ink-2">{row.spot?.name ?? 'non indicato'}</span>
          </p>
          {!spots && (
            <button
              type="button"
              className={btnGhost}
              onClick={() =>
                listSpots()
                  .then((all) =>
                    setSpots(
                      all
                        .map((s) => ({ ...s, d: haversine(row.center_lat, row.center_lon, s.lat, s.lon) }))
                        .filter((s) => s.d < 20000)
                        .sort((x, y) => x.d - y.d),
                    ),
                  )
                  .catch((e: Error) => setError(e.message))
              }
            >
              Cambia
            </button>
          )}
        </div>
        {spots && (
          <div className="space-y-2">
            {spots.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {spots.map((s) => (
                  <button key={s.id} type="button" className={btnSecondary} onClick={() => run(() => updateSession(row.id, { spot_id: s.id }))}>
                    {s.name} <span className="text-xs text-ink-2">{fmtDist(s.d, 'km')}</span>
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (newName.trim())
                  void run(async () => {
                    const s = await createSpot(newName, row.center_lat, row.center_lon)
                    await updateSession(row.id, { spot_id: s.id })
                    setNewName('')
                  })
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                placeholder="Nuovo spot, es. Barcola"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base"
              />
              <button type="submit" className={btnPrimary} disabled={!newName.trim()}>
                Crea
              </button>
            </form>
            <p className="text-xs text-ink-2">Le prossime uscite entro 3 km da uno spot ci verranno assegnate da sole.</p>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-critical">{error}</p>}
    </section>
  )
}
