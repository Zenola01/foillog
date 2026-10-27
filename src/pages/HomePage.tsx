import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FeedCard } from '../components/FeedCard'
import { FileDrop } from '../components/FileDrop'
import { IconShare, IconX } from '../components/icons'
import { TrackThumb } from '../components/TrackThumb'
import { btnGhost, btnPrimary, btnSecondary, card, Segmented } from '../components/ui'
import { useAuth } from '../lib/auth'
import { feed, myCrews, type CloudSession } from '../lib/cloud'
import { dayKey } from '../lib/crewStats'
import { useLibrary, type ImportJob } from '../lib/library'
import { useSettings, type Settings } from '../lib/settings'
import type { SessionRecord } from '../lib/store'
import { fmtDate, fmtDist, fmtDuration, fmtPct, fmtSpeed, fmtTime, SPEED_SHORT } from '../lib/units'

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

function byDay<T>(items: T[], time: (x: T) => number): { key: string; label: string; items: T[] }[] {
  const out: { key: string; label: string; items: T[] }[] = []
  for (const it of items) {
    const t = time(it)
    const key = dayKey(t)
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(it)
    else out.push({ key, label: dayLabel(t), items: [it] })
  }
  return out
}

export default function HomePage() {
  const { ready, user } = useAuth()
  const { sessions, jobs, importFiles, importDemo, dismissJobs, persistent, share, cloudVersion } = useLibrary()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string[]>([])
  const [demoBusy, setDemoBusy] = useState(false)
  const [rows, setRows] = useState<CloudSession[] | null>(null)
  const [more, setMore] = useState(false)
  const [crewCount, setCrewCount] = useState<number | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [sharing, setSharing] = useState<Record<string, 'busy' | string>>({})
  const [whose, setWhose] = useState<'mine' | 'friend'>('mine')
  const [friend, setFriend] = useState('')

  const userId = user?.id
  useEffect(() => {
    if (!userId) {
      setRows(null)
      setCrewCount(null)
      return
    }
    let alive = true
    setFeedError(null)
    feed(PAGE)
      .then((r) => {
        if (!alive) return
        setRows(r)
        setMore(r.length === PAGE)
      })
      .catch((e: Error) => alive && setFeedError(e.message))
    myCrews()
      .then((c) => alive && setCrewCount(c.length))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [userId, cloudVersion])

  // Shared sessions show in the crew feed; the device list keeps the rest.
  const local = useMemo(() => (sessions ?? []).filter((s) => !s.cloudId), [sessions])
  const feedDays = useMemo(() => byDay(rows ?? [], (r) => Date.parse(r.started_at)), [rows])
  const localDays = useMemo(() => byDay(local, (s) => s.summary.start), [local])

  const onFiles = async (files: File[]) => {
    const created = await importFiles(files, whose === 'friend' ? { friend: friend.trim() || 'Amico' } : {})
    if (files.length === 1 && created.length === 1) navigate(created[0].cloudId ? `/c/${created[0].cloudId}` : `/s/${created[0].id}`)
  }
  const toggle = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length >= 4 ? sel : [...sel, id]))
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

  const empty = sessions != null && local.length === 0 && (!user || rows?.length === 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Uscite</h1>
        <p className="text-sm text-ink-2">
          {user ? 'Le uscite della tua crew e quelle salvate su questo dispositivo.' : 'Le uscite salvate su questo dispositivo.'}
        </p>
      </div>

      {!persistent && (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
          Questo browser non permette di salvare dati: le uscite resteranno solo finché la pagina è aperta.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Di chi sono le uscite da caricare"
            value={whose}
            onChange={setWhose}
            options={[
              { value: 'mine', label: 'Mie' },
              { value: 'friend', label: 'Di un amico' },
            ]}
          />
          {whose === 'friend' && (
            <input
              value={friend}
              onChange={(e) => setFriend(e.target.value)}
              maxLength={40}
              placeholder="Nome dell'amico"
              aria-label="Nome dell'amico"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-base sm:max-w-xs"
            />
          )}
        </div>
        <p className="px-1 text-xs text-ink-2">
          {whose === 'mine'
            ? user
              ? 'Le tue uscite vanno anche nel feed della crew.'
              : 'Le uscite restano su questo dispositivo.'
            : 'Le uscite di un amico restano solo su questo dispositivo, a suo nome: per metterle nella crew deve caricarle lui con il suo account.'}
        </p>
        <FileDrop onFiles={onFiles} compact={!empty} />
      </div>

      {jobs.length > 0 && (
        <div className={`${card} p-3`}>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-semibold">Importazione</p>
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

      {ready && !user && (
        <div className={`${card} space-y-2 p-4`}>
          <p className="font-semibold">Condividi le uscite con la tua crew</p>
          <p className="text-sm text-ink-2">
            Con un account gratuito le tue uscite vanno nel feed degli amici, e vedi «La giornata» con il replay di tutti quelli che erano in
            acqua.
          </p>
          <Link to="/accedi?mode=signup" className={btnPrimary}>
            Crea un account
          </Link>
        </div>
      )}
      {user && crewCount === 0 && (
        <div className={`${card} space-y-2 p-4`}>
          <p className="font-semibold">Non sei ancora in una crew</p>
          <p className="text-sm text-ink-2">Creane una e manda il link agli amici, oppure apri il link d'invito che ti hanno mandato.</p>
          <Link to="/crew" className={btnPrimary}>
            Vai alle crew
          </Link>
        </div>
      )}

      {empty && <DemoCard busy={demoBusy} onDemo={async () => {
        setDemoBusy(true)
        try {
          const [mine] = await importDemo()
          if (mine) navigate(`/s/${mine.id}`)
        } finally {
          setDemoBusy(false)
        }
      }} />}

      {user && feedError && <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-critical">{feedError}</p>}
      {user && rows == null && !feedError && <p className="text-sm text-ink-2">Carico il feed della crew…</p>}

      {feedDays.map((g) => (
        <section key={`f-${g.key}`} className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 text-sm font-semibold text-ink-2 first-letter:uppercase">{g.label}</h2>
            {new Set(g.items.map((r) => r.user_id)).size > 1 && (
              <Link to={`/giornata/${g.key}`} className={btnGhost}>
                La giornata →
              </Link>
            )}
          </div>
          <ul className="space-y-2">
            {g.items.map((r) => (
              <FeedCard
                key={r.id}
                s={r}
                userId={user!.id}
                settings={settings}
                selected={selected.includes(`c:${r.id}`)}
                onToggle={() => toggle(`c:${r.id}`)}
              />
            ))}
          </ul>
        </section>
      ))}
      {user && more && rows && (
        <button
          type="button"
          className={btnSecondary}
          onClick={() =>
            feed(PAGE, rows[rows.length - 1].started_at)
              .then((r) => {
                setRows([...rows, ...r])
                setMore(r.length === PAGE)
              })
              .catch((e: Error) => setFeedError(e.message))
          }
        >
          Mostra altre uscite
        </button>
      )}

      {local.length > 0 && (
        <div className="space-y-2">
          {user && (
            <div className="flex items-center gap-2 pt-2">
              <h2 className="min-w-0 flex-1 text-base font-semibold">Solo su questo dispositivo</h2>
            </div>
          )}
          {localDays.map((g) => (
            <section key={`l-${g.key}`} className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-2 first-letter:uppercase">{g.label}</h3>
              <ul className="space-y-2">
                {g.items.map((s) => (
                  <LocalCard
                    key={s.id}
                    s={s}
                    settings={settings}
                    selected={selected.includes(s.id)}
                    onToggle={() => toggle(s.id)}
                    canShare={!!user && !s.demo}
                    sharing={sharing[s.id]}
                    onShare={() => shareOne(s.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lg">
            <span className="text-sm">{selected.length === 1 ? 'Scegli almeno un’altra uscita' : `${selected.length} uscite selezionate`}</span>
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
      <p className="font-semibold">Vuoi vedere come funziona?</p>
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

function LocalCard({
  s,
  settings,
  selected,
  onToggle,
  canShare,
  sharing,
  onShare,
}: {
  s: SessionRecord
  settings: Settings
  selected: boolean
  onToggle: () => void
  canShare: boolean
  sharing?: 'busy' | string
  onShare: () => void
}) {
  const sum = s.summary
  const u = SPEED_SHORT[settings.speedUnit]
  return (
    <li className={`${card} p-2.5 ${selected ? 'ring-2 ring-[var(--series-1)]' : ''}`}>
      <div className="flex items-center gap-3">
        <Link to={`/s/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <TrackThumb points={s.preview} className="h-16 w-[100px] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{s.title}</p>
            <p className="truncate text-sm text-ink-2">
              {fmtTime(sum.start)} · {s.rider}
              {s.demo ? ' · esempio' : ''}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm">
              <span>{fmtDist(sum.distance, settings.distUnit)}</span>
              <span>{fmtDuration(sum.duration)}</span>
              <span>
                max {fmtSpeed(sum.records.s2, settings.speedUnit)} {u}
              </span>
              <span>{fmtPct(sum.foilShare)} in foil</span>
            </p>
          </div>
        </Link>
        <label className="flex shrink-0 cursor-pointer flex-col items-center gap-0.5 px-1 text-[11px] text-ink-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="h-5 w-5 accent-[var(--series-1)]"
            aria-label={`Seleziona ${s.title} per il confronto`}
          />
          confronta
        </label>
      </div>
      {canShare && (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
          <button type="button" className={btnGhost} onClick={onShare} disabled={sharing === 'busy'}>
            <IconShare width={16} height={16} />
            {sharing === 'busy' ? 'Invio…' : 'Condividi con la crew'}
          </button>
          {sharing && sharing !== 'busy' && <span className="text-xs text-critical">{sharing}</span>}
        </div>
      )}
    </li>
  )
}
