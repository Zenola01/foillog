import { analyzeTrack } from '../lib/analysis/analyze'
import { processTrack } from '../lib/analysis/clean'
import type { ImportResult, WorkerRequest } from '../lib/engine'
import { parseFile } from '../lib/parsers/detect'

// Parsing and analysis run here so that a 25 Hz Vakaros log never freezes the page.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: unknown): void
}

ctx.onmessage = (e) => {
  const req = e.data
  try {
    if (req.type === 'import') {
      const parsed = parseFile(req.name, req.data, req.lastModified)
      const { track, rateHz, warnings } = processTrack(parsed.track)
      const result: ImportResult = {
        format: parsed.format,
        device: parsed.device,
        name: parsed.name,
        track,
        wind: parsed.wind,
        rateHz,
        warnings: [...parsed.warnings, ...warnings],
      }
      ctx.postMessage({ id: req.id, ok: true, result })
    } else {
      ctx.postMessage({ id: req.id, ok: true, result: analyzeTrack(req.track, req.wind, req.opts) })
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
