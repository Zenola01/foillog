import { useEffect, useState } from 'react'
import { historyOf, type CloudSession, type HistoryRow } from './cloud'
import { sessionBand, type PolarSource } from './polars'
import type { SessionRecord } from './store'
import type { SessionGear } from './types'

/** Another session of the same rider, as the session page compares with and picks gear from. */
export interface PastSession extends PolarSource {
  gear: SessionGear[] | null
}

export const pastOfRow = (r: HistoryRow): PastSession => ({
  id: r.id,
  start: Date.parse(r.started_at),
  band: sessionBand(r.wind_band, r.windSpeed),
  polar: r.polar,
  vmgUp: r.vmgUp,
  vmgDown: r.vmgDown,
  gear: r.gear,
})

export const pastOfRecord = (r: SessionRecord): PastSession => ({
  id: r.id,
  start: r.summary.start,
  band: sessionBand(r.windBand, r.summary.modelWindSpeed),
  polar: r.summary.polar,
  vmgUp: r.summary.bestVmgUp,
  vmgDown: r.summary.bestVmgDown,
  gear: r.gear ?? null,
})

export const pastOfCloud = (s: CloudSession): PastSession => ({
  id: s.id,
  start: Date.parse(s.started_at),
  band: sessionBand(s.wind_band, s.summary.modelWindSpeed),
  polar: s.summary.polar,
  vmgUp: s.summary.bestVmgUp,
  vmgDown: s.summary.bestVmgDown,
  gear: s.gear,
})

const NONE: HistoryRow[] = []

/** A rider's sessions in the crew: null while loading, empty without a rider or when unreadable. */
export function useHistory(userId: string | null | undefined): HistoryRow[] | null {
  const [got, setGot] = useState<{ userId: string; rows: HistoryRow[] } | null>(null)
  useEffect(() => {
    if (!userId) return
    let alive = true
    historyOf(userId)
      .then((rows) => alive && setGot({ userId, rows }))
      .catch(() => alive && setGot({ userId, rows: [] }))
    return () => {
      alive = false
    }
  }, [userId])
  if (!userId) return NONE
  return got?.userId === userId ? got.rows : null
}
