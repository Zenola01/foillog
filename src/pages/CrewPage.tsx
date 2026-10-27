import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar, RequireAuth } from '../components/RequireAuth'
import { btnGhost, btnPrimary, btnSecondary, card } from '../components/ui'
import { useAuth } from '../lib/auth'
import { createCrew, crewNameByCode, inviteLink, joinCrew, leaveCrew, myCrews, type Crew } from '../lib/cloud'

export default function CrewPage() {
  return (
    <RequireAuth why="Per creare la tua crew o entrare in quella dei tuoi amici con un invito.">
      <Crews />
    </RequireAuth>
  )
}

function Crews() {
  const { user } = useAuth()
  const [crews, setCrews] = useState<Crew[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    myCrews()
      .then(setCrews)
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crew</h1>
        <p className="text-sm text-ink-2">Nella crew vedete le uscite gli uni degli altri. Si entra solo con il link d'invito.</p>
      </div>
      {error && <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-critical">{error}</p>}
      {crews == null && !error && <p className="text-ink-2">Caricamento…</p>}

      {crews?.map((c) => {
        const link = inviteLink(c.invite_code)
        return (
          <section key={c.id} className={`${card} space-y-3 p-4`}>
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-lg font-semibold">{c.name}</h2>
              <button
                type="button"
                className={`${btnGhost} text-critical`}
                onClick={() => window.confirm(`Uscire dalla crew «${c.name}»? Non vedrai più le loro uscite.`) && run(() => leaveCrew(c.id, user!.id))}
              >
                Esci
              </button>
            </div>
            <ul className="space-y-1.5">
              {c.members.map((m) => (
                <li key={m.user_id}>
                  <Link to={`/rider/${m.user_id}`} className="flex items-center gap-2.5">
                    <Avatar name={m.profile?.display_name ?? '?'} size={30} />
                    <span className="font-medium">{m.profile?.display_name ?? 'Rider'}</span>
                    {m.role === 'owner' && <span className="text-xs text-ink-2">ha creato la crew</span>}
                    {m.user_id === user?.id && <span className="text-xs text-ink-2">(tu)</span>}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              <p className="font-medium">Invita gli amici</p>
              <p className="text-ink-2">
                Manda loro questo link: aprendolo creano l'account ed entrano nella crew. Codice <b className="tabular">{c.invite_code}</b>.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {typeof navigator.share === 'function' && (
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => navigator.share({ title: 'FoilLog', text: `Entra nella crew «${c.name}» su FoilLog`, url: link }).catch(() => {})}
                  >
                    Condividi l'invito
                  </button>
                )}
                <button type="button" className={btnSecondary} onClick={() => navigator.clipboard.writeText(link).then(() => alert('Link copiato'))}>
                  Copia il link
                </button>
              </div>
            </div>
          </section>
        )
      })}

      <form
        className={`${card} space-y-2 p-4`}
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void run(async () => {
            await createCrew(name)
            setName('')
          })
        }}
      >
        <p className="font-semibold">{crews?.length ? 'Crea un’altra crew' : 'Crea la tua crew'}</p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Es. Barcola Wing"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base"
          />
          <button type="submit" className={btnPrimary} disabled={busy || !name.trim()}>
            Crea
          </button>
        </div>
      </form>

      <form
        className={`${card} space-y-2 p-4`}
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim()) void run(async () => {
            await joinCrew(code)
            setCode('')
          })
        }}
      >
        <p className="font-semibold">Hai un codice d'invito?</p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={12}
            placeholder="Es. 4F2A9C1B"
            className="tabular min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base uppercase"
          />
          <button type="submit" className={btnSecondary} disabled={busy || !code.trim()}>
            Entra
          </button>
        </div>
      </form>
    </div>
  )
}

/** Opened from an invite link: #/entra/CODE */
export function JoinPage() {
  const { code = '' } = useParams()
  const { ready, user } = useAuth()
  const next = encodeURIComponent(`/entra/${code}`)
  if (!ready) return <p className="py-16 text-center text-ink-2">Caricamento…</p>
  if (!user) {
    return (
      <div className={`${card} mx-auto max-w-md space-y-3 p-5`}>
        <p className="text-lg font-semibold">Ti hanno invitato in una crew su FoilLog</p>
        <p className="text-sm text-ink-2">
          FoilLog analizza le uscite in wing foil e le condivide con gli amici. Crea un account (è gratis) per entrare nella crew.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to={`/accedi?mode=signup&next=${next}`} className={btnPrimary}>
            Crea un account
          </Link>
          <Link to={`/accedi?next=${next}`} className={btnSecondary}>
            Ho già un account
          </Link>
        </div>
      </div>
    )
  }
  return <JoinConfirm code={code} />
}

function JoinConfirm({ code }: { code: string }) {
  const navigate = useNavigate()
  const [name, setName] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    crewNameByCode(code)
      .then(setName)
      .catch((e: Error) => setError(e.message))
  }, [code])
  if (error) return <p className={`${card} p-4 text-sm text-critical`}>{error}</p>
  if (name === undefined) return <p className="py-16 text-center text-ink-2">Controllo l'invito…</p>
  if (name === null) {
    return (
      <div className={`${card} mx-auto max-w-md space-y-3 p-5`}>
        <p className="font-semibold">Invito non valido</p>
        <p className="text-sm text-ink-2">Il codice «{code}» non corrisponde a nessuna crew. Chiedi un nuovo link a chi ti ha invitato.</p>
        <Link to="/crew" className={btnSecondary}>
          Vai alle crew
        </Link>
      </div>
    )
  }
  return (
    <div className={`${card} mx-auto max-w-md space-y-3 p-5`}>
      <p className="text-lg font-semibold">Entrare nella crew «{name}»?</p>
      <p className="text-sm text-ink-2">Vedrai le uscite dei membri e loro vedranno le tue (tranne quelle «solo per me»).</p>
      <button
        type="button"
        className={btnPrimary}
        onClick={() =>
          joinCrew(code)
            .then(() => navigate('/crew'))
            .catch((e: Error) => setError(e.message))
        }
      >
        Entra nella crew
      </button>
    </div>
  )
}
