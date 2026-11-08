import { useId, useState } from 'react'
import { indexAtTime } from '../lib/analysis/series'
import { METRICS, type LiveRider } from '../lib/liveMetrics'
import { useSettings, type LiveMetric } from '../lib/settings'
import { LineKey } from './ui'

/** The boxes that pick the numbers; the choice is kept in the settings. */
export function MetricChecks({ id, riders, omit = [], className }: { id: string; riders: LiveRider[]; omit?: LiveMetric[]; className?: string }) {
  const { settings, update } = useSettings()
  const toggle = (k: LiveMetric) =>
    update({ liveMetrics: settings.liveMetrics.includes(k) ? settings.liveMetrics.filter((x) => x !== k) : [...settings.liveMetrics, k] })
  return (
    <fieldset id={id} className={`grid grid-cols-2 gap-x-3 gap-y-1.5 ${className ?? ''}`}>
      <legend className="sr-only">Dati da mostrare</legend>
      {METRICS.filter((m) => !omit.includes(m.key) && riders.some(m.available)).map((m) => (
        <label key={m.key} className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
          <input type="checkbox" checked={settings.liveMetrics.includes(m.key)} onChange={() => toggle(m.key)} className="h-4 w-4 accent-[var(--accent-btn)]" />
          {m.label}
        </label>
      ))}
    </fieldset>
  )
}

/** Each rider's numbers at the replay position, drawn over the map; the menu picks the numbers. */
export function LiveInfo({ riders, cursor }: { riders: LiveRider[]; cursor: number | null }) {
  const { settings } = useSettings()
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const shown = METRICS.filter((m) => riders.some(m.available) && settings.liveMetrics.includes(m.key))
  const arrows = shown.some((m) => m.key === 'vmg')
  const sides = shown.some((m) => m.key === 'twa')

  return (
    <div className="pointer-events-auto max-w-full rounded-2xl bg-surface/90 text-xs">
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
      {open && <MetricChecks id={menuId} riders={riders} className="border-t border-line px-2.5 py-2" />}
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
                {[arrows && '↑ verso il vento, ↓ sottovento', sides && 'dx/sx mure a dritta/sinistra'].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        )
      )}
    </div>
  )
}
