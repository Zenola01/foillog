import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { bestManeuver, detailAverages, maneuverDetails, rateSeriesOf, type ManeuverDetail, type RateSource } from '../lib/analysis/maneuverDetail'
import { maneuverOption, type ManeuverLine } from '../lib/charts'
import type { SessionData } from '../lib/store'
import type { ThemeColors } from '../lib/theme'
import type { Maneuver, SessionAnalysis, Tack } from '../lib/types'
import { fmtNum, fmtPct, fmtSpeed, fmtTimeSec, SPEED_SHORT, toUnit, type SpeedUnit } from '../lib/units'
import { EChart, type Chart } from './EChart'
import { btnGhost, card, LineKey, Outcome, Segmented, StatTile, zones } from './ui'

type Kind = Maneuver['kind']
type Track = SessionData['track']

const KIND_NAME: Record<Kind, string> = { jibe: 'Strambata', tack: 'Virata' }
const PLURAL: Record<Kind, string> = { jibe: 'Strambate', tack: 'Virate' }
const PASSAGE: Record<Kind, string> = { jibe: 'alla poppa piena', tack: 'alla prua al vento' }
const arrow = (from: Tack) => (from === 'S' ? 'D→S' : 'S→D')
const rateText = (v: number | null | undefined) => (v == null ? '–' : fmtNum(v, 0))
const angleText = (v: number | null | undefined) => (v == null ? '–' : `${fmtNum(v, 0)}°`)
/** «140° → 120°»: the angle from the wind going into the turn and coming out of it. */
const anglesText = (entry: number | null | undefined, exit: number | null | undefined) => (entry == null && exit == null ? '–' : `${angleText(entry)} → ${angleText(exit)}`)
/** «140→120°», for the narrow columns of a table on a phone. */
const anglesShort = (entry: number | null | undefined, exit: number | null | undefined) =>
  entry == null && exit == null ? '–' : `${entry == null ? '–' : fmtNum(entry, 0)}→${exit == null ? '–' : fmtNum(exit, 0)}°`

/** A manoeuvre as drawn: the colour says how much speed it kept, dashes that it touched the water. */
interface Drawn {
  d: ManeuverDetail
  color: string
  dashed: boolean
}

export function ManeuversTab({
  a,
  tr,
  unit,
  colors,
  selected,
  onPick,
  onSelect,
}: {
  a: SessionAnalysis
  tr: Track
  unit: SpeedUnit
  colors: ThemeColors
  selected: number | null
  /** Picks a manoeuvre and zooms the map and the charts on it. */
  onPick: (k: number) => void
  /** Only marks it: tapping one line after another must not move the page. */
  onSelect: (k: number) => void
}) {
  if (a.wind.dir == null) return <p className={`${card} p-4 text-sm text-ink-2`}>Imposta il vento per riconoscere strambate e virate.</p>
  if (!a.maneuvers.length) return <p className={`${card} p-4 text-sm text-ink-2`}>Nessuna strambata o virata riconosciuta in questa uscita.</p>
  return <Analysis a={a} tr={tr} windDir={a.wind.dir} unit={unit} colors={colors} selected={selected} onPick={onPick} onSelect={onSelect} />
}

function Analysis({
  a,
  tr,
  windDir,
  unit,
  colors,
  selected,
  onPick,
  onSelect,
}: {
  a: SessionAnalysis
  tr: Track
  windDir: number
  unit: SpeedUnit
  colors: ThemeColors
  selected: number | null
  onPick: (k: number) => void
  onSelect: (k: number) => void
}) {
  const u = SPEED_SHORT[unit]
  const ms = a.maneuvers
  const details = useMemo(() => maneuverDetails(tr, ms, windDir), [tr, ms, windDir])
  const hasHeel = details.some((d) => d?.heelIn != null)

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
  const jibes = ms.filter((m) => m.kind === 'jibe')
  const rows = (['jibe', 'tack'] as const)
    .flatMap((kind) =>
      (['S', 'P'] as const).map((from) => {
        const xs = ms.filter((m) => m.kind === kind && m.from === from)
        return {
          label: `${PLURAL[kind]} da ${from === 'S' ? 'dritta' : 'sinistra'}`,
          n: xs.length,
          ok: xs.filter((m) => m.foiled).length,
          avg: detailAverages(details.filter((d): d is ManeuverDetail => d != null && d.maneuver.kind === kind && d.maneuver.from === from)),
        }
      }),
    )
    .filter((r) => r.n > 0)

  return (
    <div className="space-y-4">
      <div className={`${zones} [--cols:2]`}>
        <StatTile label="Velocità minima in strambata" value={fmtSpeed(avg(jibes.filter((m) => !m.fell).map((m) => m.minSpeed)), unit)} unit={u} sub="media" />
        <StatTile
          label="Durata media strambata"
          value={jibes.length ? `${fmtNum(avg(details.flatMap((d) => (d?.maneuver.kind === 'jibe' ? d.turnSeconds : []))), 0)} s` : '–'}
        />
        <StatTile label="Cadute o soste" value={String(a.summary.falls)} sub={`${ms.filter((m) => m.fell).length} in manovra`} />
      </div>

      <Overlay details={details} tr={tr} unit={unit} colors={colors} selected={selected} onSelect={onSelect} onPick={onPick} />

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <caption className="px-3 pt-3 text-left text-sm font-semibold">Medie per lato</caption>
          <thead className="text-xs text-ink-2">
            <tr>
              <th className="py-2 pr-1 pl-3 text-left font-medium" />
              <th className="px-2 py-2 text-right font-medium">Vel. ang. °/s</th>
              <th className="px-2 py-2 text-right font-medium">Angolo vento</th>
              {hasHeel && <th className="py-2 pr-3 pl-2 text-right font-medium">Inclinaz.</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <td className="py-2 pr-1 pl-3 whitespace-nowrap">
                  {r.label}
                  <span className="block text-xs text-ink-2 tabular">
                    {r.ok}/{r.n} in foil, <span className="font-semibold text-ink">{fmtPct(r.ok / r.n)}</span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular">{rateText(r.avg.turnRate)}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular">{anglesShort(r.avg.entryAngle, r.avg.exitAngle)}</td>
                {hasHeel && <td className="py-2 pr-3 pl-2 text-right tabular">{angleText(r.avg.heelIn)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The manoeuvres of one kind on top of each other: their paths and what happened along them. */
function Overlay({
  details,
  tr,
  unit,
  colors,
  selected,
  onSelect,
  onPick,
}: {
  details: (ManeuverDetail | null)[]
  tr: Track
  unit: SpeedUnit
  colors: ThemeColors
  selected: number | null
  onSelect: (k: number) => void
  onPick: (k: number) => void
}) {
  const u = SPEED_SHORT[unit]
  const all = useMemo(() => details.filter((d): d is ManeuverDetail => d != null), [details])
  const count = (k: Kind, from?: Tack) => all.filter((d) => d.maneuver.kind === k && (!from || d.maneuver.from === from)).length
  const [kind, setKind] = useState<Kind>(() => (count('jibe') >= count('tack') ? 'jibe' : 'tack'))
  const [wantedSide, setSide] = useState<Tack>(() => (count(kind, 'S') >= count(kind, 'P') ? 'S' : 'P'))
  // A kind of manoeuvre may have been sailed from one side only.
  const side: Tack = count(kind, wantedSide) > 0 ? wantedSide : wantedSide === 'S' ? 'P' : 'S'
  const [source, setSource] = useState<RateSource>(tr.hdg ? 'compass' : 'track')
  // A manoeuvre picked elsewhere (the map) brings its own group into view.
  const [seen, setSeen] = useState(selected)
  if (selected !== seen) {
    setSeen(selected)
    const m = selected != null ? details[selected]?.maneuver : null
    if (m) {
      setKind(m.kind)
      setSide(m.from)
    }
  }

  const shown = useMemo(() => all.filter((d) => d.maneuver.kind === kind && d.maneuver.from === side), [all, kind, side])
  const best = useMemo(() => bestManeuver(shown), [shown])
  const picked = selected != null ? (shown.find((d) => d.index === selected) ?? null) : null
  const focus = picked ?? best ?? shown[0] ?? null
  const focusColor = colors.series[1]

  // Lighter or darker with the speed kept, on the same ramp as the map; the fastest ones on top.
  const foiled = shown.filter((d) => d.maneuver.foiled).map((d) => d.maneuver.minSpeed)
  const lo = foiled.length ? Math.min(...foiled) : 0
  const hi = foiled.length ? Math.max(...foiled) : 0
  const drawn = useMemo<Drawn[]>(() => {
    const step = (v: number) => (hi > lo ? Math.min(4, Math.floor(((v - lo) / (hi - lo)) * 5)) : 4)
    return shown
      .map((d) => ({ d, color: d.maneuver.foiled ? colors.speed[step(d.maneuver.minSpeed)] : colors.critical, dashed: !d.maneuver.foiled }))
      .sort((p, q) => p.d.maneuver.minSpeed - q.d.maneuver.minSpeed)
  }, [shown, lo, hi, colors])

  const seconds = useMemo(() => {
    const reach = shown.map((d) => Math.max(-d.turnStart, d.turnEnd)).sort((p, q) => p - q)
    const typical = reach.length ? reach[Math.floor((reach.length - 1) * 0.9)] : 5
    return Math.min(25, Math.max(6, Math.ceil(typical) + 3))
  }, [shown])

  const lines = useCallback(
    (values: (d: ManeuverDetail) => number[] | null, map: (v: number) => number = (v) => v): ManeuverLine[] =>
      drawn.flatMap(({ d, color, dashed }) => {
        const ys = values(d)
        if (!ys) return []
        return [
          {
            id: d.index,
            name: `${KIND_NAME[d.maneuver.kind]} ${arrow(d.maneuver.from)}, ${fmtTimeSec(tr.t[d.maneuver.i0])}`,
            color: d === focus ? focusColor : color,
            dashed,
            focus: d === focus,
            data: d.t.map((s, i): [number, number | null] => [Math.round(s * 100) / 100, Number.isFinite(ys[i]) ? Math.round(map(ys[i]) * 10) / 10 : null]),
          },
        ]
      }),
    [drawn, focus, focusColor, tr.t],
  )
  const rateLines = useMemo(() => lines((d) => rateSeriesOf(d, source)), [lines, source])
  const heelLines = useMemo(() => lines((d) => d.heel), [lines])
  const speedLines = useMemo(() => lines((d) => d.speed, (v) => toUnit(v, unit)), [lines, unit])

  const falls = details.filter((d) => d == null).length
  const pickedFall = selected != null && details[selected] == null
  if (!all.length) return <p className={`${card} p-4 text-sm text-ink-2`}>Solo cadute in questa uscita: nessuna traiettoria da confrontare.</p>

  const kinds = (['jibe', 'tack'] as const).filter((k) => count(k) > 0)
  const touched = shown.some((d) => !d.maneuver.foiled)

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3 p-3`}>
        <div>
          <p className="card-title">Traiettorie sovrapposte</p>
          <p className="text-xs text-ink-2">Allineate {PASSAGE[kind]} (il pallino). Tocca una linea per i numeri.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented label="Tipo di manovra" value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: `${PLURAL[k]} (${count(k)})` }))} />
          <Segmented
            label="Lato"
            value={side}
            onChange={setSide}
            options={[
              { value: 'S', label: `Da dritta (${count(kind, 'S')})` },
              { value: 'P', label: `Da sinistra (${count(kind, 'P')})` },
            ]}
          />
        </div>
        {shown.length > 0 && (
          <>
            <PathsPlot drawn={drawn} focus={focus} focusColor={focusColor} colors={colors} tr={tr} unit={unit} onPick={onSelect} />
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
              {foiled.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  Velocità minima {fmtSpeed(lo, unit, 0)}
                  <span aria-hidden className="inline-flex overflow-hidden rounded-full">
                    {colors.speed.map((c) => (
                      <span key={c} className="h-[5px] w-3" style={{ background: c }} />
                    ))}
                  </span>
                  {fmtSpeed(hi, unit, 0)} {u}
                </span>
              )}
              {touched && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: colors.critical }} /> toccata
                </span>
              )}
              {focus && (
                <span className="inline-flex items-center gap-1.5">
                  <LineKey color={focusColor} /> {picked ? 'selezionata' : focus === best ? 'la migliore (minima più alta)' : 'in evidenza'}
                </span>
              )}
            </p>
            {focus && (
              <Readout
                d={focus}
                isBest={!picked && focus === best}
                unit={unit}
                tr={tr}
                position={shown.indexOf(focus)}
                count={shown.length}
                onStep={(by) => onSelect(shown[(shown.indexOf(focus) + by + shown.length) % shown.length].index)}
                onMap={() => {
                  onPick(focus.index)
                  // On a phone the map is up above; on a large screen it stays beside the charts.
                  if (!window.matchMedia('(min-width: 1024px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
            )}
          </>
        )}
        {pickedFall && <p className="text-sm text-ink-2">Caduta: traiettoria non disegnata.</p>}
        {!pickedFall && falls > 0 && <p className="text-xs text-ink-2">{falls === 1 ? 'Una caduta non disegnata.' : `${falls} cadute non disegnate.`}</p>}
      </div>

      {shown.length > 0 && (
        <>
          <div className={`${card} space-y-2 p-3`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="card-title">Velocità angolare (°/s)</p>
              {tr.hdg && (
                <Segmented
                  compact
                  label="Da dove viene la curva della velocità angolare"
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: 'compass', label: 'Prua (bussola)' },
                    { value: 'track', label: 'Traccia (GPS)' },
                  ]}
                />
              )}
            </div>
            <TimeChart lines={rateLines} seconds={seconds} unit="°/s" yMin={-20} colors={colors} onPick={onSelect} height={190} label="Velocità angolare nel tempo, attorno al passaggio" />
          </div>

          {heelLines.length > 0 && (
            <div className={`${card} space-y-2 p-3`}>
              <p className="card-title">Inclinazione verso l’interno della curva (°)</p>
              <TimeChart lines={heelLines} seconds={seconds} unit="°" colors={colors} onPick={onSelect} height={170} label="Inclinazione nel tempo, attorno al passaggio" />
            </div>
          )}

          <div className={`${card} space-y-2 p-3`}>
            <p className="card-title">Velocità ({u})</p>
            <TimeChart lines={speedLines} seconds={seconds} unit={u} digits={1} colors={colors} onPick={onSelect} height={170} label="Velocità nel tempo, attorno al passaggio" />
          </div>
        </>
      )}
    </div>
  )
}

function TimeChart({
  lines,
  seconds,
  unit,
  digits,
  yMin,
  colors,
  onPick,
  height,
  label,
}: {
  lines: ManeuverLine[]
  seconds: number
  unit: string
  digits?: number
  yMin?: number
  colors: ThemeColors
  onPick: (k: number) => void
  height: number
  label: string
}) {
  const option = useMemo(() => maneuverOption({ lines, seconds, unit, digits, yMin, c: colors }), [lines, seconds, unit, digits, yMin, colors])
  const pick = useRef(onPick)
  pick.current = onPick
  const onInit = useCallback((c: Chart) => {
    c.on('click', (e: unknown) => {
      const id = (e as { seriesId?: string }).seriesId
      if (id != null) pick.current(Number(id))
    })
  }, [])
  return <EChart option={option} height={height} label={label} onInit={onInit} />
}

/** The numbers of the manoeuvre in evidence. */
function Readout({
  d,
  isBest,
  unit,
  tr,
  position,
  count,
  onStep,
  onMap,
}: {
  d: ManeuverDetail
  isBest: boolean
  unit: SpeedUnit
  tr: Track
  /** Where it stands among those shown, in time order. */
  position: number
  count: number
  onStep: (by: 1 | -1) => void
  onMap: () => void
}) {
  const m = d.maneuver
  const u = SPEED_SHORT[unit]
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold">
          {isBest && 'La migliore: '}
          {KIND_NAME[m.kind]} {arrow(m.from)}
        </span>
        <span className="text-ink-2 tabular">{fmtTimeSec(tr.t[m.i0])}</span>
        <Outcome ok={m.foiled} />
        <span className="ml-auto inline-flex items-center">
          <button type="button" className={`${btnGhost} text-lg leading-none`} aria-label="Manovra precedente" onClick={() => onStep(-1)}>
            ‹
          </button>
          <span className="text-xs text-ink-2 tabular">
            {position + 1}/{count}
          </span>
          <button type="button" className={`${btnGhost} text-lg leading-none`} aria-label="Manovra successiva" onClick={() => onStep(1)}>
            ›
          </button>
          <button type="button" className={btnGhost} onClick={onMap}>
            Sulla mappa
          </button>
        </span>
      </div>
      <div className={`${zones} [--cols:2] sm:[--cols:3]`}>
        <StatTile label="Velocità angolare" value={rateText(d.turnRate)} unit={d.turnRate == null ? undefined : '°/s'} sub="media della curva" />
        <StatTile label="Angolo al vento" value={anglesText(d.entryAngle, d.exitAngle)} sub="ingresso → uscita" />
        {d.heelIn != null && <StatTile label="Inclinazione" value={`${fmtNum(d.heelIn, 0)}°`} sub="massima verso l’interno" />}
        <StatTile label="Raggio" value={d.radius == null ? '–' : fmtNum(d.radius, 0)} unit={d.radius == null ? undefined : 'm'} sub={`curva di ${fmtNum(d.turnSeconds, 0)} s`} />
        <StatTile label="Velocità minima" value={fmtSpeed(m.minSpeed, unit)} unit={u} sub={`entrata ${fmtSpeed(m.entrySpeed, unit)}, uscita ${fmtSpeed(m.exitSpeed, unit)}`} />
      </div>
    </div>
  )
}

const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  const k = (s.length - 1) * p
  const i = Math.floor(k)
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (k - i)
}

/** Distance from point (px, py) to the segment a–b. */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const f = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(px - ax - f * dx, py - ay - f * dy)
}

/** A curve through the points (Catmull-Rom): at one point per second a plain polyline looks all corners. */
function smoothPath(pts: [number, number][]) {
  const p = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  let out = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = p(i)
    const [x2, y2] = p(i + 1)
    const c1x = x1 + (x2 - p(i - 1)[0]) / 6
    const c1y = y1 + (y2 - p(i - 1)[1]) / 6
    const c2x = x2 - (p(i + 2)[0] - x1) / 6
    const c2y = y2 - (p(i + 2)[1] - y1) / 6
    out += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
  }
  return out
}

/** Paths on the same scale in both directions, wind from the top, in metres from the passage. */
function PathsPlot({
  drawn,
  focus,
  focusColor,
  colors,
  tr,
  unit,
  onPick,
}: {
  drawn: Drawn[]
  focus: ManeuverDetail | null
  focusColor: string
  colors: ThemeColors
  tr: Track
  unit: SpeedUnit
  onPick: (k: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  const [hover, setHover] = useState<{ d: ManeuverDetail; x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current!
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    // What most paths need: one very long turn must not shrink all the others.
    const x0 = Math.min(quantile(drawn.map(({ d }) => Math.min(...d.x)), 0.1), 0)
    const x1 = Math.max(quantile(drawn.map(({ d }) => Math.max(...d.x)), 0.9), 0)
    const y0 = Math.min(quantile(drawn.map(({ d }) => Math.min(...d.y)), 0.1), 0)
    const y1 = Math.max(quantile(drawn.map(({ d }) => Math.max(...d.y)), 0.9), 0)
    // Room beyond the passage, on the side the paths leave free, for the wind and the scale.
    const free = (x1 - x0 || 1) * 0.18
    const onLeft = -x0 >= x1
    const left = onLeft ? x0 : x0 - free
    const right = onLeft ? x1 + free : x1
    const rx = right - left || 1
    const ry = y1 - y0 || 1
    const h = Math.round(Math.max(260, Math.min(460, w * 1.1, (w * ry) / rx)))
    const margin = 14
    const s = Math.min((w - 2 * margin) / rx, (h - 2 * margin) / ry)
    const toX = (x: number) => w / 2 + (x - (left + right) / 2) * s
    const toY = (y: number) => h / 2 - (y - (y0 + y1) / 2) * s
    const paths = new Map(
      drawn.map(({ d }) => [
        d,
        d.t.map((_, i) => [toX(d.x[i]), toY(d.y[i])] as [number, number]),
      ]),
    )
    const scale = [5, 10, 20, 25, 50, 100, 200, 500].filter((m) => m * s <= w * 0.3).pop() ?? 5
    return { h, s, paths, ox: toX(0), oy: toY(0), onLeft, scale }
  }, [drawn, w])

  const nearest = (e: MouseEvent, within: number) => {
    const r = box.current!.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    let best: ManeuverDetail | null = null
    let bestD = within
    for (const [d, pts] of geo.paths) {
      for (let i = 1; i < pts.length; i++) {
        const q = toSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
        if (q < bestD) {
          bestD = q
          best = d
        }
      }
    }
    return best ? { d: best, x: px, y: py } : null
  }

  const pathOf = (d: ManeuverDetail) => smoothPath(geo.paths.get(d)!)
  const nearestIndex = (d: ManeuverDetail, s: number) => d.t.reduce((b, x, i) => (Math.abs(x - s) < Math.abs(d.t[b] - s) ? i : b), 0)
  const chevron = (d: ManeuverDetail, s: number) => {
    const pts = geo.paths.get(d)!
    const i = Math.max(1, Math.min(pts.length - 2, nearestIndex(d, s)))
    const angle = (Math.atan2(pts[i + 1][1] - pts[i - 1][1], pts[i + 1][0] - pts[i - 1][0]) * 180) / Math.PI
    return <path d="M-6 -4.5L5 0L-6 4.5Z" fill={focusColor} transform={`translate(${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}) rotate(${angle.toFixed(0)})`} />
  }
  const dot = (d: ManeuverDetail, s: number) => {
    const [x, y] = geo.paths.get(d)![nearestIndex(d, s)]
    return <circle cx={x} cy={y} r={3.5} fill={colors.surface} stroke={focusColor} strokeWidth={2} />
  }

  // Wind and scale sit past the passage, where the paths leave room.
  const edge = geo.onLeft ? w - 10 : 10
  const anchor = geo.onLeft ? 'end' : 'start'
  const barW = geo.scale * geo.s

  return (
    <div
      ref={box}
      className="relative cursor-pointer overflow-hidden"
      onClick={(e) => {
        const hit = nearest(e, 30)
        if (hit) onPick(hit.d.index)
      }}
      onMouseMove={(e) => setHover(nearest(e, 16))}
      onMouseLeave={() => setHover(null)}
    >
      <svg role="img" aria-label="Traiettorie delle manovre sovrapposte, con il vento dall’alto" width={w} height={geo.h} className="block">
        {/* The wind axis through the passage. */}
        <line x1={geo.ox} x2={geo.ox} y1={0} y2={geo.h} stroke={colors.axis} strokeWidth={1} strokeDasharray="3 4" />
        {drawn.map(({ d, color, dashed }) =>
          d === focus ? null : (
            <path
              key={d.index}
              d={pathOf(d)}
              fill="none"
              stroke={color}
              strokeWidth={hover?.d === d ? 2.5 : 1.5}
              strokeDasharray={dashed ? '5 4' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )}
        {focus && geo.paths.has(focus) && (
          <>
            <path d={pathOf(focus)} fill="none" stroke={colors.surface} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
            <path
              d={pathOf(focus)}
              fill="none"
              stroke={focusColor}
              strokeWidth={3}
              strokeDasharray={focus.maneuver.foiled ? undefined : '7 5'}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {dot(focus, focus.turnStart)}
            {dot(focus, focus.turnEnd)}
            {chevron(focus, focus.turnStart - 1.5)}
            {chevron(focus, focus.turnEnd + 1.5)}
          </>
        )}
        <circle cx={geo.ox} cy={geo.oy} r={4} fill={colors.ink} stroke={colors.surface} strokeWidth={2} />
        {/* Wind. */}
        <g transform={`translate(${edge} 8)`} fill={colors.ink2}>
          <text x={0} y={10} fontSize={12} textAnchor={anchor}>
            Vento
          </text>
          <g transform={`translate(${geo.onLeft ? -14 : 14} 15)`}>
            <path d="M0 0V20" stroke={colors.ink2} strokeWidth={1.5} fill="none" />
            <path d="M-4.5 15L0 23L4.5 15Z" />
          </g>
        </g>
        {/* Scale. */}
        <g transform={`translate(${geo.onLeft ? edge - barW : edge} ${geo.h - 10})`}>
          <path d={`M0 -4V0H${barW.toFixed(1)}V-4`} fill="none" stroke={colors.ink2} strokeWidth={1.2} />
          <text x={barW / 2} y={-6} fontSize={11} textAnchor="middle" fill={colors.ink2}>
            {geo.scale} m
          </text>
        </g>
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
          style={{ left: Math.min(hover.x + 12, w - 170), top: Math.min(hover.y + 12, geo.h - 50) }}
        >
          <span className="font-semibold">
            {KIND_NAME[hover.d.maneuver.kind]} {arrow(hover.d.maneuver.from)}, {fmtTimeSec(tr.t[hover.d.maneuver.i0])}
          </span>
          <br />
          <span className="text-ink-2">
            minima {fmtSpeed(hover.d.maneuver.minSpeed, unit)} {SPEED_SHORT[unit]}
            {hover.d.turnRate != null && `, ${fmtNum(hover.d.turnRate, 0)}°/s`}
          </span>
        </div>
      )}
    </div>
  )
}
