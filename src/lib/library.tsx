import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { demoFiles, demoModelWind, demoStartTime } from './demo'
import { analyzeInWorker, importInWorker, type ImportResult } from './engine'
import { fetchModelWind } from './openMeteo'
import { myName, useSettings } from './settings'
import { simplifyTrack } from './simplify'
import {
  deleteAll,
  deleteSession,
  getSessionData,
  isPersistent,
  listSessions,
  saveSession,
  type SessionRecord,
} from './store'
import type { ModelWind } from './types'
import { fmtShortDate, fmtTime } from './units'

export interface ImportJob {
  key: string
  name: string
  status: 'reading' | 'analyzing' | 'done' | 'duplicate' | 'error'
  error?: string
  sessionId?: string
}

interface LibraryValue {
  sessions: SessionRecord[] | null
  jobs: ImportJob[]
  persistent: boolean
  importFiles: (files: File[]) => Promise<SessionRecord[]>
  importDemo: () => Promise<SessionRecord[]>
  updateSession: (id: string, patch: Partial<SessionRecord>) => Promise<void>
  removeSession: (id: string) => Promise<void>
  removeAll: () => Promise<void>
  dismissJobs: () => void
  /** Recomputes every stored summary, e.g. after the foil threshold changes. */
  reanalyzeAll: (foilOnKn: number) => Promise<void>
}

const Ctx = createContext<LibraryValue | null>(null)

const GENERIC_NAMES = /^(uscita|activity|track|traccia|workout|allenamento|untitled|senza titolo|esempio.*)$/i

function defaultTitle(imp: ImportResult): string {
  if (imp.name && !GENERIC_NAMES.test(imp.name.trim())) return imp.name.trim()
  const t = imp.track.t[0]
  return `Uscita del ${fmtShortDate(t)}, ${fmtTime(t)}`
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null)
  const [jobs, setJobs] = useState<ImportJob[]>([])

  const refresh = useCallback(async () => setSessions(await listSessions()), [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const setJob = (key: string, patch: Partial<ImportJob>) =>
    setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...patch } : j)))

  /** Analyses an imported track and stores it as a new session (or returns the existing copy). */
  const createSession = useCallback(
    async (
      imp: ImportResult,
      o: { fileName: string; rider: string; modelWind?: ModelWind | null; demo?: boolean; title?: string },
    ): Promise<{ rec: SessionRecord; duplicate: boolean }> => {
      const existing = (await listSessions()).find(
        (s) => s.summary.start === imp.track.t[0] && s.summary.points === imp.track.t.length && s.rider === o.rider,
      )
      if (existing) return { rec: existing, duplicate: true }
      const n = imp.track.t.length
      let lat = 0
      let lon = 0
      for (let i = 0; i < n; i++) {
        lat += imp.track.lat[i]
        lon += imp.track.lon[i]
      }
      const modelWind =
        o.modelWind !== undefined ? o.modelWind : await fetchModelWind(lat / n, lon / n, imp.track.t[0], imp.track.t[n - 1])
      const analysis = await analyzeInWorker(imp.track, imp.wind, { foilOnKn: settings.foilOnKn, modelWind })
      const rec: SessionRecord = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        fileName: o.fileName,
        format: imp.format,
        device: imp.device,
        title: o.title ?? defaultTitle(imp),
        rider: o.rider,
        notes: '',
        foilOnKn: settings.foilOnKn,
        windOverride: null,
        modelWind,
        summary: analysis.summary,
        preview: simplifyTrack(imp.track.lat, imp.track.lon),
        warnings: imp.warnings,
        demo: o.demo,
      }
      await saveSession(rec, { track: imp.track, wind: imp.wind })
      return { rec, duplicate: false }
    },
    [settings.foilOnKn],
  )

  const importFiles = useCallback(
    async (files: File[]) => {
      const queued = files.map((f) => ({ key: crypto.randomUUID(), name: f.name, status: 'reading' as const, file: f }))
      setJobs((js) => [...js.filter((j) => j.status !== 'done' && j.status !== 'duplicate'), ...queued.map(({ file: _f, ...j }) => j)])
      const created: SessionRecord[] = []
      for (const q of queued) {
        try {
          const buf = await q.file.arrayBuffer()
          setJob(q.key, { status: 'analyzing' })
          const imp = await importInWorker(q.file.name, buf, q.file.lastModified)
          const { rec, duplicate } = await createSession(imp, { fileName: q.file.name, rider: myName(settings) })
          setJob(q.key, { status: duplicate ? 'duplicate' : 'done', sessionId: rec.id })
          if (!duplicate) created.push(rec)
        } catch (e) {
          setJob(q.key, { status: 'error', error: e instanceof Error ? e.message : String(e) })
        }
      }
      await refresh()
      return created
    },
    [createSession, refresh, settings],
  )

  const importDemo = useCallback(async () => {
    const created: SessionRecord[] = []
    for (const f of demoFiles(demoStartTime())) {
      const buf = new TextEncoder().encode(f.gpx).buffer as ArrayBuffer
      const imp = await importInWorker(f.name, buf)
      const { rec } = await createSession(imp, {
        fileName: f.name,
        rider: f.friend ? 'Amico (esempio)' : myName(settings),
        modelWind: demoModelWind,
        demo: true,
        title: 'Esempio · Lago di Garda',
      })
      created.push(rec)
    }
    await refresh()
    return created
  }, [createSession, refresh, settings])

  const updateSession = useCallback(
    async (id: string, patch: Partial<SessionRecord>) => {
      const cur = (await listSessions()).find((s) => s.id === id)
      if (!cur) return
      await saveSession({ ...cur, ...patch })
      await refresh()
    },
    [refresh],
  )

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSession(id)
      await refresh()
    },
    [refresh],
  )

  const removeAll = useCallback(async () => {
    await deleteAll()
    setJobs([])
    await refresh()
  }, [refresh])

  const reanalyzeAll = useCallback(
    async (foilOnKn: number) => {
      for (const s of await listSessions()) {
        if (s.foilOnKn === foilOnKn) continue
        const d = await getSessionData(s.id)
        if (!d) continue
        const a = await analyzeInWorker(d.track, d.wind, { foilOnKn, windOverride: s.windOverride, modelWind: s.modelWind })
        await saveSession({ ...s, foilOnKn, summary: a.summary })
      }
      await refresh()
    },
    [refresh],
  )

  const value = useMemo<LibraryValue>(
    () => ({
      sessions,
      jobs,
      persistent: isPersistent(),
      importFiles,
      importDemo,
      updateSession,
      removeSession,
      removeAll,
      dismissJobs: () => setJobs([]),
      reanalyzeAll,
    }),
    [sessions, jobs, importFiles, importDemo, updateSession, removeSession, removeAll, reanalyzeAll],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLibrary(): LibraryValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLibrary outside LibraryProvider')
  return v
}
