-- =============================================================================
-- Migration 026 — Role Restriction on citizen_create_trip() RPC
-- =============================================================================
-- REVIEW ONLY — DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT AUTHORIZATION.
--
-- Objective:
--   Enforce strict server-side role and authorization checks inside the
--   citizen_create_trip() SECURITY DEFINER function.
--
-- Verification Rules:
--   1. Unauthenticated callers (auth.uid() IS NULL) -> REJECTED.
--   2. Caller without an active profile record -> REJECTED.
--   3. Caller with role IN ('officer', 'admin', 'super_admin') -> REJECTED.
--      (Administrative and inspection roles must dispatch or inspect via admin portal).
--   4. Caller designated or currently assigned as a transport driver -> REJECTED.
--      (Drivers operate strictly on trips dispatched by administrators).
--   5. Only registered citizens with role = 'user' who are not designated drivers
--      may create citizen transport trips.
--   6. Backend auto-generation of GS-YYYY-NNNNNN Trip IDs is preserved.
--   7. Global uniqueness retry loop (up to 5 attempts) is preserved.
--   8. Full audit logging is preserved.
-- =============================================================================

-- Drop and recreate the function with identical signature to ensure clean upgrade
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
  v_user_id     uuid;
  v_user_role   public.user_role;
  v_trip_code   text;
  v_trip_id     uuid;
  v_attempt     int := 0;
  v_max         int := 5;
  v_is_driver   boolean := false;
BEGIN
  -- ── 1. Authentication Guard ────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Authentication required. Please sign in.'
    );
  END IF;

  -- ── 2. Server-side Profile and Role Verification ───────────────────────────
  -- Never trust frontend headers or claims; verify directly from public.profiles
  SELECT p.role INTO v_user_role
  FROM public.profiles AS p
  WHERE p.id = v_user_id;

  IF v_user_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Profile not found. Please complete profile setup before submitting trips.'
    );
  END IF;

  -- Reject administrative and officer roles from submitting citizen trips
  IF v_user_role IN ('officer', 'admin', 'super_admin') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Administrative and inspection officers cannot create citizen trips. Use the official Admin Dispatch portal.'
    );
  END IF;

  -- Ensure role is explicitly 'user' (citizen)
  IF v_user_role <> 'user' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Only registered citizens can submit citizen transport trips.'
    );
  END IF;

  -- ── 3. Driver Role Restriction ─────────────────────────────────────────────
  -- Check if caller is designated or active as a transport driver on any trip
  SELECT EXISTS (
    SELECT 1 FROM public.trips AS t
    WHERE t.driver_id = v_user_id
  ) INTO v_is_driver;

  IF v_is_driver THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Designated transport drivers cannot create citizen trips. Drivers must only operate on trips dispatched by administrators.'
    );
  END IF;

  -- ── 4. Input Validation ────────────────────────────────────────────────────
  IF p_vehicle_number IS NULL OR trim(p_vehicle_number) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number is required');
  END IF;

  IF length(trim(p_vehicle_number)) < 4 OR length(trim(p_vehicle_number)) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number must be 4-20 characters');
  END IF;

  IF p_vehicle_number !~ '^[A-Za-z0-9 ]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle number contains invalid characters');
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

  -- ── 5. Generation & Retry Loop for Unique Trip Code ────────────────────────
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

      -- ── 6. Audit Trail Logging ─────────────────────────────────────────────
      INSERT INTO public.audit_logs (
        trip_id,
        actor_id,
        action,
        metadata
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

-- ── 7. Permissions and Isolation ─────────────────────────────────────────────
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
  'Secure citizen trip creation RPC. Enforces user role verification, prevents driver/admin misuse, and generates GS-YYYY-NNNNNN Trip IDs.';
