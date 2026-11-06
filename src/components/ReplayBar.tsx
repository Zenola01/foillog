import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtClockDuration, fmtTimeSec } from '../lib/units'
import { IconPause, IconPlay } from './icons'

const SPEEDS = [1, 5, 10, 20]
/** Half the width of the slider's needle: it never gets closer than this to the ends. */
const NEEDLE = 14

export interface Replay {
  t: number
  playing: boolean
  speed: number
  /** True once the rider has moved the replay away from the start. */
  touched: boolean
  setT: (t: number) => void
  toggle: () => void
  setSpeed: (s: number) => void
}

/** Clock for the animated replay, `speed` times faster than real time. */
export function useReplay(t0: number, t1: number): Replay {
  const [t, setTState] = useState(t0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    setTState(t0)
    setPlaying(false)
    setTouched(false)
  }, [t0, t1])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(100, now - last)
      last = now
      setTState((prev) => Math.min(t1, prev + dt * speed))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, t1])

  useEffect(() => {
    if (playing && t >= t1) setPlaying(false)
  }, [playing, t, t1])

  const setT = useCallback((v: number) => {
    setTouched(true)
    setTState(v)
  }, [])
  const toggle = useCallback(() => {
    setTouched(true)
    setPlaying((p) => {
      if (!p) setTState((cur) => (cur >= t1 ? t0 : cur))
      return !p
    })
  }, [t0, t1])
  return { t, playing, speed, touched, setT, toggle, setSpeed }
}

/** The speed of a whole session as a row of bars, one path so that it stays light while the replay runs. */
function SpeedBars({ d, n, color }: { d: string; n: number; color: string }) {
  return (
    <svg viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" className="size-full" aria-hidden="true">
      <path d={d} fill={color} />
    </svg>
  )
}

export function ReplayBar({
  replay,
  t0,
  t1,
  relative,
  readout,
  profile,
}: {
  replay: Replay
  t0: number
  t1: number
  relative?: boolean
  readout?: string
  /** The speed through the session, in even steps: the slider then runs over it, and shows where the fast stretches are. */
  profile?: number[]
}) {
  const label = relative ? fmtClockDuration((replay.t - t0) / 1000) : fmtTimeSec(replay.t)
  const played = Math.min(1, Math.max(0, (replay.t - t0) / (t1 - t0 || 1)))
  const bars = useMemo(() => {
    if (!profile?.length) return null
    const max = Math.max(...profile, 1e-9)
    return profile.map((v, k) => `M${k + 0.14} 1V${(1 - Math.max(0.06, v / max)).toFixed(3)}H${k + 0.86}V1Z`).join('')
  }, [profile])
  return (
    <div className="rounded-2xl bg-surface p-2.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={replay.toggle}
          aria-label={replay.playing ? 'Metti in pausa il replay' : 'Avvia il replay'}
          className="flex press size-11 shrink-0 items-center justify-center rounded-full bg-accent-btn text-on-accent"
        >
          {replay.playing ? <IconPause width={18} height={18} /> : <IconPlay width={18} height={18} />}
        </button>
        <div className="relative h-11 min-w-0 flex-1">
          <div className="absolute inset-y-1" style={{ insetInline: NEEDLE }}>
            {bars ? (
              <>
                <SpeedBars d={bars} n={profile!.length} color="var(--axis)" />
                <div className="absolute inset-0" style={{ clipPath: `inset(0 ${(1 - played) * 100}% 0 0)` }}>
                  <SpeedBars d={bars} n={profile!.length} color="var(--bar)" />
                </div>
              </>
            ) : (
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-[var(--bar-track)]">
                <div className="size-full origin-left bg-[var(--bar)]" style={{ transform: `scaleX(${played})` }} />
              </div>
            )}
          </div>
          <input
            type="range"
            min={t0}
            max={t1}
            step={200}
            value={replay.t}
            onChange={(e) => replay.setT(Number(e.target.value))}
            // Phones only move a slider by its thumb: a tap on the bars goes there too.
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              const at = (e.clientX - box.left - NEEDLE) / (box.width - 2 * NEEDLE)
              replay.setT(t0 + Math.min(1, Math.max(0, at)) * (t1 - t0))
            }}
            aria-label="Posizione del replay"
            className="scrubber absolute inset-0 h-full w-full"
          />
        </div>
        <select
          value={replay.speed}
          onChange={(e) => replay.setSpeed(Number(e.target.value))}
          aria-label="Velocità del replay"
          className="min-h-9 shrink-0 rounded-full bg-surface-2 px-2 py-1 font-display text-[16px] font-semibold text-ink"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1 flex justify-between gap-2 px-1 font-display text-[15px] leading-tight font-medium text-ink-2">
        <span className="tabular">{label}</span>
        {readout && <span className="truncate text-ink tabular">{readout}</span>}
      </div>
    </div>
  )
}
