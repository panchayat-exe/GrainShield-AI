-- =============================================================
-- GrainShield AI — Migration 013: Admin Backend Completion & Hardening
-- Adds atomic manual review resolution, secure user role management,
-- admin trip creation, verification update RLS, and immutable audit logging.
-- Fully idempotent: safe to run multiple times.
-- =============================================================

-- -------------------------------------------------------------
-- 1. RLS: Allow Admins/Officers to update verification_results
-- (Required when officers manually override/resolve a verification)
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "Admins update verifications" ON public.verification_results;
CREATE POLICY "Admins update verifications" ON public.verification_results
    FOR UPDATE
    USING (public.is_admin_or_officer())
    WITH CHECK (public.is_admin_or_officer());

-- -------------------------------------------------------------
-- 2. RLS: Immutability for audit_logs
-- Prevent update and delete on audit_logs by anyone (tamper-proof)
-- -------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated;

-- Ensure select and insert policies are active for admins
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs
    FOR SELECT USING (public.is_admin_or_officer());

DROP POLICY IF EXISTS "Admins insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins insert audit logs" ON public.audit_logs
    FOR INSERT WITH CHECK (public.is_admin_or_officer());

-- -------------------------------------------------------------
-- 3. FUNCTION: resolve_manual_review
-- Transactionally resolves a manual review case, updating:
--   - manual_review_requests (status, reviewer, notes, timestamp)
--   - verification_results (status, decision, explanation)
--   - trips (status, updated_at)
--   - audit_logs (immutable record)
-- Concurrency safe: prevents duplicate or conflicting review decisions.
-- -------------------------------------------------------------
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
    v_actor_id UUID := auth.uid();
    v_actor_role TEXT;
    v_actor_email TEXT;
    v_trip_id UUID;
    v_evidence_id UUID;
    v_current_review_status public.review_status;
    v_trip_status public.trip_status;
    v_verif_status public.verification_status;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- 1. Authorization check
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT role::text, email INTO v_actor_role, v_actor_email
    FROM public.profiles
    WHERE id = v_actor_id;

    IF v_actor_role NOT IN ('officer', 'admin', 'super_admin') THEN
        RAISE EXCEPTION 'Access denied: Only officers and administrators can resolve manual reviews.';
    END IF;

    -- 2. Validation
    IF p_decision NOT IN ('pass', 'retake', 'rejected') THEN
        RAISE EXCEPTION 'Invalid decision: % (must be pass, retake, or rejected).', p_decision;
    END IF;

    IF p_notes IS NULL OR btrim(p_notes) = '' THEN
        RAISE EXCEPTION 'Officer justification notes are mandatory for audit compliance.';
    END IF;

    -- 3. Lock and verify review request
    SELECT trip_id, evidence_id, status
    INTO v_trip_id, v_evidence_id, v_current_review_status
    FROM public.manual_review_requests
    WHERE id = p_review_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manual review request % not found.', p_review_id;
    END IF;

    IF v_current_review_status = 'resolved' THEN
        RAISE EXCEPTION 'This review request has already been resolved by another officer.';
    END IF;

    -- 4. Map decision to statuses
    IF p_decision = 'pass' THEN
        v_trip_status := 'pass'::public.trip_status;
        v_verif_status := 'pass'::public.verification_status;
    ELSIF p_decision = 'retake' THEN
        v_trip_status := 'retake'::public.trip_status;
        v_verif_status := 'retake'::public.verification_status;
    ELSE
        v_trip_status := 'rejected'::public.trip_status;
        v_verif_status := 'fail'::public.verification_status;
    END IF;

    -- 5. Atomic update: manual_review_requests
    UPDATE public.manual_review_requests
    SET
        status = 'resolved'::public.review_status,
        assigned_reviewer = v_actor_id,
        reviewer_notes = p_notes,
        resolved_at = v_now,
        updated_at = v_now
    WHERE id = p_review_id;

    -- 6. Atomic update: trips
    UPDATE public.trips
    SET
        status = v_trip_status,
        updated_at = v_now
    WHERE id = v_trip_id;

    -- 7. Atomic update: verification_results (if associated record exists)
    UPDATE public.verification_results
    SET
        status = v_verif_status,
        decision = upper(p_decision),
        explanation = coalesce(explanation, '') || E'\n[Manual Review by ' || coalesce(v_actor_email, v_actor_id::text) || E']: ' || p_notes,
        processing_completed_at = coalesce(processing_completed_at, v_now),
        updated_at = v_now
    WHERE trip_id = v_trip_id
      AND (evidence_id = v_evidence_id OR v_evidence_id IS NULL);

    -- 8. Immutable audit log entry
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
            'review_id', p_review_id,
            'decision', p_decision,
            'notes', p_notes,
            'reviewer_role', v_actor_role,
            'reviewer_email', v_actor_email,
            'timestamp', v_now
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', v_trip_id,
        'review_id', p_review_id,
        'decision', p_decision,
        'status', v_trip_status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_manual_review(UUID, TEXT, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 4. FUNCTION: manage_user_role
-- Secure hierarchical RBAC role assignment:
--   - Officers cannot change roles.
--   - Admins can assign 'user' or 'officer'; cannot modify super_admins or grant admin/super_admin.
--   - Super admins can assign any role; cannot remove the last super_admin.
--   - Writes audit log on every role modification.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_user_role(
    target_user_id UUID,
    new_role public.user_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_actor_role TEXT;
    v_target_old_role TEXT;
    v_super_admin_count INT;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT role::text INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    IF v_actor_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Access denied: Only administrators can assign roles.';
    END IF;

    SELECT role::text INTO v_target_old_role
    FROM public.profiles
    WHERE id = target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.';
    END IF;

    -- Privilege escalation prevention:
    -- Regular admins cannot touch super_admins, and cannot promote to admin or super_admin
    IF v_actor_role = 'admin' THEN
        IF v_target_old_role IN ('admin', 'super_admin') THEN
            RAISE EXCEPTION 'Permission denied: Admins cannot modify admin or super_admin accounts.';
        END IF;
        IF new_role IN ('admin'::public.user_role, 'super_admin'::public.user_role) THEN
            RAISE EXCEPTION 'Permission denied: Privilege escalation prohibited. Only super_admins can grant administrator privileges.';
        END IF;
    END IF;

    -- Super admin safeguard: Prevent removing the last super_admin
    IF v_target_old_role = 'super_admin' AND new_role <> 'super_admin'::public.user_role THEN
        SELECT count(*) INTO v_super_admin_count
        FROM public.profiles
        WHERE role = 'super_admin'::public.user_role;

        IF v_super_admin_count <= 1 THEN
            RAISE EXCEPTION 'Action blocked: Cannot demote the last remaining super_admin.';
        END IF;
    END IF;

    -- Execute role update
    UPDATE public.profiles
    SET role = new_role, updated_at = v_now
    WHERE id = target_user_id;

    -- Write audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_actor_id,
        'user_role_changed',
        'profiles',
        target_user_id,
        jsonb_build_object(
            'target_user_id', target_user_id,
            'old_role', v_target_old_role,
            'new_role', new_role::text,
            'assigned_by', v_actor_id,
            'assigned_by_role', v_actor_role
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', target_user_id,
        'old_role', v_target_old_role,
        'new_role', new_role::text
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_user_role(UUID, public.user_role) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 5. FUNCTION: admin_create_trip
-- Allows authorized admin officers to initialize a new transport trip
-- with audit log tracking and validation.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_trip(
    p_trip_code TEXT,
    p_vehicle_number TEXT,
    p_driver_name TEXT,
    p_driver_phone TEXT,
    p_stage public.trip_stage,
    p_origin TEXT,
    p_destination TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_clean_plate TEXT;
    v_new_trip_id UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.is_admin_or_officer() THEN
        RAISE EXCEPTION 'Access denied: Only administrators and officers can create transport trips.';
    END IF;

    v_clean_plate := upper(regexp_replace(coalesce(p_vehicle_number, ''), '[^A-Za-z0-9]', '', 'g'));

    IF length(v_clean_plate) < 8 OR length(v_clean_plate) > 11 THEN
        RAISE EXCEPTION 'Invalid vehicle plate number format.';
    END IF;

    INSERT INTO public.trips (
        trip_code,
        vehicle_number,
        driver_name,
        driver_phone,
        stage,
        origin,
        destination,
        created_by,
        status,
        created_at,
        updated_at
    ) VALUES (
        p_trip_code,
        v_clean_plate,
        p_driver_name,
        p_driver_phone,
        p_stage,
        p_origin,
        p_destination,
        v_actor_id,
        'submitted'::public.trip_status,
        v_now,
        v_now
    )
    RETURNING id INTO v_new_trip_id;

    -- Audit log
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
        'trip_created',
        'trips',
        v_new_trip_id,
        v_new_trip_id,
        jsonb_build_object(
            'trip_code', p_trip_code,
            'vehicle_number', v_clean_plate,
            'stage', p_stage::text,
            'origin', p_origin,
            'destination', p_destination
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', v_new_trip_id,
        'trip_code', p_trip_code,
        'vehicle_number', v_clean_plate
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_trip(TEXT, TEXT, TEXT, TEXT, public.trip_stage, TEXT, TEXT) TO authenticated, service_role;
