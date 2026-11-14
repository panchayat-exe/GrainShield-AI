-- =============================================================
-- Migration 021: Secure Failed Job Resolution RPC
-- GrainShield AI — AI Worker Reliability
--
-- Purpose:
--   Provides a narrowly-scoped, security-definer function
--   for officers to mark failed AI jobs as resolved.
--
--   Deliberately does NOT grant broad UPDATE access to the
--   failed_jobs table. All resolution is channelled through
--   this RPC, which:
--
--     1. Authenticates the caller.
--     2. Restricts to admin / super_admin / officer roles.
--     3. Rejects already-resolved jobs.
--     4. Sets ONLY resolved_at, resolved_by, resolution_note.
--     5. Writes an audit log entry.
--     6. Returns a typed JSONB result.
--
-- NO direct UPDATE RLS policy on failed_jobs is added.
-- The service-role key (AI worker) can still INSERT via
-- the existing bypass.
--
-- IDEMPOTENT: safe to run multiple times.
-- =============================================================

BEGIN;


-- =============================================================
-- 1. resolve_failed_job()
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
    -- ---------------------------------------------------------

    UPDATE public.failed_jobs
       SET resolved_at      = now(),
           resolved_by      = v_actor_id,
           resolution_note  = NULLIF(
               pg_catalog.btrim(COALESCE(p_resolution_note, '')),
               ''
           )
     WHERE id = p_job_id
       AND resolved_at IS NULL;   -- guard against race condition


    -- ---------------------------------------------------------
    -- E. AUDIT LOG
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
    'Idempotent guard: rejects already-resolved jobs. '
    'Writes an audit log entry.';


-- ---------------------------------------------------------
-- Revoke broad access; grant only to authenticated users.
-- Role check is enforced inside the function.
-- ---------------------------------------------------------

REVOKE ALL ON FUNCTION public.resolve_failed_job(uuid, text)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.resolve_failed_job(uuid, text)
  TO authenticated;


-- =============================================================
-- 2. COMMIT
-- =============================================================

COMMIT;


-- =============================================================
-- MIGRATION 021 COMPLETE
--
-- Verification query (run separately after applying):
--
--   SELECT proname, prosecdef, proconfig
--     FROM pg_proc
--     WHERE proname = 'resolve_failed_job'
--       AND pronamespace = 'public'::regnamespace;
--
-- Expected: prosecdef = true, proconfig = {search_path=}
-- =============================================================
