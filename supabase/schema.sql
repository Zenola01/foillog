-- FoilLog · database per Supabase (Fase 2: crew)
--
-- Come si usa: nel progetto Supabase apri «SQL Editor», incolla tutto questo file e premi «Run».
-- Si può rieseguire senza perdere dati.
--
-- Regole di visibilità:
--   · vedi le uscite (e i profili) di chi è in almeno una crew con te, più le tue;
--   · un'uscita «solo per me» la vedi solo tu;
--   · modifichi e cancelli solo le cose tue;
--   · in una crew si entra solo con il codice d'invito.

-- ─────────────────────────────────────────── Tabelle

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Rider' check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.crew_members (
  crew_id uuid not null references public.crews (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create table if not exists public.spots (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  lat double precision not null,
  lon double precision not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  visibility text not null default 'crew' check (visibility in ('crew', 'private')),
  spot_id uuid references public.spots (id) on delete set null,
  device text,
  format text,
  notes text not null default '',
  -- All the numbers shown in the feed (SessionSummary); the columns below repeat the ones
  -- used for sorting and leaderboards.
  summary jsonb not null,
  distance_m double precision not null default 0,
  max_2s double precision,
  max_10s double precision,
  best_500m double precision,
  foil_share double precision,
  center_lat double precision not null,
  center_lon double precision not null,
  -- Simplified track for thumbnails, [[lat, lon], ...].
  preview jsonb not null default '[]',
  -- Full track in the «tracks» storage bucket: {user_id}/{session_id}.json.gz
  track_path text,
  wind_override double precision,
  model_wind jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, started_at)
);
create index if not exists sessions_started_at_idx on public.sessions (started_at desc);
create index if not exists sessions_user_idx on public.sessions (user_id);
create index if not exists sessions_spot_idx on public.sessions (spot_id);

create table if not exists public.kudos (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists comments_session_idx on public.comments (session_id, created_at);

-- ─────────────────────────────────────────── Funzioni
-- They run as the owner (security definer) so the policies can look at crew membership
-- without recursing into their own rules. Every name is schema-qualified (search_path = '').

-- True when I share at least one crew with `other` (and for myself).
create or replace function public.shares_crew(other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select other = auth.uid() or exists (
    select 1
    from public.crew_members a
    join public.crew_members b on b.crew_id = a.crew_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function public.is_crew_member(crew uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.crew_members where crew_id = crew and user_id = auth.uid());
$$;

create or replace function public.can_see_session(sid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
    where s.id = sid
      and (s.user_id = auth.uid() or (s.visibility = 'crew' and public.shares_crew(s.user_id)))
  );
$$;

-- Storage objects are named {user_id}/{session_id}.json.gz: readable by whoever can see the session.
create or replace function public.can_see_track(object_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return public.can_see_session(split_part(storage.filename(object_name), '.', 1)::uuid);
exception when others then
  return false;
end;
$$;

create or replace function public.create_crew(crew_name text)
returns public.crews
language plpgsql security definer set search_path = ''
as $$
declare
  c public.crews;
begin
  if auth.uid() is null then
    raise exception 'Serve l''accesso';
  end if;
  insert into public.crews (name, created_by) values (trim(crew_name), auth.uid()) returning * into c;
  insert into public.crew_members (crew_id, user_id, role) values (c.id, auth.uid(), 'owner');
  return c;
end;
$$;

create or replace function public.join_crew(code text)
returns public.crews
language plpgsql security definer set search_path = ''
as $$
declare
  c public.crews;
begin
  if auth.uid() is null then
    raise exception 'Serve l''accesso';
  end if;
  select * into c from public.crews where invite_code = upper(trim(code));
  if c.id is null then
    raise exception 'Codice invito non valido';
  end if;
  insert into public.crew_members (crew_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return c;
end;
$$;

-- Crew name for an invite code, so the join page can say which crew it is.
create or replace function public.crew_name_by_code(code text)
returns text
language sql stable security definer set search_path = ''
as $$
  select name from public.crews where invite_code = upper(trim(code));
$$;

-- A profile for every new account, named from the sign-up form.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 40), ''), 'Rider'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────── Regole di accesso (RLS)

alter table public.profiles enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.spots enable row level security;
alter table public.sessions enable row level security;
alter table public.kudos enable row level security;
alter table public.comments enable row level security;

drop policy if exists "profiles: crewmates" on public.profiles;
create policy "profiles: crewmates" on public.profiles
  for select to authenticated using (public.shares_crew(id));
drop policy if exists "profiles: own" on public.profiles;
create policy "profiles: own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "crews: members" on public.crews;
create policy "crews: members" on public.crews
  for select to authenticated using (public.is_crew_member(id));
drop policy if exists "crews: owner renames" on public.crews;
create policy "crews: owner renames" on public.crews
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "members: same crew" on public.crew_members;
create policy "members: same crew" on public.crew_members
  for select to authenticated using (public.is_crew_member(crew_id));
drop policy if exists "members: leave" on public.crew_members;
create policy "members: leave" on public.crew_members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "spots: read" on public.spots;
create policy "spots: read" on public.spots
  for select to authenticated using (true);
drop policy if exists "spots: add" on public.spots;
create policy "spots: add" on public.spots
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "spots: rename own" on public.spots;
create policy "spots: rename own" on public.spots
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "sessions: read" on public.sessions;
create policy "sessions: read" on public.sessions
  for select to authenticated
  using (user_id = auth.uid() or (visibility = 'crew' and public.shares_crew(user_id)));
drop policy if exists "sessions: add own" on public.sessions;
create policy "sessions: add own" on public.sessions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "sessions: edit own" on public.sessions;
create policy "sessions: edit own" on public.sessions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "sessions: delete own" on public.sessions;
create policy "sessions: delete own" on public.sessions
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "kudos: read" on public.kudos;
create policy "kudos: read" on public.kudos
  for select to authenticated using (public.can_see_session(session_id));
drop policy if exists "kudos: give" on public.kudos;
create policy "kudos: give" on public.kudos
  for insert to authenticated with check (user_id = auth.uid() and public.can_see_session(session_id));
drop policy if exists "kudos: take back" on public.kudos;
create policy "kudos: take back" on public.kudos
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "comments: read" on public.comments;
create policy "comments: read" on public.comments
  for select to authenticated using (public.can_see_session(session_id));
drop policy if exists "comments: write" on public.comments;
create policy "comments: write" on public.comments
  for insert to authenticated with check (user_id = auth.uid() and public.can_see_session(session_id));
drop policy if exists "comments: delete own" on public.comments;
create policy "comments: delete own" on public.comments
  for delete to authenticated using (user_id = auth.uid());

-- ─────────────────────────────────────────── Permessi espliciti
-- Since 2026 Supabase no longer exposes new tables to its API automatically: grant exactly what
-- the app needs, to signed-in users only. Nothing is granted to anonymous visitors.

grant usage on schema public to authenticated;
revoke all on public.profiles, public.crews, public.crew_members, public.spots, public.sessions, public.kudos,
  public.comments from anon;
grant select, update on public.profiles to authenticated;
grant select, update on public.crews to authenticated;
grant select, delete on public.crew_members to authenticated;
grant select, insert, update on public.spots to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, delete on public.kudos to authenticated;
grant select, insert, delete on public.comments to authenticated;

revoke execute on function public.shares_crew(uuid), public.is_crew_member(uuid), public.can_see_session(uuid),
  public.can_see_track(text), public.create_crew(text), public.join_crew(text), public.crew_name_by_code(text),
  public.handle_new_user() from public, anon;
revoke execute on function public.handle_new_user() from authenticated;
grant execute on function public.shares_crew(uuid), public.is_crew_member(uuid), public.can_see_session(uuid),
  public.can_see_track(text), public.create_crew(text), public.join_crew(text), public.crew_name_by_code(text)
  to authenticated;

-- ─────────────────────────────────────────── Archivio delle tracce

insert into storage.buckets (id, name, public, file_size_limit)
values ('tracks', 'tracks', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "tracks: read" on storage.objects;
create policy "tracks: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'tracks' and ((storage.foldername(name))[1] = auth.uid()::text or public.can_see_track(name)));
drop policy if exists "tracks: upload own" on storage.objects;
create policy "tracks: upload own" on storage.objects
  for insert to authenticated with check (bucket_id = 'tracks' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "tracks: replace own" on storage.objects;
create policy "tracks: replace own" on storage.objects
  for update to authenticated using (bucket_id = 'tracks' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "tracks: delete own" on storage.objects;
create policy "tracks: delete own" on storage.objects
  for delete to authenticated using (bucket_id = 'tracks' and (storage.foldername(name))[1] = auth.uid()::text);
