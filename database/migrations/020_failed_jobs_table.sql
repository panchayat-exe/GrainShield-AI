-- =============================================================
-- Migration 020: Failed Jobs Dead-Letter Table
-- GrainShield AI — AI Worker Reliability
--
-- Purpose:
--   Capture AI worker failures for operator visibility
--   and retry tracking.
--
-- Idempotent:
--   Safe to execute multiple times.
--   Uses DROP POLICY IF EXISTS before CREATE POLICY
--   to prevent 42710 "already exists" errors on re-run.
--
-- Existing application tables are not modified.
-- =============================================================

BEGIN;

-- =============================================================
-- 1. CREATE FAILED JOBS TABLE
-- =============================================================

CREATE TABLE IF NOT EXISTS public.failed_jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    verification_id     uuid
        REFERENCES public.verification_results(id)
        ON DELETE SET NULL,

    trip_id             uuid
        REFERENCES public.trips(id)
        ON DELETE SET NULL,

    error_message       text NOT NULL,

    error_at            timestamptz NOT NULL DEFAULT now(),

    retry_count         int NOT NULL DEFAULT 0,

    last_retry_at       timestamptz,

    resolved_at         timestamptz,

    resolved_by         uuid
        REFERENCES public.profiles(id)
        ON DELETE SET NULL,

    resolution_note     text,

    worker_id           text,

    job_stage           text
);

-- =============================================================
-- 2. CREATE INDEXES
-- =============================================================

CREATE INDEX IF NOT EXISTS failed_jobs_trip_id_idx
    ON public.failed_jobs(trip_id);

CREATE INDEX IF NOT EXISTS failed_jobs_verification_id_idx
    ON public.failed_jobs(verification_id);

CREATE INDEX IF NOT EXISTS failed_jobs_error_at_idx
    ON public.failed_jobs(error_at DESC);

CREATE INDEX IF NOT EXISTS failed_jobs_unresolved_idx
    ON public.failed_jobs(error_at DESC)
    WHERE resolved_at IS NULL;

-- =============================================================
-- 3. ENABLE ROW LEVEL SECURITY
-- =============================================================

ALTER TABLE public.failed_jobs
    ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 4. RECREATE OFFICER READ POLICY
--    DROP POLICY IF EXISTS prevents ERROR 42710 on re-run.
-- =============================================================

DROP POLICY IF EXISTS
    "Officers can view failed jobs"
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

-- =============================================================
-- 5. TABLE PERMISSIONS
-- =============================================================

GRANT SELECT ON TABLE public.failed_jobs
TO authenticated;

-- The AI worker uses the Supabase service-role key.
-- Service role bypasses RLS, subject to its database privileges.

-- =============================================================
-- 6. DOCUMENTATION
-- =============================================================

COMMENT ON TABLE public.failed_jobs IS
    'Dead-letter queue for AI worker job failures. '
    'Rows are inserted by the worker on unrecoverable errors.';

COMMENT ON COLUMN public.failed_jobs.retry_count IS
    'Number of times this job has been retried after initial failure.';

COMMENT ON COLUMN public.failed_jobs.resolved_at IS
    'NULL means unresolved. Set when an operator manually reconciles the failure.';

COMMENT ON COLUMN public.failed_jobs.job_stage IS
    'Processing stage at which failure occurred: claim, ai_call, status_update, etc.';

COMMENT ON COLUMN public.failed_jobs.worker_id IS
    'Identifier of the AI worker instance that encountered the failure.';

COMMENT ON COLUMN public.failed_jobs.resolution_note IS
    'Optional explanation of how the failed job was reconciled.';

-- =============================================================
-- 7. COMMIT
-- =============================================================

COMMIT;

-- =============================================================
-- MIGRATION 020 COMPLETE
-- =============================================================
