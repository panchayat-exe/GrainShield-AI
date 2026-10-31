-- Migration 009: Atomic job claiming for AI worker + failed job tracking
-- This uses SELECT FOR UPDATE SKIP LOCKED to prevent multiple workers
-- processing the same verification job simultaneously.

-- Add worker tracking columns to verification_results
ALTER TABLE verification_results
  ADD COLUMN IF NOT EXISTS claimed_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- Function for atomic job claiming (prevents race condition between workers)
-- Workers call this RPC instead of direct SELECT to get exclusive job ownership.
CREATE OR REPLACE FUNCTION claim_pending_verification(p_worker_id TEXT)
RETURNS TABLE(
  id UUID,
  trip_id UUID,
  evidence_id UUID,
  expected_plate TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE verification_results vr
  SET
    status = 'processing',
    claimed_by = p_worker_id,
    claimed_at = NOW(),
    processing_started_at = NOW()
  WHERE vr.id = (
    SELECT vr2.id
    FROM verification_results vr2
    WHERE vr2.status = 'pending'
      AND (vr2.retry_count < 3)
    ORDER BY vr2.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING vr.id, vr.trip_id, vr.evidence_id, vr.expected_plate;
END;
$$;

-- Grant execution to service_role (worker uses service role key)
GRANT EXECUTE ON FUNCTION claim_pending_verification(TEXT) TO service_role;

-- Index to support the claim query
CREATE INDEX IF NOT EXISTS idx_verification_results_pending_claim
  ON verification_results(status, retry_count, created_at)
  WHERE status = 'pending';

-- View: failed verifications for monitoring
CREATE OR REPLACE VIEW failed_verifications AS
SELECT
  id,
  trip_id,
  evidence_id,
  status,
  failure_reason,
  retry_count,
  failed_at,
  created_at
FROM verification_results
WHERE status = 'error' OR (status = 'pending' AND retry_count >= 3)
ORDER BY failed_at DESC NULLS LAST, created_at DESC;

COMMENT ON FUNCTION claim_pending_verification IS
  'Atomically claims one pending verification job for a worker. Uses FOR UPDATE SKIP LOCKED to prevent race conditions between multiple workers.';