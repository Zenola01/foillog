import type { EChartsCoreOption } from 'echarts/core'
import { MIN_HR, pointWeights } from './analysis/series'
import type { ThemeColors } from './theme'
import type { PolarBin, SessionAnalysis, Track } from './types'
import { fmtClockDuration, fmtNum, fmtTime, fmtTimeSec, MS_TO_KN, SPEED_SHORT, toUnit, type SpeedUnit } from './units'

// ECharts options. Marks follow the data-viz spec: 2px lines with a 10% area wash, solid
// hairline grid, one y-axis per chart, values leading in tooltips with a line key per series.

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const v = parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
}

/** Solid colour `t` of the way from hex colour `a` to `b` (both #rrggbb; otherwise `a`). */
export function mix(a: string, b: string, t: number): string {
  const ma = /^#?([0-9a-f]{6})$/i.exec(a.trim())
  const mb = /^#?([0-9a-f]{6})$/i.exec(b.trim())
  if (!ma || !mb) return a
  const va = parseInt(ma[1], 16)
  const vb = parseInt(mb[1], 16)
  const ch = (shift: number) => Math.round(((va >> shift) & 255) * (1 - t) + ((vb >> shift) & 255) * t)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

const lineKey = (color: string) =>
  `<span style="display:inline-block;width:14px;height:3px;border-radius:2px;background:${color};vertical-align:middle;margin-right:6px"></span>`

function tooltipBase(c: ThemeColors) {
  return {
    confine: true,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    padding: [6, 10],
    textStyle: { color: c.ink, fontSize: 13 },
    extraCssText: 'box-shadow:0 4px 18px rgba(0,0,0,.14);border-radius:10px;',
  }
}

function timeAxis(c: ThemeColors, relative: boolean) {
  return {
    type: relative ? 'value' : 'time',
    min: 'dataMin',
    max: 'dataMax',
    axisLine: { lineStyle: { color: c.axis } },
    axisTick: { show: false },
    axisLabel: {
      color: c.muted,
      hideOverlap: true,
      // An axis without data asks for labels at NaN.
      formatter: (v: number) => (!Number.isFinite(v) ? '' : relative ? fmtClockDuration(v / 1000) : fmtTime(v)),
    },
    splitLine: { show: false },
  }
}

function valueAxis(c: ThemeColors, name: string, extra: object = {}) {
  return {
    type: 'value',
    name,
    nameGap: 10,
    nameTextStyle: { color: c.muted, align: 'left' },
    axisLabel: { color: c.muted },
    splitLine: { lineStyle: { color: c.grid, width: 1, type: 'solid' } },
    ...extra,
  }
}

function zoom(c: ThemeColors, coarse: boolean, relative: boolean) {
  const slider = {
    type: 'slider',
    filterMode: 'none',
    height: 26,
    bottom: 8,
    borderColor: c.border,
    backgroundColor: 'transparent',
    fillerColor: alpha(c.series[0], 0.12),
    dataBackground: { lineStyle: { color: c.axis, width: 1 }, areaStyle: { color: c.grid, opacity: 0.7 } },
    selectedDataBackground: { lineStyle: { color: c.series[0], width: 1 }, areaStyle: { color: c.series[0], opacity: 0.18 } },
    handleStyle: { color: c.surface, borderColor: c.muted },
    moveHandleStyle: { color: c.grid },
    emphasis: { handleStyle: { borderColor: c.ink2 } },
    textStyle: { color: c.muted },
    labelFormatter: (v: number) => (relative ? fmtClockDuration(v / 1000) : fmtTime(v)),
    brushSelect: false,
  }
  // On touch screens only the slider zooms, so a finger on the plot still scrolls the page.
  return coarse ? [slider] : [{ type: 'inside', filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false }, slider]
}

/** Speed over time with the foil threshold; the slider selects a stretch of the session. */
export function speedOption(p: {
  tr: Track
  a: SessionAnalysis
  unit: SpeedUnit
  c: ThemeColors
  foilKn: number
  coarse: boolean
}): { option: EChartsCoreOption; index: Int32Array } {
  const { tr, a, unit, c } = p
  const n = tr.t.length
  const data: [number, number | null][] = []
  const index: number[] = []
  for (let i = 0; i < n; i++) {
    if (tr.gap[i] && i > 0) {
      data.push([tr.t[i] - 1, null])
      index.push(-1)
    }
    data.push([tr.t[i], Math.round(toUnit(tr.spd[i], unit) * 10) / 10])
    index.push(i)
  }
  const u = SPEED_SHORT[unit]
  const option: EChartsCoreOption = {
    animation: false,
    grid: { left: 42, right: 14, top: 26, bottom: 62 },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: c.muted, width: 1 } },
      formatter: (ps: { dataIndex: number }[]) => {
        const i = index[ps[0]?.dataIndex ?? -1]
        if (i == null || i < 0) return ''
        const twa = a.twa ? Math.round(a.twa[i]) : null
        const side = twa == null ? '' : ` · ${Math.abs(twa)}° ${twa >= 0 ? 'dritta' : 'sinistra'}`
        return `<b style="font-size:15px">${fmtNum(toUnit(tr.spd[i], unit))} ${u}</b> <span style="color:${c.ink2}">${fmtTimeSec(tr.t[i])}</span><br><span style="color:${c.ink2}">${a.foil[i] ? 'in foil' : 'non in foil'}${side}</span>`
      },
    },
    xAxis: timeAxis(c, false),
    yAxis: valueAxis(c, u, { min: 0 }),
    dataZoom: zoom(c, p.coarse, false),
    series: [
      {
        id: 'speed',
        name: 'Velocità',
        type: 'line',
        data,
        showSymbol: false,
        sampling: 'lttb',
        connectNulls: false,
        lineStyle: { width: 2, color: c.series[0], join: 'round', cap: 'round' },
        itemStyle: { color: c.series[0] },
        areaStyle: { color: c.series[0], opacity: 0.1 },
        emphasis: { disabled: true },
        markLine: {
          symbol: 'none',
          silent: true,
          animation: false,
          lineStyle: { color: c.muted, width: 1, type: 'solid' },
          label: { color: c.ink2, formatter: 'soglia foil', position: 'insideEndTop', fontSize: 11 },
          data: [{ yAxis: Math.round(toUnit(p.foilKn / MS_TO_KN, unit) * 10) / 10 }],
        },
      },
    ],
  }
  return { option, index: Int32Array.from(index) }
}

/** Time spent in each speed band while foiling. */
export function histogramOption(tr: Track, a: SessionAnalysis, unit: SpeedUnit, c: ThemeColors): EChartsCoreOption {
  const w = pointWeights(tr)
  const step = unit === 'ms' ? 0.5 : unit === 'kmh' ? 2 : 1
  const mins = new Map<number, number>()
  for (let i = 0; i < tr.t.length; i++) {
    if (!a.foil[i]) continue
    const b = Math.floor(toUnit(tr.spd[i], unit) / step)
    mins.set(b, (mins.get(b) ?? 0) + w[i] / 60)
  }
  const keys = [...mins.keys()].sort((x, y) => x - y)
  const lo = keys[0] ?? 0
  const hi = keys[keys.length - 1] ?? 0
  const cats: string[] = []
  const vals: number[] = []
  for (let b = lo; b <= hi; b++) {
    cats.push(fmtNum(b * step, step < 1 ? 1 : 0))
    vals.push(Math.round((mins.get(b) ?? 0) * 10) / 10)
  }
  const u = SPEED_SHORT[unit]
  return {
    animation: false,
    grid: { left: 40, right: 12, top: 26, bottom: 30 },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'item',
      formatter: (p: { dataIndex: number; value: number }) =>
        `<b style="font-size:15px">${fmtNum(p.value)} min</b><br><span style="color:${c.ink2}">tra ${fmtNum((lo + p.dataIndex) * step, step < 1 ? 1 : 0)} e ${fmtNum((lo + p.dataIndex + 1) * step, step < 1 ? 1 : 0)} ${u}</span>`,
    },
    xAxis: {
      type: 'category',
      data: cats,
      name: u,
      nameLocation: 'end',
      nameTextStyle: { color: c.muted },
      axisLine: { lineStyle: { color: c.axis } },
      axisTick: { show: false },
      axisLabel: { color: c.muted, hideOverlap: true },
    },
    yAxis: valueAxis(c, 'min'),
    series: [
      {
        type: 'bar',
        data: vals,
        barMaxWidth: 24,
        barCategoryGap: '14%',
        itemStyle: { color: c.series[0], borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: alpha(c.series[0], 0.75) } },
      },
    ],
  }
}

/** Heel and pitch from the Vakaros orientation, same unit so one axis. */
export function orientationOption(tr: Track, c: ThemeColors, coarse: boolean): EChartsCoreOption {
  const roll: [number, number | null][] = []
  const pitch: [number, number | null][] = []
  const step = Math.max(1, Math.floor(tr.t.length / 12000))
  for (let i = 0; i < tr.t.length; i += step) {
    // Standing still or carrying the board ashore the angles are meaningless (±180°) and would
    // flatten the chart: leave those stretches out.
    const moving = tr.spd[i] >= 2.5
    if (tr.roll) roll.push([tr.t[i], moving ? Math.round(tr.roll[i] * 10) / 10 : null])
    if (tr.pitch) pitch.push([tr.t[i], moving ? Math.round(tr.pitch[i] * 10) / 10 : null])
  }
  // Axis from the 0.5–99.5 percentiles: a capsize spikes to ±180° and would flatten the rest.
  const vals = [...roll, ...pitch].map((p) => p[1]).filter((v): v is number => v != null).sort((a, b) => a - b)
  const lo = vals.length ? vals[Math.floor(vals.length * 0.005)] : -30
  const hi = vals.length ? vals[Math.ceil(vals.length * 0.995) - 1] : 30
  const yMin = Math.floor((lo - 5) / 20) * 20
  const yMax = Math.ceil((hi + 5) / 20) * 20
  const series = [
    { name: 'Sbandamento', data: roll, color: c.series[0] },
    { name: 'Beccheggio', data: pitch, color: c.series[1] },
  ].filter((s) => s.data.length)
  return {
    animation: false,
    legend: { top: 0, right: 8, icon: 'roundRect', itemWidth: 14, itemHeight: 3, textStyle: { color: c.ink2 } },
    grid: { left: 40, right: 14, top: 30, bottom: 62 },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: c.muted, width: 1 } },
      formatter: (ps: { seriesName: string; value: [number, number | null]; color: string }[]) =>
        `<span style="color:${c.ink2}">${fmtTimeSec(ps[0].value[0])}</span><br>` +
        (ps[0].value[1] == null
          ? `<span style="color:${c.ink2}">fermo</span>`
          : ps.map((s) => `${lineKey(s.color)}<b>${fmtNum(s.value[1] ?? NaN)}°</b> <span style="color:${c.ink2}">${esc(s.seriesName)}</span>`).join('<br>')),
    },
    xAxis: timeAxis(c, false),
    yAxis: valueAxis(c, 'gradi', { min: yMin, max: yMax }),
    dataZoom: zoom(c, coarse, false),
    series: series.map((s) => ({
      type: 'line',
      name: s.name,
      data: s.data,
      showSymbol: false,
      connectNulls: false,
      sampling: 'lttb',
      lineStyle: { width: 2, color: s.color },
      itemStyle: { color: s.color },
      emphasis: { disabled: true },
    })),
  }
}

export function heartRateOption(tr: Track, c: ThemeColors, coarse: boolean): EChartsCoreOption {
  const data: [number, number][] = []
  for (let i = 0; i < tr.t.length; i++) if (tr.hr && tr.hr[i] > MIN_HR) data.push([tr.t[i], Math.round(tr.hr[i])])
  return {
    animation: false,
    grid: { left: 40, right: 14, top: 26, bottom: 62 },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: c.muted, width: 1 } },
      formatter: (ps: { value: [number, number] }[]) =>
        `<b style="font-size:15px">${ps[0].value[1]} bpm</b> <span style="color:${c.ink2}">${fmtTimeSec(ps[0].value[0])}</span>`,
    },
    xAxis: timeAxis(c, false),
    yAxis: valueAxis(c, 'bpm', { scale: true }),
    dataZoom: zoom(c, coarse, false),
    series: [
      {
        type: 'line',
        data,
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 2, color: c.series[0] },
        areaStyle: { color: c.series[0], opacity: 0.1 },
        itemStyle: { color: c.series[0] },
        emphasis: { disabled: true },
      },
    ],
  }
}

/** A polar line; `dashed` marks a reference (the best so far) behind the session's own line. */
export interface PolarLine {
  name: string
  color: string
  bins: (PolarBin & { note?: string })[]
  dashed?: boolean
}

/**
 * Polar: speed (90th percentile) against true wind angle, wind from the top, starboard tack on
 * the right and port on the left. Each tack is its own line so the no-go zone stays open.
 */
export function polarOption(sessions: PolarLine[], unit: SpeedUnit, c: ThemeColors): EChartsCoreOption {
  const u = SPEED_SHORT[unit]
  const series = sessions.flatMap((s) =>
    (['S', 'P'] as const).map((side) => ({
      type: 'line',
      name: s.name,
      coordinateSystem: 'polar',
      z: s.dashed ? 1 : 2,
      showSymbol: true,
      symbolSize: s.dashed ? 5 : 6,
      lineStyle: { width: 2, color: s.color, type: s.dashed ? 'dashed' : 'solid' },
      // Hollow markers on a reference line: told apart by more than its colour.
      itemStyle: s.dashed ? { color: c.surface, borderColor: s.color, borderWidth: 1.5 } : { color: s.color, borderColor: c.surface, borderWidth: 2 },
      emphasis: { disabled: true },
      data: s.bins
        .filter((b) => (side === 'S' ? b.twa > 0 : b.twa < 0))
        .sort((x, y) => Math.abs(x.twa) - Math.abs(y.twa))
        .map((b) => ({ value: [Math.round(toUnit(b.speed, unit) * 10) / 10, b.twa >= 0 ? b.twa : 360 + b.twa], twa: b.twa, note: b.note })),
    })),
  )
  return {
    animation: false,
    legend:
      sessions.length > 1
        ? {
            top: 0,
            left: 'center',
            // The default key draws each line with its marker: a reference reads dashed and hollow.
            itemWidth: 22,
            itemHeight: 8,
            textStyle: { color: c.ink2 },
          }
        : undefined,
    polar: { radius: '74%', center: ['50%', sessions.length > 1 ? '56%' : '52%'] },
    angleAxis: {
      type: 'value',
      min: 0,
      max: 360,
      startAngle: 90,
      clockwise: true,
      interval: 30,
      axisLine: { lineStyle: { color: c.axis } },
      axisTick: { show: false },
      axisLabel: { color: c.muted, formatter: (v: number) => `${v <= 180 ? v : 360 - v}°` },
      splitLine: { lineStyle: { color: c.grid } },
    },
    radiusAxis: {
      type: 'value',
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.muted, fontSize: 10 },
      splitLine: { lineStyle: { color: c.grid } },
    },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'item',
      formatter: (p: { seriesName: string; color: string; data: { value: [number, number]; twa: number; note?: string } }) =>
        `${sessions.length > 1 ? lineKey(sessions.find((s) => s.name === p.seriesName)?.color ?? p.color) : ''}<b style="font-size:15px">${fmtNum(p.data.value[0])} ${u}</b><br><span style="color:${c.ink2}">${Math.abs(
          Math.round(p.data.twa),
        )}° dal vento · mure a ${p.data.twa >= 0 ? 'dritta' : 'sinistra'}${sessions.length > 1 ? ` · ${esc(p.seriesName)}` : ''}${p.data.note ? ` · ${esc(p.data.note)}` : ''}</span>`,
    },
    series,
  }
}

/** Speed of several sessions on a shared clock (time of day, or time since each start). */
export function compareSpeedOption(
  sessions: { name: string; color: string; tr: Track; offset: number }[],
  unit: SpeedUnit,
  c: ThemeColors,
  relative: boolean,
  coarse: boolean,
): EChartsCoreOption {
  const u = SPEED_SHORT[unit]
  return {
    animation: false,
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 3, textStyle: { color: c.ink2 } },
    grid: { left: 42, right: 14, top: 34, bottom: 62 },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: c.muted, width: 1 } },
      formatter: (ps: { seriesName: string; color: string; value: [number, number | null] }[]) =>
        `<span style="color:${c.ink2}">${relative ? fmtClockDuration(ps[0].value[0] / 1000) : fmtTimeSec(ps[0].value[0])}</span><br>` +
        ps
          .filter((s) => s.value[1] != null)
          .map((s) => `${lineKey(s.color)}<b>${fmtNum(s.value[1]!)} ${u}</b> <span style="color:${c.ink2}">${esc(s.seriesName)}</span>`)
          .join('<br>'),
    },
    xAxis: timeAxis(c, relative),
    yAxis: valueAxis(c, u, { min: 0 }),
    dataZoom: zoom(c, coarse, relative),
    series: sessions.map((s) => {
      const data: [number, number | null][] = []
      const step = Math.max(1, Math.floor(s.tr.t.length / 6000))
      for (let i = 0; i < s.tr.t.length; i += step) {
        if (s.tr.gap[i]) data.push([s.tr.t[i] + s.offset - 1, null])
        data.push([s.tr.t[i] + s.offset, Math.round(toUnit(s.tr.spd[i], unit) * 10) / 10])
      }
      return {
        type: 'line',
        name: s.name,
        data,
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 2, color: s.color },
        itemStyle: { color: s.color },
        emphasis: { disabled: true },
      }
    }),
  }
}

/** Best 10 s speed of each session over the season: one series, so no legend. */
export function progressOption(points: { t: number; v: number }[], unit: SpeedUnit, c: ThemeColors): EChartsCoreOption {
  const u = SPEED_SHORT[unit]
  return {
    animation: false,
    grid: { left: 42, right: 16, top: 26, bottom: 30 },
    tooltip: {
      ...tooltipBase(c),
      trigger: 'item',
      formatter: (p: { value: [number, number] }) =>
        `<b style="font-size:15px">${fmtNum(p.value[1])} ${u}</b><br><span style="color:${c.ink2}">${new Date(p.value[0]).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}</span>`,
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: c.axis } },
      axisTick: { show: false },
      axisLabel: { color: c.muted, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: valueAxis(c, u, { scale: true }),
    series: [
      {
        type: 'line',
        data: points.map((p) => [p.t, Math.round(toUnit(p.v, unit) * 10) / 10]),
        showSymbol: true,
        symbolSize: 8,
        lineStyle: { width: 2, color: c.series[0] },
        itemStyle: { color: c.series[0], borderColor: c.surface, borderWidth: 2 },
        emphasis: { scale: 1.3 },
      },
    ],
  }
}
