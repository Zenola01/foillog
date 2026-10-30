// Tracks handed over through the clipboard. iPhone does not let a web app appear in the share
// sheet, so the file is copied instead (in Vakaros: Condividi → Copia, or with the «FoilLog»
// shortcut) and pasted here.

const NAME = 'traccia incollata'

/** Extension from the first bytes, the way the parsers tell the formats apart. */
function extOf(u8: Uint8Array): 'vkx' | 'gpx' | 'csv' {
  if (u8.length > 8 && u8[0] === 0xff && u8[1] < 0x20) return 'vkx'
  return /<gpx[\s>]/i.test(new TextDecoder().decode(u8.subarray(0, 2000))) ? 'gpx' : 'csv'
}

/**
 * Tracks in pasted text: the text of a GPX or CSV file, or a whole file in base64 (what the
 * shortcut copies, since a binary VKX file cannot travel as plain text).
 */
export function tracksFromText(text: string): File[] {
  const t = text.trim()
  if (/<gpx[\s>]/i.test(t.slice(0, 2000))) return [new File([t], `${NAME}.gpx`, { type: 'application/gpx+xml' })]
  const b64 = t.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '')
  if (b64.length >= 200 && b64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return [new File([u8], `${NAME}.${extOf(u8)}`)]
  }
  if (/^[^\n]*(lat|latitude)[^\n]*[,;\t]/i.test(t)) return [new File([t], `${NAME}.csv`, { type: 'text/csv' })]
  return []
}

/**
 * The name of a track file pasted without its content: Chrome pastes a file copied in the Finder as
 * its name and its icon only.
 */
export function fileNameOnly(text: string): string | null {
  const t = text.trim()
  return /^[^\n/\\]{1,200}\.(gpx|vkx|csv)$/i.test(t) ? t : null
}

/** Tracks in a paste: copied files first, then text. Images are never tracks (a file's icon). */
export function tracksFromPaste(dt: DataTransfer): File[] {
  const notImage = (f: File) => !f.type.startsWith('image/')
  const files = [...dt.files].filter(notImage)
  if (!files.length) {
    for (const it of Array.from(dt.items)) {
      const f = it.kind === 'file' ? it.getAsFile() : null
      if (f && notImage(f)) files.push(f)
    }
  }
  return files.length ? files : tracksFromText(dt.getData('text/plain'))
}
