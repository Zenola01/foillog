import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FeedCard } from '../components/FeedCard'
import { FileDrop } from '../components/FileDrop'
import { IconShare, IconX } from '../components/icons'
import { ScorePanel, SessionLine } from '../components/Scores'
import { btnGhost, btnPrimary, btnSecondary, card, instrumentLabel, Segmented } from '../components/ui'
import { lacksPerf, sessionScores } from '../lib/analysis/scores'
import { useAuth } from '../lib/auth'
import { feed, myCrews, type CloudSession } from '../lib/cloud'
import { byDay } from '../lib/crewStats'
import { useLibrary, type ImportJob } from '../lib/library'
import { useMissingScores, useOthersPerf } from '../lib/missingScores'
import { isMyName, useSettings, type Settings } from '../lib/settings'
import type { SessionRecord } from '../lib/store'
import { together, type Span } from '../lib/together'
import type { SessionSummary } from '../lib/types'
import { fmtDate, fmtShortDate, fmtTime } from '../lib/units'

const STATUS: Record<ImportJob['status'], string> = {
  reading: 'Lettura…',
  analyzing: 'Analisi…',
  sharing: 'Invio alla crew…',
  done: 'Importata',
  duplicate: 'Già presente',
  error: 'Errore',
}

const PAGE = 30

function dayLabel(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const yest = new Date()
  yest.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Oggi'
  if (same(d, yest)) return 'Ieri'
  return fmtDate(ms)
}

/** The line under a title: the time, unless the title says it already (as the ones the app makes up do), and the rest. */
function aboutLine(s: Pick<SessionRecord, 'title' | 'summary'>, ...rest: (string | false | undefined)[]): string {
  const time = fmtTime(s.summary.start)
  return [!s.title.includes(time) && time, ...rest].filter(Boolean).join(' · ')
}

/** A session in the list: from the crew's project, or kept on this device only. */
type Entry = { at: number; row: CloudSession; rec?: undefined } | { at: number; rec: SessionRecord; row?: undefined }

type View = 'mine' | 'feed'

/** Kept while going into a session and back; the app always starts on your own sessions. */
let lastView: View = 'mine'

export default function HomePage() {
  const { ready, user, profile } = useAuth()
  const { sessions, jobs, importFiles, importDemo, dismissJobs, persistent, share, cloudVersion } = useLibrary()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [view, setView] = useState(lastView)
  const [selected, setSelected] = useState<string[]>([])
  const [demoBusy, setDemoBusy] = useState(false)
  const [loaded, setLoaded] = useState<Record<View, CloudSession[] | null>>({ mine: null, feed: null })
  const [more, setMore] = useState(false)
  const [crewCount, setCrewCount] = useState<number | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [sharing, setSharing] = useState<Record<string, 'busy' | string>>({})

  const userId = user?.id
  const owner = view === 'mine' ? userId : undefined
  useEffect(() => {
    if (!userId) {
      setLoaded({ mine: null, feed: null })
      return
    }
    let alive = true
    setListError(null)
    setMore(false)
    feed(PAGE, undefined, owner)
      .then((r) => {
        if (!alive) return
        setLoaded((l) => ({ ...l, [view]: r }))
        setMore(r.length === PAGE)
      })
      .catch((e: Error) => alive && setListError(e.message))
    return () => {
      alive = false
    }
  }, [userId, owner, view, cloudVersion])

  useEffect(() => {
    if (!userId || view !== 'feed') return
    let alive = true
    myCrews()
      .then((c) => alive && setCrewCount(c.length))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [userId, view])

  // Shared sessions come from the crew's project and the device keeps the rest: one list, day by day.
  const rows = loaded[view]
  const local = useMemo(() => (sessions ?? []).filter((s) => !s.cloudId), [sessions])
  const accountName = profile?.display_name
  const isMine = useCallback((s: SessionRecord) => isMyName(s.rider, settings, accountName), [settings, accountName])
  const myLocal = useMemo(() => local.filter(isMine), [local, isMine])
  const scored = useCallback((id: string, summary: SessionSummary) => {
    const patch = (list: CloudSession[] | null) => list && list.map((r) => (r.id === id ? { ...r, summary } : r))
    setLoaded((l) => ({ mine: patch(l.mine), feed: patch(l.feed) }))
  }, [])
  useMissingScores(loaded.mine, local, scored)
  const othersPerf = useOthersPerf(loaded.feed, userId)
  const days = useMemo(() => {
    const entries: Entry[] = [
      ...(rows ?? []).map((r) => ({
        at: Date.parse(r.started_at),
        row: lacksPerf(r.summary) && othersPerf.has(r.id) ? { ...r, summary: { ...r.summary, perf: othersPerf.get(r.id) } } : r,
      })),
      ...(view === 'mine' ? myLocal : local).map((rec) => ({ at: rec.summary.start, rec })),
    ]
    return byDay(entries, (e) => e.at)
  }, [rows, othersPerf, view, myLocal, local])
  // Your latest session with an overall score heads your own list.
  const latest = useMemo(() => {
    if (view !== 'mine') return null
    for (const g of days) {
      for (const e of g.items) {
        const scores = e.row ? sessionScores(e.row.summary.perf, e.row.wind_speed) : sessionScores(e.rec.summary.perf, e.rec.windSpeed)
        if (scores?.overall != null) return { e, scores }
      }
    }
    return null
  }, [view, days])

  const onFiles = async (files: File[]) => {
    const created = await importFiles(files)
    if (files.length === 1 && created.length === 1) navigate(created[0].cloudId ? `/c/${created[0].cloudId}` : `/s/${created[0].id}`)
  }
  const toggle = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length >= 4 ? sel : [...sel, id]))
  // Only sessions sailed at the same time can be compared: the box shows where somebody else was on
  // the water together, and once one is ticked, only the sessions sailed with it can join.
  const spans = useMemo(() => {
    const m = new Map<string, Span>()
    for (const r of loaded.feed ?? []) m.set(`c:${r.id}`, { start: Date.parse(r.started_at), end: Date.parse(r.ended_at) })
    for (const s of local) m.set(s.id, s.summary)
    return m
  }, [loaded.feed, local])
  const paired = useMemo(() => {
    const ids = [...spans.keys()]
    return new Set(ids.filter((a) => ids.some((b) => b !== a && together([spans.get(a)!, spans.get(b)!]))))
  }, [spans])
  const pick = (id: string): { selected?: boolean; onToggle?: () => void; blocked?: string } => {
    if (!paired.has(id)) return {}
    const on = selected.includes(id)
    const chosen = selected.flatMap((x) => spans.get(x) ?? [])
    const blocked = on ? undefined : chosen.length >= 4 ? 'max 4' : chosen.length && !together([...chosen, spans.get(id)!]) ? 'altro orario' : undefined
    return { selected: on, onToggle: () => toggle(id), blocked }
  }
  const shareOne = async (id: string) => {
    setSharing((m) => ({ ...m, [id]: 'busy' }))
    try {
      await share(id)
      setSharing((m) => {
        const { [id]: _done, ...rest } = m
        return rest
      })
    } catch (e) {
      setSharing((m) => ({ ...m, [id]: e instanceof Error ? e.message : String(e) }))
    }
  }

  const empty = sessions != null && myLocal.length === 0 && (!user || loaded.mine?.length === 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="font-display text-[30px] leading-none font-bold tracking-wider uppercase">Uscite</h1>
        <Segmented
          label="Quali uscite vedere"
          value={view}
          onChange={(v) => {
            lastView = v
            setView(v)
          }}
          options={[
            { value: 'mine', label: 'Le mie' },
            { value: 'feed', label: 'Feed' },
          ]}
        />
      </div>

      {!persistent && (
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
          Questo browser non permette di salvare dati: le uscite resteranno solo finché la pagina è aperta.
        </p>
      )}

      {latest && (
        <Link to={latest.e.row ? `/c/${latest.e.row.id}` : `/s/${latest.e.rec.id}`} className="block">
          <ScorePanel scores={latest.scores} caption={`${fmtShortDate(latest.e.at)} · Overall`} />
        </Link>
      )}

      {view === 'mine' && (
        <div className="space-y-2">
          <FileDrop onFiles={onFiles} compact={!empty} />
          <p className="px-1 text-xs text-ink-2">{user ? 'Le tue uscite vanno anche nel feed della crew.' : 'Le uscite restano su questo dispositivo.'}</p>
        </div>
      )}

      {jobs.length > 0 && (
        <div className={`${card} p-3`}>
          <div className="mb-1 flex items-center justify-between">
            <p className="font-display text-[16px] leading-tight font-semibold tracking-wider uppercase">Importazione</p>
            {jobs.every((j) => j.status === 'done' || j.status === 'duplicate' || j.status === 'error') && (
              <button type="button" onClick={dismissJobs} className="rounded-lg p-1 text-ink-2 hover:bg-surface-2" aria-label="Chiudi">
                <IconX width={18} height={18} />
              </button>
            )}
          </div>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {jobs.map((j) => (
              <li key={j.key} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate">{j.name}</span>
                {j.status === 'error' ? (
                  <span className="text-right text-critical">{j.error}</span>
                ) : j.sessionId && (j.status === 'done' || j.status === 'duplicate') ? (
                  <Link to={j.cloudId ? `/c/${j.cloudId}` : `/s/${j.sessionId}`} className="text-right font-medium text-accent">
                    {j.status === 'done' && j.cloudId ? 'Condivisa con la crew' : STATUS[j.status]} · apri
                    {j.shareError && <span className="block text-xs font-normal text-ink-2">Salvata solo qui: {j.shareError}</span>}
                  </Link>
                ) : (
                  <span className="text-ink-2">{STATUS[j.status]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === 'feed' && ready && !user && (
        <div className={`${card} space-y-2 p-4`}>
          <p className="font-display text-[19px] leading-tight font-semibold">Condividi le uscite con la tua crew</p>
          <p className="text-sm text-ink-2">
            Con un account gratuito le tue uscite vanno nel feed degli amici, e vedi «La giornata» con il replay di tutti quelli che erano in
            acqua.
          </p>
          <Link to="/accedi?mode=signup" className={btnPrimary}>
            Crea un account
          </Link>
        </div>
      )}
      {view === 'feed' && user && crewCount === 0 && (
        <div className={`${card} space-y-2 p-4`}>
          <p className="font-display text-[19px] leading-tight font-semibold">Non sei ancora in una crew</p>
          <p className="text-sm text-ink-2">Creane una e manda il link agli amici, oppure apri il link d'invito che ti hanno mandato.</p>
          <Link to="/crew" className={btnPrimary}>
            Vai alle crew
          </Link>
        </div>
      )}

      {view === 'mine' && empty && <DemoCard busy={demoBusy} onDemo={async () => {
        setDemoBusy(true)
        try {
          const [mine] = await importDemo()
          if (mine) navigate(`/s/${mine.id}`)
        } finally {
          setDemoBusy(false)
        }
      }} />}

      {user && listError && <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-critical">{listError}</p>}
      {user && rows == null && !listError && <p className="text-sm text-ink-2">{view === 'mine' ? 'Carico le tue uscite…' : 'Carico il feed della crew…'}</p>}
      {view === 'feed' && user && rows != null && days.length === 0 && !!crewCount && <p className="text-sm text-ink-2">Ancora nessuna uscita nella crew.</p>}

      {days.map((g) => (
        <section key={g.key} className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className={`min-w-0 flex-1 ${instrumentLabel}`}>{dayLabel(g.items[0].at)}</h2>
            {view === 'feed' && new Set(g.items.flatMap((e) => e.row?.user_id ?? [])).size > 1 && (
              <Link to={`/giornata/${g.key}`} className={btnGhost}>
                La giornata →
              </Link>
            )}
          </div>
          <ul className="divide-y divide-[var(--border)] border-y border-line">
            {g.items.map((e) =>
              e.rec ? (
                <LocalCard
                  key={e.rec.id}
                  s={e.rec}
                  settings={settings}
                  showRider={view === 'feed'}
                  {...(view === 'feed' ? pick(e.rec.id) : {})}
                  canShare={!!user && !e.rec.demo && isMine(e.rec)}
                  sharing={sharing[e.rec.id]}
                  onShare={() => shareOne(e.rec.id)}
                />
              ) : view === 'feed' ? (
                <FeedCard key={e.row.id} s={e.row} userId={user!.id} settings={settings} {...pick(`c:${e.row.id}`)} />
              ) : (
                <OutingCard
                  key={e.row.id}
                  to={`/c/${e.row.id}`}
                  s={e.row}
                  windSpeed={e.row.wind_speed}
                  about={aboutLine(e.row, e.row.spot?.name, e.row.visibility === 'private' && 'solo per te')}
                  settings={settings}
                />
              ),
            )}
          </ul>
        </section>
      ))}
      {user && more && rows && (
        <button
          type="button"
          className={btnSecondary}
          onClick={() =>
            feed(PAGE, rows[rows.length - 1].started_at, owner)
              .then((r) => {
                setLoaded((l) => ({ ...l, [view]: [...rows, ...r] }))
                setMore(r.length === PAGE)
              })
              .catch((e: Error) => setListError(e.message))
          }
        >
          Mostra altre uscite
        </button>
      )}

      {view === 'feed' && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 shadow-lg">
            <span className="text-sm">{selected.length === 1 ? 'Scegli un’altra uscita nello stesso orario' : `${selected.length} uscite selezionate`}</span>
            <button
              type="button"
              className={btnPrimary}
              disabled={selected.length < 2}
              onClick={() => navigate(`/confronta?ids=${selected.join(',')}`)}
            >
              Confronta
            </button>
            <button type="button" onClick={() => setSelected([])} className="rounded-lg p-1 text-ink-2" aria-label="Annulla selezione">
              <IconX width={18} height={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DemoCard({ busy, onDemo }: { busy: boolean; onDemo: () => void }) {
  return (
    <div className={`${card} space-y-3 p-5`}>
      <p className="font-display text-[19px] leading-tight font-semibold">Vuoi vedere come funziona?</p>
      <p className="text-sm text-ink-2">
        Carica due uscite di esempio sul Lago di Garda, la tua e quella di un amico nello stesso pomeriggio: potrai provare mappa, grafici,
        manovre e confronto prima di caricare i tuoi file. Gli esempi restano su questo dispositivo.
      </p>
      <button type="button" className={btnSecondary} disabled={busy} onClick={onDemo}>
        {busy ? 'Preparo gli esempi…' : 'Prova con le uscite di esempio'}
      </button>
      <p className="text-sm text-ink-2">
        Come esportare i file dal Vakaros e dall'Apple Watch? Trovi la guida in{' '}
        <Link to="/impostazioni" className="font-medium text-accent">
          Impostazioni
        </Link>
        .
      </p>
    </div>
  )
}

/** A session in a list that needs no name, 🤙 or comments on it. */
function OutingCard({
  to,
  s,
  windSpeed,
  about,
  settings,
  selected,
  onToggle,
  blocked,
  children,
}: {
  to: string
  s: Pick<SessionRecord, 'title' | 'preview' | 'summary'>
  windSpeed: number | null | undefined
  /** The line under the title. */
  about: string
  settings: Settings
  selected?: boolean
  /** Without it there is no compare box (nobody else on the water at the same time). */
  onToggle?: () => void
  /** Why it cannot join the sessions already ticked. */
  blocked?: string
  children?: ReactNode
}) {
  return (
    <li className={`py-2.5 ${selected ? 'bg-surface-2' : ''}`}>
      <div className="flex items-center gap-3">
        <Link to={to} className="flex min-w-0 flex-1 items-center gap-3">
          <SessionLine s={s} windSpeed={windSpeed} about={about} settings={settings} />
        </Link>
        {onToggle && (
          <label className={`flex shrink-0 flex-col items-center gap-0.5 px-1 text-[11px] text-ink-2 ${blocked ? 'opacity-60' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={!!selected}
              disabled={!!blocked}
              onChange={onToggle}
              className="h-5 w-5 accent-[var(--accent-btn)]"
              aria-label={`Seleziona ${s.title} per il confronto`}
            />
            {blocked ?? 'confronta'}
          </label>
        )}
      </div>
      {children}
    </li>
  )
}

/** A session kept on this device only. */
function LocalCard({
  s,
  showRider,
  canShare,
  sharing,
  onShare,
  ...rest
}: {
  s: SessionRecord
  showRider: boolean
  settings: Settings
  selected?: boolean
  onToggle?: () => void
  blocked?: string
  canShare: boolean
  sharing?: 'busy' | string
  onShare: () => void
}) {
  return (
    <OutingCard to={`/s/${s.id}`} s={s} windSpeed={s.windSpeed} about={aboutLine(s, showRider && s.rider, s.demo && 'esempio')} {...rest}>
      {canShare && (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
          <button type="button" className={btnGhost} onClick={onShare} disabled={sharing === 'busy'}>
            <IconShare width={16} height={16} />
            {sharing === 'busy' ? 'Invio…' : 'Condividi con la crew'}
          </button>
          {sharing && sharing !== 'busy' && <span className="text-xs text-critical">{sharing}</span>}
        </div>
      )}
    </OutingCard>
  )
}
