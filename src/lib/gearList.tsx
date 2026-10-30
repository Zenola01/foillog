import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { loadGear, saveGear } from './cloud'
import { useSettings } from './settings'
import type { GearItem } from './types'

interface GearValue {
  /** Null until read. */
  items: GearItem[] | null
  /** Signed in, the list lives in the account (every device sees it); otherwise on this device. */
  inAccount: boolean
  error: string | null
  save: (items: GearItem[]) => Promise<void>
}

const Ctx = createContext<GearValue | null>(null)

export function GearProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { settings, update } = useSettings()
  const userId = user?.id ?? null
  const [cloud, setCloud] = useState<GearItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const local = useRef(settings.gear)
  local.current = settings.gear

  useEffect(() => {
    setCloud(null)
    setError(null)
    if (!userId) return
    let alive = true
    loadGear(userId)
      .then(async (list) => {
        // A list made before signing in moves to the account the first time.
        if (!list.length && local.current.length) {
          list = local.current
          await saveGear(userId, list)
          update({ gear: [] })
        }
        if (alive) setCloud(list)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [userId, update])

  const save = useCallback(
    async (items: GearItem[]) => {
      if (!userId) return update({ gear: items })
      await saveGear(userId, items)
      setCloud(items)
    },
    [userId, update],
  )

  const value = useMemo<GearValue>(
    () => ({ items: userId ? cloud : settings.gear, inAccount: !!userId, error, save }),
    [userId, cloud, settings.gear, error, save],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useGear(): GearValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useGear outside GearProvider')
  return v
}
