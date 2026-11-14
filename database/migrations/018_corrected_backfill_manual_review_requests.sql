-- =============================================================================
-- Migration 018: Corrected Backfill of manual_review_requests
-- GrainShield AI — Gujarat Food Grain Transport Verification
-- =============================================================================
-- REPLACES Migration 017 (which must NOT be applied).
--
-- PROBLEM WITH MIGRATION 017:
--   Its backfill JOIN selects ALL trip_evidence records for every manual_review
--   trip, creating review rows for evidence photographs that received a PASS or
--   RETAKE AI decision. Only evidence that actually received decision='manual_review'
--   should trigger a review case.
--
-- THIS MIGRATION:
--   1. Backfills manual_review_requests ONLY for evidence records where
--      verification_results.decision = 'manual_review'. (Correct.)
--   2. Adds a partial UNIQUE index to prevent concurrent worker duplicates.
--   3. Adds supporting indexes for query performance.
--   4. Does NOT touch existing manual_review_requests rows.
--   5. Is fully idempotent: safe to run multiple times.
--
-- PRE-FLIGHT CHECKS (run BEFORE applying this migration):
--   See GRAINSHIELD_MIGRATION_017_CORRECTED_PLAN.md for PRE-01 through PRE-07.
--
-- POST-FLIGHT VERIFICATION:
--   See GRAINSHIELD_MIGRATION_017_CORRECTED_PLAN.md for POST-01 through POST-04.
--
-- MANUAL APPLICATION ONLY:
--   Run in Supabase SQL Editor (project: umkjdpgxxylckoohnyco).
--   Do NOT apply to production automatically via CI.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Ensure required columns exist (idempotent — may already exist from
-- Migration 015 and 016, but guarded with IF NOT EXISTS)
-- ---------------------------------------------------------------------------

ALTER TABLE public.manual_review_requests
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.manual_review_requests
  ADD COLUMN IF NOT EXISTS evidence_id UUID
    REFERENCES public.trip_evidence(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Corrected Backfill
--
-- Only insert review rows where:
--   a) The trip is currently in 'manual_review' status.
--   b) The evidence record has a verification_result with decision='manual_review'.
--   c) No review row already exists for this exact (trip_id, evidence_id) pair.
--   d) The trip has a valid created_by (required for requested_by NOT NULL constraint).
--
-- Cases where no verification_result exists for the evidence (Category D) are
-- intentionally skipped — do not auto-create review rows without AI evidence.
-- See GRAINSHIELD_EVIDENCE_RECONCILIATION.md for officer reconciliation path.
-- ---------------------------------------------------------------------------

INSERT INTO public.manual_review_requests (
  trip_id,
  evidence_id,
  requested_by,
  user_notes,
  status,
  created_at,
  updated_at
)
SELECT
  t.id              AS trip_id,
  te.id             AS evidence_id,
  t.created_by      AS requested_by,
  'Backfilled by Migration 018: AI decision was manual_review for this evidence photograph. '
    || 'Verification result: ' || COALESCE(vr.explanation, 'No explanation recorded.')
                    AS user_notes,
  'pending'         AS status,
  COALESCE(vr.created_at, te.uploaded_at, t.created_at, NOW())  AS created_at,
  NOW()             AS updated_at
FROM public.verification_results vr
JOIN public.trip_evidence te ON te.id = vr.evidence_id
JOIN public.trips t ON t.id = vr.trip_id
WHERE t.status = 'manual_review'
  AND t.created_by IS NOT NULL           -- required: requested_by NOT NULL constraint
  AND vr.decision = 'manual_review'      -- only evidence the AI actually flagged
  AND NOT EXISTS (
    SELECT 1
    FROM public.manual_review_requests mrr
    WHERE mrr.trip_id  = vr.trip_id
      AND mrr.evidence_id = vr.evidence_id
  );

-- ---------------------------------------------------------------------------
-- Step 3: Partial UNIQUE index to prevent concurrent worker duplicate inserts.
--
-- Allows multiple RESOLVED reviews for the same (trip_id, evidence_id) —
-- historical records (e.g., re-submitted retake evidence) must be preserved.
-- Only blocks ACTIVE duplicate rows (pending, assigned, in_review).
--
-- If the worker tries to insert a duplicate active row, it receives:
--   "duplicate key value violates unique constraint uq_mrr_active_trip_evidence"
-- The worker treats this as non-fatal (logs warning, continues). The first
-- insert succeeded — idempotent behavior. No code change required in worker.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_mrr_active_trip_evidence
  ON public.manual_review_requests (trip_id, evidence_id)
  WHERE status NOT IN ('resolved', 'escalated');

-- ---------------------------------------------------------------------------
-- Step 4: Performance indexes
-- (Idempotent — only created if missing)
-- ---------------------------------------------------------------------------

-- Index for worker's evidence_id lookup
CREATE INDEX IF NOT EXISTS manual_review_requests_evidence_id_idx
  ON public.manual_review_requests (evidence_id);

-- Index for queue queries filtered by (trip_id, status)
CREATE INDEX IF NOT EXISTS manual_review_requests_trip_status_idx
  ON public.manual_review_requests (trip_id, status);

-- Composite index supporting the state-machine trigger's override check:
-- WHERE trip_id = ? AND evidence_id = ? AND status = 'resolved' AND consumed_at IS NULL
CREATE INDEX IF NOT EXISTS manual_review_requests_consumed_idx
  ON public.manual_review_requests (trip_id, evidence_id, status, consumed_at);

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION (run immediately after applying):
--
-- 1. Confirm expected row count was inserted:
-- SELECT COUNT(*) FROM manual_review_requests WHERE user_notes LIKE 'Backfilled by Migration 018:%';
-- Expected: equals PRE-04 count from GRAINSHIELD_MIGRATION_017_CORRECTED_PLAN.md
--
-- 2. Confirm no PASS/FAIL evidence got review rows:
-- SELECT mrr.id, mrr.trip_id, mrr.evidence_id, vr.decision
-- FROM manual_review_requests mrr
-- JOIN verification_results vr ON vr.evidence_id = mrr.evidence_id
-- WHERE mrr.user_notes LIKE 'Backfilled by Migration 018:%'
--   AND vr.decision <> 'manual_review';
-- Expected: 0 rows
--
-- 3. Confirm no manual_review trips remain without a review row:
-- SELECT t.id, t.trip_code FROM trips t
-- LEFT JOIN manual_review_requests mrr ON mrr.trip_id = t.id
-- WHERE t.status = 'manual_review' AND mrr.id IS NULL;
-- Expected: only trips where vr.decision != 'manual_review' for all evidence (Category D)
--
-- 4. Confirm UNIQUE index was created:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'manual_review_requests'
--   AND indexname = 'uq_mrr_active_trip_evidence';
-- Expected: 1 row
-- =============================================================================
--
-- ROLLBACK (if needed — only before any officer has resolved backfilled rows):
--
-- DELETE FROM manual_review_requests
-- WHERE user_notes LIKE 'Backfilled by Migration 018:%'
--   AND status = 'pending';
--
-- DROP INDEX IF EXISTS uq_mrr_active_trip_evidence;
-- =============================================================================
