import { Component, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { btnSecondary, card } from './ui'

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={`${card} space-y-3 p-5`}>
        <p className="font-semibold">Qualcosa è andato storto</p>
        <p className="text-sm text-ink-2">{this.state.error.message}</p>
        <button type="button" className={btnSecondary} onClick={() => window.location.reload()}>
          Ricarica la pagina
        </button>
      </div>
    )
  }
}

/** Keeps a crash inside one page from blanking the whole app; navigating away clears it. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <Boundary resetKey={pathname}>{children}</Boundary>
}
