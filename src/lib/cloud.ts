import { createStore, del, get, set, type UseStore } from 'idb-keyval'
import { friendlyError } from './auth'
import { haversine } from './geo'
import type { SessionData, SessionRecord } from './store'
import { supabase } from './supabase'
import { decodeTrackFile, encodeTrackFile } from './trackCodec'
import type { ModelWind, SessionSummary } from './types'

// Everything that talks to the crew's Supabase project. Row-level security decides what each
// query returns, so these functions simply ask for "everything" and get what the rider may see.

export interface Crew {
  id: string
  name: string
  invite_code: string
  created_by: string
  members: { user_id: string; role: string; profile: { display_name: string } | null }[]
}

export interface Spot {
  id: string
  name: string
  lat: number
  lon: number
}

export interface CloudSession {
  id: string
  user_id: string
  title: string
  started_at: string
  ended_at: string
  visibility: 'crew' | 'private'
  spot_id: string | null
  device: string | null
  format: string | null
  notes: string
  summary: SessionSummary
  center_lat: number
  center_lon: number
  preview: [number, number][]
  track_path: string | null
  wind_override: number | null
  model_wind: ModelWind | null
  created_at: string
  profile: { display_name: string } | null
  spot: { id: string; name: string } | null
  kudos: { user_id: string }[]
  comments: { count: number }[]
}

export interface Comment {
  id: string
  user_id: string
  body: string
  created_at: string
  profile: { display_name: string } | null
}

// Profiles are embedded through user_id explicitly: kudos and comments also link sessions and
// profiles (many-to-many), and an unqualified embed is rejected as ambiguous.
const SESSION_FIELDS =
  'id, user_id, title, started_at, ended_at, visibility, spot_id, device, format, notes, summary, center_lat, center_lon, preview, track_path, wind_override, model_wind, created_at, profile:profiles!user_id(display_name), spot:spots(id, name), kudos(user_id), comments(count)'

/** Spots closer than this to a session's centre are taken as its spot. */
const SPOT_RADIUS_M = 3000

function check<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw new Error(friendlyError(r.error))
  return r.data as T
}

export const inviteLink = (code: string) => `${location.origin}${location.pathname}#/entra/${code}`

// ─── Crews

export async function myCrews(): Promise<Crew[]> {
  return check(
    await supabase
      .from('crews')
      .select('id, name, invite_code, created_by, members:crew_members(user_id, role, profile:profiles!user_id(display_name))')
      .order('created_at'),
  ) as unknown as Crew[]
}

export async function createCrew(name: string): Promise<void> {
  check(await supabase.rpc('create_crew', { crew_name: name }))
}

export async function joinCrew(code: string): Promise<{ id: string; name: string }> {
  return check(await supabase.rpc('join_crew', { code })) as { id: string; name: string }
}

export async function crewNameByCode(code: string): Promise<string | null> {
  return check(await supabase.rpc('crew_name_by_code', { code })) as string | null
}

export async function leaveCrew(crewId: string, userId: string): Promise<void> {
  check(await supabase.from('crew_members').delete().eq('crew_id', crewId).eq('user_id', userId))
}

// ─── Spots

export async function listSpots(): Promise<Spot[]> {
  return check(await supabase.from('spots').select('id, name, lat, lon').order('name')) as Spot[]
}

export function nearestSpot(spots: Spot[], lat: number, lon: number, radius = SPOT_RADIUS_M): Spot | null {
  let best: Spot | null = null
  let bestD = radius
  for (const s of spots) {
    const d = haversine(lat, lon, s.lat, s.lon)
    if (d <= bestD) {
      best = s
      bestD = d
    }
  }
  return best
}

export async function createSpot(name: string, lat: number, lon: number): Promise<Spot> {
  return check(await supabase.from('spots').insert({ name: name.trim(), lat, lon }).select('id, name, lat, lon').single()) as Spot
}

// ─── Sessions

/** Uploads a session (row + compressed track). Re-sharing the same session updates it. */
export async function shareSession(rec: SessionRecord, data: SessionData, userId: string): Promise<string> {
  const s = rec.summary
  const spot = nearestSpot(await listSpots(), s.center[0], s.center[1])
  const row = {
    user_id: userId,
    title: rec.title.slice(0, 120),
    started_at: new Date(s.start).toISOString(),
    ended_at: new Date(s.end).toISOString(),
    visibility: 'crew',
    spot_id: spot?.id ?? null,
    device: rec.device ?? null,
    format: rec.format,
    notes: rec.notes,
    summary: s,
    distance_m: s.distance,
    max_2s: s.records.s2,
    max_10s: s.records.s10,
    best_500m: s.records.m500,
    foil_share: s.foilShare,
    center_lat: s.center[0],
    center_lon: s.center[1],
    preview: rec.preview,
    wind_override: rec.windOverride,
    model_wind: rec.modelWind,
  }
  const saved = check(await supabase.from('sessions').upsert(row, { onConflict: 'user_id,started_at' }).select('id').single()) as { id: string }
  const path = `${userId}/${saved.id}.json.gz`
  const blob = await encodeTrackFile(data.track, data.wind)
  const up = await supabase.storage.from('tracks').upload(path, blob, { upsert: true, contentType: 'application/gzip' })
  if (up.error) throw new Error(friendlyError(up.error))
  check(await supabase.from('sessions').update({ track_path: path }).eq('id', saved.id))
  await set(saved.id, data, trackCache())
  return saved.id
}

export async function feed(limit = 40, before?: string): Promise<CloudSession[]> {
  let q = supabase.from('sessions').select(SESSION_FIELDS).order('started_at', { ascending: false }).limit(limit)
  if (before) q = q.lt('started_at', before)
  return check(await q) as unknown as CloudSession[]
}

export async function sessionsBetween(from: Date, to: Date): Promise<CloudSession[]> {
  return check(
    await supabase
      .from('sessions')
      .select(SESSION_FIELDS)
      .gte('started_at', from.toISOString())
      .lt('started_at', to.toISOString())
      .order('started_at'),
  ) as unknown as CloudSession[]
}

export async function sessionsOf(userId: string): Promise<CloudSession[]> {
  return check(await supabase.from('sessions').select(SESSION_FIELDS).eq('user_id', userId).order('started_at', { ascending: false })) as unknown as CloudSession[]
}

export async function sessionsAtSpot(spotId: string): Promise<CloudSession[]> {
  return check(await supabase.from('sessions').select(SESSION_FIELDS).eq('spot_id', spotId).order('started_at', { ascending: false })) as unknown as CloudSession[]
}

export async function getSession(id: string): Promise<CloudSession | null> {
  return check(await supabase.from('sessions').select(SESSION_FIELDS).eq('id', id).maybeSingle()) as unknown as CloudSession | null
}

export type SessionPatch = Partial<Pick<CloudSession, 'title' | 'notes' | 'visibility' | 'spot_id' | 'wind_override'>> & {
  summary?: SessionSummary
}

export async function updateSession(id: string, patch: SessionPatch): Promise<void> {
  const extra = patch.summary
    ? {
        distance_m: patch.summary.distance,
        max_2s: patch.summary.records.s2,
        max_10s: patch.summary.records.s10,
        best_500m: patch.summary.records.m500,
        foil_share: patch.summary.foilShare,
      }
    : {}
  check(await supabase.from('sessions').update({ ...patch, ...extra }).eq('id', id))
}

export async function deleteSession(s: CloudSession): Promise<void> {
  if (s.track_path) await supabase.storage.from('tracks').remove([s.track_path])
  check(await supabase.from('sessions').delete().eq('id', s.id))
  await del(s.id, trackCache())
}

// Tracks are cached on the device after the first download, so a session opens offline.
let cacheDb: UseStore | null = null
const trackCache = () => (cacheDb ??= createStore('foillog-cloud-tracks', 'tracks'))

export async function loadTrack(s: Pick<CloudSession, 'id' | 'track_path'>): Promise<SessionData> {
  try {
    const cached = await get<SessionData>(s.id, trackCache())
    if (cached) return cached
  } catch {
    // No IndexedDB here: download every time.
  }
  if (!s.track_path) throw new Error('La traccia di questa uscita non è ancora stata caricata.')
  const r = await supabase.storage.from('tracks').download(s.track_path)
  if (r.error || !r.data) throw new Error(friendlyError(r.error ?? 'Download non riuscito'))
  const data = await decodeTrackFile(r.data)
  try {
    await set(s.id, data, trackCache())
  } catch {
    // Not cached; fine.
  }
  return data
}

// ─── Kudos and comments

export async function setKudos(sessionId: string, userId: string, on: boolean): Promise<void> {
  if (on) check(await supabase.from('kudos').insert({ session_id: sessionId }))
  else check(await supabase.from('kudos').delete().eq('session_id', sessionId).eq('user_id', userId))
}

export async function listComments(sessionId: string): Promise<Comment[]> {
  return check(
    await supabase.from('comments').select('id, user_id, body, created_at, profile:profiles!user_id(display_name)').eq('session_id', sessionId).order('created_at'),
  ) as unknown as Comment[]
}

export async function addComment(sessionId: string, body: string): Promise<void> {
  check(await supabase.from('comments').insert({ session_id: sessionId, body: body.trim().slice(0, 1000) }))
}

export async function deleteComment(id: string): Promise<void> {
  check(await supabase.from('comments').delete().eq('id', id))
}

/** A cloud row in the shape the session views already use. */
export function asRecord(s: CloudSession): SessionRecord {
  return {
    id: s.id,
    createdAt: Date.parse(s.created_at),
    fileName: '',
    format: (s.format as SessionRecord['format']) ?? 'gpx',
    device: s.device ?? undefined,
    title: s.title,
    rider: s.profile?.display_name ?? 'Rider',
    notes: s.notes,
    foilOnKn: 0,
    windOverride: s.wind_override,
    modelWind: s.model_wind,
    summary: s.summary,
    preview: s.preview,
    warnings: [],
  }
}
