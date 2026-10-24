-- Nearby discovery stores short-lived device coordinates outside the public
-- profile table. Coordinates are only reachable through authenticated RPCs.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

alter table public.users
  add column if not exists nearby_enabled boolean not null default false;

create table if not exists private.nearby_presence (
  user_id uuid primary key references public.users(id) on delete cascade,
  location extensions.geography(point, 4326) not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table private.nearby_presence enable row level security;
revoke all on private.nearby_presence from public, anon, authenticated;

create index if not exists nearby_presence_location_gist_idx
  on private.nearby_presence using gist (location);
create index if not exists nearby_presence_expiry_idx
  on private.nearby_presence (expires_at);

create or replace function private.set_nearby_presence(
  p_latitude double precision,
  p_longitude double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid location';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = v_user_id
      and u.nearby_enabled is true
      and u.discoverable is true
      and coalesce(u.is_banned, false) is false
      and coalesce(u.is_suspended, false) is false
      and coalesce(u.status, 'active') = 'active'
  ) then
    raise exception 'Enable Nearby in privacy settings first';
  end if;

  insert into private.nearby_presence (user_id, location, updated_at, expires_at)
  values (
    v_user_id,
    extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography,
    now(),
    now() + interval '30 minutes'
  )
  on conflict (user_id) do update
    set location = excluded.location,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at;
end;
$$;

create or replace function private.clear_nearby_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  delete from private.nearby_presence where user_id = v_user_id;
end;
$$;

create or replace function private.query_nearby_people(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters integer default 10000,
  p_filter text default 'all',
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  avatar_url text,
  username text,
  phone_verified boolean,
  distance_band text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_origin extensions.geography(point, 4326);
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid location';
  end if;
  if p_radius_meters is null or p_radius_meters < 1000 or p_radius_meters > 25000 then
    raise exception 'Radius must be between 1000 and 25000 meters';
  end if;
  if p_filter not in ('all', 'neighbors', 'mutuals', 'sellers') then
    raise exception 'Invalid Nearby filter';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = v_user_id
      and u.nearby_enabled is true
      and u.discoverable is true
      and coalesce(u.is_banned, false) is false
      and coalesce(u.is_suspended, false) is false
      and coalesce(u.status, 'active') = 'active'
  ) then
    return;
  end if;

  v_origin := extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude), 4326
  )::extensions.geography;

  return query
  select
    u.id,
    u.name,
    u.avatar_url,
    u.username,
    coalesce(u.phone_verified, false),
    case
      when extensions.st_distance(np.location, v_origin) <= 1000 then 'Within 1 km'
      when extensions.st_distance(np.location, v_origin) <= 5000 then 'Within 5 km'
      when extensions.st_distance(np.location, v_origin) <= 10000 then 'Within 10 km'
      else 'Within 25 km'
    end
  from private.nearby_presence np
  join public.users u on u.id = np.user_id
  where np.user_id <> v_user_id
    and np.expires_at > now()
    and u.nearby_enabled is true
    and u.discoverable is true
    and coalesce(u.is_banned, false) is false
    and coalesce(u.is_suspended, false) is false
    and coalesce(u.status, 'active') = 'active'
    and not (v_user_id = any(coalesce(u.blocked_users, '{}'::uuid[])))
    and not exists (
      select 1 from public.users viewer
      where viewer.id = v_user_id
        and u.id = any(coalesce(viewer.blocked_users, '{}'::uuid[]))
    )
    and extensions.st_dwithin(np.location, v_origin, p_radius_meters)
    and (p_search is null or btrim(p_search) = '' or u.name ilike '%' || btrim(p_search) || '%')
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = v_user_id and b.blocked_id = u.id)
         or (b.blocker_id = u.id and b.blocked_id = v_user_id)
    )
    and (
      p_filter not in ('mutuals', 'sellers')
      or (p_filter = 'mutuals' and exists (
        select 1
        from public.followers f1
        join public.followers f2
          on f2.follower_id = u.id and f2.following_id = v_user_id
        where f1.follower_id = v_user_id and f1.following_id = u.id
      ))
      or (p_filter = 'sellers' and exists (
        select 1 from public.posts p
        where p.user_id = u.id and p.category = 'For Sale' and p.is_sold is false
      ))
    )
  order by extensions.st_distance(np.location, v_origin), u.id
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- PostgREST only exposes public RPC wrappers. The privileged implementations
-- stay in the unexposed private schema and validate auth.uid() themselves.
create or replace function public.upsert_nearby_presence(
  p_latitude double precision,
  p_longitude double precision
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_nearby_presence(p_latitude, p_longitude);
$$;

create or replace function public.clear_nearby_presence()
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.clear_nearby_presence();
$$;

create or replace function public.nearby_people(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters integer default 10000,
  p_filter text default 'all',
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  avatar_url text,
  username text,
  phone_verified boolean,
  distance_band text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.query_nearby_people(
    p_latitude, p_longitude, p_radius_meters, p_filter, p_search, p_limit, p_offset
  );
$$;

revoke all on function private.set_nearby_presence(double precision, double precision) from public, anon;
revoke all on function private.clear_nearby_presence() from public, anon;
revoke all on function private.query_nearby_people(double precision, double precision, integer, text, text, integer, integer) from public, anon;
grant execute on function private.set_nearby_presence(double precision, double precision) to authenticated;
grant execute on function private.clear_nearby_presence() to authenticated;
grant execute on function private.query_nearby_people(double precision, double precision, integer, text, text, integer, integer) to authenticated;

revoke all on function public.upsert_nearby_presence(double precision, double precision) from public, anon;
revoke all on function public.clear_nearby_presence() from public, anon;
revoke all on function public.nearby_people(double precision, double precision, integer, text, text, integer, integer) from public, anon;
grant execute on function public.upsert_nearby_presence(double precision, double precision) to authenticated;
grant execute on function public.clear_nearby_presence() to authenticated;
grant execute on function public.nearby_people(double precision, double precision, integer, text, text, integer, integer) to authenticated;

select cron.schedule(
  'cleanup-expired-nearby-presence',
  '*/15 * * * *',
  'delete from private.nearby_presence where expires_at <= now()'
);
