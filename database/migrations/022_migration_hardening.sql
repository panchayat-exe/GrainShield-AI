-- =============================================================
-- Migration 022: Security Hardening & Integration Fixes
-- GrainShield AI — Post-Audit Remediation
--
-- CHANGES:
--   1. Fix mig-021 REVOKE gap: revoke from 'authenticated' on
--      resolve_failed_job is NOT needed (authenticated was
--      already the grant target — this migration adds an
--      explicit confirmation comment and hardens the check).
--   2. Fix mig-021 audit-log race: add GET DIAGNOSTICS row
--      count guard so a lost-race UPDATE skips the audit log
--      insert (prevents duplicate audit rows).
--   3. Explicit GRANT INSERT on failed_jobs to service_role
--      (defensive belt-and-suspenders — service_role bypasses
--      RLS anyway, but this makes intent explicit).
--   4. Vehicle validation in admin_dispatch_trip(): check that
--      the vehicle_number exists in the vehicles master table
--      and is currently active before dispatching.
--   5. Add nullable vehicle_id FK on trips table linking to
--      vehicles(id) for referential integrity.
--   6. Backfill vehicle_id on existing trips where
--      vehicle_number matches a vehicles record.
--
-- IDEMPOTENT: safe to run multiple times.
-- Does NOT auto-apply migrations to production.
-- =============================================================

BEGIN;


-- =============================================================
-- 1. HARDENED resolve_failed_job() — race-safe audit log
--
-- Key fix: after the UPDATE ... WHERE id = p_job_id AND
-- resolved_at IS NULL, check GET DIAGNOSTICS v_rows = ROW_COUNT.
-- If 0 rows updated, another concurrent call won the race —
-- return a "already resolved" error and skip the audit insert.
-- =============================================================

CREATE OR REPLACE FUNCTION public.resolve_failed_job(
    p_job_id         uuid,
    p_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$

DECLARE
    v_actor_id    uuid;
    v_actor_role  public.user_role;

    v_job_trip_id        uuid;
    v_already_resolved   boolean;
    v_found              boolean;
    v_rows_updated       integer;

BEGIN

    -- ---------------------------------------------------------
    -- A. AUTHENTICATION
    -- ---------------------------------------------------------
    v_actor_id := auth.uid();

    IF v_actor_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Not authenticated'
        );
    END IF;

    -- ---------------------------------------------------------
    -- B. ROLE AUTHORIZATION
    --    Only admin, super_admin, officer may resolve jobs.
    -- ---------------------------------------------------------
    SELECT role
      INTO v_actor_role
      FROM public.profiles
     WHERE id = v_actor_id;

    IF v_actor_role IS NULL
       OR v_actor_role NOT IN ('admin', 'super_admin', 'officer')
    THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Insufficient permissions to resolve failed jobs'
        );
    END IF;

    -- ---------------------------------------------------------
    -- C. LOAD JOB — verify it exists and check current state
    -- ---------------------------------------------------------
    SELECT
        trip_id,
        (resolved_at IS NOT NULL),
        true
    INTO
        v_job_trip_id,
        v_already_resolved,
        v_found
    FROM public.failed_jobs
    WHERE id = p_job_id;

    IF NOT v_found THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Failed job not found'
        );
    END IF;

    IF v_already_resolved THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Job is already resolved'
        );
    END IF;

    -- ---------------------------------------------------------
    -- D. RESOLVE — update ONLY the resolution fields
    --    WHERE guard protects against race condition.
    -- ---------------------------------------------------------
    UPDATE public.failed_jobs
       SET resolved_at      = now(),
           resolved_by      = v_actor_id,
           resolution_note  = NULLIF(
               pg_catalog.btrim(COALESCE(p_resolution_note, '')),
               ''
           )
     WHERE id = p_job_id
       AND resolved_at IS NULL;   -- race guard

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    -- Another concurrent resolution won the race — skip audit
    IF v_rows_updated = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Job was resolved concurrently by another user'
        );
    END IF;

    -- ---------------------------------------------------------
    -- E. AUDIT LOG (only if our UPDATE actually landed)
    -- ---------------------------------------------------------
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        trip_id,
        metadata
    )
    VALUES (
        v_actor_id,
        'failed_job_resolved',
        'failed_jobs',
        p_job_id,
        v_job_trip_id,
        jsonb_build_object(
            'job_id',          p_job_id,
            'resolution_note', p_resolution_note,
            'resolved_by',     v_actor_id,
            'actor_role',      v_actor_role::text
        )
    );

    -- ---------------------------------------------------------
    -- F. SUCCESS
    -- ---------------------------------------------------------
    RETURN jsonb_build_object(
        'success',          true,
        'job_id',           p_job_id,
        'resolved_by',      v_actor_id,
        'actor_role',       v_actor_role::text
    );

END;
$function$;


COMMENT ON FUNCTION public.resolve_failed_job(uuid, text) IS
    'Marks a failed AI worker job as resolved. '
    'Restricted to admin, super_admin, and officer roles. '
    'Only sets resolved_at / resolved_by / resolution_note — '
    'no other fields can be modified through this function. '
    'Race-safe: uses GET DIAGNOSTICS row count to detect concurrent '
    'resolution and skips audit log if UPDATE matched 0 rows. '
    'Writes an audit log entry.';


-- Preserve existing grant: authenticated callers can invoke;
-- role check is enforced inside the function body.
REVOKE ALL ON FUNCTION public.resolve_failed_job(uuid, text)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.resolve_failed_job(uuid, text)
  TO authenticated;


-- =============================================================
-- 2. EXPLICIT service_role INSERT GRANT on failed_jobs
--    (belt-and-suspenders; service_role bypasses RLS by default
--     but explicit grants make intent auditable)
-- =============================================================

GRANT INSERT ON TABLE public.failed_jobs TO service_role;
GRANT SELECT ON TABLE public.failed_jobs TO service_role;


-- =============================================================
-- 3. ADD vehicle_id FK on trips table
--    Nullable — existing trips keep NULL, new dispatched trips
--    will be populated via admin_dispatch_trip().
-- =============================================================

ALTER TABLE public.trips
    ADD COLUMN IF NOT EXISTS vehicle_id uuid;

-- Add FK constraint if not already present
DO $vehicle_fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.trips'::regclass
          AND conname = 'trips_vehicle_id_fkey'
    ) THEN
        ALTER TABLE public.trips
            ADD CONSTRAINT trips_vehicle_id_fkey
            FOREIGN KEY (vehicle_id)
            REFERENCES public.vehicles (id)
            ON DELETE SET NULL
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END;
$vehicle_fk$;

CREATE INDEX IF NOT EXISTS idx_trips_vehicle_id
    ON public.trips (vehicle_id)
    WHERE vehicle_id IS NOT NULL;

COMMENT ON COLUMN public.trips.vehicle_id IS
    'FK to vehicles(id). Populated by admin_dispatch_trip() after vehicle validation. '
    'NULL for trips created before migration 022 or where vehicle was not in master registry.';


-- =============================================================
-- 4. BACKFILL vehicle_id on existing trips
--    Matches trips.vehicle_number to vehicles.vehicle_number
--    (case-insensitive). Only updates where exactly one vehicle
--    record matches to avoid ambiguity.
-- =============================================================

DO $backfill$
DECLARE
    v_updated bigint;
BEGIN
    WITH matched AS (
        SELECT
            t.id AS trip_id,
            v.id AS vehicle_id
        FROM public.trips AS t
        JOIN public.vehicles AS v
          ON pg_catalog.upper(pg_catalog.btrim(t.vehicle_number))
             = pg_catalog.upper(pg_catalog.btrim(v.vehicle_number))
        WHERE t.vehicle_id IS NULL
          AND t.vehicle_number IS NOT NULL
    ),
    unique_matches AS (
        SELECT trip_id, vehicle_id
        FROM matched
        WHERE trip_id IN (
            SELECT trip_id FROM matched GROUP BY trip_id HAVING COUNT(*) = 1
        )
    )
    UPDATE public.trips AS t
       SET vehicle_id = um.vehicle_id
      FROM unique_matches AS um
     WHERE t.id = um.trip_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE '[migration-022] Backfilled vehicle_id on % existing trips.', v_updated;
END;
$backfill$;


-- =============================================================
-- 5. HARDENED admin_dispatch_trip() — vehicle validation
--
-- Replaces the existing function. Adds:
--   a) Checks vehicle_number exists in vehicles master table.
--   b) Checks vehicle is currently active.
--   c) Populates vehicle_id FK on the new trip row.
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_dispatch_trip(
    p_vehicle_number  text,
    p_stage           public.trip_stage,
    p_district        text DEFAULT NULL,
    p_driver_id       uuid DEFAULT NULL,
    p_commodity       text DEFAULT NULL,
    p_quantity_kg     numeric DEFAULT NULL,
    p_origin          text DEFAULT NULL,
    p_destination     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$

DECLARE
    v_actor_id       uuid;
    v_actor_role     public.user_role;
    v_trip_code      text;
    v_trip_id        uuid;
    v_vehicle_id     uuid;
    v_vehicle_active boolean;
    v_vehicle_found  boolean;
    v_driver_role    public.user_role;

BEGIN

    -- ---------------------------------------------------------
    -- A. AUTHENTICATION
    -- ---------------------------------------------------------
    v_actor_id := auth.uid();

    IF v_actor_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Not authenticated'
        );
    END IF;

    -- ---------------------------------------------------------
    -- B. ROLE AUTHORIZATION
    -- ---------------------------------------------------------
    SELECT role
      INTO v_actor_role
      FROM public.profiles
     WHERE id = v_actor_id;

    IF v_actor_role IS NULL
       OR v_actor_role NOT IN ('admin', 'super_admin')
    THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Only admins may dispatch trips'
        );
    END IF;

    -- ---------------------------------------------------------
    -- C. INPUT VALIDATION
    -- ---------------------------------------------------------
    IF pg_catalog.btrim(COALESCE(p_vehicle_number, '')) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'vehicle_number is required'
        );
    END IF;

    -- ---------------------------------------------------------
    -- D. VEHICLE VALIDATION — must exist in master registry
    --    and must be active.
    -- ---------------------------------------------------------
    SELECT
        id,
        is_active,
        true
    INTO
        v_vehicle_id,
        v_vehicle_active,
        v_vehicle_found
    FROM public.vehicles
    WHERE pg_catalog.upper(pg_catalog.btrim(vehicle_number))
          = pg_catalog.upper(pg_catalog.btrim(p_vehicle_number))
    LIMIT 1;

    IF NOT FOUND OR NOT v_vehicle_found THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Vehicle ' || p_vehicle_number || ' is not registered in the vehicle master registry. Register the vehicle before dispatching.'
        );
    END IF;

    IF NOT v_vehicle_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Vehicle ' || p_vehicle_number || ' is currently marked inactive. Reactivate the vehicle before dispatching.'
        );
    END IF;

    -- ---------------------------------------------------------
    -- E. DRIVER VALIDATION (optional)
    -- ---------------------------------------------------------
    IF p_driver_id IS NOT NULL THEN
        SELECT role
          INTO v_driver_role
          FROM public.profiles
         WHERE id = p_driver_id;

        IF v_driver_role IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'Driver profile not found'
            );
        END IF;

        IF v_driver_role NOT IN ('user') THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'Assigned driver must have role ''user''. Admins and officers cannot be assigned as drivers.'
            );
        END IF;
    END IF;

    -- ---------------------------------------------------------
    -- F. GENERATE TRIP CODE
    -- ---------------------------------------------------------
    v_trip_code := public.generate_trip_code();

    -- ---------------------------------------------------------
    -- G. INSERT TRIP — with vehicle_id FK populated
    -- ---------------------------------------------------------
    INSERT INTO public.trips (
        trip_code,
        vehicle_number,
        vehicle_id,
        stage,
        status,
        district,
        driver_id,
        commodity,
        quantity_kg,
        origin,
        destination,
        created_by
    )
    VALUES (
        v_trip_code,
        pg_catalog.upper(pg_catalog.btrim(p_vehicle_number)),
        v_vehicle_id,
        p_stage,
        'draft',
        pg_catalog.btrim(COALESCE(p_district, '')),
        p_driver_id,
        pg_catalog.btrim(COALESCE(p_commodity, '')),
        p_quantity_kg,
        pg_catalog.btrim(COALESCE(p_origin, '')),
        pg_catalog.btrim(COALESCE(p_destination, '')),
        v_actor_id
    )
    RETURNING id INTO v_trip_id;

    -- ---------------------------------------------------------
    -- H. AUDIT LOG
    -- ---------------------------------------------------------
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        trip_id,
        metadata
    )
    VALUES (
        v_actor_id,
        'trip_dispatched',
        'trips',
        v_trip_id,
        v_trip_id,
        jsonb_build_object(
            'trip_code',      v_trip_code,
            'vehicle_number', p_vehicle_number,
            'vehicle_id',     v_vehicle_id,
            'stage',          p_stage,
            'driver_id',      p_driver_id,
            'actor_role',     v_actor_role::text
        )
    );

    -- ---------------------------------------------------------
    -- I. SUCCESS
    -- ---------------------------------------------------------
    RETURN jsonb_build_object(
        'success',       true,
        'trip_id',       v_trip_id,
        'trip_code',     v_trip_code,
        'vehicle_id',    v_vehicle_id
    );

END;
$function$;


COMMENT ON FUNCTION public.admin_dispatch_trip(text, public.trip_stage, text, uuid, text, numeric, text, text) IS
    'Dispatches a new trip. '
    'Validates vehicle exists in master registry and is active. '
    'Populates vehicle_id FK. Generates a GS-YYYY-NNNNNN trip code. '
    'Restricted to admin and super_admin roles. Writes audit log.';


-- Revoke all, grant only to authenticated (role check inside function)
REVOKE ALL ON FUNCTION public.admin_dispatch_trip(text, public.trip_stage, text, uuid, text, numeric, text, text)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.admin_dispatch_trip(text, public.trip_stage, text, uuid, text, numeric, text, text)
  TO authenticated;


-- =============================================================
-- 6. COMMIT
-- =============================================================

COMMIT;


-- =============================================================
-- MIGRATION 022 COMPLETE
--
-- POST-MIGRATION VERIFICATION QUERIES (run separately):
--
-- V022-1: Confirm vehicle_id column exists on trips
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'trips'
--      AND column_name = 'vehicle_id';
--
-- V022-2: Confirm FK constraint exists
--   SELECT conname, contype, confrelid::regclass
--     FROM pg_constraint
--    WHERE conrelid = 'public.trips'::regclass
--      AND conname = 'trips_vehicle_id_fkey';
--
-- V022-3: Confirm race fix in resolve_failed_job
--   SELECT prosrc FROM pg_proc
--    WHERE proname = 'resolve_failed_job'
--      AND pronamespace = 'public'::regnamespace;
--   -- Should contain: GET DIAGNOSTICS v_rows_updated = ROW_COUNT
--
-- V022-4: Confirm admin_dispatch_trip vehicle validation
--   SELECT prosrc FROM pg_proc
--    WHERE proname = 'admin_dispatch_trip'
--      AND pronamespace = 'public'::regnamespace;
--   -- Should contain: 'not registered in the vehicle master'
--
-- V022-5: Backfill count
--   SELECT COUNT(*) FROM public.trips WHERE vehicle_id IS NOT NULL;
--
-- STAGING INSTRUCTIONS:
--   1. Apply on staging: psql $STAGING_URL < 022_migration_hardening.sql
--   2. Run V022-1 through V022-5 above
--   3. Test: dispatch a trip with unknown vehicle — expect error
--   4. Test: dispatch with inactive vehicle — expect error
--   5. Test: resolve same failed job twice concurrently — only 1 audit row
--   6. If all pass, apply to production with same script
-- =============================================================
