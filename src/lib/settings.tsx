import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_FOIL_KN } from './analysis/analyze'
import type { DistUnit, SpeedUnit } from './units'

/** Numbers that can be shown live over the map while replaying several riders. */
export type LiveMetric = 'spd' | 'vmg' | 'twa' | 'crs' | 'dist' | 'foil' | 'hr' | 'heel'

export interface Settings {
  speedUnit: SpeedUnit
  distUnit: DistUnit
  foilOnKn: number
  riderName: string
  liveMetrics: LiveMetric[]
  /** Several riders on one map: whole tracks, or only the trail each one leaves. */
  trailMode: 'full' | 'tail'
}

const KEY = 'foillog.settings'
const DEFAULTS: Settings = {
  speedUnit: 'kn',
  distUnit: 'km',
  foilOnKn: DEFAULT_FOIL_KN,
  riderName: '',
  liveMetrics: ['spd', 'vmg'],
  trailMode: 'full',
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    // Private browsing or blocked storage: fall back to the defaults.
  }
  return DEFAULTS
}

interface SettingsValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

const Ctx = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load)
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // Not persisted; the change still applies for this visit.
      }
      return next
    })
  }, [])
  const value = useMemo(() => ({ settings, update }), [settings, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettings outside SettingsProvider')
  return v
}

/** The rider name used for your own sessions. */
export const myName = (s: Settings) => s.riderName.trim() || 'Io'
