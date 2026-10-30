import { clear, createStore, del, get, set, values, type UseStore } from 'idb-keyval'
import type { InstrumentWind, ModelWind, SessionGear, SessionSummary, SourceFormat, Track, WindBand } from './types'

/** What the session list needs; the heavy track lives separately in SessionData. */
export interface SessionRecord {
  id: string
  createdAt: number
  fileName: string
  format: SourceFormat
  device?: string
  title: string
  rider: string
  notes: string
  /** Foil threshold the stored summary was computed with (kn). */
  foilOnKn: number
  windOverride: number | null
  modelWind: ModelWind | null
  /** Wind strength chosen by the rider; otherwise it comes from the model wind. */
  windBand?: WindBand | null
  gear?: SessionGear[]
  summary: SessionSummary
  /** Simplified track for thumbnails, [lat, lon]. */
  preview: [number, number][]
  warnings: string[]
  demo?: boolean
  /** Id of the crew copy once shared. */
  cloudId?: string
}

export interface SessionData {
  track: Track
  wind: InstrumentWind | null
}

// Sessions are kept in IndexedDB on this device. If the browser refuses it (private mode,
// blocked site data) everything still works for the visit, held in memory.
let metaDb: UseStore | null = null
let dataDb: UseStore | null = null
const meta = () => (metaDb ??= createStore('foillog-sessions', 'meta'))
const data = () => (dataDb ??= createStore('foillog-tracks', 'data'))
const memory = { meta: new Map<string, SessionRecord>(), data: new Map<string, SessionData>() }
let inMemory = false
const dataCache = new Map<string, SessionData>()

async function attempt<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  if (inMemory) return fallback()
  try {
    return await fn()
  } catch (e) {
    console.warn('IndexedDB non disponibile, uso la memoria', e)
    inMemory = true
    return fallback()
  }
}

export const isPersistent = () => !inMemory

export async function listSessions(): Promise<SessionRecord[]> {
  const all = await attempt(() => values<SessionRecord>(meta()), () => [...memory.meta.values()])
  return all.sort((a, b) => b.summary.start - a.summary.start)
}

export async function getSessionData(id: string): Promise<SessionData | null> {
  const cached = dataCache.get(id)
  if (cached) return cached
  const d = await attempt(() => get<SessionData>(id, data()), () => memory.data.get(id))
  if (d) dataCache.set(id, d)
  return d ?? null
}

export async function saveSession(rec: SessionRecord, d?: SessionData): Promise<void> {
  if (d) {
    dataCache.set(rec.id, d)
    await attempt(() => set(rec.id, d, data()), () => void memory.data.set(rec.id, d))
  }
  await attempt(() => set(rec.id, rec, meta()), () => void memory.meta.set(rec.id, rec))
}

export async function deleteSession(id: string): Promise<void> {
  dataCache.delete(id)
  await attempt(
    async () => {
      await del(id, meta())
      await del(id, data())
    },
    () => {
      memory.meta.delete(id)
      memory.data.delete(id)
    },
  )
}

export async function deleteAll(): Promise<void> {
  dataCache.clear()
  await attempt(
    async () => {
      await clear(meta())
      await clear(data())
    },
    () => {
      memory.meta.clear()
      memory.data.clear()
    },
  )
}
