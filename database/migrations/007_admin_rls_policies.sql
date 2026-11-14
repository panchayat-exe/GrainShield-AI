-- Migration 007: Admin RLS Policies for GrainShield AI Admin Portal
-- Admins and super_admins can read all data across users

-- Helper: check if current user is admin
create or replace function public.is_admin_or_officer()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role in ('admin', 'super_admin', 'officer')
  );
$$;

-- trips: admins can read all
drop policy if exists "Admins read all trips" on public.trips;
create policy "Admins read all trips" on public.trips
  for select using (public.is_admin_or_officer());

-- trips: admins can update status
drop policy if exists "Admins update trips" on public.trips;
create policy "Admins update trips" on public.trips
  for update using (public.is_admin_or_officer());

-- verification_results: admins can read all
drop policy if exists "Admins read all verifications" on public.verification_results;
create policy "Admins read all verifications" on public.verification_results
  for select using (public.is_admin_or_officer());

-- manual_review_requests: admins can read and update all
drop policy if exists "Admins read all reviews" on public.manual_review_requests;
create policy "Admins read all reviews" on public.manual_review_requests
  for select using (public.is_admin_or_officer());

drop policy if exists "Admins update reviews" on public.manual_review_requests;
create policy "Admins update reviews" on public.manual_review_requests
  for update using (public.is_admin_or_officer());

-- audit_logs: admins can read all
drop policy if exists "Admins read audit logs" on public.audit_logs;
create policy "Admins read audit logs" on public.audit_logs
  for select using (public.is_admin_or_officer());

-- profiles: admins can read all profiles
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles
  for select using (public.is_admin_or_officer());

-- trip_evidence: admins can read metadata (storage access controlled separately)
drop policy if exists "Admins read all evidence" on public.trip_evidence;
create policy "Admins read all evidence" on public.trip_evidence
  for select using (public.is_admin_or_officer());

-- audit_logs: admins can insert (for manual review decisions)
drop policy if exists "Admins insert audit logs" on public.audit_logs;
create policy "Admins insert audit logs" on public.audit_logs
  for insert with check (public.is_admin_or_officer());
