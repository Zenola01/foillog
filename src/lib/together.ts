// Sessions sailed together. Tracks are compared only between riders who were on the water at the
// same time: same wind, same water, and a replay where everybody moves on one clock.

/** Time on the water together needed to compare two sessions. */
export const MIN_TOGETHER_MS = 5 * 60_000

export interface Span {
  start: number
  end: number
}

/** Time all the sessions were on the water together (ms; 0 if never all at once). */
export function sharedTime(spans: Span[]): number {
  if (!spans.length) return 0
  const start = Math.max(...spans.map((s) => s.start))
  const end = Math.min(...spans.map((s) => s.end))
  return Math.max(0, end - start)
}

/** At least two sessions, all on the water at once for MIN_TOGETHER_MS. */
export const together = (spans: Span[]) => spans.length >= 2 && sharedTime(spans) >= MIN_TOGETHER_MS

/**
 * Sessions sailed at the same time, grouped: each one together with at least another of its group,
 * groups sorted by start and most recent first. Sessions with nobody else on the water are left out.
 */
export function groupTogether<T extends Span>(items: T[]): T[][] {
  const groups: T[][] = []
  let cur: T[] = []
  let curEnd = -Infinity
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    // Too short to be together with anybody; it must not split the group around it either.
    if (it.end - it.start < MIN_TOGETHER_MS) continue
    // Sorted by start: the member ending last is the only one that could overlap it enough.
    if (cur.length && curEnd - it.start >= MIN_TOGETHER_MS) {
      cur.push(it)
      curEnd = Math.max(curEnd, it.end)
      continue
    }
    if (cur.length >= 2) groups.push(cur)
    cur = [it]
    curEnd = it.end
  }
  if (cur.length >= 2) groups.push(cur)
  return groups.reverse()
}
