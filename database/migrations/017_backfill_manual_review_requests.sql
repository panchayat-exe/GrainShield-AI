-- =============================================================================
-- Migration 017 — Backfill missing manual_review_requests rows
-- =============================================================================
-- For every trip currently in `manual_review` status that has evidence uploaded
-- but no corresponding manual_review_requests row, insert a backfill row so the
-- officer queue can display and act on these trips.
--
-- Safe to run multiple times (NOT EXISTS guard prevents duplicate inserts).
-- =============================================================================

BEGIN;

-- 1. Backfill: one review row per evidence item on manual_review trips with no existing row
INSERT INTO manual_review_requests (
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
  'Backfilled by Migration 017: AI flagged this trip for manual review.' AS user_notes,
  'pending'         AS status,
  COALESCE(te.uploaded_at, t.created_at, NOW()) AS created_at,
  NOW()             AS updated_at
FROM trips t
JOIN trip_evidence te ON te.trip_id = t.id
WHERE t.status = 'manual_review'
  AND t.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM manual_review_requests mrr
    WHERE mrr.trip_id  = t.id
      AND mrr.evidence_id = te.id
  );

-- 2. Ensure the consumed_at column exists (idempotent - already added in 016)
ALTER TABLE manual_review_requests
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ DEFAULT NULL;

-- 3. Ensure evidence_id index exists for query performance
CREATE INDEX IF NOT EXISTS manual_review_requests_evidence_id_idx
  ON manual_review_requests (evidence_id);

CREATE INDEX IF NOT EXISTS manual_review_requests_trip_status_idx
  ON manual_review_requests (trip_id, status);

COMMIT;

-- Verification query — run after applying to confirm backfill worked:
-- SELECT t.id, t.trip_code, t.status, COUNT(mrr.id) AS review_rows
-- FROM trips t
-- LEFT JOIN manual_review_requests mrr ON mrr.trip_id = t.id
-- WHERE t.status = 'manual_review'
-- GROUP BY t.id, t.trip_code, t.status;
