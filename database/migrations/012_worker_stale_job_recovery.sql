
-- GrainShield AI
-- Migration 012: Recover jobs abandoned by crashed workers.
-- Policy: 5-minute stale threshold, 3 retries after initial attempt.

CREATE OR REPLACE FUNCTION public.claim_pending_verification(
    p_worker_id TEXT
)
RETURNS TABLE (
    id UUID,
    trip_id UUID,
    evidence_id UUID,
    expected_plate TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
        RAISE EXCEPTION 'Worker ID is required';
    END IF;

    -- Requeue stale jobs. After 3 retries, mark them as errors.
    WITH stale AS (
        UPDATE public.verification_results AS vr
        SET
            status = CASE
                WHEN vr.retry_count >= 3
                    THEN 'error'::public.verification_status
                ELSE 'pending'::public.verification_status
            END,
            retry_count = vr.retry_count + 1,
            claimed_by = NULL,
            claimed_at = NULL,
            failed_at = CASE
                WHEN vr.retry_count >= 3 THEN v_now
                ELSE NULL
            END,
            failure_reason = CASE
                WHEN vr.retry_count >= 3
                    THEN 'Worker repeatedly failed to complete this job.'
                ELSE NULL
            END,
            explanation = CASE
                WHEN vr.retry_count >= 3
                    THEN 'Automatic retries exhausted after worker timeout.'
                ELSE vr.explanation
            END,
            processing_completed_at = CASE
                WHEN vr.retry_count >= 3 THEN v_now
                ELSE NULL
            END
        WHERE vr.status = 'processing'
          AND COALESCE(
              vr.claimed_at,
              vr.processing_started_at,
              vr.created_at
          ) < v_now - INTERVAL '5 minutes'
        RETURNING
            vr.id,
            vr.trip_id,
            vr.status,
            vr.retry_count,
            vr.failure_reason
    )
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        trip_id,
        metadata
    )
    SELECT
        NULL,
        'verification_completed',
        'verification_results',
        s.id,
        s.trip_id,
        jsonb_build_object(
            'recovery', true,
            'status', s.status,
            'retry_count', s.retry_count,
            'reason', s.failure_reason,
            'recovered_at', v_now
        )
    FROM stale AS s;

    -- Atomically claim the oldest eligible pending job.
    RETURN QUERY
    UPDATE public.verification_results AS vr
    SET
        status = 'processing',
        claimed_by = p_worker_id,
        claimed_at = v_now,
        processing_started_at = v_now
    WHERE vr.id = (
        SELECT vr2.id
        FROM public.verification_results AS vr2
        WHERE vr2.status = 'pending'
          AND vr2.retry_count <= 3
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

-- Preserve server-only execution permissions.
REVOKE ALL ON FUNCTION
    public.claim_pending_verification(TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.claim_pending_verification(TEXT)
TO service_role;
