import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { bestManeuver, detailAverages, maneuverDetails, rateSeriesOf, type ManeuverDetail, type RateSource } from '../lib/analysis/maneuverDetail'
import { maneuverOption, type ManeuverLine } from '../lib/charts'
import type { SessionData } from '../lib/store'
import type { ThemeColors } from '../lib/theme'
import type { Maneuver, SessionAnalysis, Tack } from '../lib/types'
import { fmtNum, fmtPct, fmtSpeed, fmtTimeSec, SPEED_SHORT, toUnit, type SpeedUnit } from '../lib/units'
import { EChart, type Chart } from './EChart'
import { card, LineKey, Outcome, Segmented, StatTile } from './ui'

type Kind = Maneuver['kind']
type Side = 'all' | Tack
type Track = SessionData['track']

const KIND_NAME: Record<Kind, string> = { jibe: 'Strambata', tack: 'Virata' }
const PLURAL: Record<Kind, string> = { jibe: 'Strambate', tack: 'Virate' }
const PASSAGE: Record<Kind, string> = { jibe: 'la poppa piena', tack: 'la prua al vento' }
const arrow = (from: Tack) => (from === 'S' ? 'D→S' : 'S→D')
const rateText = (v: number | null | undefined) => (v == null ? '–' : fmtNum(v, 0))
const angleText = (v: number | null | undefined) => (v == null ? '–' : `${fmtNum(v, 0)}°`)
/** «140° → 120°»: the angle from the wind going into the turn and coming out of it. */
const anglesText = (entry: number | null | undefined, exit: number | null | undefined) => (entry == null && exit == null ? '–' : `${angleText(entry)} → ${angleText(exit)}`)
/** «140→120°», for the narrow columns of a table on a phone. */
const anglesShort = (entry: number | null | undefined, exit: number | null | undefined) =>
  entry == null && exit == null ? '–' : `${entry == null ? '–' : fmtNum(entry, 0)}→${exit == null ? '–' : fmtNum(exit, 0)}°`

/** Below about one point per this many seconds the peaks come out blunter than they were. */
const COARSE_POINT_S = 0.8

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
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Velocità minima in strambata" value={fmtSpeed(avg(jibes.filter((m) => !m.fell).map((m) => m.minSpeed)), unit)} unit={u} sub="media, senza le cadute" />
        <StatTile
          label="Durata media strambata"
          value={jibes.length ? `${fmtNum(avg(details.flatMap((d) => (d?.maneuver.kind === 'jibe' ? d.turnSeconds : []))), 0)} s` : '–'}
          sub="la curva, senza le cadute"
        />
        <StatTile label="Cadute o soste" value={String(a.summary.falls)} sub={`${ms.filter((m) => m.fell).length} durante una manovra`} />
      </div>

      <Overlay details={details} tr={tr} unit={unit} colors={colors} selected={selected} onSelect={onSelect} />

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <caption className="px-3 pt-3 text-left text-sm font-semibold">Per lato</caption>
          <thead className="text-xs text-ink-2">
            <tr>
              <th className="py-2 pr-1 pl-3 text-left font-medium" />
              <th className="px-2 py-2 text-right font-medium">Vel. ang.</th>
              <th className="px-2 py-2 text-right font-medium">Angolo</th>
              {hasHeel && <th className="py-2 pr-3 pl-2 text-right font-medium">Inclinaz.</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <td className="py-2 pr-1 pl-3 whitespace-nowrap">
                  {r.label}
                  <span className="block text-xs text-ink-2 tabular">
                    {r.ok}/{r.n} in foil · <span className="font-semibold text-ink">{fmtPct(r.ok / r.n)}</span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular">{rateText(r.avg.turnRate)}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular">{anglesShort(r.avg.entryAngle, r.avg.exitAngle)}</td>
                {hasHeel && <td className="py-2 pr-3 pl-2 text-right tabular">{angleText(r.avg.heelIn)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 pb-3 text-xs text-ink-2">
          Medie delle manovre. Vel. ang.: velocità angolare in °/s, angolo girato diviso il tempo della curva. Angolo: al vento, in ingresso → in uscita.
          {hasHeel && ' Inclinaz.: la massima verso l’interno della curva.'}
        </p>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[650px] text-sm">
          <caption className="px-3 pt-3 text-left text-sm font-semibold">Tutte le manovre ({u})</caption>
          <thead className="text-xs text-ink-2">
            <tr>
              <th className="py-2 pr-1 pl-3 text-left font-medium">Ora</th>
              <th className="px-2 py-2 text-left font-medium">Manovra</th>
              <th className="px-2 py-2 text-right font-medium">Vel. ang.</th>
              <th className="px-2 py-2 text-right font-medium">Angolo</th>
              {hasHeel && <th className="px-2 py-2 text-right font-medium">Inclinaz.</th>}
              <th className="px-2 py-2 text-right font-medium">Minima</th>
              <th className="px-2 py-2 text-right font-medium">Entrata</th>
              <th className="px-2 py-2 text-right font-medium">Uscita</th>
              <th className="px-3 py-2 text-right font-medium">Curva</th>
            </tr>
          </thead>
          <tbody>
            {ms.map((m, k) => {
              const d = details[k]
              return (
                <tr
                  key={k}
                  onClick={() => onPick(k)}
                  className={`cursor-pointer border-t border-line ${selected === k ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
                >
                  <td className="py-2 pr-1 pl-3 tabular">{fmtTimeSec(tr.t[m.i0])}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {KIND_NAME[m.kind]} <span className="text-ink-2">{arrow(m.from)}</span>
                    <span className="block">
                      <Outcome ok={m.foiled} fell={m.fell} />
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular">{rateText(d?.turnRate)}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap tabular">{anglesShort(d?.entryAngle, d?.exitAngle)}</td>
                  {hasHeel && <td className="px-2 py-2 text-right tabular">{angleText(d?.heelIn)}</td>}
                  <td className="px-2 py-2 text-right font-semibold tabular">{fmtSpeed(m.minSpeed, unit)}</td>
                  <td className="px-2 py-2 text-right tabular">{fmtSpeed(m.entrySpeed, unit)}</td>
                  <td className="px-2 py-2 text-right tabular">{fmtSpeed(m.exitSpeed, unit)}</td>
                  <td className="px-3 py-2 text-right tabular">{d?.turnSeconds === 0 ? '–' : `${fmtNum(d ? d.turnSeconds : m.duration, 0)} s`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-3 pb-3 text-xs text-ink-2">
          D→S: da mure a dritta a mure a sinistra. Vel. ang.: velocità angolare in °/s, angolo girato diviso il tempo della curva. Angolo: al vento, in ingresso → in uscita.
          {hasHeel && ' Inclinaz.: la massima verso l’interno della curva.'} Tocca una riga per vederla sulla mappa.
        </p>
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
}: {
  details: (ManeuverDetail | null)[]
  tr: Track
  unit: SpeedUnit
  colors: ThemeColors
  selected: number | null
  onSelect: (k: number) => void
}) {
  const u = SPEED_SHORT[unit]
  const all = useMemo(() => details.filter((d): d is ManeuverDetail => d != null), [details])
  const count = (k: Kind) => all.filter((d) => d.maneuver.kind === k).length
  const [kind, setKind] = useState<Kind>(() => (count('jibe') >= count('tack') ? 'jibe' : 'tack'))
  const [side, setSide] = useState<Side>('all')
  const [source, setSource] = useState<RateSource>(tr.hdg ? 'compass' : 'track')
  // A manoeuvre picked elsewhere (the map, the table) brings its own group into view.
  const [seen, setSeen] = useState(selected)
  if (selected !== seen) {
    setSeen(selected)
    const m = selected != null ? details[selected]?.maneuver : null
    if (m) {
      setKind(m.kind)
      if (side !== 'all' && side !== m.from) setSide('all')
    }
  }

  const shown = useMemo(() => all.filter((d) => d.maneuver.kind === kind && (side === 'all' || d.maneuver.from === side)), [all, kind, side])
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

  const steps = (all[0].t.length > 1 ? all.map((d) => d.t[1] - d.t[0]) : [0]).sort((p, q) => p - q)
  const coarse = steps[steps.length >> 1] >= COARSE_POINT_S
  const kinds = (['jibe', 'tack'] as const).filter((k) => count(k) > 0)
  const touched = shown.some((d) => !d.maneuver.foiled)

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3 p-3`}>
        <div>
          <p className="text-sm font-semibold">Traiettorie sovrapposte</p>
          <p className="text-xs text-ink-2">
            Vento dall’alto. Ogni linea è una manovra, allineata dove passa {PASSAGE[kind]} (il pallino). Tocca una linea per leggerne i numeri.
            {side === 'all' && ' Quelle da mure a dritta sono specchiate, per sovrapporle.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented label="Tipo di manovra" value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: `${PLURAL[k]} (${count(k)})` }))} />
          <Segmented
            label="Lato"
            value={side}
            onChange={setSide}
            options={[
              { value: 'all', label: 'Tutte' },
              { value: 'S', label: 'Da dritta' },
              { value: 'P', label: 'Da sinistra' },
            ]}
          />
        </div>
        {shown.length ? (
          <>
            <PathsPlot drawn={drawn} focus={focus} focusColor={focusColor} mirror={side === 'all'} colors={colors} tr={tr} unit={unit} onPick={onSelect} />
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
                  <LineKey color={focusColor} /> {picked ? 'selezionata' : focus === best ? 'la migliore' : 'in evidenza'}
                </span>
              )}
            </p>
            {focus && <Readout d={focus} isBest={!picked && focus === best} unit={unit} tr={tr} />}
          </>
        ) : (
          <p className="text-sm text-ink-2">Nessuna manovra di questo tipo da questo lato.</p>
        )}
        {pickedFall && <p className="text-sm text-ink-2">La manovra selezionata è una caduta: la sua traiettoria non è disegnata.</p>}
        {!pickedFall && falls > 0 && <p className="text-xs text-ink-2">{falls === 1 ? 'Una caduta non è disegnata.' : `${falls} cadute non sono disegnate.`}</p>}
      </div>

      {shown.length > 0 && (
        <>
          <div className={`${card} space-y-2 p-3`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Velocità angolare (°/s)</p>
                <p className="text-xs text-ink-2">
                  {tr.hdg
                    ? source === 'compass'
                      ? 'Secondo per secondo, quanto ruota la tavola (bussola).'
                      : 'Secondo per secondo, quanto curva la rotta (GPS).'
                    : 'Secondo per secondo, quanto curva la rotta (GPS).'}{' '}
                  Sopra lo zero gira nel verso della manovra.
                </p>
              </div>
              {tr.hdg && (
                <Segmented
                  compact
                  label="Da dove viene la curva della velocità angolare"
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: 'compass', label: 'Prua' },
                    { value: 'track', label: 'Traccia' },
                  ]}
                />
              )}
            </div>
            <TimeChart lines={rateLines} seconds={seconds} unit="°/s" yMin={-20} colors={colors} onPick={onSelect} height={190} label="Velocità angolare nel tempo, attorno al passaggio" />
            {coarse && <p className="text-xs text-ink-2">Questa traccia ha un punto al secondo: nel grafico i picchi risultano un po’ più bassi di quelli reali.</p>}
          </div>

          {heelLines.length > 0 ? (
            <div className={`${card} space-y-2 p-3`}>
              <div>
                <p className="text-sm font-semibold">Inclinazione (°)</p>
                <p className="text-xs text-ink-2">Sbandamento della tavola: sopra lo zero verso l’interno della curva, sotto verso l’esterno.</p>
              </div>
              <TimeChart lines={heelLines} seconds={seconds} unit="°" colors={colors} onPick={onSelect} height={170} label="Inclinazione nel tempo, attorno al passaggio" />
            </div>
          ) : (
            <p className="px-1 text-xs text-ink-2">L’inclinazione richiede un dispositivo che la misura, come il Vakaros.</p>
          )}

          <div className={`${card} space-y-2 p-3`}>
            <p className="text-sm font-semibold">Velocità ({u})</p>
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
function Readout({ d, isBest, unit, tr }: { d: ManeuverDetail; isBest: boolean; unit: SpeedUnit; tr: Track }) {
  const m = d.maneuver
  const u = SPEED_SHORT[unit]
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold">
          {isBest && 'La migliore: '}
          {KIND_NAME[m.kind]} {arrow(m.from)}
        </span>
        <span className="text-ink-2 tabular">{fmtTimeSec(tr.t[m.i0])}</span>
        <Outcome ok={m.foiled} />
      </p>
      {isBest && <p className="text-xs text-ink-2">La velocità minima più alta rimanendo in foil.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile label="Velocità angolare" value={rateText(d.turnRate)} unit={d.turnRate == null ? undefined : '°/s'} sub="angolo girato diviso il tempo della curva" />
        <StatTile label="Angolo al vento" value={anglesText(d.entryAngle, d.exitAngle)} sub="in ingresso → in uscita" />
        {d.heelIn != null && (
          <StatTile
            label="Inclinazione"
            value={`${fmtNum(d.heelIn, 0)}°`}
            sub={`massima verso l’interno${d.heelAtPassage != null ? ` · al passaggio ${fmtNum(d.heelAtPassage, 0)}°` : ''}`}
          />
        )}
        <StatTile label="Raggio" value={d.radius == null ? '–' : fmtNum(d.radius, 0)} unit={d.radius == null ? undefined : 'm'} sub={`curva di ${fmtNum(d.turnSeconds, 0)} s`} />
        <StatTile label="Velocità minima" value={fmtSpeed(m.minSpeed, unit)} unit={u} sub={`entrata ${fmtSpeed(m.entrySpeed, unit)} · uscita ${fmtSpeed(m.exitSpeed, unit)}`} />
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
  mirror,
  colors,
  tr,
  unit,
  onPick,
}: {
  drawn: Drawn[]
  focus: ManeuverDetail | null
  focusColor: string
  mirror: boolean
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
    const X = (d: ManeuverDetail, i: number) => (mirror && d.maneuver.from === 'S' ? -d.x[i] : d.x[i])
    // What most paths need: one very long turn must not shrink all the others.
    const xs = drawn.map(({ d }) => d.x.map((_, i) => X(d, i)))
    const x0 = Math.min(quantile(xs.map((v) => Math.min(...v)), 0.1), 0)
    const x1 = Math.max(quantile(xs.map((v) => Math.max(...v)), 0.9), 0)
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
        d.t.map((_, i) => [toX(X(d, i)), toY(d.y[i])] as [number, number]),
      ]),
    )
    const scale = [5, 10, 20, 25, 50, 100, 200, 500].filter((m) => m * s <= w * 0.3).pop() ?? 5
    return { h, s, paths, ox: toX(0), oy: toY(0), onLeft, scale }
  }, [drawn, mirror, w])

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
            {KIND_NAME[hover.d.maneuver.kind]} {arrow(hover.d.maneuver.from)} · {fmtTimeSec(tr.t[hover.d.maneuver.i0])}
          </span>
          <br />
          <span className="text-ink-2">
            minima {fmtSpeed(hover.d.maneuver.minSpeed, unit)} {SPEED_SHORT[unit]}
            {hover.d.turnRate != null && ` · ${fmtNum(hover.d.turnRate, 0)}°/s`}
          </span>
        </div>
      )}
    </div>
  )
}
