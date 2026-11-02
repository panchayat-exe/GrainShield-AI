
-- GrainShield AI
-- Migration 011: Secure atomic verification job claiming

CREATE OR REPLACE FUNCTION public.claim_pending_verification(
    p_worker_id TEXT
)
RETURNS TABLE(
    id UUID,
    trip_id UUID,
    evidence_id UUID,
    expected_plate TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.verification_results AS vr
    SET
        status = 'processing',
        claimed_by = p_worker_id,
        claimed_at = NOW(),
        processing_started_at = NOW()
    WHERE vr.id = (
        SELECT vr2.id
        FROM public.verification_results AS vr2
        WHERE vr2.status = 'pending'
          AND vr2.retry_count < 3
        ORDER BY vr2.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING
        vr.id,
        vr.trip_id,
        vr.evidence_id,
        vr.expected_plate;
END;
$$;

-- Prevent anonymous and authenticated users from claiming jobs.
REVOKE ALL ON FUNCTION
    public.claim_pending_verification(TEXT)
FROM PUBLIC, anon, authenticated;

-- Only the trusted server-side worker can execute this function.
GRANT EXECUTE ON FUNCTION
    public.claim_pending_verification(TEXT)
TO service_role;
