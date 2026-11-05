-- =============================================================
-- Migration 024: Checkpoint Table & search_path Hardening
-- GrainShield AI
--
-- FEATURES:
--   1. checkpoints table - models CP1-CP4 per trip enforced in DB
--   2. trip_evidence.checkpoint_number column
--   3. CP ordering trigger - cannot submit CP2 before CP1 passes
--   4. search_path hardening on existing helper functions
--      (is_vehicle_registered, update_updated_at,
--       normalize_vehicle_number, set_updated_at)
--
-- IDEMPOTENT: safe to run multiple times.
-- Does NOT auto-apply to production.
-- =============================================================

BEGIN;


-- =============================================================
-- 1. ADD checkpoint_number TO trip_evidence
--    1 = CP1 (first_mile in), 2 = CP1 (first_mile out),
--    3 = CP2 (mid_mile),       4 = CP3 (last_mile)
--    NULL = legacy evidence before this migration
-- =============================================================

ALTER TABLE public.trip_evidence
    ADD COLUMN IF NOT EXISTS checkpoint_number smallint
    CHECK (checkpoint_number BETWEEN 1 AND 4);

COMMENT ON COLUMN public.trip_evidence.checkpoint_number IS
    'Checkpoint number (1-4). '
    '1=First Mile In, 2=First Mile Out, 3=Mid Mile, 4=Last Mile. '
    'NULL for evidence submitted before migration 024.';

CREATE INDEX IF NOT EXISTS idx_trip_evidence_checkpoint
    ON public.trip_evidence(trip_id, checkpoint_number)
    WHERE checkpoint_number IS NOT NULL;


-- =============================================================
-- 2. CREATE checkpoints TABLE
-- =============================================================

CREATE TABLE IF NOT EXISTS public.checkpoints (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    trip_id             uuid NOT NULL
        REFERENCES public.trips(id)
        ON DELETE CASCADE,

    checkpoint_number   smallint NOT NULL
        CHECK (checkpoint_number BETWEEN 1 AND 4),

    -- Descriptive label for display
    label               text NOT NULL
        CHECK (label IN ('first_mile_in', 'first_mile_out', 'mid_mile', 'last_mile')),

    evidence_id         uuid
        REFERENCES public.trip_evidence(id)
        ON DELETE SET NULL,

    -- Status: pending | submitted | pass | retake | rejected
    status              text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','submitted','pass','retake','rejected')),

    officer_note        text,

    resolved_by         uuid
        REFERENCES public.profiles(id)
        ON DELETE SET NULL,

    resolved_at         timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    -- Each trip has exactly one record per checkpoint number
    UNIQUE (trip_id, checkpoint_number)
);

COMMENT ON TABLE public.checkpoints IS
    'Models the 4-checkpoint progression (CP1-CP4) for each trip. '
    'CP1=First Mile In, CP2=First Mile Out, CP3=Mid Mile, CP4=Last Mile. '
    'Status transitions are enforced by trigger: CP(n) cannot be submitted '
    'before CP(n-1) has passed.';

CREATE INDEX IF NOT EXISTS idx_checkpoints_trip_id
    ON public.checkpoints(trip_id);

CREATE INDEX IF NOT EXISTS idx_checkpoints_status
    ON public.checkpoints(status)
    WHERE status IN ('pending','submitted');


-- =============================================================
-- 3. BACKFILL: Create checkpoint records for existing trips
--    Every trip gets 4 pending checkpoint rows on creation.
--    For trips already in pass/completed, mark all as pass.
--    For trips in draft/submitted/processing, leave as pending.
-- =============================================================

DO $backfill_checkpoints$
DECLARE
    v_inserted bigint := 0;
BEGIN
    -- Insert missing checkpoint rows (idempotent via ON CONFLICT DO NOTHING)
    INSERT INTO public.checkpoints (trip_id, checkpoint_number, label, status)
    SELECT
        t.id,
        cp.num,
        cp.lbl,
        CASE
            WHEN t.status IN ('pass', 'completed', 'rejected') THEN
                CASE WHEN t.status = 'rejected' THEN 'rejected' ELSE 'pass' END
            ELSE 'pending'
        END
    FROM public.trips AS t
    CROSS JOIN (
        VALUES
            (1::smallint, 'first_mile_in'),
            (2::smallint, 'first_mile_out'),
            (3::smallint, 'mid_mile'),
            (4::smallint, 'last_mile')
    ) AS cp(num, lbl)
    ON CONFLICT (trip_id, checkpoint_number) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RAISE NOTICE '[024] Backfilled % checkpoint records for existing trips.', v_inserted;
END;
$backfill_checkpoints$;


-- =============================================================
-- 4. TRIGGER: Enforce checkpoint ordering
--    CP(n) cannot be SUBMITTED until CP(n-1) has status = 'pass'
--    CP1 can always be submitted (no predecessor).
-- =============================================================

CREATE OR REPLACE FUNCTION public.enforce_checkpoint_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_prev_status text;
BEGIN
    -- Only enforce when transitioning TO 'submitted'
    IF NEW.status <> 'submitted' THEN
        RETURN NEW;
    END IF;

    -- CP1 has no predecessor - always allowed
    IF NEW.checkpoint_number = 1 THEN
        RETURN NEW;
    END IF;

    -- Check predecessor status
    SELECT status
      INTO v_prev_status
      FROM public.checkpoints
     WHERE trip_id          = NEW.trip_id
       AND checkpoint_number = NEW.checkpoint_number - 1;

    IF v_prev_status IS NULL THEN
        RAISE EXCEPTION
            '[GrainShield] Cannot submit CP%: preceding checkpoint record missing.',
            NEW.checkpoint_number;
    END IF;

    IF v_prev_status <> 'pass' THEN
        RAISE EXCEPTION
            '[GrainShield] Cannot submit CP%: CP% must pass first (current status: %).',
            NEW.checkpoint_number,
            NEW.checkpoint_number - 1,
            v_prev_status;
    END IF;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.enforce_checkpoint_order() IS
    'Trigger function: prevents submitting checkpoint N until checkpoint N-1 has passed.';

DROP TRIGGER IF EXISTS trg_checkpoint_order ON public.checkpoints;
CREATE TRIGGER trg_checkpoint_order
    BEFORE INSERT OR UPDATE ON public.checkpoints
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_checkpoint_order();


-- =============================================================
-- 5. AUTO-UPDATE updated_at ON checkpoints
-- =============================================================

DROP TRIGGER IF EXISTS trg_checkpoints_updated_at ON public.checkpoints;
CREATE TRIGGER trg_checkpoints_updated_at
    BEFORE UPDATE ON public.checkpoints
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- 6. RLS ON checkpoints
-- =============================================================

ALTER TABLE public.checkpoints ENABLE ROW LEVEL SECURITY;

DO $checkpoint_rls$
BEGIN
    -- Admins/officers: full read
    DROP POLICY IF EXISTS "checkpoints: admin read" ON public.checkpoints;
    CREATE POLICY "checkpoints: admin read"
        ON public.checkpoints FOR SELECT
        TO authenticated
        USING (public.is_admin());

    -- Drivers: read their own trip checkpoints
    DROP POLICY IF EXISTS "checkpoints: driver read" ON public.checkpoints;
    CREATE POLICY "checkpoints: driver read"
        ON public.checkpoints FOR SELECT
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.trips t
                WHERE t.id = trip_id
                  AND (
                    t.driver_id  = auth.uid()
                    OR t.assigned_to = auth.uid()
                    OR t.created_by  = auth.uid()
                  )
            )
        );

    -- Drivers: submit their own checkpoints (UPDATE status to 'submitted' only)
    DROP POLICY IF EXISTS "checkpoints: driver submit" ON public.checkpoints;
    CREATE POLICY "checkpoints: driver submit"
        ON public.checkpoints FOR UPDATE
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.trips t
                WHERE t.id = trip_id
                  AND (t.driver_id = auth.uid() OR t.created_by = auth.uid())
            )
        )
        WITH CHECK (
            status = 'submitted'
        );

    -- Admins/officers: resolve checkpoints (pass/retake/rejected)
    DROP POLICY IF EXISTS "checkpoints: admin resolve" ON public.checkpoints;
    CREATE POLICY "checkpoints: admin resolve"
        ON public.checkpoints FOR UPDATE
        TO authenticated
        USING (public.is_admin())
        WITH CHECK (status IN ('pass','retake','rejected','pending'));

    RAISE NOTICE '[024] checkpoints RLS policies created.';
END;
$checkpoint_rls$;

GRANT SELECT, UPDATE ON TABLE public.checkpoints TO authenticated;
GRANT INSERT ON TABLE public.checkpoints TO service_role;


-- =============================================================
-- 7. search_path HARDENING on existing helper functions
--    (mig 001 / 008 functions lacked SET search_path = '')
-- =============================================================

-- 7a. set_updated_at() - mig 001
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.set_updated_at() IS
    'Generic trigger function: sets updated_at = now(). search_path hardened in mig-024.';


-- 7b. update_updated_at() - alias used in some migrations
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.update_updated_at() IS
    'Alias for set_updated_at(). search_path hardened in mig-024.';


-- 7c. normalize_vehicle_number() - mig 008
CREATE OR REPLACE FUNCTION public.normalize_vehicle_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF NEW.vehicle_number IS NOT NULL THEN
        NEW.vehicle_number :=
            pg_catalog.upper(pg_catalog.regexp_replace(
                pg_catalog.btrim(NEW.vehicle_number),
                '[^A-Z0-9]', '', 'g'
            ));
    END IF;
    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.normalize_vehicle_number() IS
    'Trigger: normalizes vehicle_number to uppercase alphanumeric. search_path hardened mig-024.';


-- 7d. normalize_trips_vehicle_number() - trips table variant
CREATE OR REPLACE FUNCTION public.normalize_trips_vehicle_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF NEW.vehicle_number IS NOT NULL THEN
        NEW.vehicle_number :=
            pg_catalog.upper(pg_catalog.regexp_replace(
                pg_catalog.btrim(NEW.vehicle_number),
                '[^A-Z0-9]', '', 'g'
            ));
    END IF;
    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.normalize_trips_vehicle_number() IS
    'Trigger: normalizes trips.vehicle_number. search_path hardened mig-024.';


-- 7e. is_vehicle_registered(text) - used in RLS policies
CREATE OR REPLACE FUNCTION public.is_vehicle_registered(p_vehicle_number text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.vehicles
        WHERE pg_catalog.upper(pg_catalog.btrim(vehicle_number))
            = pg_catalog.upper(pg_catalog.btrim(p_vehicle_number))
          AND is_active = true
    );
END;
$fn$;

COMMENT ON FUNCTION public.is_vehicle_registered(text) IS
    'Returns true if vehicle_number is registered and active. search_path hardened mig-024.';


-- =============================================================
-- 8. ADD push_token TO profiles (for Expo push notifications)
-- =============================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS push_token text;

COMMENT ON COLUMN public.profiles.push_token IS
    'Expo push notification token. Set by mobile app on login. '
    'Used by send-trip-notification Edge Function.';
-- =============================================================
-- 8. COMMIT
-- =============================================================

COMMIT;


-- =============================================================
-- MIGRATION 024 COMPLETE
--
-- POST-MIGRATION VERIFICATION QUERIES:
--
-- V024-1: Confirm checkpoints table exists
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'checkpoints';
--
-- V024-2: Confirm checkpoint_number column on trip_evidence
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'trip_evidence' AND column_name = 'checkpoint_number';
--
-- V024-3: Confirm backfill - each trip has 4 checkpoints
--   SELECT trip_id, COUNT(*) FROM public.checkpoints GROUP BY trip_id
--    HAVING COUNT(*) <> 4;
--   Expected: 0 rows (all trips have exactly 4)
--
-- V024-4: Test ordering enforcement
--   -- Try to submit CP2 before CP1 passes (should raise exception)
--   -- First get a trip_id: SELECT id FROM trips LIMIT 1;
--   UPDATE public.checkpoints SET status='submitted'
--    WHERE trip_id='<trip_id>' AND checkpoint_number=2;
--   Expected: ERROR '[GrainShield] Cannot submit CP2: CP1 must pass first'
--
-- V024-5: search_path hardened functions
--   SELECT proname, proconfig FROM pg_proc
--    WHERE proname IN (
--      'set_updated_at','update_updated_at',
--      'normalize_vehicle_number','normalize_trips_vehicle_number',
--      'is_vehicle_registered','enforce_checkpoint_order'
--    )
--    AND pronamespace = 'public'::regnamespace;
--   Expected: proconfig contains {search_path=} for all rows
--
-- STAGING INSTRUCTIONS:
--   1. Paste ENTIRE file into Supabase SQL Editor → Run once
--   2. Run V024-1 through V024-5 above
--   3. Test checkpoint ordering via admin UI
--   4. If all pass, apply to production
-- =============================================================
