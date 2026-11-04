-- =============================================================================
-- Migration 015: Strict Trip State Machine & Transition Guards
-- GrainShield AI — Gujarat Food Grain Transport Verification
-- =============================================================================
-- Enforces backend/database workflow rules across ALL submission paths,
-- RPCs, background workers, and service-role updates:
--
-- 1. AI PASS alone may authorize automatic progression when all required checks pass.
-- 2. AI FAIL must not automatically progress the trip.
-- 3. MANUAL_REVIEW must remain pending until an authorized officer resolves it.
-- 4. Geofence FAIL must block ordinary completion.
-- 5. GPS SKIPPED or facility NOT_APPLICABLE must not be silently interpreted as verified arrival.
-- 6. FPS shop mismatch or unreadable required shop identification must remain subject to manual review.
-- 7. Authorized overrides must be explicit and auditable via resolve_manual_review.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_trip_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_latest_ev record;
  v_latest_verif record;
  v_has_override boolean := false;
  v_override record;
BEGIN
  -- If status did not change, allow update (e.g. updating vehicle_number or updated_at)
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Allowed progression to submitted, processing, manual_review, rejected, or retake
  -- These represent entry into evaluation or pending queues and do not authorize grain movement
  IF NEW.status IN ('submitted', 'processing', 'manual_review', 'rejected', 'retake', 'draft') THEN
    RETURN NEW;
  END IF;

  -- -------------------------------------------------------------------------
  -- Restrictive Transitions: 'in_transit', 'completed', 'pass'
  -- These authorize grain movement or finalize government delivery.
  -- -------------------------------------------------------------------------

  -- 1. Check if an authorized officer or admin has legitimately resolved a manual review
  SELECT mr.*, p.role as reviewer_role
  INTO v_override
  FROM public.manual_review_requests mr
  LEFT JOIN public.profiles p ON p.id = mr.assigned_reviewer
  WHERE mr.trip_id = NEW.id
    AND mr.status = 'resolved'
    AND mr.assigned_reviewer IS NOT NULL
    AND p.role IN ('officer', 'admin', 'super_admin')
    AND mr.resolved_at >= (now() - INTERVAL '15 minutes')
  ORDER BY mr.resolved_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_has_override := true;
  END IF;

  -- If an authorized officer override exists, permit the transition
  IF v_has_override THEN
    RETURN NEW;
  END IF;

  -- 2. No officer override exists -> This is an automated transition.
  -- Strict Automated Rules MUST be verified:

  -- Find latest evidence record for this trip
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

  -- Rule 4 & 5: Geofence FAIL, SKIPPED, or NOT_APPLICABLE strictly blocks completion/transit
  IF v_latest_ev.geofence_status IS NULL OR v_latest_ev.geofence_status != 'pass' THEN
    RAISE EXCEPTION 'State Machine Violation: Geofence verification not passed (status: %). Trip % cannot advance to % without authorized officer override.',
      COALESCE(v_latest_ev.geofence_status, 'missing'), NEW.trip_code, NEW.status;
  END IF;

  -- Find associated verification result
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
