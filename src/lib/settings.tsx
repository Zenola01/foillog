import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_FOIL_KN } from './analysis/analyze'
import type { GearItem } from './types'
import type { DistUnit, SpeedUnit } from './units'

/** Numbers that can be shown live over the map while replaying several riders. */
export type LiveMetric = 'spd' | 'vmg' | 'twa' | 'crs' | 'dist' | 'foil' | 'hr' | 'heel'

/** Numbers that can be written over a video. */
export type VideoMetric = Exclude<LiveMetric, 'foil'>

/** The colours the app can wear. */
export const PALETTES = [
  { id: 'giallo', name: 'Giallo', swatch: '#c8f31d' },
  { id: 'arancio', name: 'Arancio', swatch: '#ff7a1a' },
  { id: 'oceano', name: 'Azzurro', swatch: '#38c6f4' },
  { id: 'rosso', name: 'Rosso', swatch: '#ff4757' },
  { id: 'bianco', name: 'Bianco', swatch: '#ffffff' },
] as const

export type Palette = (typeof PALETTES)[number]['id']

export interface Settings {
  palette: Palette
  speedUnit: SpeedUnit
  distUnit: DistUnit
  foilOnKn: number
  riderName: string
  liveMetrics: LiveMetric[]
  /** The numbers written over a video. */
  videoMetrics: VideoMetric[]
  /** Several riders on one map: whole tracks, or only the trail each one leaves. */
  trailMode: 'full' | 'tail'
  /** Share of the upwind and downwind legs, best first, behind the "best legs" averages (1 = all). */
  topShare: number
  /** Gear list while signed out; signed in, it lives in the profile. */
  gear: GearItem[]
}

const KEY = 'foillog.settings'
const DEFAULTS: Settings = {
  palette: 'giallo',
  speedUnit: 'kn',
  distUnit: 'km',
  foilOnKn: DEFAULT_FOIL_KN,
  riderName: '',
  liveMetrics: ['spd', 'vmg'],
  videoMetrics: ['spd', 'vmg', 'twa'],
  trailMode: 'full',
  topShare: 0.2,
  gear: [],
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

/** The browser's own bars take the colour of the page. */
const tintBars = () => {
  const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim()
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page)
}

const wear = (palette: Palette) => {
  document.documentElement.dataset.palette = palette
  tintBars()
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(() => {
    const loaded = load()
    wear(loaded.palette)
    return loaded
  })
  useEffect(() => {
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', tintBars)
    return () => scheme.removeEventListener('change', tintBars)
  }, [])
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      wear(next.palette)
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

/** Whether a session kept on this device is yours: its rider's name is all it says about that. */
export const isMyName = (rider: string, s: Settings, accountName?: string) => rider === myName(s) || rider === accountName
