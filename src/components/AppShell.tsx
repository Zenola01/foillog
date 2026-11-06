import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { IconCompare, IconCrew, IconList, IconSettings, IconTrophy, Logo } from './icons'

const NAV = [
  { to: '/', label: 'Uscite', Icon: IconList, end: true },
  { to: '/crew', label: 'Crew', Icon: IconCrew, end: false },
  { to: '/record', label: 'Record', Icon: IconTrophy, end: false },
  { to: '/confronta', label: 'Confronta', Icon: IconCompare, end: false },
  { to: '/impostazioni', label: 'Altro', Icon: IconSettings, end: false },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const active = NAV.findIndex((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))
  // A block body: an effect must return nothing or a cleanup function, never scrollTo's result.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-display text-[21px] font-bold">
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
                  `rounded-md px-3 py-1.5 font-display text-[16px] font-semibold transition ${isActive ? 'text-accent' : 'text-ink-2 hover:text-ink'}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 md:pb-12">
        <div key={pathname} className="page-enter">
          {children}
        </div>
      </main>
      <nav className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+8px)] z-30 md:hidden" aria-label="Sezioni">
        <div className="relative grid grid-cols-5 rounded-2xl border border-line bg-surface shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
          {active >= 0 && (
            <span aria-hidden className="slide absolute inset-y-1 left-0 w-1/5 px-1" style={{ transform: `translateX(${active * 100}%)` }}>
              <span className="block size-full rounded-xl bg-accent-btn" />
            </span>
          )}
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 pt-2 pb-1.5 font-display text-[12px] font-semibold transition-colors ${isActive ? 'text-on-accent' : 'text-ink-2'}`
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
