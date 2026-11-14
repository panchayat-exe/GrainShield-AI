# GrainShield AI — Migration 017 Corrected Plan

**Prepared by:** Sprint 5.1 Independent Database Audit  
**Date:** 2026-11-05  
**Decision:** Migration 017 is NOT safe as written. Replace with Migration 018.

---

## 1. Verdict on Migration 017

**NOT SAFE TO APPLY.**

**Root cause:** The backfill JOIN selects ALL `trip_evidence` records for each `manual_review` trip, not just the evidence photograph that received the `manual_review` AI decision.

```sql
-- CURRENT (WRONG) Migration 017 logic:
FROM trips t
JOIN trip_evidence te ON te.trip_id = t.id  -- every photo on the trip
WHERE t.status = 'manual_review'
  AND t.created_by IS NOT NULL
  AND NOT EXISTS (...)
```

**Impact example:**
```
Trip: GS-2024-001 (status = manual_review)
  Evidence A: uploaded first  → vr.decision = 'pass'
  Evidence B: uploaded second → vr.decision = 'manual_review'  ← only this should get a review row

Migration 017 inserts:
  → manual_review_requests for Evidence A  ← WRONG, this evidence passed
  → manual_review_requests for Evidence B  ← correct

Result: Officer sees 2 review cases for 1 trip. Resolving Evidence A's case would:
  1. Update verification_results for Evidence A (which was already PASS)
  2. Set consumed_at on Evidence A's review row
  3. Attempt to update trip status — trigger checks LATEST evidence (Evidence B)
     → Trigger finds no consumed override for Evidence B → BLOCKS transition
  
  Officer is now confused: review says "done" but trip is still stuck in manual_review.
```

---

## 2. Correct Backfill Logic (Target)

The backfill must ONLY create review rows for evidence that:
1. Belongs to a trip currently in `manual_review` status.
2. Has a `verification_results` record with `decision = 'manual_review'`.
3. Does NOT already have a `manual_review_requests` row for that specific `(trip_id, evidence_id)` pair.

```sql
-- CORRECT logic for Migration 018:
FROM verification_results vr
JOIN trip_evidence te ON te.id = vr.evidence_id
JOIN trips t ON t.id = vr.trip_id
WHERE t.status = 'manual_review'
  AND t.created_by IS NOT NULL
  AND vr.decision = 'manual_review'          -- only AI-flagged evidence
  AND NOT EXISTS (
    SELECT 1 FROM manual_review_requests mrr
    WHERE mrr.trip_id = vr.trip_id
      AND mrr.evidence_id = vr.evidence_id
  )
```

---

## 3. Pre-Migration Diagnostic Checklist

Run ALL of these in Supabase SQL Editor (read-only) BEFORE applying Migration 018.

Document the actual counts in the deployment notes.

```sql
-- PRE-01: How many trips are in manual_review?
SELECT COUNT(*) AS total_manual_review_trips
FROM trips WHERE status = 'manual_review';

-- PRE-02: How many evidence records across those trips?
SELECT COUNT(*) AS total_evidence_on_mr_trips
FROM trip_evidence te
JOIN trips t ON t.id = te.trip_id
WHERE t.status = 'manual_review';

-- PRE-03: How many verification_results have decision='manual_review' on those trips?
SELECT COUNT(*) AS vr_flagged_manual_review
FROM verification_results vr
JOIN trips t ON t.id = vr.trip_id
WHERE t.status = 'manual_review'
  AND vr.decision = 'manual_review';

-- PRE-04: How many SHOULD get backfilled (corrected logic)?
SELECT COUNT(*) AS rows_to_insert
FROM verification_results vr
JOIN trip_evidence te ON te.id = vr.evidence_id
JOIN trips t ON t.id = vr.trip_id
WHERE t.status = 'manual_review'
  AND t.created_by IS NOT NULL
  AND vr.decision = 'manual_review'
  AND NOT EXISTS (
    SELECT 1 FROM manual_review_requests mrr
    WHERE mrr.trip_id = vr.trip_id AND mrr.evidence_id = vr.evidence_id
  );

-- PRE-05: How many OLD (incorrect) rows would Migration 017 insert?
-- Compare this to PRE-04. If PRE-05 > PRE-04, Migration 017 is confirmed wrong.
SELECT COUNT(*) AS old_017_would_insert
FROM trips t
JOIN trip_evidence te ON te.trip_id = t.id
WHERE t.status = 'manual_review'
  AND t.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM manual_review_requests mrr
    WHERE mrr.trip_id = t.id AND mrr.evidence_id = te.id
  );

-- PRE-06: Trips with manual_review evidence but no created_by (would be skipped)
SELECT t.id, t.trip_code
FROM trips t
JOIN verification_results vr ON vr.trip_id = t.id
WHERE t.status = 'manual_review'
  AND vr.decision = 'manual_review'
  AND t.created_by IS NULL;

-- PRE-07: Existing review rows for manual_review trips (should not be duplicated)
SELECT COUNT(*) AS existing_review_rows
FROM manual_review_requests mrr
JOIN trips t ON t.id = mrr.trip_id
WHERE t.status = 'manual_review';
```

**Stop conditions — do NOT apply Migration 018 if:**
- PRE-04 = 0 and PRE-07 > 0: All manual_review trips already have review rows — Migration 018 is a no-op. Apply safely (idempotent) but verify the existing rows are Category A (correct associations).
- PRE-06 returns any rows: Those trips have no `created_by` — the `requested_by NOT NULL` constraint would cause the insert to fail. Investigate before applying.
- PRE-02 >> PRE-03: Many evidence records per trip but few are actually flagged. This confirms Migration 017 was wrong.

---

## 4. Migration 018 SQL

> [!IMPORTANT]
> This migration replaces Migration 017. Do NOT apply Migration 017. Apply this instead.
> Run manually in Supabase SQL Editor (project: umkjdpgxxylckoohnyco).
> This is idempotent: safe to run multiple times.

```sql
-- See: database/migrations/018_corrected_backfill_manual_review_requests.sql
```

**Key differences from Migration 017:**

| Aspect | Migration 017 | Migration 018 |
|--------|--------------|---------------|
| Backfill source | `trips JOIN trip_evidence` (all evidence) | `verification_results JOIN trip_evidence JOIN trips` (only AI-flagged) |
| Filter condition | `t.status = 'manual_review'` only | + `vr.decision = 'manual_review'` |
| Duplicate guard | NOT EXISTS on `(trip_id, evidence_id)` | Same, plus partial UNIQUE index |
| Unverifiable cases | Silently skips (creates row for all evidence) | Correctly identifies and skips; diagnostic query identifies them |
| UNIQUE constraint | None | Partial UNIQUE index on active reviews |

---

## 5. Rollback Plan

Migration 018 only INSERTs rows and creates an index. No existing data is modified.

**To rollback (if needed):**
```sql
-- Remove backfilled rows inserted by Migration 018
-- (Identify them by user_notes)
DELETE FROM manual_review_requests
WHERE user_notes LIKE 'Backfilled by Migration 018:%'
  AND status = 'pending';

-- Drop the partial unique index
DROP INDEX IF EXISTS uq_mrr_active_trip_evidence;
DROP INDEX IF EXISTS manual_review_requests_evidence_id_idx;
DROP INDEX IF EXISTS manual_review_requests_trip_status_idx;
```

> [!WARNING]
> Do NOT roll back if any backfilled rows have already been resolved by officers.
> Resolved rows are part of the government audit trail.

---

## 6. Post-Migration Verification

After applying Migration 018, run these in Supabase SQL Editor:

```sql
-- POST-01: Confirm expected row count was inserted
-- Should equal PRE-04 count from before migration
SELECT COUNT(*) AS inserted_rows
FROM manual_review_requests
WHERE user_notes LIKE 'Backfilled by Migration 018:%';

-- POST-02: Confirm no PASS/FAIL evidence got review rows from this migration
SELECT mrr.id, mrr.trip_id, mrr.evidence_id, vr.decision
FROM manual_review_requests mrr
JOIN verification_results vr ON vr.evidence_id = mrr.evidence_id
WHERE mrr.user_notes LIKE 'Backfilled by Migration 018:%'
  AND vr.decision <> 'manual_review';
-- Expected: 0 rows

-- POST-03: Confirm all manual_review trips now have at least one review row
SELECT t.id, t.trip_code
FROM trips t
LEFT JOIN manual_review_requests mrr ON mrr.trip_id = t.id
WHERE t.status = 'manual_review'
  AND mrr.id IS NULL;
-- Expected: 0 rows, OR only trips where the AI flagged evidence has no vr record (Category D)

-- POST-04: Confirm UNIQUE index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'manual_review_requests'
  AND indexname = 'uq_mrr_active_trip_evidence';
-- Expected: 1 row
```

---

## 7. Worker Concurrent Insert Handling

After Migration 018 adds the partial UNIQUE index, the worker's check-then-insert pattern needs to handle the unique violation gracefully.

The current worker code (lines 445-491 of `worker.js`) does:
1. `maybeSingle()` SELECT — check for existing row
2. `insert()` — create new row

With the UNIQUE index, two concurrent workers could both pass step 1 before either completes step 2. The second insert would throw a unique constraint violation.

**Current handling:** `if (reviewInsertError)` logs a warning and continues — trip is still in `manual_review` status. ✅ This is already non-fatal.

**After Migration 018:** The unique violation error message will be: `duplicate key value violates unique constraint "uq_mrr_active_trip_evidence"`. The worker logs this as a warning and continues. The first worker's insert succeeded — idempotent behavior. ✅ No code change required in the worker.

**Optional hardening:** Add explicit conflict handling in worker:
```javascript
// Optional: Use upsert with onConflict to avoid the check-then-insert pattern
await adminClient.from("manual_review_requests").insert({
  trip_id,
  evidence_id,
  requested_by: requestedBy,
  user_notes: ...,
  status: "pending",
}).onConflict(["trip_id", "evidence_id"]).ignore();
// Note: onConflict only works with explicit column names matching the index definition
```
This is a future hardening step, not required for correctness given the warning-only error handling.

---

## 8. Deployment Decision

| Condition | Decision |
|-----------|----------|
| Migration 017 not yet applied | ✅ Apply Migration 018 instead |
| PRE-04 = 0 (no rows to backfill) | ✅ Apply Migration 018 (index creation is still valuable) |
| PRE-06 returns rows (trips with no created_by) | ⚠️ INVESTIGATE — fix or exclude those trips first |
| PRE-05 > PRE-04 (confirms Migration 017 was wrong) | ✅ Confirms Migration 018 is needed |
| POST-02 returns rows | ❌ STOP — Migration 018 has the same bug as 017; re-audit |

**Current recommendation: CONDITIONAL GO**
- Apply Migration 018 (not 017) manually via Supabase SQL Editor
- Run PRE-01 through PRE-07 diagnostics first and document counts
- Run POST-01 through POST-04 verification immediately after
- Do not proceed if PRE-06 returns rows without resolving the `created_by` issue
