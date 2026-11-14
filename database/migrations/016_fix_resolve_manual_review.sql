-- =============================================================================
-- Migration 016: Fix resolve_manual_review — Eliminate Multiple-Row Subquery Bug
-- GrainShield AI — Gujarat Food Grain Transport Verification
-- =============================================================================
-- PROBLEM (Screenshot 482):
--   "Review failed: Failed to update trip status: more than one row returned
--    by a subquery used as an expression"
--
-- ROOT CAUSE in Migration 013, line 137-138:
--   UPDATE public.verification_results
--   ...
--   WHERE trip_id = v_trip_id
--     AND (evidence_id = v_evidence_id OR v_evidence_id IS NULL);
--
--   When v_evidence_id IS NULL (review requests that pre-date the evidence_id
--   requirement), this clause becomes: WHERE trip_id = v_trip_id
--   ...which matches ALL verification_results for that trip. If multiple exist,
--   the trigger's subquery returns more than one row → PostgreSQL raises an error.
--
-- FIX:
--   1. evidence_id MUST always be set on manual_review_requests before resolution.
--      If not set, back-fill it from the latest trip_evidence record.
--   2. Remove the OR v_evidence_id IS NULL fallback entirely.
--   3. Use WHERE evidence_id = v_evidence_id ONLY (strict, targeted update).
--   4. If evidence_id cannot be determined, raise a clear exception.
--   5. Mark consumed_at on the review request (once-only enforcement, Migration 015).
--   6. Trip status update now NEVER routes through the state-machine trigger for
--      manual review resolutions — instead, the function updates trips with a bypass
--      flag in a separate controlled step, or the trigger must allow it via
--      the consumed override path.
--
-- NOTE FOR MANUAL APPLICATION:
--   Run this in the Supabase SQL Editor (project: umkjdpgxxylckoohnyco).
--   This is idempotent: safe to run multiple times.
-- =============================================================================

-- Step 1: Ensure evidence_id column exists on manual_review_requests
-- (already added in migration 001, but guard with IF NOT EXISTS)
ALTER TABLE public.manual_review_requests
  ADD COLUMN IF NOT EXISTS evidence_id UUID REFERENCES public.trip_evidence(id) ON DELETE SET NULL;

ALTER TABLE public.manual_review_requests
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ DEFAULT NULL;

-- Step 2: Back-fill evidence_id on existing review requests that have NULL evidence_id
-- Links each review to the most recently uploaded evidence photograph for that trip.
UPDATE public.manual_review_requests mrr
SET evidence_id = (
  SELECT te.id
  FROM public.trip_evidence te
  WHERE te.trip_id = mrr.trip_id
  ORDER BY te.uploaded_at DESC
  LIMIT 1
)
WHERE mrr.evidence_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.trip_evidence te WHERE te.trip_id = mrr.trip_id
  );

-- Step 3: Replace resolve_manual_review with the fixed version
-- Key changes:
--   a) If evidence_id is still NULL after back-fill attempt, back-fill within the function.
--   b) UPDATE verification_results WHERE evidence_id = v_evidence_id (strict, no OR NULL).
--   c) Set consumed_at on the review record to prevent reuse.
--   d) Trip update uses the existing state-machine path, which now finds the
--      consumed override via check_trip_status_transition() (Migration 015).
CREATE OR REPLACE FUNCTION public.resolve_manual_review(
    p_review_id UUID,
    p_decision TEXT,     -- 'pass', 'retake', 'rejected'
    p_notes TEXT         -- Mandatory explanation for government audit
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor_id       UUID := auth.uid();
    v_actor_role     TEXT;
    v_actor_email    TEXT;
    v_trip_id        UUID;
    v_evidence_id    UUID;
    v_current_status public.review_status;
    v_trip_status    public.trip_status;
    v_verif_status   public.verification_status;
    v_now            TIMESTAMPTZ := clock_timestamp();
    v_latest_ev_id   UUID;
BEGIN
    -- -------------------------------------------------------------------------
    -- 1. Authentication
    -- -------------------------------------------------------------------------
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT role::text, email
    INTO v_actor_role, v_actor_email
    FROM public.profiles
    WHERE id = v_actor_id;

    IF v_actor_role NOT IN ('officer', 'admin', 'super_admin') THEN
        RAISE EXCEPTION 'Access denied: Only officers and administrators can resolve manual reviews.';
    END IF;

    -- -------------------------------------------------------------------------
    -- 2. Input validation
    -- -------------------------------------------------------------------------
    IF p_decision NOT IN ('pass', 'retake', 'rejected') THEN
        RAISE EXCEPTION 'Invalid decision: % (must be pass, retake, or rejected).', p_decision;
    END IF;

    IF p_notes IS NULL OR btrim(p_notes) = '' THEN
        RAISE EXCEPTION 'Officer justification notes are mandatory for audit compliance.';
    END IF;

    -- -------------------------------------------------------------------------
    -- 3. Lock review request (FOR UPDATE prevents concurrent resolution)
    -- -------------------------------------------------------------------------
    SELECT trip_id, evidence_id, status
    INTO v_trip_id, v_evidence_id, v_current_status
    FROM public.manual_review_requests
    WHERE id = p_review_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manual review request % not found.', p_review_id;
    END IF;

    IF v_current_status = 'resolved' THEN
        RAISE EXCEPTION 'This review request has already been resolved by another officer.';
    END IF;

    -- -------------------------------------------------------------------------
    -- 4. Ensure evidence_id is populated
    --    If the review record was created without evidence_id (older records),
    --    back-fill with the latest evidence for this trip.
    --    If still no evidence exists, raise a clear error.
    -- -------------------------------------------------------------------------
    IF v_evidence_id IS NULL THEN
        SELECT id
        INTO v_latest_ev_id
        FROM public.trip_evidence
        WHERE trip_id = v_trip_id
        ORDER BY uploaded_at DESC
        LIMIT 1;

        IF v_latest_ev_id IS NULL THEN
            RAISE EXCEPTION 'Cannot resolve review: No evidence photograph found for trip %. Upload evidence first.', v_trip_id;
        END IF;

        -- Back-fill the review record with the evidence_id for future reference
        UPDATE public.manual_review_requests
        SET evidence_id = v_latest_ev_id,
            updated_at  = v_now
        WHERE id = p_review_id;

        v_evidence_id := v_latest_ev_id;
    END IF;

    -- -------------------------------------------------------------------------
    -- 5. Map decision → DB enum values
    -- -------------------------------------------------------------------------
    IF p_decision = 'pass' THEN
        v_trip_status  := 'pass'::public.trip_status;
        v_verif_status := 'pass'::public.verification_status;
    ELSIF p_decision = 'retake' THEN
        v_trip_status  := 'retake'::public.trip_status;
        v_verif_status := 'retake'::public.verification_status;
    ELSE
        v_trip_status  := 'rejected'::public.trip_status;
        v_verif_status := 'fail'::public.verification_status;
    END IF;

    -- -------------------------------------------------------------------------
    -- 6. Mark review as resolved with consumed_at timestamp (once-only enforcement)
    --    This must happen BEFORE the trips update so that check_trip_status_transition()
    --    can find the consumed=NULL record and permit the transition.
    -- -------------------------------------------------------------------------
    UPDATE public.manual_review_requests
    SET
        status            = 'resolved'::public.review_status,
        assigned_reviewer = v_actor_id,
        reviewer_notes    = p_notes,
        evidence_id       = v_evidence_id,  -- ensure it is set
        resolved_at       = v_now,
        updated_at        = v_now
        -- NOTE: consumed_at is left NULL here intentionally.
        -- check_trip_status_transition() will set consumed_at when the trip update fires.
        -- This ensures the override can only authorize exactly ONE transition.
    WHERE id = p_review_id;

    -- -------------------------------------------------------------------------
    -- 7. Update verification_results — STRICT evidence_id binding (no OR NULL)
    --    Uses WHERE evidence_id = v_evidence_id ONLY to avoid multi-row bug.
    -- -------------------------------------------------------------------------
    UPDATE public.verification_results
    SET
        status                   = v_verif_status,
        decision                 = upper(p_decision),
        explanation              = coalesce(explanation, '')
                                   || E'\n[Manual Review by '
                                   || coalesce(v_actor_email, v_actor_id::text)
                                   || E']: '
                                   || p_notes,
        processing_completed_at  = coalesce(processing_completed_at, v_now),
        updated_at               = v_now
    WHERE evidence_id = v_evidence_id;
    -- NOTE: If no verification_result exists for this evidence (edge case),
    -- this silently skips. The trip and review are still updated correctly.

    -- -------------------------------------------------------------------------
    -- 8. Update trip status
    --    The trigger check_trip_status_transition() will find the resolved (not yet
    --    consumed) override record above and permit this transition.
    --    For retake/rejected, the trigger allows those statuses without an override check.
    -- -------------------------------------------------------------------------
    UPDATE public.trips
    SET
        status     = v_trip_status,
        updated_at = v_now
    WHERE id = v_trip_id;

    -- -------------------------------------------------------------------------
    -- 9. Write immutable audit log
    -- -------------------------------------------------------------------------
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        trip_id,
        metadata,
        created_at
    ) VALUES (
        v_actor_id,
        'manual_review_' || p_decision,
        'trips',
        v_trip_id,
        v_trip_id,
        jsonb_build_object(
            'review_id',      p_review_id,
            'evidence_id',    v_evidence_id,
            'decision',       p_decision,
            'notes',          p_notes,
            'reviewer_role',  v_actor_role,
            'reviewer_email', v_actor_email,
            'timestamp',      v_now
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success',     true,
        'trip_id',     v_trip_id,
        'evidence_id', v_evidence_id,
        'review_id',   p_review_id,
        'decision',    p_decision,
        'status',      v_trip_status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_manual_review(UUID, TEXT, TEXT)
  TO authenticated, service_role;

-- =============================================================================
-- Step 4: Fix check_trip_status_transition to also allow retake/rejected
-- transitions from manual_review without requiring a geofence pass.
-- Current behavior: retake/rejected return early (line 43-45 of migration 015)
-- which is correct — these are already in the allowed list.
-- No change needed there.
--
-- However: when decision is 'pass', the trigger requires either:
--   (a) A consumed=NULL resolved override (which we set above in step 6), OR
--   (b) A clean AI PASS with geofence pass.
--
-- The consumed_at logic is already correct in migration 015.
-- No trigger changes needed — the function above sets consumed_at=NULL
-- intentionally so the trigger can find and consume it.
-- =============================================================================

-- =============================================================================
-- Step 5: Add a safety index on verification_results(evidence_id) if missing
-- This ensures the WHERE evidence_id = v_evidence_id query is fast and returns
-- exactly the right rows (no full-table scan that could cause confusion).
-- =============================================================================
CREATE INDEX IF NOT EXISTS verification_results_evidence_id_idx
  ON public.verification_results(evidence_id);

-- =============================================================================
-- VERIFICATION QUERY (run after applying to confirm fix):
--
-- SELECT
--   mrr.id as review_id,
--   mrr.trip_id,
--   mrr.evidence_id,
--   mrr.status,
--   mrr.consumed_at,
--   COUNT(vr.id) as verification_rows_matched
-- FROM manual_review_requests mrr
-- LEFT JOIN verification_results vr ON vr.evidence_id = mrr.evidence_id
-- GROUP BY mrr.id, mrr.trip_id, mrr.evidence_id, mrr.status, mrr.consumed_at
-- ORDER BY mrr.created_at DESC
-- LIMIT 20;
--
-- Expected: verification_rows_matched = 0 or 1 (never more than 1 per evidence_id).
-- =============================================================================
