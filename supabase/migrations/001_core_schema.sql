-- =============================================================
-- Migration 001: Core Schema — GrainShield AI
-- Fully Idempotent: safe to run multiple times.
-- =============================================================

-- -----------------------------------------------
-- ENUMS (safe creation if not exists)
-- -----------------------------------------------
do $$ begin
  create type user_role as enum ('user', 'officer', 'admin', 'super_admin');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type trip_stage as enum ('first_mile', 'mid_mile', 'last_mile');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type trip_status as enum ('draft', 'submitted', 'processing', 'pass', 'retake', 'manual_review', 'rejected', 'completed');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type verification_status as enum ('pending', 'processing', 'pass', 'retake', 'manual_review', 'error');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type review_status as enum ('pending', 'assigned', 'in_review', 'resolved', 'escalated');
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------
-- HELPER: updated_at trigger function
-- -----------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------
-- TABLE: profiles
-- -----------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  full_name       text,
  phone           text,
  district        text,
  organization_id uuid,
  role            user_role not null default 'user',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_email_idx on public.profiles(email);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------
-- TABLE: trips
-- -----------------------------------------------
create table if not exists public.trips (
  id              uuid primary key default gen_random_uuid(),
  trip_code       text not null,
  vehicle_number  text not null,
  driver_name     text,
  driver_phone    text,
  stage           trip_stage not null,
  origin          text,
  destination     text,
  created_by      uuid not null references auth.users(id) on delete restrict,
  assigned_to     uuid references auth.users(id) on delete set null,
  organization_id uuid,
  status          trip_status not null default 'submitted',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (trip_code, created_by)
);

create index if not exists trips_created_by_idx on public.trips(created_by);
create index if not exists trips_assigned_to_idx on public.trips(assigned_to);
create index if not exists trips_status_idx on public.trips(status);
create index if not exists trips_trip_code_idx on public.trips(trip_code);
create index if not exists trips_created_at_idx on public.trips(created_at desc);

drop trigger if exists trips_updated_at on public.trips;
create trigger trips_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

-- -----------------------------------------------
-- TABLE: trip_evidence
-- -----------------------------------------------
create table if not exists public.trip_evidence (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips(id) on delete cascade,
  uploaded_by       uuid not null references auth.users(id) on delete restrict,
  stage             trip_stage not null,
  storage_path      text not null unique,
  original_filename text not null,
  mime_type         text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size         bigint not null check (file_size > 0 and file_size <= 10485760),
  checksum          text,
  uploaded_at       timestamptz not null default now()
);

create index if not exists trip_evidence_trip_id_idx on public.trip_evidence(trip_id);
create index if not exists trip_evidence_uploaded_by_idx on public.trip_evidence(uploaded_by);
create index if not exists trip_evidence_uploaded_at_idx on public.trip_evidence(uploaded_at desc);

-- -----------------------------------------------
-- TABLE: verification_results
-- -----------------------------------------------
create table if not exists public.verification_results (
  id                        uuid primary key default gen_random_uuid(),
  trip_id                   uuid not null references public.trips(id) on delete cascade,
  evidence_id               uuid not null references public.trip_evidence(id) on delete cascade,
  status                    verification_status not null default 'pending',
  image_quality             text,
  vehicle_detected          boolean,
  expected_plate            text,
  detected_plate            text,
  plate_match               boolean,
  vehicle_type              text,
  evidence_checks           jsonb,
  confidence                numeric check (confidence >= 0 and confidence <= 1),
  decision                  text,
  explanation               text,
  processor_version         text,
  processing_started_at     timestamptz,
  processing_completed_at   timestamptz,
  raw_output                jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists verification_results_trip_id_idx on public.verification_results(trip_id);
create index if not exists verification_results_evidence_id_idx on public.verification_results(evidence_id);
create index if not exists verification_results_status_idx on public.verification_results(status);
create index if not exists verification_results_created_at_idx on public.verification_results(created_at desc);

drop trigger if exists verification_results_updated_at on public.verification_results;
create trigger verification_results_updated_at
  before update on public.verification_results
  for each row execute function public.set_updated_at();

-- -----------------------------------------------
-- TABLE: trip_locations
-- -----------------------------------------------
create table if not exists public.trip_locations (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  latitude        numeric(10, 7) not null check (latitude >= -90 and latitude <= 90),
  longitude       numeric(10, 7) not null check (longitude >= -180 and longitude <= 180),
  accuracy_meters numeric,
  source          text not null default 'device_gps',
  recorded_at     timestamptz not null default now(),
  uploaded_by     uuid not null references auth.users(id) on delete restrict
);

create index if not exists trip_locations_trip_id_idx on public.trip_locations(trip_id);
create index if not exists trip_locations_recorded_at_idx on public.trip_locations(recorded_at desc);

-- -----------------------------------------------
-- TABLE: manual_review_requests
-- -----------------------------------------------
create table if not exists public.manual_review_requests (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips(id) on delete cascade,
  evidence_id       uuid not null references public.trip_evidence(id) on delete cascade,
  requested_by      uuid not null references auth.users(id) on delete restrict,
  user_notes        text,
  status            review_status not null default 'pending',
  assigned_reviewer uuid references auth.users(id) on delete set null,
  reviewer_notes    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

create index if not exists manual_review_requests_trip_id_idx on public.manual_review_requests(trip_id);
create index if not exists manual_review_requests_status_idx on public.manual_review_requests(status);
create index if not exists manual_review_requests_requested_by_idx on public.manual_review_requests(requested_by);

drop trigger if exists manual_review_requests_updated_at on public.manual_review_requests;
create trigger manual_review_requests_updated_at
  before update on public.manual_review_requests
  for each row execute function public.set_updated_at();

-- -----------------------------------------------
-- TABLE: audit_logs
-- -----------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  trip_id     uuid references public.trips(id) on delete cascade,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_logs_trip_id_idx on public.audit_logs(trip_id);
create index if not exists audit_logs_actor_id_idx on public.audit_logs(actor_id);
create index if not exists audit_logs_action_idx on public.audit_logs(action);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);
