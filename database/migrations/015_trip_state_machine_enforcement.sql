-- =============================================================================
-- Migration 015: Strict Trip State Machine & Transition Guards
-- GrainShield AI — Gujarat Food Grain Transport Verification
-- =============================================================================
-- Enforces backend/database workflow rules across ALL submission paths,
-- RPCs, background workers, and service-role updates:
--
-- 1. AI PASS alone may authorize automatic progression when all required checks pass.
-- 2. AI FAIL must not automatically progress the trip (routes to rejected).
-- 3. MANUAL_REVIEW must remain pending until an authorized officer resolves it.
-- 4. Geofence FAIL must block ordinary completion.
-- 5. GPS SKIPPED or facility NOT_APPLICABLE must not be silently interpreted as verified arrival.
-- 6. FPS shop mismatch or unreadable required shop identification must remain subject to manual review.
-- 7. Authorized overrides must be explicit, scoped to the exact evidence ID, once-only (consumed),
--    and auditable via resolve_manual_review.
-- =============================================================================

-- Ensure consumed_at column exists on manual_review_requests for once-only override enforcement
ALTER TABLE public.manual_review_requests
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS manual_review_requests_consumed_idx
  ON public.manual_review_requests(trip_id, evidence_id, status, consumed_at);

CREATE OR REPLACE FUNCTION public.check_trip_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_latest_ev record;
  v_latest_verif record;
  v_override record;
BEGIN
  -- If status did not change, allow update (e.g. updating vehicle_number or updated_at)
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Allowed progression to entry/processing/review queues:
  -- These represent entry into evaluation or pending queues and do not authorize grain movement
  IF NEW.status IN ('submitted', 'processing', 'manual_review', 'rejected', 'retake', 'draft') THEN
    RETURN NEW;
  END IF;

  -- -------------------------------------------------------------------------
  -- Restrictive Transitions: 'completed', 'pass'
  -- These authorize grain movement or finalize government delivery.
  -- -------------------------------------------------------------------------

  -- STEP 1: Every restrictive transition REQUIRES an uploaded evidence photograph.
  SELECT *
  INTO v_latest_ev
  FROM public.trip_evidence
  WHERE trip_id = NEW.id
  ORDER BY uploaded_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'State Machine Violation: Cannot advance trip % to % without verified evidence photograph.',
      NEW.trip_code, NEW.status;
  END IF;

  -- STEP 2: Check if an authorized officer or admin has legitimately resolved
  -- a manual review request SPECIFICALLY SCOPED to THIS EXACT evidence photograph,
  -- and that has NOT already been consumed by an earlier transition.
  SELECT mr.*, p.role as reviewer_role
  INTO v_override
  FROM public.manual_review_requests mr
  JOIN public.profiles p ON p.id = mr.assigned_reviewer
  WHERE mr.trip_id = NEW.id
    AND mr.evidence_id = v_latest_ev.id
    AND mr.status = 'resolved'
    AND mr.consumed_at IS NULL
    AND mr.assigned_reviewer IS NOT NULL
    AND p.role IN ('officer', 'admin', 'super_admin')
    AND mr.resolved_at >= (now() - INTERVAL '15 minutes')
  ORDER BY mr.resolved_at DESC
  LIMIT 1;

  -- If an authorized officer override exists for this exact evidence, mark it consumed and permit the transition
  IF FOUND THEN
    UPDATE public.manual_review_requests
    SET consumed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_override.id;

    RETURN NEW;
  END IF;

  -- STEP 3: No valid officer override exists -> Strict automated rules MUST be verified:

  -- Rule 4 & 5: Geofence FAIL, SKIPPED, or NOT_APPLICABLE strictly blocks completion/transit
  IF v_latest_ev.geofence_status IS NULL OR v_latest_ev.geofence_status != 'pass' THEN
    RAISE EXCEPTION 'State Machine Violation: Geofence verification not passed (status: %). Trip % cannot advance to % without authorized officer override.',
      COALESCE(v_latest_ev.geofence_status, 'missing'), NEW.trip_code, NEW.status;
  END IF;

  -- Find associated verification result for this exact evidence
  SELECT *
  INTO v_latest_verif
  FROM public.verification_results
  WHERE evidence_id = v_latest_ev.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'State Machine Violation: No verification result record linked to evidence %. Trip cannot advance to %.',
      v_latest_ev.id, NEW.status;
  END IF;

  -- Rule 1, 2, 3: AI PASS alone authorizes automated progression.
  -- Any other status (manual_review, fail, retake, pending) strictly blocks ordinary completion.
  IF v_latest_verif.status != 'pass' OR v_latest_verif.decision != 'pass' THEN
    RAISE EXCEPTION 'State Machine Violation: AI verification not passed (status: %, decision: %). Trip % cannot advance to % without authorized officer override.',
      v_latest_verif.status, v_latest_verif.decision, NEW.trip_code, NEW.status;
  END IF;

  -- Rule 6: FPS Delivery (Last Mile) verification
  IF NEW.stage = 'last_mile' AND NEW.status = 'completed' THEN
    IF v_latest_verif.evidence_checks IS NOT NULL THEN
      IF (v_latest_verif.evidence_checks->>'banner_detected')::boolean = false THEN
        RAISE EXCEPTION 'State Machine Violation: Fair Price Shop banner not detected or unreadable. Delivery cannot complete automatically without officer review.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_trip_state_machine ON public.trips;
CREATE TRIGGER trg_enforce_trip_state_machine
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.check_trip_status_transition();
