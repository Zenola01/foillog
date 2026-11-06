import { hasHeartRate } from './analysis/series'
import type { VideoMetric } from './settings'
import { compass, fmtDist, fmtNum, fmtSpeed, SPEED_SHORT, type DistUnit, type SpeedUnit } from './units'
import type { OverlaySource, OverlayValues } from './videoData'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const FONT = '"Barlow Condensed", "Helvetica Neue", Helvetica, Arial, sans-serif'
const VALUE_COLOR = '#c8f31d'
const LABEL_COLOR = 'rgba(255, 255, 255, 0.78)'

/** The numbers a video can show, in the order they are drawn. */
export const VIDEO_METRICS: { key: VideoMetric; label: string; available: (s: OverlaySource) => boolean }[] = [
  { key: 'spd', label: 'Velocità', available: () => true },
  { key: 'vmg', label: 'VMG', available: (s) => s.windDir != null },
  { key: 'twa', label: 'Angolo al vento', available: (s) => s.windDir != null },
  { key: 'hr', label: 'Battito', available: (s) => hasHeartRate(s.track) },
  { key: 'crs', label: 'Rotta', available: () => true },
  { key: 'dist', label: 'Distanza', available: () => true },
  { key: 'heel', label: 'Sbandamento', available: (s) => s.track.roll != null },
]

/** What a cell of the band says. */
export interface OverlayCell {
  label: string
  value: string
  note: string
}

/** The chosen numbers as text, in the fixed order of VIDEO_METRICS. */
export function overlayCells(v: OverlayValues | null, metrics: VideoMetric[], unit: SpeedUnit, distUnit: DistUnit): OverlayCell[] {
  const u = SPEED_SHORT[unit]
  const cell = (key: VideoMetric): OverlayCell => {
    switch (key) {
      case 'spd':
        return { label: 'SOG', value: v ? fmtSpeed(v.sog, unit) : '–', note: v ? u : '' }
      case 'vmg':
        return v?.vmg == null
          ? { label: 'VMG', value: '–', note: '' }
          : { label: v.vmg >= 0 ? 'VMG ↑' : 'VMG ↓', value: fmtSpeed(Math.abs(v.vmg), unit), note: u }
      case 'twa':
        return v?.twa == null ? { label: 'TWA', value: '–', note: '' } : { label: 'TWA', value: `${fmtNum(Math.abs(v.twa), 0)}°`, note: v.twa >= 0 ? 'dx' : 'sx' }
      case 'hr':
        return v?.hr == null ? { label: 'Battito', value: '–', note: '' } : { label: 'Battito', value: fmtNum(v.hr, 0), note: 'bpm' }
      case 'crs':
        return v ? { label: 'Rotta', value: `${fmtNum(v.crs, 0)}°`, note: compass(v.crs) } : { label: 'Rotta', value: '–', note: '' }
      case 'dist': {
        if (!v) return { label: 'Distanza', value: '–', note: '' }
        const [value, note = ''] = fmtDist(v.dist, distUnit).split(' ')
        return { label: 'Distanza', value, note }
      }
      case 'heel':
        return { label: 'Sbandamento', value: v?.heel == null ? '–' : `${fmtNum(v.heel, 0)}°`, note: '' }
    }
  }
  return VIDEO_METRICS.filter((m) => metrics.includes(m.key)).map((m) => cell(m.key))
}

/** How many cells go in a row: up to four on one row, then two rows. */
export function overlayColumns(n: number): number {
  if (n <= 4) return n
  return n <= 6 ? 3 : 4
}

/**
 * A value with each digit in a cell of the same width, as this face's digits differ and the numbers
 * would otherwise shake as they change. Returns how wide it came out.
 */
function drawValue(ctx: Ctx, text: string, x: number, y: number): number {
  const cell = Math.max(...[...'0123456789'].map((d) => ctx.measureText(d).width))
  let at = x
  for (const ch of text) {
    const width = ctx.measureText(ch).width
    const digit = ch >= '0' && ch <= '9'
    ctx.fillText(ch, digit ? at + (cell - width) / 2 : at, y)
    at += digit ? cell : width
  }
  return at - x
}

/** The chosen numbers in a band at the bottom of a frame of w×h pixels, sized on its short side. */
export function drawOverlay(ctx: Ctx, w: number, h: number, cells: OverlayCell[]) {
  if (!cells.length) return
  const base = Math.min(w, h)
  const cols = overlayColumns(cells.length)
  const rows = Math.ceil(cells.length / cols)
  const fullCell = base * 0.31
  const cellW = Math.min(fullCell, (w - base * 0.07) / cols)
  // Narrower cells take slightly smaller numbers, so that value and unit still fit.
  const k = Math.min(1, (cellW / fullCell) * 1.15)
  const rowH = base * 0.165 * (rows > 1 ? 0.88 : 1)
  const panelW = cellW * cols
  const panelH = rowH * rows
  const x0 = (w - panelW) / 2
  const y0 = h - panelH - base * 0.055

  ctx.save()
  ctx.fillStyle = 'rgba(10, 13, 15, 0.74)'
  ctx.beginPath()
  ctx.roundRect(x0, y0, panelW, panelH, base * 0.014)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = Math.max(1, base * 0.002)
  ctx.beginPath()
  for (let c = 1; c < cols; c++) {
    ctx.moveTo(x0 + cellW * c, y0 + rowH * 0.18)
    ctx.lineTo(x0 + cellW * c, y0 + panelH - rowH * 0.18)
  }
  for (let r = 1; r < rows; r++) {
    ctx.moveTo(x0 + base * 0.025, y0 + rowH * r)
    ctx.lineTo(x0 + panelW - base * 0.025, y0 + rowH * r)
  }
  ctx.stroke()

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  cells.forEach((c, n) => {
    const x = x0 + cellW * (n % cols) + base * 0.03 * k
    const y = y0 + rowH * Math.floor(n / cols)
    ctx.fillStyle = LABEL_COLOR
    ctx.font = `600 ${base * 0.034 * k}px ${FONT}`
    ctx.fillText(c.label, x, y + rowH * 0.3)
    ctx.fillStyle = VALUE_COLOR
    ctx.font = `700 ${base * 0.09 * k}px ${FONT}`
    const valueW = drawValue(ctx, c.value, x, y + rowH * 0.84)
    ctx.fillStyle = LABEL_COLOR
    ctx.font = `500 ${base * 0.032 * k}px ${FONT}`
    ctx.fillText(c.note, x + valueW + base * 0.008, y + rowH * 0.84)
  })
  ctx.restore()
}
