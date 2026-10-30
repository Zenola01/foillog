import { describe, expect, it } from 'vitest'
import { fileNameOnly, tracksFromText } from '../src/lib/clipboardTracks'

const gpx = `<?xml version="1.0"?>\n<gpx version="1.1"><trk><trkseg>${'<trkpt lat="45.6" lon="13.7"><time>2026-10-22T11:02:00Z</time></trkpt>'.repeat(5)}</trkseg></trk></gpx>`
const base64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8))
const bytes = async (f: File) => new Uint8Array(await f.arrayBuffer())

describe('tracks pasted from the clipboard', () => {
  it('takes the text of a GPX file', async () => {
    const [f] = tracksFromText(`\n${gpx}\n`)
    expect(f.name).toBe('traccia incollata.gpx')
    expect(await f.text()).toBe(gpx)
  })

  it('decodes a whole file copied in base64, line breaks or not, and tells VKX from GPX', async () => {
    const vkx = new Uint8Array(400).map((_, i) => (i === 0 ? 0xff : i === 1 ? 0x05 : i % 251))
    const lines = base64(vkx).replace(/(.{76})/g, '$1\n')
    const [a] = tracksFromText(lines)
    expect(a.name).toBe('traccia incollata.vkx')
    expect(await bytes(a)).toEqual(vkx)
    const [b] = tracksFromText(base64(new TextEncoder().encode(gpx)))
    expect(b.name).toBe('traccia incollata.gpx')
  })

  it('takes CSV text and ignores anything else', () => {
    expect(tracksFromText('time,lat,lon,sog\n2026-10-22T11:02:00Z,45.6,13.7,5.1')[0].name).toBe('traccia incollata.csv')
    expect(tracksFromText('ciao, ci vediamo in spiaggia alle 13')).toEqual([])
    expect(tracksFromText('')).toEqual([])
  })

  it('recognises a file pasted as its name only (a Finder copy in Chrome)', () => {
    expect(fileNameOnly('Bora 2109.gpx')).toBe('Bora 2109.gpx')
    expect(fileNameOnly(' Atlas III 7-9-2026.VKX\n')).toBe('Atlas III 7-9-2026.VKX')
    expect(fileNameOnly('/Users/zeno/Bora.gpx')).toBeNull()
    expect(fileNameOnly('ciao')).toBeNull()
  })
})
