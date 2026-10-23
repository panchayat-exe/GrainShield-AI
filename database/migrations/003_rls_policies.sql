-- =============================================================
-- Migration 003: Row Level Security Policies
-- Fully Idempotent: safe to run multiple times.
-- =============================================================

-- -----------------------------------------------
-- Enable RLS on all tables
-- -----------------------------------------------
alter table if exists public.profiles                enable row level security;
alter table if exists public.trips                   enable row level security;
alter table if exists public.trip_evidence           enable row level security;
alter table if exists public.verification_results    enable row level security;
alter table if exists public.trip_locations          enable row level security;
alter table if exists public.manual_review_requests  enable row level security;
alter table if exists public.audit_logs              enable row level security;

-- ============================================================
-- PROFILES policies
-- ============================================================

drop policy if exists "profiles: own read" on public.profiles;
create policy "profiles: own read"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles: admin read all" on public.profiles;
create policy "profiles: admin read all"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

drop policy if exists "profiles: own update safe fields" on public.profiles;
create policy "profiles: own update safe fields"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
  );

-- ============================================================
-- TRIPS policies
-- ============================================================

drop policy if exists "trips: own read" on public.trips;
create policy "trips: own read"
  on public.trips for select
  to authenticated
  using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or public.is_admin()
  );

drop policy if exists "trips: create own" on public.trips;
create policy "trips: create own"
  on public.trips for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "trips: update own" on public.trips;
create policy "trips: update own"
  on public.trips for update
  to authenticated
  using (created_by = auth.uid() or assigned_to = auth.uid())
  with check (
    created_by = (select created_by from public.trips where id = trips.id)
  );

drop policy if exists "trips: admin update" on public.trips;
create policy "trips: admin update"
  on public.trips for update
  to authenticated
  using (public.is_admin());

drop policy if exists "trips: admin delete" on public.trips;
create policy "trips: admin delete"
  on public.trips for delete
  to authenticated
  using (public.is_admin());

-- ============================================================
-- TRIP_EVIDENCE policies
-- ============================================================

drop policy if exists "trip_evidence: own read" on public.trip_evidence;
create policy "trip_evidence: own read"
  on public.trip_evidence for select
  to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
    )
    or public.is_admin()
  );

drop policy if exists "trip_evidence: create own" on public.trip_evidence;
create policy "trip_evidence: create own"
  on public.trip_evidence for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
    )
  );

-- ============================================================
-- VERIFICATION_RESULTS policies
-- ============================================================

drop policy if exists "verification_results: own read" on public.verification_results;
create policy "verification_results: own read"
  on public.verification_results for select
  to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
    )
    or public.is_admin()
  );

drop policy if exists "verification_results: create pending" on public.verification_results;
create policy "verification_results: create pending"
  on public.verification_results for insert
  to authenticated
  with check (
    status = 'pending'
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
    )
  );

-- ============================================================
-- TRIP_LOCATIONS policies
-- ============================================================

drop policy if exists "trip_locations: own read" on public.trip_locations;
create policy "trip_locations: own read"
  on public.trip_locations for select
  to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
    )
    or public.is_admin()
  );

drop policy if exists "trip_locations: create own" on public.trip_locations;
create policy "trip_locations: create own"
  on public.trip_locations for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
    )
  );

-- ============================================================
-- MANUAL_REVIEW_REQUESTS policies
-- ============================================================

drop policy if exists "manual_review_requests: own read" on public.manual_review_requests;
create policy "manual_review_requests: own read"
  on public.manual_review_requests for select
  to authenticated
  using (
    requested_by = auth.uid()
    or public.is_admin()
  );

drop policy if exists "manual_review_requests: create own" on public.manual_review_requests;
create policy "manual_review_requests: create own"
  on public.manual_review_requests for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
      and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
    )
  );

drop policy if exists "manual_review_requests: admin update" on public.manual_review_requests;
create policy "manual_review_requests: admin update"
  on public.manual_review_requests for update
  to authenticated
  using (public.is_admin())
  with check (
    requested_by = (select requested_by from public.manual_review_requests where id = manual_review_requests.id)
    and trip_id = (select trip_id from public.manual_review_requests where id = manual_review_requests.id)
  );

-- ============================================================
-- AUDIT_LOGS policies
-- ============================================================

drop policy if exists "audit_logs: own trip read" on public.audit_logs;
create policy "audit_logs: own trip read"
  on public.audit_logs for select
  to authenticated
  using (
    (
      trip_id is not null
      and exists (
        select 1 from public.trips t
        where t.id = trip_id
        and (t.created_by = auth.uid() or t.assigned_to = auth.uid())
      )
    )
    or public.is_admin()
  );
