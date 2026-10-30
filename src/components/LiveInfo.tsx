import { useId, useState, type ReactNode } from 'react'
import { hasHeartRate, indexAtTime, MIN_HR } from '../lib/analysis/series'
import { norm180, RAD } from '../lib/geo'
import { useSettings, type LiveMetric, type Settings } from '../lib/settings'
import type { Track } from '../lib/types'
import { compass, fmtDist, fmtSpeed, SPEED_SHORT } from '../lib/units'
import { LineKey } from './ui'

/** A rider replayed on the shared clock. */
export interface LiveRider {
  id: string
  name: string
  color: string
  track: Track
  /** Added to the track's own time to put it on the shared clock. */
  offset: number
  /** Direction the wind blows from (deg), when known. */
  windDir: number | null
  foil?: Uint8Array | null
}

interface MetricDef {
  key: LiveMetric
  /** Name in the menu. */
  label: string
  /** Column heading. */
  head: (s: Settings) => string
  available: (r: LiveRider) => boolean
  value: (r: LiveRider, i: number, s: Settings) => ReactNode
}

const twaAt = (r: LiveRider, i: number) => norm180(r.windDir! - r.track.crs[i])
const whole = (v: number, suffix = '') => (Number.isFinite(v) ? `${Math.round(v)}${suffix}` : '–')

const METRICS: MetricDef[] = [
  {
    key: 'spd',
    label: 'Velocità',
    head: (s) => `Vel. ${SPEED_SHORT[s.speedUnit]}`,
    available: () => true,
    value: (r, i, s) => fmtSpeed(r.track.spd[i], s.speedUnit),
  },
  {
    key: 'vmg',
    label: 'VMG',
    head: (s) => `VMG ${SPEED_SHORT[s.speedUnit]}`,
    available: (r) => r.windDir != null,
    value: (r, i, s) => {
      const v = r.track.spd[i] * Math.cos(twaAt(r, i) * RAD)
      return (
        <>
          {fmtSpeed(Math.abs(v), s.speedUnit)}
          <span className="text-ink-2">{v >= 0 ? ' ↑' : ' ↓'}</span>
        </>
      )
    },
  },
  {
    key: 'twa',
    label: 'Angolo al vento',
    head: () => 'Angolo',
    available: (r) => r.windDir != null,
    value: (r, i) => {
      const a = twaAt(r, i)
      return (
        <>
          {Math.round(Math.abs(a))}°<span className="text-ink-2"> {a >= 0 ? 'dx' : 'sx'}</span>
        </>
      )
    },
  },
  {
    key: 'crs',
    label: 'Rotta',
    head: () => 'Rotta',
    available: () => true,
    value: (r, i) => `${Math.round(r.track.crs[i])}° ${compass(r.track.crs[i])}`,
  },
  {
    key: 'dist',
    label: 'Distanza percorsa',
    head: () => 'Distanza',
    available: () => true,
    value: (r, i, s) => fmtDist(r.track.dist[i], s.distUnit),
  },
  {
    key: 'foil',
    label: 'In foil',
    head: () => 'Foil',
    available: (r) => r.foil != null,
    value: (r, i) => (r.foil![i] ? 'sì' : 'no'),
  },
  {
    key: 'hr',
    label: 'Battito',
    head: () => 'Battito',
    available: (r) => hasHeartRate(r.track),
    value: (r, i) => (r.track.hr![i] > MIN_HR ? whole(r.track.hr![i]) : '–'),
  },
  {
    key: 'heel',
    label: 'Sbandamento',
    head: () => 'Sband.',
    available: (r) => r.track.roll != null,
    value: (r, i) => whole(Math.abs(r.track.roll![i]), '°'),
  },
]

/** Each rider's numbers at the replay position, drawn over the map; the menu picks the numbers. */
export function LiveInfo({ riders, cursor }: { riders: LiveRider[]; cursor: number | null }) {
  const { settings, update } = useSettings()
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const offered = METRICS.filter((m) => riders.some(m.available))
  const shown = offered.filter((m) => settings.liveMetrics.includes(m.key))
  const toggle = (k: LiveMetric) =>
    update({ liveMetrics: settings.liveMetrics.includes(k) ? settings.liveMetrics.filter((x) => x !== k) : [...settings.liveMetrics, k] })
  const arrows = shown.some((m) => m.key === 'vmg')
  const sides = shown.some((m) => m.key === 'twa')

  return (
    <div className="pointer-events-auto max-w-full rounded-xl border border-line bg-surface/90 text-xs shadow-sm backdrop-blur">
      <div className="flex items-center justify-between gap-3 py-1 pr-1 pl-2.5">
        <span className="font-semibold">In questo momento</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((o) => !o)}
          className="rounded-md px-1.5 py-1 font-medium text-accent hover:bg-surface-2"
        >
          Dati {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <fieldset id={menuId} className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line px-2.5 py-2">
          <legend className="sr-only">Dati da mostrare</legend>
          {offered.map((m) => (
            <label key={m.key} className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={settings.liveMetrics.includes(m.key)}
                onChange={() => toggle(m.key)}
                className="h-4 w-4 accent-[var(--accent-btn)]"
              />
              {m.label}
            </label>
          ))}
        </fieldset>
      )}
      {cursor == null ? (
        <p className="px-2.5 pb-2 text-ink-2">Premi ▶ sotto la mappa per i numeri di ognuno.</p>
      ) : (
        shown.length > 0 && (
          <div className="overflow-x-auto px-1.5 pb-1.5">
            <table className="tabular">
              <thead>
                <tr className="text-ink-2">
                  <th className="px-1 py-0.5 text-left font-medium">
                    <span className="sr-only">Rider</span>
                  </th>
                  {shown.map((m) => (
                    <th key={m.key} className="px-1.5 py-0.5 text-right font-medium whitespace-nowrap">
                      {m.head(settings)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riders.map((r) => {
                  const t = r.track.t
                  const tt = cursor - r.offset
                  // Not on the water yet, or already ashore.
                  const out = !t.length || tt < t[0] || tt > t[t.length - 1]
                  const i = indexAtTime(t, tt)
                  return (
                    <tr key={r.id}>
                      <th scope="row" className="px-1 py-0.5 text-left font-medium">
                        <span className="flex items-center gap-1.5">
                          <LineKey color={r.color} />
                          <span className={`max-w-[6rem] truncate ${out ? 'text-ink-2' : ''}`}>{r.name}</span>
                        </span>
                      </th>
                      {shown.map((m) => (
                        <td key={m.key} className="px-1.5 py-0.5 text-right whitespace-nowrap">
                          {out || !m.available(r) ? '–' : m.value(r, i, settings)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {(arrows || sides) && (
              <p className="px-1 pt-0.5 text-[11px] text-ink-2">
                {[arrows && '↑ verso il vento, ↓ sottovento', sides && 'dx/sx mure a dritta/sinistra'].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )
      )}
    </div>
  )
}
