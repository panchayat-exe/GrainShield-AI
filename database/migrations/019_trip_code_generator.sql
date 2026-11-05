-- =============================================================
-- Migration 019: Server-side Trip Code Generator
-- GrainShield AI — Phase 2: Automatic Trip Generation
--
-- FEATURES:
-- 1. Global monotonically increasing trip-code sequence
-- 2. GS-YYYY-NNNNNN trip-code generation
-- 3. Driver assignment column and foreign key
-- 4. Global trip-code uniqueness
-- 5. Secure admin_dispatch_trip() RPC
-- 6. Secure get_driver_profiles() RPC
-- 7. Audit logging
--
-- IDEMPOTENT: Designed to be safely re-executed.
--
-- IMPORTANT:
-- Test on staging before production.
-- Existing duplicate trip codes will abort the migration.
-- =============================================================

BEGIN;

-- =============================================================
-- 0. PREFLIGHT: CHECK DUPLICATE TRIP CODES
-- =============================================================

DO $preflight$
DECLARE
    v_duplicate_groups bigint;
BEGIN
    SELECT COUNT(*)
      INTO v_duplicate_groups
      FROM (
          SELECT trip_code
            FROM public.trips
           WHERE trip_code IS NOT NULL
           GROUP BY trip_code
          HAVING COUNT(*) > 1
      ) duplicates;

    IF v_duplicate_groups > 0 THEN
        RAISE EXCEPTION
            '[migration-019] ABORTED: % duplicate trip_code groups found. Resolve duplicates before applying this migration.',
            v_duplicate_groups;
    END IF;
END;
$preflight$;

-- =============================================================
-- 1. CREATE TRIP CODE SEQUENCE
-- =============================================================

CREATE SEQUENCE IF NOT EXISTS public.trip_code_seq
    START WITH 100001
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.trip_code_seq
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE;

-- =============================================================
-- 2. SYNCHRONIZE SEQUENCE WITH EXISTING TRIP CODES
-- =============================================================

DO $sequence_sync$
DECLARE
    v_max_existing_suffix numeric;
    v_last_value bigint;
    v_is_called boolean;
    v_actual_next numeric;
    v_required_next numeric;
    v_max_bigint constant numeric := 9223372036854775807;
BEGIN

    SELECT COALESCE(
        MAX(
            (
                pg_catalog.regexp_match(
                    pg_catalog.upper(t.trip_code),
                    '^GS-[0-9]{4}-([0-9]+)$'
                )
            )[1]::numeric
        ),
        100000::numeric
    )
    INTO v_max_existing_suffix
    FROM public.trips AS t
    WHERE pg_catalog.upper(t.trip_code)
          ~ '^GS-[0-9]{4}-[0-9]+$';

    SELECT last_value, is_called
      INTO v_last_value, v_is_called
      FROM public.trip_code_seq;

    v_actual_next :=
        CASE
            WHEN v_is_called
                THEN v_last_value::numeric + 1
            ELSE v_last_value::numeric
        END;

    v_required_next :=
        GREATEST(
            v_max_existing_suffix + 1,
            100001::numeric
        );

    IF v_required_next > v_max_bigint THEN
        RAISE EXCEPTION
            '[migration-019] Existing trip codes exceed sequence capacity.';
    END IF;

    IF v_actual_next > v_max_bigint THEN
        RAISE EXCEPTION
            '[migration-019] Trip-code sequence has reached maximum capacity.';
    END IF;

    IF v_actual_next < v_required_next THEN
        PERFORM pg_catalog.setval(
            'public.trip_code_seq'::regclass,
            (v_required_next - 1)::bigint,
            true
        );
    END IF;

END;
$sequence_sync$;

REVOKE ALL ON SEQUENCE public.trip_code_seq
FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================
-- 3. CREATE generate_trip_code()
-- =============================================================

CREATE OR REPLACE FUNCTION public.generate_trip_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_year text;
    v_seq text;
BEGIN

    v_year := pg_catalog.to_char(
        pg_catalog.now(),
        'YYYY'
    );

    v_seq := pg_catalog.nextval(
        'public.trip_code_seq'::regclass
    )::text;

    IF pg_catalog.length(v_seq) < 6 THEN
        v_seq := pg_catalog.lpad(v_seq, 6, '0');
    END IF;

    RETURN 'GS-' || v_year || '-' || v_seq;

END;
$function$;

COMMENT ON FUNCTION public.generate_trip_code() IS
    'Generates a globally sequenced trip code in GS-YYYY-NNNNNN format.';

REVOKE ALL ON FUNCTION public.generate_trip_code()
FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================
-- 4. ADD driver_id COLUMN TO trips
-- =============================================================

ALTER TABLE public.trips
    ADD COLUMN IF NOT EXISTS driver_id uuid;

DO $driver_fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.trips'::regclass
          AND conname = 'trips_driver_id_fkey'
    ) THEN
        ALTER TABLE public.trips
            ADD CONSTRAINT trips_driver_id_fkey
            FOREIGN KEY (driver_id)
            REFERENCES public.profiles(id)
            ON DELETE SET NULL;
    END IF;
END;
$driver_fk$;

CREATE INDEX IF NOT EXISTS trips_driver_id_idx
    ON public.trips(driver_id);

COMMENT ON COLUMN public.trips.driver_id IS
    'UUID of assigned driver profile. NULL for legacy or unassigned trips.';

-- =============================================================
-- 5. UPGRADE TO GLOBAL TRIP CODE UNIQUENESS
-- =============================================================

DO $uniqueness$
DECLARE
    v_constraint_definition text;
BEGIN

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'trips_trip_code_created_by_key'
          AND conrelid = 'public.trips'::regclass
    ) THEN
        ALTER TABLE public.trips
            DROP CONSTRAINT trips_trip_code_created_by_key;
        RAISE NOTICE
            '[migration-019] Removed per-creator trip-code constraint.';
    END IF;

    SELECT pg_catalog.pg_get_constraintdef(oid)
    INTO v_constraint_definition
    FROM pg_constraint
    WHERE conname = 'trips_trip_code_unique'
      AND conrelid = 'public.trips'::regclass;

    IF FOUND THEN
        IF v_constraint_definition <> 'UNIQUE (trip_code)' THEN
            RAISE EXCEPTION
                '[migration-019] Existing trips_trip_code_unique constraint has unexpected definition: %',
                v_constraint_definition;
        END IF;
        RAISE NOTICE
            '[migration-019] Global trip-code uniqueness already exists.';
    ELSE
        ALTER TABLE public.trips
            ADD CONSTRAINT trips_trip_code_unique
            UNIQUE (trip_code);
        RAISE NOTICE
            '[migration-019] Global trip-code uniqueness created.';
    END IF;

END;
$uniqueness$;

-- =============================================================
-- 6. CREATE admin_dispatch_trip()
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_dispatch_trip(
    p_vehicle_number text,
    p_driver_id uuid DEFAULT NULL,
    p_driver_name text DEFAULT NULL,
    p_driver_phone text DEFAULT NULL,
    p_stage text DEFAULT 'first_mile',
    p_origin text DEFAULT NULL,
    p_destination text DEFAULT NULL,
    p_trip_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$

DECLARE

    v_actor_id uuid;
    v_actor_role public.user_role;

    v_trip_code text;
    v_trip_id uuid;

    v_clean_plate text;

    v_driver_name text;
    v_driver_phone text;

    v_auto_generated boolean;
    v_constraint_name text;

BEGIN

    v_actor_id := auth.uid();

    IF v_actor_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Not authenticated'
        );
    END IF;

    SELECT p.role
    INTO v_actor_role
    FROM public.profiles AS p
    WHERE p.id = v_actor_id;

    IF v_actor_role IS NULL
       OR v_actor_role NOT IN ('admin', 'super_admin') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Only administrators can dispatch trips'
        );
    END IF;

    v_clean_plate :=
        pg_catalog.regexp_replace(
            pg_catalog.upper(COALESCE(p_vehicle_number, '')),
            '[^A-Z0-9]', '', 'g'
        );

    IF v_clean_plate IS NULL
       OR pg_catalog.length(v_clean_plate) < 5 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid vehicle registration number'
        );
    END IF;

    IF p_stage IS NULL
       OR p_stage NOT IN ('first_mile', 'mid_mile', 'last_mile') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid stage value'
        );
    END IF;

    IF p_driver_id IS NOT NULL THEN
        SELECT p.full_name, p.phone
        INTO v_driver_name, v_driver_phone
        FROM public.profiles AS p
        WHERE p.id = p_driver_id
          AND p.role = 'user';

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Selected driver does not exist or is not an eligible user'
            );
        END IF;
    ELSE
        v_driver_name :=
            NULLIF(pg_catalog.btrim(COALESCE(p_driver_name, '')), '');
        v_driver_phone :=
            NULLIF(pg_catalog.btrim(COALESCE(p_driver_phone, '')), '');
    END IF;

    v_auto_generated :=
        (p_trip_code IS NULL
         OR pg_catalog.length(pg_catalog.btrim(p_trip_code)) = 0);

    IF v_auto_generated THEN
        v_trip_code := public.generate_trip_code();
    ELSE
        v_trip_code := pg_catalog.btrim(p_trip_code);

        IF EXISTS (
            SELECT 1 FROM public.trips AS t
            WHERE t.trip_code = v_trip_code
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',
                pg_catalog.format(
                    'Trip code %s already exists. Leave blank for auto-generation.',
                    v_trip_code
                )
            );
        END IF;
    END IF;

    BEGIN

        INSERT INTO public.trips (
            trip_code, vehicle_number, driver_id,
            driver_name, driver_phone,
            stage, origin, destination,
            created_by, assigned_to, status
        )
        VALUES (
            v_trip_code, v_clean_plate, p_driver_id,
            v_driver_name, v_driver_phone,
            p_stage::public.trip_stage,
            NULLIF(pg_catalog.btrim(COALESCE(p_origin, '')), ''),
            NULLIF(pg_catalog.btrim(COALESCE(p_destination, '')), ''),
            v_actor_id, p_driver_id, 'submitted'
        )
        RETURNING id INTO v_trip_id;

    EXCEPTION
        WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS
                v_constraint_name = CONSTRAINT_NAME;

            IF v_constraint_name = 'trips_trip_code_unique' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error',
                    pg_catalog.format(
                        'Trip code %s was just claimed by another request. Please retry.',
                        v_trip_code
                    )
                );
            END IF;

            RAISE;
    END;

    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, trip_id, metadata
    )
    VALUES (
        v_actor_id,
        'trip_dispatched',
        'trips',
        v_trip_id,
        v_trip_id,
        jsonb_build_object(
            'trip_code', v_trip_code,
            'vehicle_number', v_clean_plate,
            'stage', p_stage,
            'driver_id', p_driver_id,
            'origin', p_origin,
            'destination', p_destination,
            'auto_generated', v_auto_generated
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', v_trip_id,
        'trip_code', v_trip_code,
        'vehicle', v_clean_plate,
        'stage', p_stage,
        'driver_id', p_driver_id,
        'auto_generated', v_auto_generated
    );

END;

$function$;

COMMENT ON FUNCTION public.admin_dispatch_trip(
    text, uuid, text, text, text, text, text, text
) IS
    'Creates a new trip with a globally unique auto-generated trip code. '
    'Only admin and super_admin roles may dispatch trips.';

REVOKE ALL ON FUNCTION public.admin_dispatch_trip(
    text, uuid, text, text, text, text, text, text
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_dispatch_trip(
    text, uuid, text, text, text, text, text, text
)
TO authenticated;

-- =============================================================
-- 7. CREATE get_driver_profiles()
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_driver_profiles(
    p_search text DEFAULT ''
)
RETURNS TABLE (
    id uuid,
    full_name text,
    email text,
    phone text,
    district text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$

    SELECT
        p.id,
        p.full_name,
        p.email,
        p.phone,
        p.district

    FROM public.profiles AS p

    WHERE p.role = 'user'

      AND EXISTS (
          SELECT 1
          FROM public.profiles AS actor
          WHERE actor.id = auth.uid()
            AND actor.role IN ('admin', 'super_admin')
      )

      AND (
          pg_catalog.btrim(COALESCE(p_search, '')) = ''
          OR p.full_name ILIKE
              '%' || pg_catalog.btrim(COALESCE(p_search, '')) || '%'
          OR p.email ILIKE
              '%' || pg_catalog.btrim(COALESCE(p_search, '')) || '%'
          OR p.phone ILIKE
              '%' || pg_catalog.btrim(COALESCE(p_search, '')) || '%'
      )

    ORDER BY p.full_name ASC NULLS LAST

    LIMIT 50;

$function$;

COMMENT ON FUNCTION public.get_driver_profiles(text) IS
    'Returns up to 50 user-role profiles for the admin trip-creation '
    'driver dropdown. Only administrator roles can retrieve records.';

REVOKE ALL ON FUNCTION public.get_driver_profiles(text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_driver_profiles(text)
TO authenticated;

-- =============================================================
-- 8. COMMIT
-- =============================================================

COMMIT;

-- =============================================================
-- MIGRATION 019 COMPLETE
-- =============================================================
