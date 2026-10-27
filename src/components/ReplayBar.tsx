import { useCallback, useEffect, useState } from 'react'
import { fmtClockDuration, fmtTimeSec } from '../lib/units'
import { IconPause, IconPlay } from './icons'

const SPEEDS = [1, 10, 30, 60, 120]

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
  const [speed, setSpeed] = useState(30)
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

export function ReplayBar({ replay, t0, t1, relative, readout }: { replay: Replay; t0: number; t1: number; relative?: boolean; readout?: string }) {
  const label = relative ? fmtClockDuration((replay.t - t0) / 1000) : fmtTimeSec(replay.t)
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2">
      <button
        type="button"
        onClick={replay.toggle}
        aria-label={replay.playing ? 'Metti in pausa il replay' : 'Avvia il replay'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-btn text-white active:opacity-80"
      >
        {replay.playing ? <IconPause width={18} height={18} /> : <IconPlay width={18} height={18} />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={t0}
          max={t1}
          step={200}
          value={replay.t}
          onChange={(e) => replay.setT(Number(e.target.value))}
          aria-label="Posizione del replay"
          className="w-full accent-[var(--series-1)]"
        />
        <div className="flex justify-between text-xs text-ink-2">
          <span className="tabular">{label}</span>
          {readout && <span className="truncate pl-2 font-medium text-ink">{readout}</span>}
        </div>
      </div>
      <select
        value={replay.speed}
        onChange={(e) => replay.setSpeed(Number(e.target.value))}
        aria-label="Velocità del replay"
        className="shrink-0 rounded-lg border border-line bg-surface px-1.5 py-1 text-sm"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  )
}
