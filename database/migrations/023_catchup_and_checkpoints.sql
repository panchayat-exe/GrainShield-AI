-- =============================================================
-- Migration 023: Production Catch-up & Checkpoint Enforcement
-- GrainShield AI
--
-- PROBLEMS ADDRESSED:
--   1. Migration 020 fails on re-run with ERROR 42710
--      "Officers can view failed jobs already exists"
--      Root cause: Supabase SQL editor splits on semicolons,
--      running each statement in its own implicit transaction.
--      DROP POLICY IF EXISTS runs fine but then CREATE POLICY
--      re-creates the same policy name that was never dropped
--      (because a prior partial run left it and the DROP ran
--      in a separate implicit tx before CREATE).
--      FIX: This migration uses a DO block with dynamic SQL
--      to atomically drop-and-recreate all policies.
--
--   2. RLS on trips does NOT include driver_id = auth.uid()
--      so drivers assigned via driver_id cannot see their trips.
--      FIX: Drop and recreate the trips read policy.
--
--   3. No RLS policy allows drivers to update trip status
--      (start_trip, complete_trip via mobile app).
--      FIX: Add narrowly scoped driver UPDATE policy.
--
--   4. failed_jobs INSERT not explicitly granted to service_role.
--      FIX: Explicit GRANT (idempotent).
--
--   5. trips.vehicle_id FK may be missing.
--      FIX: ADD COLUMN IF NOT EXISTS + FK guard (idempotent).
--
--   6. Backfill vehicle_id on existing trips.
--
-- IDEMPOTENT: safe to run multiple times on any state.
-- Does NOT auto-apply to production — staging first.
-- =============================================================

BEGIN;

-- =============================================================
-- 1. REPAIR failed_jobs RLS POLICIES (fix ERROR 42710)
--
--    Use a DO block so DROP + CREATE run in one transaction.
--    This cannot be split by the SQL editor.
-- =============================================================

DO $fix_failed_jobs_policies$
BEGIN
    -- Officers/admins read policy
    DROP POLICY IF EXISTS "Officers can view failed jobs"
        ON public.failed_jobs;

    CREATE POLICY "Officers can view failed jobs"
        ON public.failed_jobs
        FOR SELECT
        TO authenticated
        USING (
            EXISTS (
                SELECT 1
                FROM public.profiles
                WHERE id = auth.uid()
                  AND role IN ('admin', 'super_admin', 'officer')
            )
        );

    RAISE NOTICE '[023] failed_jobs read policy recreated.';
END;
$fix_failed_jobs_policies$;


-- =============================================================
-- 2. EXPLICIT GRANTS on failed_jobs for service_role
--    (belt-and-suspenders; service_role bypasses RLS by default)
-- =============================================================

GRANT INSERT, SELECT ON TABLE public.failed_jobs TO service_role;
GRANT SELECT ON TABLE public.failed_jobs TO authenticated;


-- =============================================================
-- 3. FIX trips RLS — add driver_id visibility
--
--    Current policy: created_by = auth.uid() OR assigned_to = auth.uid() OR is_admin()
--    Missing:        driver_id  = auth.uid()
--
--    Without this, drivers assigned via driver_id column cannot
--    see their dispatched trips in My Trips.
-- =============================================================

DO $fix_trips_rls$
DECLARE
    v_policy_exists boolean;
BEGIN
    -- Check if the old policy exists
    SELECT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'trips'
          AND policyname = 'trips: own read'
    ) INTO v_policy_exists;

    IF v_policy_exists THEN
        DROP POLICY "trips: own read" ON public.trips;
        RAISE NOTICE '[023] Dropped old trips read policy.';
    END IF;

    -- Also drop legacy name variants if they exist
    BEGIN
        DROP POLICY IF EXISTS "Users can view their own trips" ON public.trips;
        DROP POLICY IF EXISTS "trips_own_read" ON public.trips;
    EXCEPTION WHEN OTHERS THEN
        NULL; -- ignore if not found
    END;

    CREATE POLICY "trips: own read"
        ON public.trips
        FOR SELECT
        TO authenticated
        USING (
            created_by = auth.uid()
            OR assigned_to = auth.uid()
            OR driver_id  = auth.uid()
            OR public.is_admin()
        );

    RAISE NOTICE '[023] trips read policy (re)created with driver_id.';
END;
$fix_trips_rls$;


-- =============================================================
-- 4. DRIVER UPDATE POLICY on trips
--    Drivers can update ONLY status/timestamps on their own trips
--    (needed for start_trip, GPS check-in, complete_trip from mobile)
--    Actual column restriction is enforced in RPCs (SECURITY DEFINER).
--    This policy gates row-level access; RPC gates column-level.
-- =============================================================

DO $driver_update_policy$
BEGIN
    DROP POLICY IF EXISTS "trips: driver update" ON public.trips;

    CREATE POLICY "trips: driver update"
        ON public.trips
        FOR UPDATE
        TO authenticated
        USING (
            driver_id = auth.uid()
            OR created_by = auth.uid()
            OR public.is_admin()
        )
        WITH CHECK (
            driver_id = auth.uid()
            OR created_by = auth.uid()
            OR public.is_admin()
        );

    RAISE NOTICE '[023] trips driver update policy (re)created.';
END;
$driver_update_policy$;


-- =============================================================
-- 5. ADD vehicle_id FK ON trips (idempotent)
-- =============================================================

ALTER TABLE public.trips
    ADD COLUMN IF NOT EXISTS vehicle_id uuid;

DO $vehicle_fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.trips'::regclass
          AND conname  = 'trips_vehicle_id_fkey'
    ) THEN
        ALTER TABLE public.trips
            ADD CONSTRAINT trips_vehicle_id_fkey
            FOREIGN KEY (vehicle_id)
            REFERENCES public.vehicles(id)
            ON DELETE SET NULL
            DEFERRABLE INITIALLY DEFERRED;
        RAISE NOTICE '[023] trips_vehicle_id_fkey constraint added.';
    ELSE
        RAISE NOTICE '[023] trips_vehicle_id_fkey already exists, skipping.';
    END IF;
END;
$vehicle_fk$;

CREATE INDEX IF NOT EXISTS idx_trips_vehicle_id
    ON public.trips(vehicle_id)
    WHERE vehicle_id IS NOT NULL;

COMMENT ON COLUMN public.trips.vehicle_id IS
    'FK to vehicles(id). Populated by admin_dispatch_trip(). '
    'NULL for pre-022 trips or unregistered vehicles.';


-- =============================================================
-- 6. BACKFILL vehicle_id on existing trips
-- =============================================================

DO $backfill$
DECLARE
    v_updated bigint;
BEGIN
    WITH matched AS (
        SELECT t.id AS trip_id, v.id AS vehicle_id
        FROM public.trips AS t
        JOIN public.vehicles AS v
          ON pg_catalog.upper(pg_catalog.btrim(t.vehicle_number))
           = pg_catalog.upper(pg_catalog.btrim(v.vehicle_number))
        WHERE t.vehicle_id IS NULL
          AND t.vehicle_number IS NOT NULL
    ),
    unique_matches AS (
        SELECT trip_id, vehicle_id FROM matched
        WHERE trip_id IN (
            SELECT trip_id FROM matched GROUP BY trip_id HAVING COUNT(*) = 1
        )
    )
    UPDATE public.trips AS t
       SET vehicle_id = um.vehicle_id
      FROM unique_matches AS um
     WHERE t.id = um.trip_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE '[023] Backfilled vehicle_id on % trips.', v_updated;
END;
$backfill$;


-- =============================================================
-- 7. HARDENED resolve_failed_job() — race-safe (idempotent)
-- =============================================================

CREATE OR REPLACE FUNCTION public.resolve_failed_job(
    p_job_id          uuid,
    p_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_id           uuid;
    v_actor_role         public.user_role;
    v_job_trip_id        uuid;
    v_already_resolved   boolean;
    v_found              boolean;
    v_rows_updated       integer;
BEGIN
    -- A. AUTHENTICATION
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- B. ROLE AUTHORIZATION
    SELECT role INTO v_actor_role
      FROM public.profiles WHERE id = v_actor_id;

    IF v_actor_role IS NULL
       OR v_actor_role NOT IN ('admin', 'super_admin', 'officer')
    THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    -- C. LOAD JOB
    SELECT trip_id, (resolved_at IS NOT NULL), true
      INTO v_job_trip_id, v_already_resolved, v_found
      FROM public.failed_jobs WHERE id = p_job_id;

    IF NOT v_found THEN
        RETURN jsonb_build_object('success', false, 'error', 'Failed job not found');
    END IF;
    IF v_already_resolved THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job is already resolved');
    END IF;

    -- D. RESOLVE
    UPDATE public.failed_jobs
       SET resolved_at     = pg_catalog.now(),
           resolved_by     = v_actor_id,
           resolution_note = NULLIF(pg_catalog.btrim(COALESCE(p_resolution_note, '')), '')
     WHERE id = p_job_id
       AND resolved_at IS NULL;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job resolved concurrently');
    END IF;

    -- E. AUDIT LOG
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, trip_id, metadata)
    VALUES (
        v_actor_id, 'failed_job_resolved', 'failed_jobs', p_job_id, v_job_trip_id,
        jsonb_build_object(
            'job_id', p_job_id,
            'resolution_note', p_resolution_note,
            'resolved_by', v_actor_id,
            'actor_role', v_actor_role::text
        )
    );

    RETURN jsonb_build_object(
        'success', true, 'job_id', p_job_id,
        'resolved_by', v_actor_id, 'actor_role', v_actor_role::text
    );
END;
$function$;

COMMENT ON FUNCTION public.resolve_failed_job(uuid, text) IS
    'Race-safe resolution of a failed AI worker job. '
    'Restricted to admin/super_admin/officer. '
    'GET DIAGNOSTICS guards against concurrent resolution. '
    'Writes audit log only when UPDATE row count = 1.';

REVOKE ALL ON FUNCTION public.resolve_failed_job(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_failed_job(uuid, text)
  TO authenticated;


-- =============================================================
-- 8. HARDENED admin_dispatch_trip() — vehicle validation
--    (idempotent CREATE OR REPLACE)
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_dispatch_trip(
    p_vehicle_number  text,
    p_stage           public.trip_stage,
    p_district        text    DEFAULT NULL,
    p_driver_id       uuid    DEFAULT NULL,
    p_commodity       text    DEFAULT NULL,
    p_quantity_kg     numeric DEFAULT NULL,
    p_origin          text    DEFAULT NULL,
    p_destination     text    DEFAULT NULL
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
    -- A. AUTHENTICATION
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- B. ROLE AUTHORIZATION
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
    IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'super_admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only admins may dispatch trips');
    END IF;

    -- C. INPUT VALIDATION
    IF pg_catalog.btrim(COALESCE(p_vehicle_number, '')) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'vehicle_number is required');
    END IF;

    -- D. VEHICLE VALIDATION
    SELECT id, is_active, true
      INTO v_vehicle_id, v_vehicle_active, v_vehicle_found
      FROM public.vehicles
     WHERE pg_catalog.upper(pg_catalog.btrim(vehicle_number))
         = pg_catalog.upper(pg_catalog.btrim(p_vehicle_number))
     LIMIT 1;

    IF NOT FOUND OR NOT v_vehicle_found THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Vehicle ' || p_vehicle_number || ' is not registered. Register it in Vehicle Management first.'
        );
    END IF;

    IF NOT v_vehicle_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Vehicle ' || p_vehicle_number || ' is inactive. Reactivate it before dispatching.'
        );
    END IF;

    -- E. DRIVER VALIDATION (optional)
    IF p_driver_id IS NOT NULL THEN
        SELECT role INTO v_driver_role FROM public.profiles WHERE id = p_driver_id;
        IF v_driver_role IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Driver profile not found');
        END IF;
        IF v_driver_role NOT IN ('user') THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Assigned driver must have role ''user''. Admins/officers cannot be drivers.'
            );
        END IF;
    END IF;

    -- F. GENERATE TRIP CODE
    v_trip_code := public.generate_trip_code();

    -- G. INSERT TRIP
    INSERT INTO public.trips (
        trip_code, vehicle_number, vehicle_id, stage, status,
        district, driver_id, commodity, quantity_kg,
        origin, destination, created_by
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

    -- H. AUDIT LOG
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, trip_id, metadata)
    VALUES (
        v_actor_id, 'trip_dispatched', 'trips', v_trip_id, v_trip_id,
        jsonb_build_object(
            'trip_code', v_trip_code,
            'vehicle_number', p_vehicle_number,
            'vehicle_id', v_vehicle_id,
            'stage', p_stage,
            'driver_id', p_driver_id,
            'actor_role', v_actor_role::text
        )
    );

    -- I. SUCCESS
    RETURN jsonb_build_object(
        'success', true,
        'trip_id', v_trip_id,
        'trip_code', v_trip_code,
        'vehicle_id', v_vehicle_id
    );
END;
$function$;

COMMENT ON FUNCTION public.admin_dispatch_trip(text, public.trip_stage, text, uuid, text, numeric, text, text) IS
    'Dispatches a new trip. Validates vehicle in master registry and active status. '
    'Populates vehicle_id FK. Generates GS-YYYY-NNNNNN trip code. '
    'Restricted to admin/super_admin. Writes audit log.';

REVOKE ALL ON FUNCTION public.admin_dispatch_trip(text, public.trip_stage, text, uuid, text, numeric, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_trip(text, public.trip_stage, text, uuid, text, numeric, text, text)
  TO authenticated;


-- =============================================================
-- 9. COMMIT
-- =============================================================

COMMIT;


-- =============================================================
-- MIGRATION 023 COMPLETE
--
-- POST-MIGRATION VERIFICATION QUERIES (run after applying):
--
-- V023-1: Confirm failed_jobs policy exists
--   SELECT policyname, cmd, roles
--     FROM pg_policies
--    WHERE tablename = 'failed_jobs';
--   Expected: "Officers can view failed jobs", r (SELECT), {authenticated}
--
-- V023-2: Confirm trips driver_id in RLS policy
--   SELECT policyname, qual
--     FROM pg_policies
--    WHERE tablename = 'trips' AND policyname = 'trips: own read';
--   Expected: qual contains 'driver_id = auth.uid()'
--
-- V023-3: Confirm vehicle_id column on trips
--   SELECT column_name, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'trips' AND column_name = 'vehicle_id';
--   Expected: 1 row, YES nullable
--
-- V023-4: Confirm FK constraint
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.trips'::regclass
--      AND conname = 'trips_vehicle_id_fkey';
--
-- V023-5: Confirm resolve_failed_job has GET DIAGNOSTICS
--   SELECT prosrc FROM pg_proc
--    WHERE proname = 'resolve_failed_job';
--   Expected: contains 'GET DIAGNOSTICS v_rows_updated'
--
-- V023-6: Test dispatch with unregistered vehicle
--   SELECT admin_dispatch_trip('ZZ99ZZZ9999', 'first_mile', 'Test');
--   Expected: {"success": false, "error": "... not registered ..."}
--
-- V023-7: Driver trip visibility
--   -- Log in as driver@grainshield.gov.in
--   SELECT id, trip_code FROM trips WHERE driver_id = auth.uid();
--   Expected: assigned trips visible
--
-- STAGING INSTRUCTIONS:
--   1. Open Supabase SQL Editor
--   2. Paste the ENTIRE contents of this file (do not split)
--   3. Click Run once
--   4. Run V023-1 through V023-7 above
--   5. Test dispatch flow end-to-end
--   6. If all pass, apply identically to production
-- =============================================================
