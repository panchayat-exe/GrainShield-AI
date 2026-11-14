-- =============================================================================
-- Migration 025 — citizen_create_trip() RPC, location columns, global trip_code uniqueness
-- =============================================================================
-- APPLY IN SUPABASE SQL EDITOR (once).
-- This migration:
--   1. Adds lat/lng columns to trips (IF NOT EXISTS — idempotent)
--   2. Adds commodity and quantity_kg columns (IF NOT EXISTS)
--   3. Adds a GLOBAL unique constraint on trip_code (replaces per-user one)
--   4. Creates citizen_create_trip() SECURITY DEFINER RPC
--      called by authenticated citizens — never exposes service-role key
-- =============================================================================

-- ── 1. Location columns ───────────────────────────────────────────────────────
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS origin_lat      double precision,
  ADD COLUMN IF NOT EXISTS origin_lng      double precision,
  ADD COLUMN IF NOT EXISTS destination_lat double precision,
  ADD COLUMN IF NOT EXISTS destination_lng double precision;

-- ── 2. Shipment detail columns ────────────────────────────────────────────────
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS commodity    text,
  ADD COLUMN IF NOT EXISTS quantity_kg  numeric(10,2);

-- ── 3. Global unique constraint on trip_code ──────────────────────────────────
-- The existing schema has UNIQUE(trip_code, created_by) — per-user.
-- We need a GLOBAL unique constraint so the system-generated code is globally
-- unique across all trips regardless of creator.
-- We drop the old one only if it exists, then add the global one.
DO $$
BEGIN
  -- Drop old per-user uniqueness if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trips_trip_code_created_by_key'
      AND conrelid = 'public.trips'::regclass
  ) THEN
    ALTER TABLE public.trips DROP CONSTRAINT trips_trip_code_created_by_key;
  END IF;

  -- Add global unique if not already present
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trips_trip_code_unique'
      AND conrelid = 'public.trips'::regclass
  ) THEN
    ALTER TABLE public.trips ADD CONSTRAINT trips_trip_code_unique UNIQUE (trip_code);
  END IF;
END;
$$;

-- ── 4. citizen_create_trip() RPC ──────────────────────────────────────────────
-- Drop and recreate so signature changes are applied cleanly.
DROP FUNCTION IF EXISTS public.citizen_create_trip(
  text, public.trip_stage, text, text,
  double precision, double precision, double precision, double precision,
  text, numeric
);

CREATE OR REPLACE FUNCTION public.citizen_create_trip(
  p_vehicle_number  text,
  p_stage           public.trip_stage,
  p_origin          text             DEFAULT NULL,
  p_destination     text             DEFAULT NULL,
  p_origin_lat      double precision DEFAULT NULL,
  p_origin_lng      double precision DEFAULT NULL,
  p_destination_lat double precision DEFAULT NULL,
  p_destination_lng double precision DEFAULT NULL,
  p_commodity       text             DEFAULT NULL,
  p_quantity_kg     numeric          DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_user_id    uuid;
  v_trip_code  text;
  v_trip_id    uuid;
  v_attempt    int := 0;
  v_max        int := 5;
BEGIN
  -- ── Auth guard ────────────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- ── Input validation ──────────────────────────────────────────────────────
  IF p_vehicle_number IS NULL OR trim(p_vehicle_number) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number is required');
  END IF;

  IF length(trim(p_vehicle_number)) < 4 OR length(trim(p_vehicle_number)) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number must be 4-20 characters');
  END IF;

  IF p_vehicle_number !~ '^[A-Za-z0-9 ]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number contains invalid characters');
  END IF;

  -- Coordinate range checks (nullable — only validate if provided)
  IF p_origin_lat IS NOT NULL AND (p_origin_lat < -90 OR p_origin_lat > 90) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Origin latitude out of range');
  END IF;
  IF p_origin_lng IS NOT NULL AND (p_origin_lng < -180 OR p_origin_lng > 180) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Origin longitude out of range');
  END IF;
  IF p_destination_lat IS NOT NULL AND (p_destination_lat < -90 OR p_destination_lat > 90) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Destination latitude out of range');
  END IF;
  IF p_destination_lng IS NOT NULL AND (p_destination_lng < -180 OR p_destination_lng > 180) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Destination longitude out of range');
  END IF;

  -- ── Retry loop for trip_code collision (extremely rare) ───────────────────
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max THEN
      RETURN jsonb_build_object('success', false, 'error', 'Could not generate a unique trip code — please try again');
    END IF;

    BEGIN
      -- Generate a system trip code using existing generator
      v_trip_code := public.generate_trip_code();

      INSERT INTO public.trips (
        trip_code,
        vehicle_number,
        stage,
        origin,
        destination,
        origin_lat,
        origin_lng,
        destination_lat,
        destination_lng,
        commodity,
        quantity_kg,
        created_by,
        status,
        created_at,
        updated_at
      ) VALUES (
        v_trip_code,
        upper(trim(p_vehicle_number)),
        p_stage,
        p_origin,
        p_destination,
        p_origin_lat,
        p_origin_lng,
        p_destination_lat,
        p_destination_lng,
        p_commodity,
        p_quantity_kg,
        v_user_id,
        'submitted',
        now(),
        now()
      )
      RETURNING id INTO v_trip_id;

      -- ── Audit log ──────────────────────────────────────────────────────────
      INSERT INTO public.audit_logs (
        trip_id,
        actor_id,
        action,
        details
      ) VALUES (
        v_trip_id,
        v_user_id,
        'citizen_trip_created',
        jsonb_build_object(
          'trip_code',       v_trip_code,
          'vehicle_number',  upper(trim(p_vehicle_number)),
          'stage',           p_stage,
          'origin',          p_origin,
          'destination',     p_destination,
          'has_coordinates', (p_origin_lat IS NOT NULL),
          'commodity',       p_commodity,
          'quantity_kg',     p_quantity_kg
        )
      );

      -- Success
      RETURN jsonb_build_object(
        'success',    true,
        'trip_id',    v_trip_id,
        'trip_code',  v_trip_code
      );

    EXCEPTION
      WHEN unique_violation THEN
        -- trip_code collision — loop and retry
        CONTINUE;
    END;
  END LOOP;
END;
$func$;

-- ── 5. Permissions ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.citizen_create_trip(
  text, public.trip_stage, text, text,
  double precision, double precision, double precision, double precision,
  text, numeric
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.citizen_create_trip(
  text, public.trip_stage, text, text,
  double precision, double precision, double precision, double precision,
  text, numeric
) FROM anon;

REVOKE ALL ON FUNCTION public.citizen_create_trip(
  text, public.trip_stage, text, text,
  double precision, double precision, double precision, double precision,
  text, numeric
) FROM service_role;

GRANT EXECUTE ON FUNCTION public.citizen_create_trip(
  text, public.trip_stage, text, text,
  double precision, double precision, double precision, double precision,
  text, numeric
) TO authenticated;

-- ── Post-migration verification ───────────────────────────────────────────────
-- Run these in Supabase SQL Editor to confirm success:
--
-- V025-1: Check new columns exist
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='trips'
--   AND column_name IN ('origin_lat','origin_lng','destination_lat','destination_lng','commodity','quantity_kg');
--   -- Expect 6 rows
--
-- V025-2: Check global unique constraint
--   SELECT conname FROM pg_constraint
--   WHERE conname = 'trips_trip_code_unique' AND conrelid = 'public.trips'::regclass;
--   -- Expect 1 row
--
-- V025-3: Check function exists
--   SELECT proname FROM pg_proc WHERE proname = 'citizen_create_trip';
--   -- Expect 1 row
--
-- V025-4: Check SECURITY DEFINER
--   SELECT prosecdef FROM pg_proc WHERE proname = 'citizen_create_trip';
--   -- Expect: t
--
-- V025-5: Check grants (authenticated only)
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_name = 'citizen_create_trip';
--   -- Expect: authenticated | EXECUTE only (no anon, no service_role, no PUBLIC)
