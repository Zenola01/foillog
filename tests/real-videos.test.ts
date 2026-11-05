import { existsSync, openAsBlob, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WHOLE_SECOND_SHIFT_MS } from '../src/lib/videoData'
import { readVideoInfo } from '../src/lib/videoFile'

// Real videos kept on this computer only: the folder is git-ignored, so these tests are skipped
// anywhere else (including the online build).
const DIR = join(import.meta.dirname, '..', 'video test')
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.(mov|mp4)$/i.test(f)) : []

describe.skipIf(files.length === 0)('real videos', () => {
  const day = Date.parse('2026-11-05T12:00:00Z')
  const session: [number, number] = [day, day + 2 * 3600_000]

  it.each(files)('%s tells when it starts, and its shape', async (name) => {
    const path = join(DIR, name)
    const blob = await openAsBlob(path)
    const file = new File([blob], name, { lastModified: statSync(path).mtimeMs })
    const info = await readVideoInfo(file, session)
    expect(info.duration).toBeGreaterThan(10)
    expect(info.height).toBeGreaterThan(info.width)
    expect(info.start).not.toBeNull()
    expect(info.start! % 1000).toBe(WHOLE_SECOND_SHIFT_MS)
    expect(info.start).toBeGreaterThan(session[0])
    expect(info.start).toBeLessThan(session[1])
  })
})
