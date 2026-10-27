import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { btnPrimary, card } from './ui'

/** Shows `children` only when signed in; otherwise explains why and links to the sign-in page. */
export function RequireAuth({ children, why }: { children: ReactNode; why: string }) {
  const { ready, user } = useAuth()
  const loc = useLocation()
  if (!ready) return <p className="py-16 text-center text-ink-2">Caricamento…</p>
  if (!user) {
    return (
      <div className={`${card} space-y-3 p-5`}>
        <p className="font-semibold">Serve l'accesso</p>
        <p className="text-sm text-ink-2">{why}</p>
        <Link to={`/accedi?next=${encodeURIComponent(loc.pathname + loc.search)}`} className={btnPrimary}>
          Entra o crea un account
        </Link>
      </div>
    )
  }
  return <>{children}</>
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  )
}
