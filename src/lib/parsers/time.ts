/**
 * Parses the date-time strings found in GPX and CSV files. Times without an offset are
 * taken as UTC (as the GPX spec requires); Safari rejects "YYYY-MM-DD HH:MM:SS", so the
 * space is normalised to "T" first. Day-first European dates ("31/12/2024 14:00") are accepted.
 */
export function parseDateTime(raw: string): number {
  let v = raw.trim().replace(/^"|"$/g, '')
  if (!v) return NaN
  const eu = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?$/.exec(v)
  if (eu) {
    const [, d, mo, y, h, mi, s = '0', frac = '0'] = eu
    const ms = Math.round(Number(`0.${frac}`) * 1000)
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms)
  }
  if (/^\d{4}-\d{2}-\d{2} \d/.test(v)) v = v.replace(' ', 'T')
  if (/T\d{1,2}:\d{2}(:\d{2}([.,]\d+)?)?$/.test(v)) v = `${v.replace(',', '.')}Z`
  return Date.parse(v)
}
