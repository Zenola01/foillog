import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { btnPrimary, btnSecondary, card } from './ui'

// In-app confirmation. The browser's own confirm() is not shown by some embedded browsers (the
// click then silently does nothing), so destructive actions ask here instead.

type Ask = (message: string, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>

interface Pending {
  message: string
  confirmLabel: string
  danger: boolean
  resolve: (ok: boolean) => void
}

const Ctx = createContext<Ask | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const ask = useCallback<Ask>(
    (message, opts = {}) =>
      new Promise<boolean>((resolve) =>
        setPending({ message, confirmLabel: opts.confirmLabel ?? 'Conferma', danger: opts.danger ?? false, resolve }),
      ),
    [],
  )
  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok)
      setPending(null)
    },
    [pending],
  )
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close])

  return (
    <Ctx.Provider value={ask}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center" onClick={() => close(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-message"
            className={`${card} safe-bottom w-full max-w-sm space-y-4 p-5 shadow-xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <p id="confirm-message" className="text-[15px]">
              {pending.message}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => close(false)}>
                Annulla
              </button>
              <button
                type="button"
                autoFocus
                className={pending.danger ? `${btnPrimary} bg-critical` : btnPrimary}
                onClick={() => close(true)}
              >
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useConfirm(): Ask {
  const v = useContext(Ctx)
  if (!v) throw new Error('useConfirm outside ConfirmProvider')
  return v
}
