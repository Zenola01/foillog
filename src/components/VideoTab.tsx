import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSettings, type LiveMetric } from '../lib/settings'
import { isCoarsePointer } from '../lib/theme'
import type { Track } from '../lib/types'
import { fmtClockDuration, fmtNum, fmtTime, fmtTimeSec } from '../lib/units'
import { overlayBeat, overlayValuesAt, videoInSession, type OverlaySource } from '../lib/videoData'
import { exportVideo, readVideoInfo, type VideoExport, type VideoInfo } from '../lib/videoFile'
import { drawOverlay, overlayCells, VIDEO_METRICS } from '../lib/videoOverlay'
import { IconPause, IconPlay } from './icons'
import { btnGhost, btnPrimary, btnSecondary, card } from './ui'

/** How often the slider, the clock and the map follow the video. */
const FOLLOW_MS = 250

const savedStartKey = (f: File) => `foillog.videoStart.${f.name}.${f.size}`

function loadSavedStart(f: File): number | null {
  try {
    const v = Number(localStorage.getItem(savedStartKey(f)))
    return v > 0 ? v : null
  } catch {
    return null
  }
}

function saveStart(f: File, start: number) {
  try {
    localStorage.setItem(savedStartKey(f), String(start))
  } catch {
    // Not remembered; the setting still applies for this visit.
  }
}

/** On a phone the share sheet saves the video to the photos; on a computer it is an ordinary download. */
async function saveVideo(f: File) {
  if (isCoarsePointer() && navigator.canShare?.({ files: [f] })) {
    await navigator.share({ files: [f] }).catch(() => {})
    return
  }
  const url = URL.createObjectURL(f)
  const a = document.createElement('a')
  a.href = url
  a.download = f.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** A video filmed during the session, with the session's numbers over it. It stays on this device. */
export function VideoTab({
  tr,
  windDir,
  foil,
  visible,
  onTime,
}: {
  tr: Track
  windDir: number | null
  foil: Uint8Array
  /** The tab is kept mounted while hidden, so the chosen video is not lost. */
  visible: boolean
  /** The moment of the track being shown, for the map. */
  onTime: (ms: number) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const session: [number, number] = [tr.t[0], tr.t[tr.t.length - 1]]

  const choose = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    setError(null)
    try {
      const i = await readVideoInfo(f, session)
      setFile(f)
      setInfo({ ...i, start: loadSavedStart(f) ?? i.start })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Questo file non si riesce a leggere.')
    } finally {
      setBusy(false)
    }
  }

  const picker = (label: string, className: string) => (
    <label className={`${className} cursor-pointer`}>
      {busy ? 'Leggo il video…' : label}
      <input
        type="file"
        accept="video/*,.mov,.mp4,.m4v"
        className="sr-only"
        onChange={(e) => {
          void choose(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </label>
  )

  if (!file || !info) {
    return (
      <div className={`${card} space-y-3 p-4`}>
        <p className="text-sm text-ink-2">Scegli un video girato durante questa uscita: resta sul tuo dispositivo.</p>
        {picker('Scegli un video', btnPrimary)}
        {error && <p className="text-sm text-critical">{error}</p>}
      </div>
    )
  }
  return (
    <Player
      key={`${file.name}.${file.size}`}
      file={file}
      info={info}
      tr={tr}
      windDir={windDir}
      foil={foil}
      visible={visible}
      onTime={onTime}
      session={session}
      changeButton={picker('Cambia video', btnGhost)}
    />
  )
}

function Player({
  file,
  info,
  tr,
  windDir,
  foil,
  visible,
  onTime,
  session,
  changeButton,
}: {
  file: File
  info: VideoInfo
  tr: Track
  windDir: number | null
  foil: Uint8Array
  visible: boolean
  onTime: (ms: number) => void
  session: [number, number]
  changeButton: ReactNode
}) {
  const { settings, update } = useSettings()
  const { speedUnit: unit, distUnit, videoMetrics: metrics } = settings
  const source = useMemo<OverlaySource>(() => ({ track: tr, windDir, foil }), [tr, windDir, foil])
  const offered = useMemo(() => VIDEO_METRICS.filter((m) => m.available(source)), [source])
  // What was chosen on another session may not exist on this one (no heart rate, say).
  const shown = useMemo(() => metrics.filter((k) => offered.some((m) => m.key === k)), [metrics, offered])
  const [picking, setPicking] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [seconds, setSeconds] = useState(0)
  // The clock time of the video's first frame: the only thing there is to adjust.
  const [start, setStart] = useState(info.start ?? session[0])
  /** Share done of the video being made, if one is. */
  const [making, setMaking] = useState<number | null>(null)
  const [made, setMade] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const aspect = info.width / info.height
  const job = useRef<VideoExport | null>(null)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  // Leaving the session stops a video being made: its result would have nowhere to go.
  useEffect(() => () => job.current?.cancel(), [])

  const shift = (next: number) => {
    setStart(next)
    saveStart(file, next)
    setMade(null)
  }

  const follow = useRef(onTime)
  follow.current = onTime

  // Paints the numbers over the video and keeps the rest in step, as long as the tab is showing.
  useEffect(() => {
    if (!visible) {
      video.current?.pause()
      return
    }
    let raf = 0
    let painted = ''
    let followed = -Infinity
    const wide = window.matchMedia('(min-width: 1024px)').matches
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const v = video.current
      const c = canvas.current
      if (!v || !c) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cw = Math.round(c.clientWidth * dpr)
      const ch = Math.round(c.clientHeight * dpr)
      if (!cw || !ch) return
      const ms = start + v.currentTime * 1000
      const key = `${cw}.${ch}.${overlayBeat(ms)}`
      if (key !== painted) {
        painted = key
        if (c.width !== cw) c.width = cw
        if (c.height !== ch) c.height = ch
        const ctx = c.getContext('2d')!
        ctx.clearRect(0, 0, cw, ch)
        drawOverlay(ctx, cw, ch, overlayCells(overlayValuesAt(source, ms), shown, unit, distUnit))
      }
      if (now - followed >= FOLLOW_MS) {
        followed = now
        setSeconds(v.currentTime)
        // The map stands beside the video only on a large screen.
        if (wide) follow.current(ms)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [visible, start, source, shown, unit, distUnit])

  const toggle = () => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

  const make = () => {
    setError(null)
    setMade(null)
    video.current?.pause()
    const running = exportVideo(
      file,
      info,
      (ctx, w, h, s) => drawOverlay(ctx, w, h, overlayCells(overlayValuesAt(source, start + s * 1000), shown, unit, distUnit)),
      setMaking,
    )
    job.current = running
    setMaking(0)
    // A phone that goes to sleep would stop the work.
    const awake = navigator.wakeLock?.request('screen').catch(() => null)
    running.done
      .then(setMade)
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        job.current = null
        setMaking(null)
        void awake?.then((lock) => lock?.release())
      })
  }

  const inSession = videoInSession(start, info.duration, session)
  const startValue = new Date(start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const setClock = (text: string) => {
    const [hh, mm, ss = 0] = text.split(':').map(Number)
    if (![hh, mm, ss].every(Number.isFinite)) return
    const d = new Date(session[0])
    d.setHours(hh, mm, ss, 0)
    shift(d.getTime())
  }
  const toggleMetric = (k: LiveMetric) => {
    update({ videoMetrics: metrics.includes(k) ? metrics.filter((x) => x !== k) : [...metrics, k] })
    setMade(null)
  }
  const nudge = (ms: number, label: string) => (
    <button key={label} type="button" className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm font-medium tabular" onClick={() => shift(start + ms)}>
      {label}
    </button>
  )

  return (
    <div className={`${card} space-y-3 p-3`}>
      <div className="relative mx-auto overflow-hidden rounded-xl bg-black" style={{ width: `min(100%, calc(72vh * ${aspect}))`, aspectRatio: aspect }}>
        {url && (
          <video
            ref={video}
            src={url}
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full"
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Metti in pausa il video' : 'Avvia il video'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-btn text-white active:opacity-80"
        >
          {playing ? <IconPause width={18} height={18} /> : <IconPlay width={18} height={18} />}
        </button>
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={info.duration}
            step={0.1}
            value={seconds}
            aria-label="Posizione nel video"
            className="w-full accent-[var(--series-1)]"
            onChange={(e) => {
              const s = Number(e.target.value)
              setSeconds(s)
              if (video.current) video.current.currentTime = s
            }}
          />
          <div className="flex justify-between text-xs text-ink-2 tabular">
            <span>
              {fmtClockDuration(seconds)} / {fmtClockDuration(info.duration)}
            </span>
            <span>Dati delle {fmtTimeSec(start + seconds * 1000)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <label className="mr-1 inline-flex items-center gap-2 text-sm">
          Inizio
          <input
            type="time"
            step={1}
            value={startValue}
            onChange={(e) => setClock(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm tabular"
          />
        </label>
        {nudge(-1000, '−1 s')}
        {nudge(-100, '−0,1')}
        {nudge(100, '+0,1')}
        {nudge(1000, '+1 s')}
      </div>
      <div>
        <button type="button" aria-expanded={picking} className={`${btnGhost} -ml-2.5`} onClick={() => setPicking((p) => !p)}>
          Dati a schermo {picking ? '▴' : '▾'}
        </button>
        {picking && (
          <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="Dati a schermo">
            {offered.map((m) => {
              const on = shown.includes(m.key)
              return (
                <button
                  key={m.key}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleMetric(m.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    on ? 'border-transparent bg-accent-btn text-white' : 'border-line bg-surface text-ink hover:bg-surface-2'
                  }`}
                >
                  {on && <span aria-hidden>✓</span>}
                  {m.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {info.start == null && <p className="text-sm text-critical">Questo video non dice a che ora è stato girato: imposta l’ora d’inizio.</p>}
      {info.start != null && !inSession && (
        <p className="text-sm text-critical">
          Il video è fuori da questa uscita ({fmtTime(session[0])}–{fmtTime(session[1])}): controlla l’ora d’inizio.
        </p>
      )}

      {making != null ? (
        <div className="space-y-2">
          <p className="text-sm tabular">Creo il video… {fmtNum(making * 100, 0)}%</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent-btn" style={{ width: `${making * 100}%` }} />
          </div>
          <button type="button" className={btnSecondary} onClick={() => job.current?.cancel()}>
            Annulla
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {made ? (
            <button type="button" className={btnPrimary} onClick={() => void saveVideo(made)}>
              Salva il video ({fmtNum(made.size / 1e6, 0)} MB)
            </button>
          ) : (
            <button type="button" className={btnPrimary} onClick={make}>
              Crea il video con i dati
            </button>
          )}
          {changeButton}
        </div>
      )}
      {error && <p className="text-sm text-critical">{error}</p>}
    </div>
  )
}
