import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { IconCompare, IconList, IconSettings, Logo } from './icons'

const NAV = [
  { to: '/', label: 'Uscite', Icon: IconList, end: true },
  { to: '/confronta', label: 'Confronta', Icon: IconCompare, end: false },
  { to: '/impostazioni', label: 'Impostazioni', Icon: IconSettings, end: false },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  // A block body: an effect must return nothing or a cleanup function, never scrollTo's result.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Logo className="h-7 w-7" />
            FoilLog
          </Link>
          <nav className="ml-auto hidden gap-1 md:flex" aria-label="Sezioni">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 md:pb-12">{children}</main>
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md md:hidden"
        aria-label="Sezioni"
      >
        <div className="grid grid-cols-3">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-ink-2'}`
              }
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
