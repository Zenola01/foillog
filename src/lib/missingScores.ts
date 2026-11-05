import { createStore, get, set, type UseStore } from 'idb-keyval'
import { useEffect, useState } from 'react'
import { lacksPerf, perfKey } from './analysis/scores'
import { loadTrack, updateSession, type CloudSession } from './cloud'
import { analyzeInWorker } from './engine'
import { useLibrary } from './library'
import { useSettings } from './settings'
import { getSessionData, type SessionRecord } from './store'
import type { SessionPerf, SessionSummary } from './types'

/** Each session gets one try per start of the app: one that fails waits for the next start. */
const tried = new Set<string>()

/**
 * Sessions analysed before scores were kept get them now, one at a time and out of sight, so that
 * nobody has to open each one: your own in the crew (`rows`) and those kept on this device (`local`).
 */
export function useMissingScores(rows: CloudSession[] | null, local: SessionRecord[], onCrewSummary: (id: string, summary: SessionSummary) => void) {
  const { foilOnKn } = useSettings().settings
  const { updateSession: updateLocal, mirror } = useLibrary()
  useEffect(() => {
    const crew = (rows ?? []).filter((r) => lacksPerf(r.summary) && !tried.has(r.id))
    const device = local.filter((s) => lacksPerf(s.summary) && !tried.has(s.id))
    if (!crew.length && !device.length) return
    for (const s of [...crew, ...device]) tried.add(s.id)
    void (async () => {
      for (const r of crew) {
        try {
          const d = await loadTrack(r)
          const { summary } = await analyzeInWorker(d.track, d.wind, { foilOnKn, windOverride: r.wind_override, modelWind: r.model_wind })
          await updateSession(r.id, { summary })
          await mirror(r.id, { summary, foilOnKn })
          onCrewSummary(r.id, summary)
        } catch {
          // No score on the list for now; opening the session still shows it.
        }
      }
      for (const s of device) {
        try {
          const d = await getSessionData(s.id)
          if (!d) continue
          const { summary } = await analyzeInWorker(d.track, d.wind, { foilOnKn, windOverride: s.windOverride, modelWind: s.modelWind })
          await updateLocal(s.id, { summary, foilOnKn })
        } catch {
          // As above.
        }
      }
    })()
  }, [rows, local, foilOnKn, updateLocal, mirror, onCrewSummary])
}

let othersDb: UseStore | null = null
const othersStore = () => (othersDb ??= createStore('foillog-others-perf', 'perf'))

/** Since the app started, so that coming back to the list asks for nothing twice. */
const asked = new Map<string, Promise<SessionPerf | null>>()

/** Worked out from the track the first time, then kept on this device. */
function othersPerf(r: CloudSession, foilOnKn: number): Promise<SessionPerf | null> {
  // Correcting the wind changes the scores, so what they came from is part of the key.
  const key = perfKey(r.id, r.wind_override, r.model_wind?.dir)
  const known = asked.get(key)
  if (known) return known
  const work = (async () => {
    try {
      const saved = await get<SessionPerf | null>(key, othersStore())
      if (saved !== undefined) return saved
    } catch {
      // Nothing kept on this device: work it out each time.
    }
    const d = await loadTrack(r)
    const { summary } = await analyzeInWorker(d.track, d.wind, { foilOnKn, windOverride: r.wind_override, modelWind: r.model_wind })
    const perf = summary.perf ?? null
    try {
      await set(key, perf, othersStore())
    } catch {
      // Not kept; fine.
    }
    return perf
  })()
  asked.set(key, work)
  work.catch(() => asked.delete(key))
  return work
}

/**
 * Only its owner can store what a session is scored on, and until they do it is missing for
 * everybody else: those among `rows` get it here, newest first, by session id.
 */
export function useOthersPerf(rows: CloudSession[] | null, me: string | undefined): Map<string, SessionPerf | null> {
  const { foilOnKn } = useSettings().settings
  const [perfs, setPerfs] = useState(() => new Map<string, SessionPerf | null>())
  useEffect(() => {
    let alive = true
    void (async () => {
      for (const r of rows ?? []) {
        if (r.user_id === me || !lacksPerf(r.summary)) continue
        try {
          const perf = await othersPerf(r, foilOnKn)
          if (!alive) return
          setPerfs((m) => new Map(m).set(r.id, perf))
        } catch {
          // No score on the list for now; opening the session still shows it.
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [rows, me, foilOnKn])
  return perfs
}
