import { describe, expect, it } from 'vitest'
import { hasHeartRate } from '../src/lib/analysis/series'
import { heartRateOption } from '../src/lib/charts'
import type { ThemeColors } from '../src/lib/theme'
import { fmtDate, fmtShortDate, fmtTime, fmtTimeSec } from '../src/lib/units'

// A missing time or an empty chart must never take the whole page down (Safari: "date value is
// not finite in DateTimeFormat format()").
describe('display of missing values', () => {
  it('shows a dash for a missing time', () => {
    for (const f of [fmtDate, fmtShortDate, fmtTime, fmtTimeSec]) expect(f(NaN)).toBe('–')
    expect(fmtTime(Date.UTC(2026, 8, 21, 14, 3))).toMatch(/\d\d:03/)
  })

  it('has no heart-rate chart for a column of zeros, and its axis survives no data', () => {
    const t = Float64Array.from({ length: 10 }, (_, i) => Date.UTC(2026, 8, 21, 14) + i * 1000)
    const zeros = { t, hr: new Float32Array(10) }
    expect(hasHeartRate(zeros)).toBe(false)
    expect(hasHeartRate({ hr: Float32Array.from([0, 0, 131]) })).toBe(true)
    const c = new Proxy({}, { get: (_, k) => (k === 'series' || k === 'speed' ? ['#000'] : '#000') }) as unknown as ThemeColors
    const opt = heartRateOption(zeros as never, c, false) as { xAxis: { axisLabel: { formatter: (v: number) => string } } }
    expect(opt.xAxis.axisLabel.formatter(NaN)).toBe('')
  })
})
