# GrainShield AI — Sprint 5.1 Database Review

**Prepared by:** Sprint 5.1 Independent Database Audit  
**Date:** 2026-11-05  
**Branch:** main  
**HEAD:** `9e3f934aa3bccab224a49f3c1e348c5e40879243` ✅ Confirmed  
**Scope:** Static analysis only — no production queries executed.

---

## 1. Confirmed HEAD & Migration Status

| Migration | File | Applied to Production |
|-----------|------|-----------------------|
| 013 | `013_admin_backend_completion.sql` | ✅ Yes |
| 015 | `015_trip_state_machine_enforcement.sql` | ✅ Yes |
| 016 | `016_fix_resolve_manual_review.sql` | ✅ Yes |
| 017 | `017_backfill_manual_review_requests.sql` | ⬜ **NOT YET APPLIED** |

---

## 2. Review Model Determination

**Verdict: Model C — One review per AI decision/evidence attempt**

Evidence:
1. Worker inserts `manual_review_requests` keyed on `(trip_id, evidence_id)` — the specific evidence that received the `manual_review` AI decision.
2. `resolve_manual_review()` RPC takes `p_review_id` and resolves `verification_results WHERE evidence_id = v_evidence_id` — strictly scoped to one evidence record.
3. The state-machine trigger (`check_trip_status_transition`) checks for a resolved override scoped to `v_latest_ev.id` — the specific evidence photograph.
4. `manual_review_requests.evidence_id` semantically means: **the photograph that caused the AI to flag for manual review**.

**Implications:**
- A trip with multiple evidence submissions (e.g., retake upload) may have multiple `manual_review_requests` rows — one per flagged photograph.
- Only the review row for the most recent evidence photograph will satisfy the state-machine trigger's `v_latest_ev.id` check.
- Resolving a review for an older/non-latest photograph will NOT advance the trip status (trigger checks `ORDER BY uploaded_at DESC LIMIT 1`).
- This is correct behavior: officer must resolve the evidence that is currently being evaluated.

---

## 3. Full Relationship Map

```
trips (id, status, stage, created_by, ...)
  │
  ├── trip_evidence (id, trip_id, storage_path, uploaded_at, geofence_status, ...)
  │     │
  │     ├── verification_results (id, trip_id, evidence_id, status, decision, ...)
  │     │      ← Worker fills this row; evidence_id links to trip_evidence.id
  │     │
  │     └── manual_review_requests (id, trip_id, evidence_id, requested_by, status, consumed_at, ...)
  │            ← Created by worker when decision = 'manual_review'
  │            ← evidence_id REFERENCES trip_evidence(id) ON DELETE SET NULL
  │
  └── audit_logs (id, actor_id, action, entity_id, trip_id, metadata, created_at)
        ← Immutable; written by RPC and worker
```

**Key relationships:**
- `verification_results.evidence_id` → `trip_evidence.id` (1:1 intended, enforced by index)
- `manual_review_requests.evidence_id` → `trip_evidence.id` (nullable, ON DELETE SET NULL)
- `manual_review_requests.requested_by` → `auth.users.id` (NOT NULL — cannot insert NULL)
- `manual_review_requests.assigned_reviewer` → `auth.users.id` (nullable until assigned)
- `consumed_at` on `manual_review_requests` enforces once-only override consumption by the trigger

---

## 4. Migration 013: Original `resolve_manual_review` Analysis

**Location:** Step 3 of Migration 013

**Critical Flaw (the bug that drove Migration 016):**
```sql
-- Migration 013, line 137-138 (BUGGY):
UPDATE public.verification_results
SET status = v_verif_status, ...
WHERE trip_id = v_trip_id
  AND (evidence_id = v_evidence_id OR v_evidence_id IS NULL);
-- ^^^ When v_evidence_id IS NULL, this becomes WHERE trip_id = v_trip_id
-- which matches ALL verification_results for the trip → multi-row error
```

**Other issues in Migration 013's version:**
- Did not set `consumed_at` (Migration 015 feature not yet present)
- Audit log metadata did not include `evidence_id`
- No back-fill of `evidence_id` within the function itself

---

## 5. Migration 015: State Machine Trigger Analysis

**Function:** `check_trip_status_transition()` BEFORE UPDATE trigger on `trips`

**Allowed statuses (bypass restrictive check):**
```
submitted, processing, manual_review, rejected, retake, draft
```
These return `NEW` immediately without evidence/verification checks. ✅ Correct — these do not authorize grain movement.

**Restrictive statuses:** `pass`, `completed`
For these, the trigger:
1. Fetches `v_latest_ev` = most recent `trip_evidence` record (`ORDER BY uploaded_at DESC LIMIT 1`)
2. Checks for a resolved, unconsumed override scoped to `v_latest_ev.id`
3. If override found → marks `consumed_at = clock_timestamp()` → allows transition
4. If no override → requires geofence pass + AI `pass` decision on that specific evidence

**15-Minute Window Analysis:**
```sql
AND mr.resolved_at >= (now() - INTERVAL '15 minutes')
```
- `resolve_manual_review()` RPC updates `manual_review_requests` (setting `status=resolved`, `consumed_at=NULL`) in steps 6-7, then updates `trips` in step 8 — all within the same transaction.
- The trigger fires synchronously when step 8 runs `UPDATE trips SET status = v_trip_status`.
- At that moment, `resolved_at` was just set by step 6 — well within 15 minutes.
- **Verdict:** 15-minute window is not a practical risk in the happy path.
- **Risk:** If the RPC partially succeeds (network dropout after step 6 but before step 8 commits), the transaction rolls back entirely. No partial state.
- **Residual risk:** Client retry after >15 minutes would fail the trigger's window check. Officer would need to open the review again. This is acceptable security behavior — it prevents stale override consumption.

**Evidence Selection Risk (`ORDER BY uploaded_at DESC LIMIT 1`):**
- If a trip has evidence A (PASS) uploaded first and evidence B (MANUAL_REVIEW) uploaded second, the trigger checks evidence B — which is the correct evidence to validate.
- If a trip has evidence A (MANUAL_REVIEW) and later a retake evidence B submitted (while still in `manual_review` status), the trigger checks evidence B. The officer must have resolved evidence B's review row for the trip to advance. If only evidence A's review was resolved, the trigger finds no match and blocks. ✅ Correct — the trigger correctly enforces that the latest evidence must be cleared.

---

## 6. Migration 016: Deep Analysis

**Purpose:** Replace the buggy `resolve_manual_review` from Migration 013.

**Key fixes verified:**
1. ✅ `SELECT ... FOR UPDATE` locks the review row — prevents concurrent double-resolution
2. ✅ Back-fills `v_evidence_id` within the function if it's NULL:
   ```sql
   SELECT id INTO v_latest_ev_id
   FROM public.trip_evidence
   WHERE trip_id = v_trip_id
   ORDER BY uploaded_at DESC
   LIMIT 1;
   ```
3. ✅ `UPDATE verification_results WHERE evidence_id = v_evidence_id` — strict, no OR NULL
4. ✅ Sets `consumed_at = NULL` on the review request (so trigger can find and consume it)
5. ✅ Audit log includes `evidence_id`

**Remaining concerns in Migration 016:**

**C1 — In-function back-fill still uses `ORDER BY uploaded_at DESC LIMIT 1`:**
```sql
-- Line in resolve_manual_review (016):
SELECT id INTO v_latest_ev_id
FROM public.trip_evidence
WHERE trip_id = v_trip_id
ORDER BY uploaded_at DESC LIMIT 1;
```
If `v_evidence_id IS NULL` (pre-existing review without evidence link), the function associates the review with the *newest* photograph. For trips with multiple evidence records, this may be incorrect.

**C2 — Migration 016 bulk backfill also uses `ORDER BY uploaded_at DESC LIMIT 1`:**
```sql
UPDATE public.manual_review_requests mrr
SET evidence_id = (
  SELECT te.id FROM public.trip_evidence te
  WHERE te.trip_id = mrr.trip_id
  ORDER BY te.uploaded_at DESC LIMIT 1
)
WHERE mrr.evidence_id IS NULL
```
Any review without an `evidence_id` was associated with the most recently uploaded photo — which may not be the one that triggered manual review.

**C3 — `verificationDecision = upper(p_decision)` stored in `verification_results.decision`:**
The worker stores `decision` as lowercase (`'manual_review'`, `'pass'`). The RPC's override stores `upper(p_decision)` = `'PASS'`, `'RETAKE'`, `'REJECTED'`. This creates a casing inconsistency. The UI uses `latestVerification?.decision?.toUpperCase()` which normalizes it — no functional impact, but it complicates raw SQL queries.

---

## 7. Migration 017: Backfill Bug Analysis

**Current backfill SQL:**
```sql
FROM trips t
JOIN trip_evidence te ON te.trip_id = t.id
WHERE t.status = 'manual_review'
  AND t.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM manual_review_requests mrr
    WHERE mrr.trip_id = t.id AND mrr.evidence_id = te.id
  );
```

**Bug:** This creates one `manual_review_requests` row for **every** `trip_evidence` record on a `manual_review` trip that lacks a matching review row.

**Example of incorrect behavior:**
```
Trip T1 (status = 'manual_review')
  evidence A: PASS ← not flagged, but Migration 017 will create a review row for this
  evidence B: PASS ← not flagged, but Migration 017 will create a review row for this  
  evidence C: MANUAL_REVIEW ← correctly flagged
```
Migration 017 would insert review rows for A, B, and C (if none existed). Officers would see 3 review cases for 1 trip, two of which are for already-passed evidence.

**Correct logic (required in Migration 018):**
Only create review rows for evidence records where `verification_results.decision = 'manual_review'`.

**Where no verification_result exists for the evidence:**
Do not auto-create a review row. Flag the case as unresolved for officer reconciliation.

---

## 8. Worker Insert Pattern: Race Condition Analysis

**Current worker code (lines 445-491 of worker.js):**
```javascript
// Step 1: check
const { data: existingReview } = await adminClient
  .from("manual_review_requests")
  .select("id")
  .eq("trip_id", trip_id)
  .eq("evidence_id", evidence_id)
  .maybeSingle();

// Step 2: insert (if not found)
if (!existingReview) {
  await adminClient.from("manual_review_requests").insert({ ... });
}
```

**Race condition:** Two concurrent worker processes (or a pod restart during processing) could both read `existingReview = null` before either completes the insert. Both would then attempt to insert, creating duplicate active review rows.

**Current protection:** None at database level. No UNIQUE constraint on `(trip_id, evidence_id)`.

**Proposed fix:** Partial UNIQUE index (in Migration 018):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_mrr_active_trip_evidence
  ON manual_review_requests (trip_id, evidence_id)
  WHERE status NOT IN ('resolved', 'escalated');
```
This allows historical resolved reviews to coexist while blocking concurrent duplicate active rows. Worker should handle the unique violation gracefully (log and continue — idempotent behavior).

---

## 9. SECURITY DEFINER Audit

| Function | Owner | Grants | search_path | auth.uid() behavior |
|----------|-------|--------|-------------|---------------------|
| `resolve_manual_review` | postgres (migration owner) | `authenticated, service_role` | `pg_catalog, public, pg_temp` | Returns caller's UUID when invoked via authenticated JWT; NULL when invoked via service_role without an impersonated user |
| `manage_user_role` | postgres | `authenticated, service_role` | `pg_catalog, public, pg_temp` | Same |
| `admin_create_trip` | postgres | `authenticated, service_role` | `pg_catalog, public, pg_temp` | Same |
| `check_trip_status_transition` | postgres | Trigger-only (no GRANT needed) | `public, pg_catalog` | Not called directly; runs as trigger owner |

**Findings:**
- ✅ `search_path` is locked to `pg_catalog, public, pg_temp` on all SECURITY DEFINER functions — prevents search-path injection.
- ✅ `v_actor_id := auth.uid()` is called at function start — cannot be spoofed via caller manipulation.
- ✅ `role NOT IN ('officer', 'admin', 'super_admin')` check prevents unauthorized resolution.
- ⚠️ `check_trip_status_transition` uses `search_path = public, pg_catalog` (public first). Lower risk since it's a trigger function not invokable by clients, but conventionally should be `pg_catalog, public`. **Low severity.**
- ⚠️ Worker uses service_role key — `auth.uid()` returns NULL in that context. The RPC checks `IF v_actor_id IS NULL THEN RAISE EXCEPTION`. This means the worker **cannot call `resolve_manual_review()` via RPC** — it only creates the `manual_review_requests` row. Officer resolves via authenticated session. ✅ This is the correct architecture.

---

## 10. Signed URL Security Analysis

**Code (admin-queries.ts):**
```typescript
const { data, error } = await supabase.storage
  .from("trip-evidence")
  .createSignedUrl(storagePath, expiresInSeconds);
```

**Client used:** `supabase` (anon client, authenticated by officer's JWT session)

**Security model:**
- Supabase Storage respects RLS policies on the `trip-evidence` bucket.
- The anon client uses the officer's session JWT to authorize the signed URL creation.
- RLS must permit officers/admins to read from `trip-evidence` storage. If this policy exists, the signed URL call succeeds.
- If RLS does NOT permit the officer's role, `createSignedUrl` returns an error.
- Signed URLs expire after `expiresInSeconds` (600s = 10 min in evidence gallery).
- **No service-role key is exposed to the frontend.** ✅

**Potential issue:** If storage RLS is missing or overly permissive, any authenticated user could request signed URLs for evidence paths they know. Recommend verifying the storage bucket policy allows only `officer`, `admin`, `super_admin` roles.

---

## 11. Diagnostic Query Corrections (D1–D9)

The following are **READ-ONLY** diagnostic queries. Run only in staging or via a read-replica.

### D1 — Manual review records with NULL evidence_id
```sql
SELECT id, trip_id, status, created_at
FROM manual_review_requests
WHERE evidence_id IS NULL
ORDER BY created_at DESC;
```

### D2 — Reviews with evidence_id pointing to non-existent trip_evidence
```sql
SELECT mrr.id, mrr.trip_id, mrr.evidence_id, mrr.status
FROM manual_review_requests mrr
LEFT JOIN trip_evidence te ON te.id = mrr.evidence_id
WHERE mrr.evidence_id IS NOT NULL
  AND te.id IS NULL;
```

### D3 — Multiple active reviews for the same (trip_id, evidence_id)
```sql
SELECT trip_id, evidence_id, COUNT(*) as active_count
FROM manual_review_requests
WHERE status NOT IN ('resolved', 'escalated')
GROUP BY trip_id, evidence_id
HAVING COUNT(*) > 1
ORDER BY active_count DESC;
```

### D4 — Multiple verification_results for the same evidence_id
```sql
SELECT evidence_id, COUNT(*) as vr_count
FROM verification_results
WHERE evidence_id IS NOT NULL
GROUP BY evidence_id
HAVING COUNT(*) > 1
ORDER BY vr_count DESC;
```

### D5 — Trips in manual_review status with no review row
```sql
SELECT t.id, t.trip_code, t.status, t.created_at
FROM trips t
LEFT JOIN manual_review_requests mrr ON mrr.trip_id = t.id
WHERE t.status = 'manual_review'
  AND mrr.id IS NULL;
```

### D6 — Trips with multiple evidence records
```sql
SELECT trip_id, COUNT(*) as ev_count
FROM trip_evidence
GROUP BY trip_id
HAVING COUNT(*) > 1
ORDER BY ev_count DESC;
```

### D7 — Resolved reviews that have been consumed (consumed_at IS NOT NULL)
```sql
SELECT id, trip_id, evidence_id, status, resolved_at, consumed_at
FROM manual_review_requests
WHERE status = 'resolved'
  AND consumed_at IS NOT NULL
ORDER BY consumed_at DESC;
```

### D8 — Resolved reviews NOT yet consumed (potential orphans after trip advanced)
```sql
SELECT mrr.id, mrr.trip_id, mrr.evidence_id, mrr.resolved_at, t.status as trip_status
FROM manual_review_requests mrr
JOIN trips t ON t.id = mrr.trip_id
WHERE mrr.status = 'resolved'
  AND mrr.consumed_at IS NULL
  AND t.status NOT IN ('manual_review', 'submitted', 'processing')
ORDER BY mrr.resolved_at DESC;
```

### D9 — Evidence with manual_review verification decision but no review row
```sql
SELECT vr.id as vr_id, vr.trip_id, vr.evidence_id, vr.decision, vr.created_at
FROM verification_results vr
LEFT JOIN manual_review_requests mrr 
  ON mrr.trip_id = vr.trip_id AND mrr.evidence_id = vr.evidence_id
WHERE vr.decision = 'manual_review'
  AND mrr.id IS NULL;
```
> These are cases where Migration 018 should create review rows.

---

## 12. Summary Findings Table

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| F1 | Migration 017 creates review rows for ALL evidence, not just manual_review ones | **HIGH** | Blocking — do not apply |
| F2 | M016 bulk backfill uses `ORDER BY uploaded_at DESC LIMIT 1` — may associate wrong evidence | **MEDIUM** | Already applied; legacy records may need officer reconciliation |
| F3 | No UNIQUE constraint on `(trip_id, evidence_id)` for active reviews | **MEDIUM** | Migration 018 adds partial unique index |
| F4 | In-function evidence back-fill in `resolve_manual_review` also uses latest-photo heuristic | **LOW** | Acceptable as last-resort fallback; primary path should have evidence_id set |
| F5 | `decision` stored as lowercase by worker, uppercase by RPC | **LOW** | No functional impact; UI normalizes |
| F6 | `check_trip_status_transition` search_path: `public` before `pg_catalog` | **LOW** | Trigger-only; not client-invokable |
| F7 | 15-minute override window | **INFO** | Not a real risk in same-transaction context |
| F8 | Storage signed URL uses anon client | **INFO** | Correct; storage RLS governs access |
