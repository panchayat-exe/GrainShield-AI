-- =============================================================================
-- Migration 027 — Fix audit_logs column reference in citizen_create_trip()
-- =============================================================================
-- SAFE TO APPLY TO PRODUCTION.
--
-- Problem:
--   Migration 025 created citizen_create_trip() with an INSERT into audit_logs
--   using column name "details", but the actual column is "metadata" (defined
--   in migration 001_core_schema.sql). This causes:
--     ERROR: column "details" of relation "audit_logs" does not exist
--   on every citizen trip submission.
--
-- Fix:
--   Use CREATE OR REPLACE FUNCTION to atomically replace the function body
--   with the corrected "metadata" column reference.
--   This does NOT require DROP FUNCTION and is safe to apply even if
--   migration 026 was partially or never applied.
--
-- No data is modified. No tables are altered.
-- =============================================================================

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
  v_user_id     uuid;
  v_user_role   public.user_role;
  v_trip_code   text;
  v_trip_id     uuid;
  v_attempt     int := 0;
  v_max         int := 5;
  v_is_driver   boolean := false;
BEGIN
  -- ── 1. Authentication Guard ──────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Authentication required. Please sign in.'
    );
  END IF;

  -- ── 2. Server-side Profile and Role Verification ─────────────────────────
  SELECT p.role INTO v_user_role
  FROM public.profiles AS p
  WHERE p.id = v_user_id;

  IF v_user_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Profile not found. Please complete profile setup before submitting trips.'
    );
  END IF;

  -- Reject administrative and officer roles
  IF v_user_role IN ('officer', 'admin', 'super_admin') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Administrative and inspection officers cannot create citizen trips.'
    );
  END IF;

  -- Ensure role is explicitly 'user' (citizen)
  IF v_user_role <> 'user' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Only registered citizens can submit citizen transport trips.'
    );
  END IF;

  -- ── 3. Driver Role Restriction ──────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.trips AS t
    WHERE t.driver_id = v_user_id
  ) INTO v_is_driver;

  IF v_is_driver THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Designated transport drivers cannot create citizen trips.'
    );
  END IF;

  -- ── 4. Input Validation ─────────────────────────────────────────────────
  IF p_vehicle_number IS NULL OR trim(p_vehicle_number) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number is required.');
  END IF;

  IF length(trim(p_vehicle_number)) < 4 OR length(trim(p_vehicle_number)) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number must be between 4 and 20 characters.');
  END IF;

  IF p_vehicle_number !~ '^[A-Za-z0-9 ]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number may only contain letters, digits, and spaces.');
  END IF;

  -- Geographic Coordinate Range Checks
  IF p_origin_lat IS NOT NULL AND (p_origin_lat < -90 OR p_origin_lat > 90) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Origin latitude out of range (-90 to 90)');
  END IF;
  IF p_origin_lng IS NOT NULL AND (p_origin_lng < -180 OR p_origin_lng > 180) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Origin longitude out of range (-180 to 180)');
  END IF;
  IF p_destination_lat IS NOT NULL AND (p_destination_lat < -90 OR p_destination_lat > 90) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Destination latitude out of range (-90 to 90)');
  END IF;
  IF p_destination_lng IS NOT NULL AND (p_destination_lng < -180 OR p_destination_lng > 180) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Destination longitude out of range (-180 to 180)');
  END IF;

  -- ── 5. Generation & Retry Loop for Unique Trip Code ──────────────────────
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Could not generate a unique trip code — sequence collision limit exceeded. Please retry.'
      );
    END IF;

    BEGIN
      -- Generate system-assigned GS-YYYY-NNNNNN code
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

      -- ── 6. Audit Trail Logging — uses correct column "metadata" ──────────
      --      (Migration 025 incorrectly used "details"; this is the fix.)
      INSERT INTO public.audit_logs (
        trip_id,
        actor_id,
        action,
        metadata                  -- ← CORRECT column name (was "details" in 025)
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
          'origin_lat',      p_origin_lat,
          'origin_lng',      p_origin_lng,
          'destination_lat', p_destination_lat,
          'destination_lng', p_destination_lng,
          'commodity',       p_commodity,
          'quantity_kg',     p_quantity_kg,
          'role_verified',   'user'
        )
      );

      -- Return successful result with auto-generated code
      RETURN jsonb_build_object(
        'success',    true,
        'trip_id',    v_trip_id,
        'trip_code',  v_trip_code
      );

    EXCEPTION
      WHEN unique_violation THEN
        -- Rare trip_code collision: loop and retry
        CONTINUE;
    END;
  END LOOP;
END;
$func$;

-- ── 7. Permissions ───────────────────────────────────────────────────────────
-- Restrict to authenticated users only (role check is done inside the function)
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

COMMENT ON FUNCTION public.citizen_create_trip IS
  'Secure citizen trip creation RPC (migration 027 fix). Enforces user role verification, '
  'prevents driver/admin misuse, generates GS-YYYY-NNNNNN Trip IDs, and correctly '
  'writes audit_logs.metadata (not the erroneous "details" column from migration 025).';
