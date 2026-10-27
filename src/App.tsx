import { lazy, Suspense } from 'react'
import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { btnSecondary, card } from './components/ui'
import { AuthProvider } from './lib/auth'
import { LibraryProvider } from './lib/library'
import { SettingsProvider } from './lib/settings'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'

// Map and chart libraries are large; load them only with the pages that use them.
const SessionPage = lazy(() => import('./pages/SessionPage'))
const ComparePage = lazy(() => import('./pages/ComparePage'))
const CloudSessionPage = lazy(() => import('./pages/CloudSessionPage'))
const DayPage = lazy(() => import('./pages/DayPage'))
const RecordsPage = lazy(() => import('./pages/RecordsPage'))
const SpotPage = lazy(() => import('./pages/RecordsPage').then((m) => ({ default: m.SpotPage })))
const CrewPage = lazy(() => import('./pages/CrewPage'))
const JoinPage = lazy(() => import('./pages/CrewPage').then((m) => ({ default: m.JoinPage })))

// Hash routes (#/s/…) because GitHub Pages cannot route a single-page app's paths.
export default function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <LibraryProvider>
          <HashRouter>
            <AppShell>
              <ErrorBoundary>
                <Suspense fallback={<p className="py-16 text-center text-ink-2">Caricamento…</p>}>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/s/:id" element={<SessionPage />} />
                    <Route path="/confronta" element={<ComparePage />} />
                    <Route path="/impostazioni" element={<SettingsPage />} />
                    <Route path="/accedi" element={<LoginPage />} />
                    <Route path="/crew" element={<CrewPage />} />
                    <Route path="/entra/:code" element={<JoinPage />} />
                    <Route path="/c/:id" element={<CloudSessionPage />} />
                    <Route path="/giornata/:day" element={<DayPage />} />
                    <Route path="/giornata" element={<DayPage />} />
                    <Route path="/record" element={<RecordsPage />} />
                    <Route path="/rider/:id" element={<RecordsPage />} />
                    <Route path="/spot/:id" element={<SpotPage />} />
                    <Route
                      path="*"
                      element={
                        <div className={`${card} space-y-3 p-5`}>
                          <p className="font-semibold">Pagina non trovata</p>
                          <Link to="/" className={btnSecondary}>
                            Torna alle uscite
                          </Link>
                        </div>
                      }
                    />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </AppShell>
          </HashRouter>
        </LibraryProvider>
      </AuthProvider>
    </SettingsProvider>
  )
}
