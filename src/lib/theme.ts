import { useEffect, useMemo, useState } from 'react'

export interface ThemeColors {
  surface: string
  surface2: string
  ink: string
  ink2: string
  muted: string
  grid: string
  axis: string
  border: string
  accent: string
  good: string
  critical: string
  /** Categorical slots in fixed order: series[k] always means the k-th compared session. */
  series: string[]
  /** Sequential ramp for speed, slow to fast. */
  speed: string[]
}

function read(): ThemeColors {
  const s = getComputedStyle(document.documentElement)
  const v = (n: string) => s.getPropertyValue(n).trim()
  return {
    surface: v('--surface'),
    surface2: v('--surface-2'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    border: v('--border'),
    accent: v('--accent-text'),
    good: v('--good'),
    critical: v('--critical'),
    series: [1, 2, 3, 4].map((k) => v(`--series-${k}`)),
    speed: [1, 2, 3, 4, 5].map((k) => v(`--speed-${k}`)),
  }
}

const query = () => window.matchMedia('(prefers-color-scheme: dark)')

/** Follows the system light/dark setting and exposes the colour tokens to canvas code (map, charts). */
export function useTheme(): { dark: boolean; colors: ThemeColors } {
  const [dark, setDark] = useState(() => query().matches)
  useEffect(() => {
    const m = query()
    const onChange = () => setDark(m.matches)
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [])
  // The CSS variables already reflect the new scheme when the query fires.
  const colors = useMemo(() => {
    void dark
    return read()
  }, [dark])
  return { dark, colors }
}

export const isCoarsePointer = () => window.matchMedia('(pointer: coarse)').matches
