-- =============================================================
-- Migration 019: Server-side Trip Code Generator
-- GrainShield AI — Phase 2: Automatic Trip Generation
-- Idempotent: safe to run multiple times.
-- =============================================================
-- DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT AUTHORIZATION.
-- Apply via: Supabase Dashboard > SQL Editor, or supabase db push
-- =============================================================

-- -----------------------------------------------
-- 1. Trip code sequence (global, monotonically increasing)
-- -----------------------------------------------
create sequence if not exists public.trip_code_seq start 100001 increment 1;

-- -----------------------------------------------
-- 2. generate_trip_code() — returns GS-YYYY-NNNNNN
-- -----------------------------------------------
create or replace function public.generate_trip_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year  text;
  v_seq   text;
begin
  v_year := to_char(now(), 'YYYY');
  v_seq  := lpad(nextval('public.trip_code_seq')::text, 6, '0');
  return 'GS-' || v_year || '-' || v_seq;
end;
$$;

comment on function public.generate_trip_code() is
  'Generates a unique, monotonically increasing trip code in the format GS-YYYY-NNNNNN.';

-- -----------------------------------------------
-- 3. Add driver_id column (nullable, FK to profiles)
--    Null = unassigned / legacy trip; non-null = admin-dispatched.
-- -----------------------------------------------
alter table public.trips
  add column if not exists driver_id uuid references public.profiles(id) on delete set null;

create index if not exists trips_driver_id_idx on public.trips(driver_id);

comment on column public.trips.driver_id is
  'UUID of the assigned driver profile. NULL for legacy trips or unassigned dispatches.';

-- -----------------------------------------------
-- 4. Drop the per-admin uniqueness constraint and
--    replace it with a true global uniqueness constraint.
--
--    SAFE: existing data is preserved. Only the uniqueness
--    scope changes from (trip_code, created_by) to (trip_code).
--    If existing data has duplicate trip_codes across different
--    created_by values, this migration will fail — the diagnostic
--    query below detects this case.
-- -----------------------------------------------

-- Diagnostic: check for conflicting trip codes before constraint change.
-- If this returns rows, do NOT apply the constraint change without resolving them first.
do $$
declare
  conflict_count integer;
begin
  select count(*)
    into conflict_count
    from (
      select trip_code, count(distinct created_by) as creator_count
        from public.trips
       group by trip_code
      having count(distinct created_by) > 1
    ) sub;

  if conflict_count > 0 then
    raise notice
      '[migration-019] WARNING: % trip_code(s) exist across multiple created_by values. '
      'The global unique constraint on trip_code has NOT been applied. '
      'Resolve duplicate codes before re-running this migration step.',
      conflict_count;
  else
    -- Safe to proceed: no cross-creator duplicates exist
    -- Drop the per-admin constraint only if it exists
    if exists (
      select 1
        from pg_constraint
       where conname = 'trips_trip_code_created_by_key'
         and conrelid = 'public.trips'::regclass
    ) then
      alter table public.trips drop constraint trips_trip_code_created_by_key;
      raise notice '[migration-019] Dropped trips_trip_code_created_by_key constraint.';
    end if;

    -- Add global trip_code uniqueness if not already present
    if not exists (
      select 1
        from pg_constraint
       where conname = 'trips_trip_code_unique'
         and conrelid = 'public.trips'::regclass
    ) then
      alter table public.trips add constraint trips_trip_code_unique unique (trip_code);
      raise notice '[migration-019] Added global trips_trip_code_unique constraint.';
    else
      raise notice '[migration-019] trips_trip_code_unique already exists — skipped.';
    end if;
  end if;
end $$;

-- -----------------------------------------------
-- 5. admin_dispatch_trip() RPC — creates a trip with an auto-generated code.
--    Called by admin panel; enforces super_admin / admin role.
-- -----------------------------------------------
create or replace function public.admin_dispatch_trip(
  p_vehicle_number  text,
  p_driver_id       uuid     default null,
  p_driver_name     text     default null,
  p_driver_phone    text     default null,
  p_stage           text     default 'first_mile',
  p_origin          text     default null,
  p_destination     text     default null,
  p_trip_code       text     default null   -- optional override; auto-generated when null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id    uuid;
  v_actor_role  user_role;
  v_trip_code   text;
  v_trip_id     uuid;
  v_clean_plate text;
begin
  -- Identity and authorization
  v_actor_id := auth.uid();
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select role into v_actor_role
    from public.profiles
   where id = v_actor_id;

  if v_actor_role not in ('admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'Only administrators can dispatch trips');
  end if;

  -- Validate vehicle number
  v_clean_plate := upper(regexp_replace(p_vehicle_number, '[^A-Z0-9]', '', 'g'));
  if length(v_clean_plate) < 5 then
    return jsonb_build_object('success', false, 'error', 'Invalid vehicle registration number');
  end if;

  -- Determine trip code
  if p_trip_code is not null and length(trim(p_trip_code)) > 0 then
    v_trip_code := trim(p_trip_code);
    -- Reject if manual code clashes with existing
    if exists (select 1 from public.trips where trip_code = v_trip_code) then
      return jsonb_build_object(
        'success', false,
        'error', format('Trip code %s already exists. Leave blank for auto-generation.', v_trip_code)
      );
    end if;
  else
    v_trip_code := public.generate_trip_code();
  end if;

  -- Validate stage
  if p_stage not in ('first_mile', 'mid_mile', 'last_mile') then
    return jsonb_build_object('success', false, 'error', 'Invalid stage value');
  end if;

  -- Insert trip
  insert into public.trips (
    trip_code, vehicle_number, driver_id,
    driver_name, driver_phone,
    stage, origin, destination,
    created_by, assigned_to, status
  )
  values (
    v_trip_code, v_clean_plate, p_driver_id,
    nullif(trim(coalesce(p_driver_name, '')), ''),
    nullif(trim(coalesce(p_driver_phone, '')), ''),
    p_stage::trip_stage,
    nullif(trim(coalesce(p_origin, '')), ''),
    nullif(trim(coalesce(p_destination, '')), ''),
    v_actor_id, p_driver_id, 'submitted'
  )
  returning id into v_trip_id;

  -- Audit
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, trip_id, metadata
  ) values (
    v_actor_id, 'trip_dispatched', 'trips', v_trip_id, v_trip_id,
    jsonb_build_object(
      'trip_code',       v_trip_code,
      'vehicle_number',  v_clean_plate,
      'stage',           p_stage,
      'driver_id',       p_driver_id,
      'origin',          p_origin,
      'destination',     p_destination,
      'auto_generated',  (p_trip_code is null or length(trim(coalesce(p_trip_code,''))) = 0)
    )
  );

  return jsonb_build_object(
    'success',    true,
    'trip_id',    v_trip_id,
    'trip_code',  v_trip_code,
    'vehicle',    v_clean_plate,
    'stage',      p_stage
  );
end;
$$;

comment on function public.admin_dispatch_trip is
  'Dispatches a new trip with an auto-generated unique trip code. '
  'Only admin and super_admin roles may call this function. '
  'If p_trip_code is null or empty, a GS-YYYY-NNNNNN code is auto-generated.';

-- Grant execute to authenticated users (RLS inside function enforces role check)
grant execute on function public.admin_dispatch_trip to authenticated;

-- -----------------------------------------------
-- 6. get_driver_profiles() — for admin trip-creation dropdown
-- -----------------------------------------------
create or replace function public.get_driver_profiles(p_search text default '')
returns table (
  id          uuid,
  full_name   text,
  email       text,
  phone       text,
  district    text
)
language sql
security definer
set search_path = public
stable
as $$
  select id, full_name, email, phone, district
    from public.profiles
   where role = 'user'
     and (
       p_search = ''
       or full_name ilike '%' || p_search || '%'
       or email     ilike '%' || p_search || '%'
       or phone     ilike '%' || p_search || '%'
     )
   order by full_name asc nulls last
   limit 50;
$$;

grant execute on function public.get_driver_profiles to authenticated;

comment on function public.get_driver_profiles is
  'Returns up to 50 user-role profiles for the admin trip-creation driver dropdown.';
