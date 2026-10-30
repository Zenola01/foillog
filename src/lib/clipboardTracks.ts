// Tracks handed over through the clipboard. iPhone does not let a web app appear in the share
// sheet, and it does not hand copied files to web pages either: the «FoilLog» shortcut copies the
// file as base64 text, which pastes everywhere. On a computer a copied file pastes as it is.

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

/**
 * Tracks on the clipboard, read on a tap (iPhone first shows its own «Incolla» bubble). Text works
 * everywhere; files only where the browser hands them over. Rejects if reading is not allowed.
 */
export async function readClipboard(): Promise<{ files: File[]; name: string | null }> {
  const files: File[] = []
  let name: string | null = null
  const fromText = (text: string) => {
    const f = tracksFromText(text)
    if (f.length) files.push(...f)
    else name ??= fileNameOnly(text)
  }
  if (navigator.clipboard?.read) {
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        if (type.startsWith('image/') || type === 'text/html' || type === 'text/uri-list') continue
        const blob = await item.getType(type)
        if (type === 'text/plain') fromText(await blob.text())
        else files.push(new File([blob], NAME, { type }))
      }
      if (files.length) break
    }
  } else if (navigator.clipboard?.readText) fromText(await navigator.clipboard.readText())
  return { files, name }
}
