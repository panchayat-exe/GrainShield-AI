-- Migration 020: Failed Jobs Dead-Letter Table
-- Captures AI worker errors for operator visibility and retry tracking
-- Safe to apply: creates new table only, no changes to existing tables

-- Failed jobs table
CREATE TABLE IF NOT EXISTS public.failed_jobs (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id     uuid          REFERENCES public.verification_results(id) ON DELETE SET NULL,
  trip_id             uuid          REFERENCES public.trips(id) ON DELETE SET NULL,
  error_message       text          NOT NULL,
  error_at            timestamptz   NOT NULL DEFAULT now(),
  retry_count         int           NOT NULL DEFAULT 0,
  last_retry_at       timestamptz,
  resolved_at         timestamptz,
  resolved_by         uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_note     text,
  worker_id           text,
  job_stage           text          -- e.g. 'claim', 'ai_call', 'update_status'
);

-- Indices
CREATE INDEX IF NOT EXISTS failed_jobs_trip_id_idx        ON public.failed_jobs(trip_id);
CREATE INDEX IF NOT EXISTS failed_jobs_verification_id_idx ON public.failed_jobs(verification_id);
CREATE INDEX IF NOT EXISTS failed_jobs_error_at_idx       ON public.failed_jobs(error_at DESC);
CREATE INDEX IF NOT EXISTS failed_jobs_resolved_at_idx    ON public.failed_jobs(resolved_at)
  WHERE resolved_at IS NULL; -- partial index: only unresolved rows

-- RLS: admins/officers can read; workers use service-role key to insert
ALTER TABLE public.failed_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Officers can view failed jobs"
  ON public.failed_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin', 'officer')
    )
  );

-- No INSERT/UPDATE RLS policy needed: worker uses service-role key (bypasses RLS)

COMMENT ON TABLE public.failed_jobs IS
  'Dead-letter queue for AI worker job failures. Rows are inserted by the worker on unrecoverable error.';
COMMENT ON COLUMN public.failed_jobs.retry_count IS
  'Number of times this job has been retried after initial failure.';
COMMENT ON COLUMN public.failed_jobs.resolved_at IS
  'NULL = unresolved. Set by officer when manually reconciled.';
COMMENT ON COLUMN public.failed_jobs.job_stage IS
  'The processing stage at which the failure occurred (claim, ai_call, status_update, etc.)';
