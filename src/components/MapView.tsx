import { GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Feature, FeatureCollection } from 'geojson'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { indexAtTime } from '../lib/analysis/series'
import { alpha } from '../lib/charts'
import type { Settings } from '../lib/settings'
import { isCoarsePointer, useTheme, type ThemeColors } from '../lib/theme'
import type { Maneuver, Track } from '../lib/types'
import { compass } from '../lib/units'
import { Segmented } from './ui'

// MapLibre 6 looks for its worker next to its own module, which no longer exists once bundled.
setWorkerUrl(workerUrl)

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

export interface MapTrack {
  id: string
  track: Track
  foil?: Uint8Array | null
  /** Solid colour (comparisons). Without it the line is coloured by speed. */
  color?: string
  label?: string
  /** Added to the track's own time to put it on the shared clock. */
  offset?: number
}

interface Props {
  tracks: MapTrack[]
  /** Shared-clock time of the replay or hover position. */
  cursor?: number | null
  /** Shared-clock time range to highlight. */
  range?: [number, number] | null
  maneuvers?: Maneuver[]
  /** Falls or rests outside manoeuvres: index of the stop on the first track. */
  stops?: number[]
  selectedManeuver?: number | null
  onManeuverClick?: (k: number) => void
  /** Point labelled on the map (e.g. top speed): index into the first track. */
  pin?: { i: number; text: string } | null
  windDir?: number | null
  /** Speed range (m/s) mapped onto the colour ramp. */
  speedDomain?: [number, number]
  legend?: { min: string; max: string; unit: string }
  /**
   * Several riders: 'full' keeps every track (thin and faint while replaying), 'tail' shows only the
   * trail each rider leaves behind, which fades out after `tailSeconds`.
   */
  trail?: 'full' | 'tail'
  tailSeconds?: number
  /** Panel drawn over the map (live numbers). */
  overlay?: ReactNode
  className?: string
}

/** Paint objects with expressions built at runtime; MapLibre's static paint types cannot follow them. */
const paint = (p: Record<string, unknown>) => p as never
type FC = FeatureCollection

const empty: FC = { type: 'FeatureCollection', features: [] }

/**
 * Splits a track into line pieces of near-constant speed (for the colour ramp) and foil state.
 * Solid-colour tracks split only on foil state: every joint between pieces shows as a brighter bead
 * once the line is see-through.
 */
function lineFeatures(tr: Track, foil: Uint8Array | null | undefined, i0: number, i1: number, domain: [number, number], bySpeed = true): FC {
  const features: Feature[] = []
  const step = Math.max(1, Math.ceil((i1 - i0 + 1) / 9000))
  let coords: [number, number][] = []
  let sum = 0
  let cnt = 0
  let bucket = -1
  let f = -1
  const close = () => {
    if (coords.length >= 2) {
      features.push({ type: 'Feature', properties: { v: sum / cnt, f }, geometry: { type: 'LineString', coordinates: coords } })
    }
  }
  let prev = i0
  for (let i = i0; i <= i1; i = i === i1 ? i1 + 1 : Math.min(i + step, i1)) {
    let gap = false
    for (let k = prev + 1; k <= i; k++) if (tr.gap[k]) gap = true
    prev = i
    const v = tr.spd[i]
    const fl = foil ? foil[i] : 1
    const b = bySpeed ? Math.round(((v - domain[0]) / (domain[1] - domain[0] || 1)) * 14) : 0
    const p: [number, number] = [tr.lon[i], tr.lat[i]]
    if (gap) {
      close()
      coords = [p]
      sum = v
      cnt = 1
    } else if (coords.length > 0 && (b !== bucket || fl !== f)) {
      coords.push(p)
      close()
      coords = [p]
      sum = v
      cnt = 1
    } else {
      coords.push(p)
      sum += v
      cnt++
    }
    bucket = b
    f = fl
  }
  close()
  return { type: 'FeatureCollection', features }
}

function positionAt(tr: Track, t: number): [number, number] | null {
  const n = tr.t.length
  if (t < tr.t[0] || t > tr.t[n - 1]) return null
  const i = indexAtTime(tr.t, t)
  if (i >= n - 1) return [tr.lon[n - 1], tr.lat[n - 1]]
  if (tr.gap[i + 1]) return [tr.lon[i], tr.lat[i]]
  const f = (t - tr.t[i]) / (tr.t[i + 1] - tr.t[i])
  return [tr.lon[i] + (tr.lon[i + 1] - tr.lon[i]) * f, tr.lat[i] + (tr.lat[i + 1] - tr.lat[i]) * f]
}

/** Data-driven colour expression; typed `never` because MapLibre's static types cannot describe it. */
function speedColor(c: ThemeColors, d: [number, number]): never {
  const stops = c.speed.flatMap((col, k) => [d[0] + ((d[1] - d[0]) * k) / (c.speed.length - 1), col])
  return ['interpolate', ['linear'], ['get', 'v'], ...stops] as never
}

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Board seen from above, nose up: rotated to the course while replaying. */
const BOARD_PATH = 'M0 -14 C3.6 -9 5 -2 4.8 6 C4.7 10 4 13 3 14 L-3 14 C-4 13 -4.7 10 -4.8 6 C-5 -2 -3.6 -9 0 -14 Z'

interface Boat {
  marker: Marker
  hull: SVGSVGElement
  pill: HTMLElement | null
  /** Name label on the left of the board. */
  left: boolean
}

function boatEl(color: string, label: string | undefined, c: ThemeColors): { el: HTMLElement; hull: SVGSVGElement; pill: HTMLElement | null } {
  const el = document.createElement('div')
  el.style.cssText = 'position:relative;width:0;height:0;pointer-events:none;'
  const hull = document.createElementNS(SVG_NS, 'svg')
  hull.setAttribute('viewBox', '-8 -16 16 32')
  hull.setAttribute('width', '16')
  hull.setAttribute('height', '32')
  hull.style.cssText = 'position:absolute;left:-8px;top:-16px;overflow:visible;transform-origin:8px 16px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));'
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', BOARD_PATH)
  path.setAttribute('fill', color)
  path.setAttribute('stroke', c.surface)
  path.setAttribute('stroke-width', '2')
  path.setAttribute('paint-order', 'stroke')
  hull.appendChild(path)
  el.appendChild(hull)
  let pill: HTMLElement | null = null
  if (label) {
    pill = document.createElement('div')
    pill.textContent = label
    pill.style.cssText = `position:absolute;left:17px;top:-11px;font:600 12px system-ui,-apple-system,sans-serif;color:${c.ink};background:${c.surface};border:1px solid ${c.border};border-radius:999px;padding:1px 7px;white-space:nowrap;`
    el.appendChild(pill)
  }
  return { el, hull, pill }
}

/**
 * Riders close together on screen: each name goes on the side away from the nearest other board,
 * so labels do not cover each other or the boards. Near the edge of the map it stays inside.
 */
function placeLabels(map: MapLibreMap, boats: (Boat | null)[]) {
  const width = map.getContainer().clientWidth
  const pts = boats.map((b) => (b ? map.project(b.marker.getLngLat()) : null))
  boats.forEach((b, k) => {
    const p = pts[k]
    if (!b?.pill || !p) return
    let nearX: number | null = null
    let best = 140
    for (let j = 0; j < pts.length; j++) {
      const q = pts[j]
      if (j === k || !q) continue
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < best) {
        best = d
        nearX = q.x
      }
    }
    let left = nearX != null && nearX > p.x
    const room = b.pill.offsetWidth + 17
    if (!left && p.x + room > width) left = true
    else if (left && p.x - room < 0) left = false
    if (left === b.left) return
    b.left = left
    b.pill.style.left = left ? '' : '17px'
    b.pill.style.right = left ? '17px' : ''
  })
}

function MapViewImpl(props: Props) {
  const { tracks, cursor, range, maneuvers, stops, selectedManeuver, onManeuverClick, pin, windDir, legend, className } = props
  const trail = props.trail ?? 'full'
  const tailMs = (props.tailSeconds ?? 60) * 1000
  const multi = tracks.length > 1
  const replaying = cursor != null
  const { dark, colors } = useTheme()
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [styleGen, setStyleGen] = useState(0)
  /** False while a style is loading: sources and layers cannot be touched then. */
  const styleReady = useRef(false)
  const styleUrl = useRef(dark ? STYLES.dark : STYLES.light)
  const clickRef = useRef(onManeuverClick)
  clickRef.current = onManeuverClick
  const cursorMarkers = useRef<(Boat | null)[]>([])
  const pinMarker = useRef<Marker | null>(null)

  const domain = useMemo<[number, number]>(() => {
    if (props.speedDomain) return props.speedDomain
    const t = tracks[0]?.track
    if (!t) return [0, 10]
    const s = Array.from(t.spd).filter((v) => v > 1).sort((a, b) => a - b)
    return s.length ? [s[Math.floor(s.length * 0.05)], s[Math.floor(s.length * 0.98)]] : [0, 10]
  }, [props.speedDomain, tracks])

  const bounds = useMemo(() => {
    const b = new LngLatBounds()
    for (const { track } of tracks) for (let i = 0; i < track.t.length; i += 10) b.extend([track.lon[i], track.lat[i]])
    return b
  }, [tracks])

  // Create the map once.
  useEffect(() => {
    const coarse = isCoarsePointer()
    const map = new MapLibreMap({
      container: box.current!,
      style: styleUrl.current,
      bounds: bounds.isEmpty() ? undefined : bounds,
      fitBoundsOptions: { padding: 36 },
      attributionControl: { compact: true },
      cooperativeGestures: coarse,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      locale: {
        'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl + scorrimento per lo zoom della mappa',
        'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ + scorrimento per lo zoom della mappa',
        'CooperativeGesturesHandler.MobileHelpText': 'Usa due dita per muovere la mappa',
        'NavigationControl.ZoomIn': 'Ingrandisci',
        'NavigationControl.ZoomOut': 'Riduci',
      },
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.on('style.load', () => {
      styleReady.current = true
      setStyleGen((g) => g + 1)
    })
    map.on('click', 'fl-mnv', (e) => {
      const k = e.features?.[0]?.properties?.k
      if (typeof k === 'number') clickRef.current?.(k)
    })
    map.on('mouseenter', 'fl-mnv', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'fl-mnv', () => (map.getCanvas().style.cursor = ''))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      cursorMarkers.current = []
      pinMarker.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Light/dark basemap. A full style swap drops our layers; style.load re-adds them.
  useEffect(() => {
    const url = dark ? STYLES.dark : STYLES.light
    if (url === styleUrl.current) return
    styleUrl.current = url
    styleReady.current = false
    mapRef.current?.setStyle(url, { diff: false })
  }, [dark])

  // Fit to the tracks when the set of tracks changes.
  const trackKey = tracks.map((t) => t.id).join(',')
  useEffect(() => {
    const map = mapRef.current
    if (map && !bounds.isEmpty()) map.fitBounds(bounds, { padding: 36, animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey])

  // Track lines.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady.current) return
    tracks.forEach((t, k) => {
      const src = `fl-trk-${k}`
      const data = lineFeatures(t.track, t.foil, 0, t.track.t.length - 1, domain, !t.color)
      const existing = map.getSource(src) as GeoJSONSource | undefined
      if (existing) existing.setData(data)
      else map.addSource(src, { type: 'geojson', data })
      const width: unknown = multi ? ['case', ['==', ['get', 'f'], 1], 2, 1.5] : ['case', ['==', ['get', 'f'], 1], 3.5, 2.2]
      if (!map.getLayer(`${src}-casing`)) {
        const before = map.getLayer('fl-tail-0') ? 'fl-tail-0' : map.getLayer('fl-sel-casing') ? 'fl-sel-casing' : undefined
        map.addLayer({
          id: `${src}-casing`,
          type: 'line',
          source: src,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: paint({ 'line-color': colors.surface, 'line-width': ['+', width, multi ? 1.5 : 3] }),
        }, before)
        map.addLayer({
          id: `${src}-line`,
          type: 'line',
          source: src,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: paint({ 'line-color': t.color ?? speedColor(colors, domain), 'line-width': width }),
        }, before)
      } else {
        map.setPaintProperty(`${src}-casing`, 'line-color', colors.surface)
        map.setPaintProperty(`${src}-casing`, 'line-width', ['+', width, multi ? 1.5 : 3] as never)
        map.setPaintProperty(`${src}-line`, 'line-color', t.color ?? speedColor(colors, domain))
        map.setPaintProperty(`${src}-line`, 'line-width', width as never)
      }
    })
    // One fading trail per rider (line-gradient needs its own source with line metrics).
    tracks.forEach((t, k) => {
      const id = `fl-tail-${k}`
      const color = t.color ?? colors.ink
      const gradient = ['interpolate', ['linear'], ['line-progress'], 0, alpha(color, 0), 0.5, alpha(color, 0.55), 1, alpha(color, 1)]
      if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: empty, lineMetrics: true })
        const before = map.getLayer('fl-sel-casing') ? 'fl-sel-casing' : undefined
        map.addLayer(
          { id, type: 'line', source: id, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: paint({ 'line-width': 3.5, 'line-gradient': gradient }) },
          before,
        )
      } else map.setPaintProperty(id, 'line-gradient', gradient as never)
    })
    for (let k = tracks.length; map.getSource(`fl-tail-${k}`); k++) {
      if (map.getLayer(`fl-tail-${k}`)) map.removeLayer(`fl-tail-${k}`)
      map.removeSource(`fl-tail-${k}`)
    }
    // Remove pieces left from a longer previous list.
    for (let k = tracks.length; map.getSource(`fl-trk-${k}`); k++) {
      for (const l of ['line', 'casing']) if (map.getLayer(`fl-trk-${k}-${l}`)) map.removeLayer(`fl-trk-${k}-${l}`)
      map.removeSource(`fl-trk-${k}`)
    }
    // Selection and manoeuvre layers sit above the tracks.
    if (!map.getSource('fl-sel')) {
      map.addSource('fl-sel', { type: 'geojson', data: empty })
      map.addLayer({ id: 'fl-sel-casing', type: 'line', source: 'fl-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': colors.surface, 'line-width': 8 } })
      map.addLayer({ id: 'fl-sel-line', type: 'line', source: 'fl-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: paint({ 'line-color': ['get', 'c'], 'line-width': 4.5 }) })
    }
    if (!map.getSource('fl-stop')) {
      map.addSource('fl-stop', { type: 'geojson', data: empty })
      // Hollow ring: a stop, as opposed to the filled manoeuvre dots.
      map.addLayer({
        id: 'fl-stop',
        type: 'circle',
        source: 'fl-stop',
        paint: { 'circle-radius': 5, 'circle-color': colors.surface, 'circle-stroke-color': colors.critical, 'circle-stroke-width': 2.5 },
      })
    } else {
      map.setPaintProperty('fl-stop', 'circle-color', colors.surface)
      map.setPaintProperty('fl-stop', 'circle-stroke-color', colors.critical)
    }
    if (!map.getSource('fl-mnv')) {
      map.addSource('fl-mnv', { type: 'geojson', data: empty })
      map.addLayer({
        id: 'fl-mnv',
        type: 'circle',
        source: 'fl-mnv',
        paint: paint({
          'circle-radius': ['case', ['==', ['get', 'sel'], 1], 8, 6],
          'circle-color': ['get', 'c'],
          'circle-stroke-color': colors.surface,
          'circle-stroke-width': 2,
        }),
      })
    } else map.setPaintProperty('fl-mnv', 'circle-stroke-color', colors.surface)
    map.setPaintProperty('fl-sel-casing', 'line-color', colors.surface)
  }, [styleGen, tracks, colors, domain, multi])

  // How visible the whole tracks are: dimmed around a selected range; with several riders, faint
  // (or hidden, in trail mode) while the replay runs so the moving trails stand out.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady.current) return
    const op = range ? 0.35 : !multi ? 1 : replaying ? (trail === 'tail' ? 0 : 0.28) : trail === 'tail' ? 0.3 : 0.85
    tracks.forEach((_, k) => {
      if (map.getLayer(`fl-trk-${k}-line`)) map.setPaintProperty(`fl-trk-${k}-line`, 'line-opacity', op)
      if (map.getLayer(`fl-trk-${k}-casing`)) map.setPaintProperty(`fl-trk-${k}-casing`, 'line-opacity', op * 0.6)
    })
  }, [styleGen, tracks, range, multi, replaying, trail])

  // Highlighted range: brighter copy on top, the rest dimmed.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady.current || !map.getSource('fl-sel')) return
    const feats: Feature[] = []
    tracks.forEach((t) => {
      if (range) {
        const off = t.offset ?? 0
        const i0 = indexAtTime(t.track.t, range[0] - off)
        const i1 = indexAtTime(t.track.t, range[1] - off)
        if (i1 > i0) {
          for (const f of lineFeatures(t.track, t.foil, i0, i1, domain, !t.color).features) {
            f.properties = { ...f.properties, c: t.color ?? null }
            feats.push(f)
          }
        }
      }
    })
    ;(map.getSource('fl-sel') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats })
    const solid = tracks[0]?.color
    map.setPaintProperty('fl-sel-line', 'line-color', solid ? (['coalesce', ['get', 'c'], solid] as never) : speedColor(colors, domain))
  }, [styleGen, tracks, range, colors, domain])

  // Manoeuvre markers (single-session view): status colour plus a ring.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady.current || !map.getSource('fl-mnv')) return
    const t = tracks[0]?.track
    const feats: Feature[] =
      t && maneuvers
        ? maneuvers.map((m, k) => ({
            type: 'Feature',
            properties: { k, c: m.foiled ? colors.good : colors.critical, sel: k === selectedManeuver ? 1 : 0 },
            geometry: { type: 'Point', coordinates: [t.lon[m.at], t.lat[m.at]] },
          }))
        : []
    ;(map.getSource('fl-mnv') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats })
  }, [styleGen, tracks, maneuvers, selectedManeuver, colors])

  // New colours or tracks: rebuild the cursor markers with the new colours.
  useEffect(() => {
    for (const m of cursorMarkers.current) m?.marker.remove()
    cursorMarkers.current = []
  }, [colors, tracks])

  // Stops outside manoeuvres.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady.current || !map.getSource('fl-stop')) return
    const t = tracks[0]?.track
    const feats: Feature[] =
      t && stops ? stops.map((i) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [t.lon[i], t.lat[i]] } })) : []
    ;(map.getSource('fl-stop') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats })
  }, [styleGen, tracks, stops])

  // Replay / hover position: a board per rider, turned to its course, and (several riders) the
  // trail it leaves, fading out after tailSeconds.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    tracks.forEach((t, k) => {
      const color = t.color ?? colors.ink
      const off = t.offset ?? 0
      const pos = cursor != null ? positionAt(t.track, cursor - off) : null
      let boat = cursorMarkers.current[k]
      const tail = styleReady.current ? (map.getSource(`fl-tail-${k}`) as GeoJSONSource | undefined) : undefined
      if (!pos) {
        boat?.marker.remove()
        cursorMarkers.current[k] = null
        tail?.setData(empty)
        return
      }
      if (!boat) {
        const { el, hull, pill } = boatEl(color, multi ? t.label : undefined, colors)
        boat = { marker: new Marker({ element: el, anchor: 'center' }).setLngLat(pos).addTo(map), hull, pill, left: false }
        cursorMarkers.current[k] = boat
      } else boat.marker.setLngLat(pos)
      const i = indexAtTime(t.track.t, cursor! - off)
      // Standing still the GPS course is noise: the board keeps its last heading.
      const crs = t.track.crs[i]
      if (t.track.spd[i] > 1 && Number.isFinite(crs)) boat.hull.style.transform = `rotate(${Math.round(crs)}deg)`
      if (multi && tail) {
        const i0 = indexAtTime(t.track.t, cursor! - off - tailMs)
        const coords: [number, number][] = []
        for (let j = i0 + 1; j <= i; j++) coords.push([t.track.lon[j], t.track.lat[j]])
        coords.push(pos)
        tail.setData(coords.length >= 2 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : empty)
      }
    })
    for (let k = tracks.length; k < cursorMarkers.current.length; k++) cursorMarkers.current[k]?.marker.remove()
    cursorMarkers.current.length = tracks.length
    if (multi) placeLabels(map, cursorMarkers.current)
  }, [cursor, tracks, colors, styleGen, multi, tailMs])

  // Labelled pin (top speed).
  useEffect(() => {
    const map = mapRef.current
    pinMarker.current?.remove()
    pinMarker.current = null
    const t = tracks[0]?.track
    if (!map || !pin || !t) return
    const el = document.createElement('div')
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;'
    const pill = document.createElement('div')
    pill.textContent = pin.text
    pill.style.cssText = `font:600 12px system-ui,-apple-system,sans-serif;color:${colors.ink};background:${colors.surface};border:1px solid ${colors.border};border-radius:8px;padding:2px 7px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.2);`
    const stem = document.createElement('div')
    stem.style.cssText = `width:2px;height:10px;background:${colors.ink};`
    const dot = document.createElement('div')
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${colors.ink};box-shadow:0 0 0 2px ${colors.surface};`
    el.append(pill, stem, dot)
    pinMarker.current = new Marker({ element: el, anchor: 'bottom', offset: [0, 4] }).setLngLat([t.lon[pin.i], t.lat[pin.i]]).addTo(map)
  }, [pin, tracks, colors, styleGen])

  return (
    <div className={`relative overflow-hidden ${className ?? ''}`}>
      {/* MapLibre's stylesheet sets position:relative on this node (and wins over Tailwind's layered
          utilities), so it is sized with height/width rather than absolute insets. */}
      <div ref={box} className="h-full w-full" />
      {(windDir != null || legend || props.overlay) && (
        <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3.75rem)] flex-col items-start gap-1.5">
          {windDir != null && (
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface/90 px-2 py-1.5 backdrop-blur">
              <svg width="30" height="30" viewBox="-15 -15 30 30" aria-hidden="true">
                <circle r="14" fill="none" stroke="var(--axis)" />
                <g transform={`rotate(${windDir})`}>
                  <path d="M0 -13 L0 7" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
                  <path d="M-4.5 3 L0 9 L4.5 3" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </g>
              </svg>
              <div className="text-xs leading-tight">
                <p className="text-ink-2">Vento da</p>
                <p className="font-semibold">
                  {compass(windDir)} {Math.round(windDir)}°
                </p>
              </div>
            </div>
          )}
          {legend && (
            <div className="rounded-xl border border-line bg-surface/90 px-2.5 py-1.5 text-xs backdrop-blur">
              <p className="mb-1 text-ink-2">Velocità ({legend.unit})</p>
              <div className="h-1.5 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${colors.speed.join(',')})` }} />
              <div className="mt-0.5 flex justify-between tabular text-ink-2">
                <span>{legend.min}</span>
                <span>{legend.max}</span>
              </div>
            </div>
          )}
          {props.overlay}
        </div>
      )}
    </div>
  )
}

export const MapView = memo(MapViewImpl)

/** Whole tracks (faint while replaying) or only the trail each rider leaves behind. */
export function TrailToggle({ value, onChange }: { value: Settings['trailMode']; onChange: (v: Settings['trailMode']) => void }) {
  return (
    <Segmented
      label="Tracce sulla mappa"
      value={value}
      onChange={onChange}
      options={[
        { value: 'full', label: 'Traccia intera' },
        { value: 'tail', label: 'Solo scia' },
      ]}
    />
  )
}
