-- =============================================================
-- Migration 004: Audit Triggers
-- Automatically insert audit log entries on important events.
-- =============================================================

-- -----------------------------------------------
-- Generic audit log writer (security definer)
-- -----------------------------------------------
create or replace function public.write_audit_log(
  p_actor_id    uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_trip_id     uuid default null,
  p_metadata    jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, trip_id, metadata)
  values (p_actor_id, p_action, p_entity_type, p_entity_id, p_trip_id, p_metadata);
end;
$$;

-- -----------------------------------------------
-- Trigger: log trip creation
-- -----------------------------------------------
create or replace function public.audit_trip_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.write_audit_log(
    new.created_by,
    'trip_created',
    'trips',
    new.id,
    new.id,
    jsonb_build_object('trip_code', new.trip_code, 'vehicle_number', new.vehicle_number, 'stage', new.stage)
  );
  return new;
end;
$$;

create trigger trips_audit_insert
  after insert on public.trips
  for each row execute function public.audit_trip_insert();

-- -----------------------------------------------
-- Trigger: log trip status changes
-- -----------------------------------------------
create or replace function public.audit_trip_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> old.status then
    perform public.write_audit_log(
      auth.uid(),
      'trip_status_updated',
      'trips',
      new.id,
      new.id,
      jsonb_build_object('old_status', old.status, 'new_status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger trips_audit_status
  after update on public.trips
  for each row execute function public.audit_trip_status_change();

-- -----------------------------------------------
-- Trigger: log evidence uploads
-- -----------------------------------------------
create or replace function public.audit_evidence_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.write_audit_log(
    new.uploaded_by,
    'evidence_uploaded',
    'trip_evidence',
    new.id,
    new.trip_id,
    jsonb_build_object('stage', new.stage, 'original_filename', new.original_filename, 'file_size', new.file_size)
  );
  return new;
end;
$$;

create trigger trip_evidence_audit_insert
  after insert on public.trip_evidence
  for each row execute function public.audit_evidence_insert();

-- -----------------------------------------------
-- Trigger: log verification result changes
-- -----------------------------------------------
create or replace function public.audit_verification_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.write_audit_log(
      auth.uid(),
      'verification_queued',
      'verification_results',
      new.id,
      new.trip_id,
      jsonb_build_object('status', new.status, 'evidence_id', new.evidence_id)
    );
  elsif TG_OP = 'UPDATE' and new.status <> old.status then
    perform public.write_audit_log(
      auth.uid(),
      'verification_completed',
      'verification_results',
      new.id,
      new.trip_id,
      jsonb_build_object('old_status', old.status, 'new_status', new.status, 'decision', new.decision)
    );
  end if;
  return new;
end;
$$;

create trigger verification_results_audit
  after insert or update on public.verification_results
  for each row execute function public.audit_verification_change();

-- -----------------------------------------------
-- Trigger: log manual review requests
-- -----------------------------------------------
create or replace function public.audit_manual_review_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.write_audit_log(
    new.requested_by,
    'manual_review_requested',
    'manual_review_requests',
    new.id,
    new.trip_id,
    jsonb_build_object('evidence_id', new.evidence_id, 'user_notes', new.user_notes)
  );
  return new;
end;
$$;

create trigger manual_review_audit_insert
  after insert on public.manual_review_requests
  for each row execute function public.audit_manual_review_insert();
