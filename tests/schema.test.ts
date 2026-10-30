import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// Runs supabase/schema.sql on an in-memory Postgres with the few Supabase pieces it relies on
// (auth.users, auth.uid(), the storage schema and the API roles), then checks who can see what.

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  create function storage.filename(name text) returns text language sql immutable as $$
    select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
  $$;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const schema = readFileSync(join(import.meta.dirname, '..', 'supabase', 'schema.sql'), 'utf8')

let db: PGlite

/** Runs `fn` as a signed-in user (or anonymous), with row-level security applied. */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}
const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows

const session = (id: string, user: string, visibility: 'crew' | 'private', minute: number) =>
  db.query(
    `insert into public.sessions (id, user_id, title, started_at, ended_at, visibility, summary, center_lat, center_lon)
     values ($1, $2, 'Uscita', $3, $3, $4, '{}', 45.7, 13.75)`,
    [id, user, `2026-09-07T06:${String(minute).padStart(2, '0')}:00Z`, visibility],
  )

const S_CREW = '10000000-0000-4000-8000-000000000001'
const S_PRIVATE = '10000000-0000-4000-8000-000000000002'
let code = ''

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  await db.exec(schema)
  // Running it twice must work: the file is meant to be re-run after changes.
  await db.exec(schema)
  for (const [id, name] of [
    [A, 'Zeno'],
    [B, 'Marco'],
    [C, 'Estraneo'],
  ]) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${name}@example.com`, { display_name: name }])
  }
})

describe('supabase schema', () => {
  it('creates a profile at sign-up, named from the form', async () => {
    const p = await rows(`select display_name from public.profiles where id = $1`, [B])
    expect(p[0].display_name).toBe('Marco')
  })

  it('lets a rider create a crew and a friend join it with the code', async () => {
    const crew = await as(A, () => rows(`select * from public.create_crew('Barcola')`))
    code = crew[0].invite_code as string
    expect(code).toMatch(/^[0-9A-F]{8}$/)
    expect(await as(B, () => rows(`select * from public.crews`))).toHaveLength(0)
    expect(await as(B, () => rows(`select public.crew_name_by_code($1) as n`, [code.toLowerCase()]))).toEqual([{ n: 'Barcola' }])
    await as(B, () => rows(`select * from public.join_crew($1)`, [code]))
    expect(await as(B, () => rows(`select name from public.crews`))).toEqual([{ name: 'Barcola' }])
    await expect(as(C, () => rows(`select * from public.join_crew('NOPE1234')`))).rejects.toThrow(/non valido/)
  })

  it('shows crew sessions and profiles to crewmates only, private sessions to nobody else', async () => {
    await as(A, () => session(S_CREW, A, 'crew', 0))
    await as(A, () => session(S_PRIVATE, A, 'private', 30))
    expect(await as(A, () => rows(`select id from public.sessions order by started_at`))).toHaveLength(2)
    expect(await as(B, () => rows(`select id from public.sessions`))).toEqual([{ id: S_CREW }])
    expect(await as(C, () => rows(`select id from public.sessions`))).toEqual([])
    expect(await as(B, () => rows(`select display_name from public.profiles order by display_name`))).toEqual([
      { display_name: 'Marco' },
      { display_name: 'Zeno' },
    ])
    expect(await as(C, () => rows(`select display_name from public.profiles`))).toEqual([{ display_name: 'Estraneo' }])
  })

  it('never lets anyone write in someone else’s name', async () => {
    await expect(as(B, () => session('10000000-0000-4000-8000-000000000003', A, 'crew', 45))).rejects.toThrow(/row-level security/)
    const changed = await as(B, () => db.query(`update public.sessions set title = 'hacked' where id = $1`, [S_CREW]))
    expect(changed.affectedRows).toBe(0)
    await as(B, () => db.query(`delete from public.sessions where id = $1`, [S_CREW]))
    expect(await as(A, () => rows(`select title from public.sessions where id = $1`, [S_CREW]))).toEqual([{ title: 'Uscita' }])
  })

  it('allows kudos and comments only on sessions you can see', async () => {
    await as(B, () => db.query(`insert into public.kudos (session_id) values ($1)`, [S_CREW]))
    await as(B, () => db.query(`insert into public.comments (session_id, body) values ($1, 'Che velocità!')`, [S_CREW]))
    await expect(as(B, () => db.query(`insert into public.kudos (session_id) values ($1)`, [S_PRIVATE]))).rejects.toThrow()
    await expect(as(C, () => db.query(`insert into public.kudos (session_id) values ($1)`, [S_CREW]))).rejects.toThrow()
    expect(await as(A, () => rows(`select body from public.comments`))).toEqual([{ body: 'Che velocità!' }])
    expect(await as(C, () => rows(`select * from public.comments`))).toEqual([])
  })

  it('stores tracks under your own folder, readable like the session', async () => {
    const put = (user: string, name: string) =>
      as(user, () => db.query(`insert into storage.objects (bucket_id, name) values ('tracks', $1)`, [name]))
    await put(A, `${A}/${S_CREW}.json.gz`)
    await put(A, `${A}/${S_PRIVATE}.json.gz`)
    await expect(put(B, `${A}/${S_CREW}.json.gz`)).rejects.toThrow(/row-level security/)
    const names = async (user: string) => (await as(user, () => rows(`select name from storage.objects order by name`))).map((r) => r.name)
    expect(await names(A)).toHaveLength(2)
    expect(await names(B)).toEqual([`${A}/${S_CREW}.json.gz`])
    expect(await names(C)).toEqual([])
  })

  it('keeps the gear in the profile, readable by the crew and changed only by its owner', async () => {
    const gear = [{ id: 'g1', kind: 'wing', name: 'Ala', size: '5' }]
    await as(A, () => db.query(`update public.profiles set gear = $1 where id = $2`, [JSON.stringify(gear), A]))
    expect(await as(B, () => rows(`select gear from public.profiles where id = $1`, [A]))).toEqual([{ gear }])
    const changed = await as(B, () => db.query(`update public.profiles set gear = '[]' where id = $1`, [A]))
    expect(changed.affectedRows).toBe(0)
    await expect(as(A, () => db.query(`update public.profiles set gear = '{}' where id = $1`, [A]))).rejects.toThrow(/check/)
  })

  it('stores the wind strength and the gear of a session', async () => {
    await as(A, () => db.query(`update public.sessions set wind_band = 'medium', gear = $1 where id = $2`, [JSON.stringify([{ id: 'g1' }]), S_CREW]))
    expect(await as(B, () => rows(`select wind_band, gear from public.sessions where id = $1`, [S_CREW]))).toEqual([
      { wind_band: 'medium', gear: [{ id: 'g1' }] },
    ])
    await expect(as(A, () => db.query(`update public.sessions set wind_band = 'tempesta' where id = $1`, [S_CREW]))).rejects.toThrow(/check/)
  })

  it('gives anonymous visitors nothing', async () => {
    await expect(as(null, () => rows(`select * from public.sessions`))).rejects.toThrow(/permission denied/)
    await expect(as(null, () => rows(`select public.crew_name_by_code('X')`))).rejects.toThrow(/permission denied/)
  })

  it('hides the crew again after leaving it', async () => {
    await as(B, () => db.query(`delete from public.crew_members where user_id = $1`, [B]))
    expect(await as(B, () => rows(`select id from public.sessions`))).toEqual([])
    expect(await as(B, () => rows(`select * from public.crews`))).toEqual([])
  })
})
