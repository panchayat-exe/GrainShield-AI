# GrainShield AI — Evidence Reconciliation Guide

**Prepared by:** Sprint 5.1 Independent Database Audit  
**Date:** 2026-11-05  
**Scope:** Static analysis — READ-ONLY queries. No production data modified.

---

## 1. How to Identify Trips with Multiple Evidence Records

A trip may have more than one `trip_evidence` record when:
- A driver submitted a retake photograph after receiving a `retake` decision.
- The driver uploaded multiple images in a single session (upload race).
- An admin re-submitted on behalf of the driver.

**Diagnostic query:**
```sql
-- D6: Trips with multiple evidence records
SELECT 
  t.trip_code,
  te.trip_id,
  COUNT(te.id) AS evidence_count,
  MIN(te.uploaded_at) AS first_upload,
  MAX(te.uploaded_at) AS latest_upload
FROM trip_evidence te
JOIN trips t ON t.id = te.trip_id
GROUP BY te.trip_id, t.trip_code
HAVING COUNT(te.id) > 1
ORDER BY evidence_count DESC;
```

---

## 2. How to Identify Which Evidence Triggered Manual Review

The authoritative link is `verification_results.decision = 'manual_review'` for a specific `evidence_id`.

**Step 1 — Find the specific evidence that received manual_review AI decision:**
```sql
SELECT
  vr.id           AS verification_id,
  vr.trip_id,
  vr.evidence_id  AS flagged_evidence_id,
  vr.decision,
  vr.status,
  vr.created_at   AS ai_decision_at,
  te.uploaded_at  AS photo_uploaded_at,
  te.storage_path
FROM verification_results vr
JOIN trip_evidence te ON te.id = vr.evidence_id
WHERE vr.decision = 'manual_review'
ORDER BY vr.created_at DESC;
```

**Step 2 — Cross-reference with existing manual_review_requests:**
```sql
SELECT
  vr.trip_id,
  vr.evidence_id  AS ai_flagged_evidence_id,
  mrr.evidence_id AS review_associated_evidence_id,
  mrr.id          AS review_id,
  mrr.status      AS review_status,
  CASE
    WHEN mrr.id IS NULL THEN 'NO_REVIEW_ROW'
    WHEN mrr.evidence_id = vr.evidence_id THEN 'CORRECT'
    WHEN mrr.evidence_id IS NULL THEN 'NULL_EVIDENCE'
    ELSE 'WRONG_EVIDENCE'
  END AS association_quality
FROM verification_results vr
JOIN trips t ON t.id = vr.trip_id
LEFT JOIN manual_review_requests mrr 
  ON mrr.trip_id = vr.trip_id
WHERE vr.decision = 'manual_review'
  AND t.status = 'manual_review'
ORDER BY vr.created_at DESC;
```

---

## 3. Classification of Legacy `manual_review_requests` Records

After running the cross-reference query above, each record falls into one of four categories:

### Category A — CORRECT ✅
`mrr.evidence_id = vr.evidence_id` where `vr.decision = 'manual_review'`

The review row correctly points to the photograph that was AI-flagged. No action required.

### Category B — AMBIGUOUS ⚠️
`mrr.evidence_id` points to a `trip_evidence` record whose `verification_results.decision` is `'pass'` or `'fail'` or `'retake'` — NOT `'manual_review'`.

This can happen when:
- Migration 016's bulk backfill selected the most recent photo (`ORDER BY uploaded_at DESC LIMIT 1`) but the most recent photo was a retake submission, not the originally flagged photo.
- The officer resolved the review while the evidence_id association was incorrect.

**Risk:** If this review was already resolved, the `consumed_at` mark was written to the wrong review row, and `verification_results` for the wrong evidence was updated.

**Officer reconciliation path:** See Section 5.

### Category C — UNRESOLVED ❌
`mrr.evidence_id IS NULL`

The review exists but was never linked to a specific photograph. The original bug from Migration 013 (`v_evidence_id IS NULL`) could cause this.

**Risk:** If `resolve_manual_review()` is called on this row, it uses the latest-photo heuristic. For multi-evidence trips, this may resolve the wrong record.

**Officer reconciliation path:** See Section 5.

### Category D — NO VERIFICATION RESULT ❓
`mrr.evidence_id` references a `trip_evidence` record that has no entry in `verification_results`.

This means no AI job was ever run for this evidence. Possible causes:
- Worker crash before inserting `verification_results`.
- Evidence uploaded directly without triggering the worker.
- `verification_results` row deleted manually.

**Risk:** `resolve_manual_review()` will update `verification_results WHERE evidence_id = ...` but find 0 rows — silently skipped (see Migration 016 comment: "If no verification_result exists for this evidence (edge case), this silently skips"). The trip and review are still updated correctly, but no verification audit trail exists.

**Officer reconciliation path:** See Section 5.

---

## 4. SQL Queries for Each Category (READ-ONLY)

### Category A — Correct associations
```sql
SELECT
  mrr.id,
  mrr.trip_id,
  mrr.evidence_id,
  mrr.status,
  'CORRECT' AS category
FROM manual_review_requests mrr
JOIN verification_results vr 
  ON vr.evidence_id = mrr.evidence_id
  AND vr.decision = 'manual_review'
ORDER BY mrr.created_at DESC;
```

### Category B — Wrong evidence associated (not the AI-flagged one)
```sql
SELECT
  mrr.id,
  mrr.trip_id,
  mrr.evidence_id    AS review_evidence_id,
  vr_actual.id       AS ai_flagged_vr_id,
  vr_actual.evidence_id AS ai_flagged_evidence_id,
  mrr.status,
  'WRONG_EVIDENCE'   AS category
FROM manual_review_requests mrr
-- The review is linked to evidence that did NOT get manual_review decision
JOIN verification_results vr_link 
  ON vr_link.evidence_id = mrr.evidence_id
-- But there IS another verification_result on this trip that did get manual_review
JOIN verification_results vr_actual 
  ON vr_actual.trip_id = mrr.trip_id
  AND vr_actual.decision = 'manual_review'
  AND vr_actual.evidence_id <> mrr.evidence_id
WHERE mrr.evidence_id IS NOT NULL
  AND vr_link.decision <> 'manual_review'
ORDER BY mrr.created_at DESC;
```

### Category C — NULL evidence_id
```sql
SELECT
  mrr.id,
  mrr.trip_id,
  mrr.status,
  mrr.created_at,
  'NULL_EVIDENCE' AS category
FROM manual_review_requests mrr
WHERE mrr.evidence_id IS NULL
ORDER BY mrr.created_at DESC;
```

### Category D — No verification result for the linked evidence
```sql
SELECT
  mrr.id,
  mrr.trip_id,
  mrr.evidence_id,
  mrr.status,
  'NO_VERIFICATION_RESULT' AS category
FROM manual_review_requests mrr
LEFT JOIN verification_results vr ON vr.evidence_id = mrr.evidence_id
WHERE mrr.evidence_id IS NOT NULL
  AND vr.id IS NULL
ORDER BY mrr.created_at DESC;
```

---

## 5. Officer Reconciliation Path

### For Category B (Wrong evidence associated):

If the review is **already resolved:**
1. Identify the correct `evidence_id` (the one with `vr.decision = 'manual_review'`).
2. Run the following read-only check to understand what was affected:
   ```sql
   SELECT vr.id, vr.status, vr.decision, vr.explanation
   FROM verification_results vr
   WHERE vr.evidence_id = '<wrong_evidence_id>';
   ```
3. If the wrong `verification_results` row was updated with an officer's override decision, an admin must manually correct it via Supabase SQL Editor:
   ```sql
   -- MANUAL INTERVENTION REQUIRED — run only after officer approval
   -- Update the verification_result for the CORRECT evidence:
   UPDATE verification_results
   SET status = '<officer_decision_status>', decision = '<OFFICER_DECISION>'
   WHERE evidence_id = '<correct_evidence_id>';
   -- Revert the incorrectly updated verification_result:
   UPDATE verification_results
   SET status = 'manual_review', decision = 'manual_review'
   WHERE evidence_id = '<wrong_evidence_id>'
     AND explanation LIKE '%[Manual Review by%';
   ```
4. Write an audit log entry for the correction:
   ```sql
   INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, trip_id, metadata)
   VALUES (
     '<admin_uuid>',
     'evidence_association_corrected',
     'manual_review_requests',
     '<mrr_id>',
     '<trip_id>',
     '{"reason": "Sprint 5.1 reconciliation: M016 backfill associated wrong evidence", "category": "B"}'::jsonb
   );
   ```

If the review is **still pending/unresolved:**
1. Officer can resolve normally via the admin dashboard.
2. `resolve_manual_review()` RPC will update `verification_results WHERE evidence_id = mrr.evidence_id`. If `evidence_id` is wrong, the wrong `verification_results` row gets updated.
3. **Recommended:** Before resolving, an admin should manually correct `manual_review_requests.evidence_id` to point to the correct evidence:
   ```sql
   UPDATE manual_review_requests
   SET evidence_id = '<correct_evidence_id>'
   WHERE id = '<mrr_id>'
     AND status NOT IN ('resolved', 'escalated');
   ```

### For Category C (NULL evidence_id):

If the review is **still pending:**
1. Identify the correct evidence:
   ```sql
   SELECT te.id, te.uploaded_at, vr.decision
   FROM trip_evidence te
   LEFT JOIN verification_results vr ON vr.evidence_id = te.id
   WHERE te.trip_id = '<trip_id>'
   ORDER BY te.uploaded_at DESC;
   ```
2. If a `manual_review` verification_result exists, link it:
   ```sql
   UPDATE manual_review_requests
   SET evidence_id = (
     SELECT te.id FROM trip_evidence te
     JOIN verification_results vr ON vr.evidence_id = te.id
     WHERE te.trip_id = '<trip_id>'
       AND vr.decision = 'manual_review'
     ORDER BY vr.created_at DESC LIMIT 1
   )
   WHERE id = '<mrr_id>'
     AND evidence_id IS NULL;
   ```
3. If no `manual_review` verification_result exists (all evidence is PASS/FAIL), flag as Category D.

If the review is **already resolved:**
- The `consumed_at` and `verification_results` update may have been applied to the latest photo heuristic. Same remediation as Category B.

### For Category D (No verification result):

This is the most ambiguous case. Options:
1. **Do nothing** — The trip is in `manual_review` status, the officer can review the photograph manually using the evidence gallery and resolve the review. The `verification_results` table update will silently skip (0 rows updated), but the trip and review status update will succeed.
2. **Insert a synthetic verification_result** — Only with explicit admin approval, to create an audit record. Do NOT fabricate AI confidence scores or detection results.
3. **Escalate** — Mark the review as `escalated` and create an internal support ticket.

---

## 6. What NOT to Do

> [!CAUTION]
> **NEVER perform these actions without officer approval and audit log entry:**
>
> - Do NOT automatically overwrite `manual_review_requests.evidence_id` for resolved reviews without understanding what was already affected.
> - Do NOT silently choose the newest photograph as the "correct" evidence for Category B/C without verifying via `verification_results.decision`.
> - Do NOT delete `manual_review_requests` rows — they are part of the government audit trail.
> - Do NOT delete `verification_results` rows.
> - Do NOT modify `audit_logs` rows.
> - Do NOT run UPDATE statements without a preceding SELECT to confirm affected row count.
> - Do NOT apply Migration 018 to production without running the Category queries above first to understand the actual data state.

---

## 7. Expected Pre-Migration 018 Counts

Before applying Migration 018, run these counts and document the results:

```sql
-- Count of trips currently in manual_review status
SELECT COUNT(*) AS manual_review_trips FROM trips WHERE status = 'manual_review';

-- Count of evidence records per manual_review trip
SELECT t.trip_code, COUNT(te.id) AS evidence_count
FROM trips t
JOIN trip_evidence te ON te.trip_id = t.id
WHERE t.status = 'manual_review'
GROUP BY t.id, t.trip_code;

-- Count of verification_results with manual_review decision (should drive backfill)
SELECT COUNT(*) AS vr_manual_review
FROM verification_results vr
JOIN trips t ON t.id = vr.trip_id
WHERE vr.decision = 'manual_review'
  AND t.status = 'manual_review';

-- Count of existing manual_review_requests for manual_review trips
SELECT COUNT(*) AS existing_mrr
FROM manual_review_requests mrr
JOIN trips t ON t.id = mrr.trip_id
WHERE t.status = 'manual_review';

-- Count of evidence records that SHOULD get new review rows (the corrected backfill target)
SELECT COUNT(*) AS should_backfill
FROM verification_results vr
JOIN trip_evidence te ON te.id = vr.evidence_id
JOIN trips t ON t.id = vr.trip_id
WHERE t.status = 'manual_review'
  AND vr.decision = 'manual_review'
  AND NOT EXISTS (
    SELECT 1 FROM manual_review_requests mrr
    WHERE mrr.trip_id = vr.trip_id AND mrr.evidence_id = vr.evidence_id
  );
```

The number of rows inserted by Migration 018 must equal `should_backfill`. If it's higher, the migration has a bug. If it's 0, all manual_review evidence already has review rows (possibly from Migration 016 or the worker).
