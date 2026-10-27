import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { btnPrimary, card, Segmented } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function LoginPage() {
  const { user, signIn, signUp } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) navigate(next, { replace: true })
  }, [user, next, navigate])

  const input = 'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base'
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{mode === 'signup' ? 'Crea il tuo account' : 'Entra in FoilLog'}</h1>
        <p className="text-sm text-ink-2">Con l'account condividi le uscite con la tua crew e vedi le loro.</p>
      </div>
      <Segmented
        label="Accesso"
        value={mode}
        onChange={(m) => {
          setMode(m)
          setError(null)
        }}
        options={[
          { value: 'signin', label: 'Entra' },
          { value: 'signup', label: 'Crea account' },
        ]}
      />
      <form
        className={`${card} space-y-3 p-4`}
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            if (mode === 'signup') await signUp(name, email, password)
            else await signIn(email, password)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        {mode === 'signup' && (
          <label className="block text-sm">
            <span className="text-ink-2">Il tuo nome (lo vede la crew)</span>
            <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" className={input} />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-ink-2">Email</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={input} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Password{mode === 'signup' ? ' (almeno 6 caratteri)' : ''}</span>
          <input
            required
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className={input}
          />
        </label>
        {error && <p className="text-sm text-critical">{error}</p>}
        <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? 'Un momento…' : mode === 'signup' ? 'Crea account' : 'Entra'}
        </button>
      </form>
      <p className="px-1 text-xs text-ink-2">
        Password dimenticata? Chiedi a chi ha creato la crew: può reimpostarla dalla pagina del progetto su Supabase.
      </p>
    </div>
  )
}
