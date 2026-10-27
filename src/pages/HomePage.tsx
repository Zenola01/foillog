import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileDrop } from '../components/FileDrop'
import { IconX } from '../components/icons'
import { TrackThumb } from '../components/TrackThumb'
import { btnPrimary, btnSecondary, card } from '../components/ui'
import { useLibrary, type ImportJob } from '../lib/library'
import { useSettings } from '../lib/settings'
import type { SessionRecord } from '../lib/store'
import { fmtDate, fmtDist, fmtDuration, fmtPct, fmtSpeed, fmtTime, SPEED_SHORT } from '../lib/units'

const STATUS: Record<ImportJob['status'], string> = {
  reading: 'Lettura…',
  analyzing: 'Analisi…',
  done: 'Importata',
  duplicate: 'Già presente',
  error: 'Errore',
}

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

export default function HomePage() {
  const { sessions, jobs, importFiles, importDemo, dismissJobs, persistent } = useLibrary()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string[]>([])
  const [demoBusy, setDemoBusy] = useState(false)

  const groups = useMemo(() => {
    const out: { label: string; items: SessionRecord[] }[] = []
    for (const s of sessions ?? []) {
      const label = dayLabel(s.summary.start)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(s)
      else out.push({ label, items: [s] })
    }
    return out
  }, [sessions])

  const onFiles = async (files: File[]) => {
    const created = await importFiles(files)
    if (files.length === 1 && created.length === 1) navigate(`/s/${created[0].id}`)
  }

  const toggle = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length >= 4 ? sel : [...sel, id]))

  const u = SPEED_SHORT[settings.speedUnit]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Le tue uscite</h1>
        <p className="text-sm text-ink-2">
          {sessions == null ? 'Caricamento…' : sessions.length === 0 ? 'Ancora nessuna uscita.' : `${sessions.length} uscite su questo dispositivo`}
        </p>
      </div>

      {!persistent && (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
          Questo browser non permette di salvare dati: le uscite resteranno solo finché la pagina è aperta.
        </p>
      )}

      <FileDrop onFiles={onFiles} compact={!!sessions?.length} />

      {jobs.length > 0 && (
        <div className={`${card} p-3`}>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-semibold">Importazione</p>
            {jobs.every((j) => j.status !== 'reading' && j.status !== 'analyzing') && (
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
                  <Link to={`/s/${j.sessionId}`} className="font-medium text-accent">
                    {STATUS[j.status]} · apri
                  </Link>
                ) : (
                  <span className="text-ink-2">{STATUS[j.status]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sessions?.length === 0 && (
        <div className={`${card} space-y-3 p-5`}>
          <p className="font-semibold">Vuoi vedere come funziona?</p>
          <p className="text-sm text-ink-2">
            Carica due uscite di esempio sul Lago di Garda, la tua e quella di un amico nello stesso pomeriggio: potrai provare
            mappa, grafici, manovre e confronto prima di caricare i tuoi file.
          </p>
          <button
            type="button"
            className={btnSecondary}
            disabled={demoBusy}
            onClick={async () => {
              setDemoBusy(true)
              try {
                const [mine] = await importDemo()
                if (mine) navigate(`/s/${mine.id}`)
              } finally {
                setDemoBusy(false)
              }
            }}
          >
            {demoBusy ? 'Preparo gli esempi…' : 'Prova con le uscite di esempio'}
          </button>
          <p className="text-sm text-ink-2">
            Come esportare i file dal Vakaros e dall'Apple Watch? Trovi la guida in{' '}
            <Link to="/impostazioni" className="font-medium text-accent">
              Impostazioni
            </Link>
            .
          </p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.label} className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-2 first-letter:uppercase">{g.label}</h2>
          <ul className="space-y-2">
            {g.items.map((s) => {
              const on = selected.includes(s.id)
              const sum = s.summary
              return (
                <li key={s.id} className={`${card} flex items-center gap-3 p-2.5 ${on ? 'ring-2 ring-[var(--series-1)]' : ''}`}>
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
                      checked={on}
                      onChange={() => toggle(s.id)}
                      className="h-5 w-5 accent-[var(--series-1)]"
                      aria-label={`Seleziona ${s.title} per il confronto`}
                    />
                    confronta
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

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
