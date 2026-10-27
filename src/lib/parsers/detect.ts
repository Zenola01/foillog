import type { ParsedFile } from '../types'
import { parseCsv } from './csv'
import { parseGpx } from './gpx'
import { parseVkx } from './vkx'

/** Picks the parser from the extension and, when that is ambiguous, from the content. */
export function parseFile(name: string, data: ArrayBuffer, lastModified?: number): ParsedFile {
  const u8 = new Uint8Array(data)
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (ext === 'vkx' || (u8.length > 8 && u8[0] === 0xff && u8[1] < 0x20)) return parseVkx(data)
  if (ext === 'fit') throw new Error('I file .FIT (Garmin) non sono ancora supportati: esportali in GPX.')
  const text = new TextDecoder('utf-8').decode(u8)
  const head = text.slice(0, 2000).trimStart()
  if (ext === 'gpx' || /<gpx[\s>]/i.test(head)) return parseGpx(text)
  if (ext === 'csv' || ext === 'txt' || /^[^\n]*(lat|latitude)[^\n]*[,;\t]/i.test(head)) return parseCsv(text, lastModified)
  throw new Error('Formato non riconosciuto: usa file GPX, VKX (Vakaros) o CSV.')
}
