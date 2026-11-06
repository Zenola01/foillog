import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

// The little there is to animate, without a library: CSS does the moving (index.css), these only
// say when to start. Whoever asked their phone for less motion gets the final state straight away.

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** True once the element has come into view, so that an animation plays when it can be seen. */
export function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setSeen(true)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [seen])
  return [ref, seen]
}

/** Whether the element is in view right now, to stop what keeps moving where it cannot be seen. */
export function useInView<T extends Element>(on = true): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [on])
  return [ref, inView]
}

/** A number climbing to `value` once `run` is true. */
export function useCountUp(value: number, run: boolean, ms = 900): number {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!run) return
    if (prefersReducedMotion()) {
      setShown(value)
      return
    }
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      setShown(Math.round(value * (1 - (1 - p) ** 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, run, ms])
  return shown
}

/** Where the marker under the chosen one of several options goes, measured inside `box`. */
export function useSlidingMarker(box: RefObject<HTMLElement | null>, selector: string, key: unknown): { x: number; w: number } | null {
  const [marker, setMarker] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = box.current?.querySelector<HTMLElement>(selector)
      setMarker(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
    }
    measure()
    // The labels change width when their font arrives.
    let alive = true
    void document.fonts?.ready.then(() => alive && measure())
    return () => {
      alive = false
    }
  }, [box, selector, key])
  return marker
}
