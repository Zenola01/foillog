import { useEffect } from 'react'
import { loadTrack, updateSession, type CloudSession } from './cloud'
import { analyzeInWorker } from './engine'
import { useLibrary } from './library'
import { useSettings } from './settings'
import { getSessionData, type SessionRecord } from './store'
import type { SessionSummary } from './types'

const lacksScores = (s: SessionSummary) => s.perf === undefined && s.windDir != null

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
    const crew = (rows ?? []).filter((r) => lacksScores(r.summary) && !tried.has(r.id))
    const device = local.filter((s) => lacksScores(s.summary) && !tried.has(s.id))
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
