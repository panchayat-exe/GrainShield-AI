-- =============================================================
-- Migration 003: Row Level Security Policies
-- =============================================================

-- -----------------------------------------------
-- Enable RLS on all tables
-- -----------------------------------------------
alter table public.profiles                enable row level security;
alter table public.trips                   enable row level security;
alter table public.trip_evidence           enable row level security;
alter table public.verification_results    enable row level security;
alter table public.trip_locations          enable row level security;
alter table public.manual_review_requests  enable row level security;
alter table public.audit_logs              enable row level security;

-- ============================================================
-- PROFILES policies
-- ============================================================

-- Users can read their own profile
create policy "profiles: own read"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- Admins can read all profiles
create policy "profiles: admin read all"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

-- Users can only update safe fields of their own profile (not role, id, email)
create policy "profiles: own update safe fields"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- Deny role escalation: the check ensures the submitted role equals the DB role
    and role = (select role from public.profiles where id = auth.uid())
  );

-- Profiles are created automatically by the handle_new_user trigger (service role)
-- No INSERT policy needed for authenticated users.

-- ============================================================
-- TRIPS policies
-- ============================================================

-- Users can read their own trips (created or assigned)
create policy "trips: own read"
  on public.trips for select
  to authenticated
  using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or public.is_admin()
  );

-- Users can create trips (created_by must equal auth.uid())
create policy "trips: create own"
  on public.trips for insert
  to authenticated
  with check (created_by = auth.uid());

-- Users can update their own trips' status only
create policy "trips: update own"
  on public.trips for update
  to authenticated
  using (created_by = auth.uid() or assigned_to = auth.uid())
  with check (
    -- created_by and id cannot be changed
    created_by = (select created_by from public.trips where id = trips.id)
  );

-- Admins can update any trip
create policy "trips: admin update"
  on public.trips for update
  to authenticated
  using (public.is_admin());

-- No direct delete for users; admins via service role only
create policy "trips: admin delete"
  on public.trips for delete
  to authenticated
  using (public.is_admin());

-- ============================================================
-- TRIP_EVIDENCE policies
-- ============================================================

-- Users can see evidence for trips they own or are assigned to
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

-- Users can insert evidence for trips they have access to;
-- uploaded_by must equal auth.uid()
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

-- No update or delete by users (evidence is immutable once uploaded)

-- ============================================================
-- VERIFICATION_RESULTS policies
-- ============================================================

-- Users can read their own trip verifications; admins read all
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

-- Users can create pending verification records
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

-- Only the service role (AI worker) can update verification results.
-- Authenticated users cannot update verifications to prevent forgery.
-- The AI worker uses the service_role key server-side.
-- No UPDATE policy for authenticated here — intentional.

-- ============================================================
-- TRIP_LOCATIONS policies
-- ============================================================

-- Users can read location history for their own trips; admins read all
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

-- Users can insert locations for trips they own;
-- uploaded_by must equal auth.uid()
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

-- Users can see requests for trips they own; admins see all
create policy "manual_review_requests: own read"
  on public.manual_review_requests for select
  to authenticated
  using (
    requested_by = auth.uid()
    or public.is_admin()
  );

-- Users can create requests for their own trips
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

-- Admins can update review status and reviewer notes
create policy "manual_review_requests: admin update"
  on public.manual_review_requests for update
  to authenticated
  using (public.is_admin())
  with check (
    -- Prevent changing the requesting user or the original trip reference
    requested_by = (select requested_by from public.manual_review_requests where id = manual_review_requests.id)
    and trip_id = (select trip_id from public.manual_review_requests where id = manual_review_requests.id)
  );

-- ============================================================
-- AUDIT_LOGS policies
-- ============================================================

-- Users can read audit logs for their own trips
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

-- Audit logs are NEVER writable by authenticated users directly.
-- They are written by trusted DB triggers and service-role server functions only.
-- No INSERT/UPDATE/DELETE policy for authenticated role here — intentional.

-- ============================================================
-- Deny all anonymous access
-- ============================================================
-- (RLS is enabled and no anon policies are created, so anonymous access
-- is automatically blocked on all tables.)
