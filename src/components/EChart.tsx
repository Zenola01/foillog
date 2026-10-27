import { BarChart, LineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, PolarComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, MarkLineComponent, PolarComponent, CanvasRenderer])

export type Chart = EChartsType

/** Thin ECharts wrapper: one instance per mount, resized with its box, option replaced on change. */
export function EChart({
  option,
  height,
  label,
  onInit,
  onOption,
  className,
}: {
  option: EChartsCoreOption
  height: number
  /** Accessible description of what the chart shows. */
  label: string
  /** Called once after the instance is created: attach event handlers here. */
  onInit?: (chart: Chart) => void
  /** Called after every option update (which resets zoom): re-apply view state here. */
  onOption?: (chart: Chart) => void
  className?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<Chart | null>(null)
  const init = useRef(onInit)
  init.current = onInit
  const after = useRef(onOption)
  after.current = onOption

  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'canvas' })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current!)
    init.current?.(c)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const c = chart.current
    if (!c) return
    c.setOption(option, { notMerge: true })
    after.current?.(c)
  }, [option])

  return <div ref={el} role="img" aria-label={label} style={{ height }} className={className} />
}
