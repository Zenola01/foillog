import type { AnalysisOptions, InstrumentWind, SessionAnalysis, SourceFormat, Track } from './types'

export interface ImportResult {
  format: SourceFormat
  device?: string
  name?: string
  track: Track
  wind: InstrumentWind | null
  rateHz: number
  warnings: string[]
}

export type WorkerRequest =
  | { id: number; type: 'import'; name: string; data: ArrayBuffer; lastModified?: number }
  | { id: number; type: 'analyze'; track: Track; wind: InstrumentWind | null; opts: AnalysisOptions }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.ok) p.resolve(e.data.result)
    else p.reject(new Error(e.data.error ?? 'Errore di analisi'))
  }
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "Il motore di analisi si è fermato"))
    pending.clear()
    w.terminate()
    worker = null
  }
  worker = w
  return w
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
type Request = WithoutId<WorkerRequest>

function call<T>(msg: Request): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ id, ...msg })
  })
}

export const importInWorker = (name: string, data: ArrayBuffer, lastModified?: number) =>
  call<ImportResult>({ type: 'import', name, data, lastModified })

export const analyzeInWorker = (track: Track, wind: InstrumentWind | null, opts: AnalysisOptions) =>
  call<SessionAnalysis>({ type: 'analyze', track, wind, opts })
