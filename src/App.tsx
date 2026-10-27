import { lazy, Suspense } from 'react'
import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { btnSecondary, card } from './components/ui'
import { LibraryProvider } from './lib/library'
import { SettingsProvider } from './lib/settings'
import HomePage from './pages/HomePage'
import SettingsPage from './pages/SettingsPage'

// Map and chart libraries are large; load them only with the pages that use them.
const SessionPage = lazy(() => import('./pages/SessionPage'))
const ComparePage = lazy(() => import('./pages/ComparePage'))

// Hash routes (#/s/…) because GitHub Pages cannot route a single-page app's paths.
export default function App() {
  return (
    <SettingsProvider>
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
    </SettingsProvider>
  )
}
