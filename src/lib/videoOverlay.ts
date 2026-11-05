import { fmtNum, fmtSpeed, SPEED_SHORT, type SpeedUnit } from './units'
import type { OverlayValues } from './videoData'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// Helvetica and Arial have digits of one width, so the numbers do not shake as they change.
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif'

/** SOG, VMG and TWA in a band at the bottom of a frame of w×h pixels, sized on its short side. */
export function drawOverlay(ctx: Ctx, w: number, h: number, v: OverlayValues | null, unit: SpeedUnit) {
  const base = Math.min(w, h)
  const panelW = Math.min(w - base * 0.07, base)
  const panelH = base * 0.165
  const x0 = (w - panelW) / 2
  const y0 = h - panelH - base * 0.055
  const cellW = panelW / 3
  const u = SPEED_SHORT[unit]

  ctx.save()
  ctx.fillStyle = 'rgba(8, 12, 18, 0.62)'
  ctx.beginPath()
  ctx.roundRect(x0, y0, panelW, panelH, base * 0.03)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = Math.max(1, base * 0.002)
  ctx.beginPath()
  for (const k of [1, 2]) {
    ctx.moveTo(x0 + cellW * k, y0 + panelH * 0.18)
    ctx.lineTo(x0 + cellW * k, y0 + panelH * 0.82)
  }
  ctx.stroke()

  const vmg = v?.vmg
  const twa = v?.twa
  const cells: { label: string; value: string; note: string }[] = [
    { label: 'SOG', value: v ? fmtSpeed(v.sog, unit) : '–', note: u },
    { label: vmg == null ? 'VMG' : vmg >= 0 ? 'VMG ↑' : 'VMG ↓', value: vmg == null ? '–' : fmtSpeed(Math.abs(vmg), unit), note: vmg == null ? '' : u },
    { label: 'TWA', value: twa == null ? '–' : `${fmtNum(Math.abs(twa), 0)}°`, note: twa == null ? '' : twa >= 0 ? 'dx' : 'sx' },
  ]
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  cells.forEach((c, k) => {
    const x = x0 + cellW * k + base * 0.03
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
    ctx.font = `600 ${base * 0.03}px ${FONT}`
    ctx.fillText(c.label, x, y0 + panelH * 0.32)
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${base * 0.072}px ${FONT}`
    ctx.fillText(c.value, x, y0 + panelH * 0.82)
    const valueW = ctx.measureText(c.value).width
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
    ctx.font = `500 ${base * 0.028}px ${FONT}`
    ctx.fillText(c.note, x + valueW + base * 0.01, y0 + panelH * 0.82)
  })
  ctx.restore()
}
