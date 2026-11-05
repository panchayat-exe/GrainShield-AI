# GrainShield AI — Sprint 5.1 Test Results

**Prepared by:** Sprint 5.1 Independent Database Audit  
**Date:** 2026-11-05  
**Branch:** main | HEAD: `9e3f934`

> [!IMPORTANT]
> This document clearly distinguishes static analysis (code path verification) from executed tests (live system observations). Labels are used throughout.

---

## Legend

| Label | Meaning |
|-------|---------|
| `[STATIC]` | Code path analysis — no live system interaction |
| `[EXECUTED]` | Actually ran against the live system |
| `[STAGED]` | Would be run in a staging environment; not yet executed |
| ✅ PASS | Finding confirms correct behavior |
| ❌ FAIL | Finding identifies a defect |
| ⚠️ WARN | Finding identifies a risk or ambiguity |
| ⬜ NOT RUN | Test not yet executed |

---

## Section 1: Officer Review Lifecycle — Static Analysis

### T1 — Officer submits review decision (happy path) `[STATIC]`

**Code path:**
1. Officer selects decision (pass/retake/rejected) + enters notes ≥5 chars → `handleConfirmReview()` in `verification.$tripId.tsx:164`
2. Guard: `if (!activeReview?.id)` — prevents passing trip UUID as review ID ✅
3. Calls `resolveManualReview({ reviewId: activeReview.id, ... })` in `admin-queries.ts:335`
4. Client-side notes validation (min 5 chars) ✅
5. Calls `supabase.rpc("resolve_manual_review", { p_review_id, p_decision, p_notes })` ✅
6. RPC in Migration 016: authenticates actor, role-checks, FOR UPDATE lock, evidence back-fill, updates `verification_results`, sets `consumed_at=NULL` on review row, updates trips (triggers state machine), writes audit log ✅
7. If `rpcErr`, error text surfaced directly to officer UI ✅
8. On success: `router.invalidate()` causes page re-fetch with updated data ✅

**Verdict:** ✅ PASS — Code path is correct end-to-end.

---

### T2 — Double-resolution race condition `[STATIC]`

**Code path:**
1. Officer A and Officer B both have the same review page open.
2. Both click "Confirm PASS" simultaneously.
3. Both call `resolveManualReview()` with the same `reviewId`.
4. RPC: `SELECT ... FOR UPDATE` on `manual_review_requests WHERE id = p_review_id` — only one transaction gets the lock. ✅
5. First transaction: `v_current_status = 'pending'` → proceeds.
6. Second transaction: waits for lock → sees `v_current_status = 'resolved'` → `RAISE EXCEPTION 'This review request has already been resolved by another officer.'` ✅
7. Second officer sees: "Review failed: This review request has already been resolved by another officer." ✅

**Verdict:** ✅ PASS — FOR UPDATE lock prevents double-resolution.

---

### T3 — Review resolution when no `manual_review_requests` row exists `[STATIC]`

**Code path:**
1. Trip is in `manual_review` status but worker failed to create a review row (pre-commit `b745c42` trips, or worker crash).
2. `activeReview` = `reviews?.find(...) ?? reviews?.[0] ?? null` = `null` (no rows fetched).
3. Guard in `verification.$tripId.tsx:155`: `if (!activeReview?.id)` → returns early with error message: "No pending review request found for this trip. The AI worker may not have created one yet. Please wait and refresh, or contact a system administrator." ✅

**Verdict:** ✅ PASS — Guard prevents null UUID being passed to RPC. **But:** Officer cannot resolve the trip without a review row. Migration 018 fixes the backfill to create these rows for existing stranded trips.

---

### T4 — State machine trigger on `pass` decision `[STATIC]`

**Code path after `resolve_manual_review()` step 8: `UPDATE trips SET status = 'pass'`:**
1. `check_trip_status_transition()` fires BEFORE UPDATE.
2. `NEW.status = 'pass'` → not in allowed bypass list → restrictive path.
3. Fetches `v_latest_ev` = most recent `trip_evidence` record.
4. Checks for resolved, unconsumed override: `WHERE trip_id = NEW.id AND evidence_id = v_latest_ev.id AND status = 'resolved' AND consumed_at IS NULL AND ...`
5. `resolve_manual_review()` step 6 set `status = 'resolved', consumed_at = NULL` on the review row.
6. Trigger finds the row → marks `consumed_at = clock_timestamp()` → allows `RETURN NEW`. ✅

**Key assumption:** The `evidence_id` on the `manual_review_requests` row matches `v_latest_ev.id` (the most recently uploaded evidence). If they don't match (e.g., Category B data), the trigger finds no match and raises:
> `"State Machine Violation: Geofence verification not passed..."`
Or if geofence passes but AI check fails:
> `"State Machine Violation: AI verification not passed..."`

**Verdict:** ✅ PASS for well-formed data. ⚠️ WARN for Category B legacy records — trigger correctly blocks but error message may confuse officer.

---

### T5 — State machine trigger on `retake` or `rejected` decision `[STATIC]`

**Code path:**
1. `UPDATE trips SET status = 'retake'` or `status = 'rejected'`.
2. Trigger `check_trip_status_transition()`: `NEW.status IN ('retake', 'rejected')` → in bypass list → `RETURN NEW` immediately. ✅
3. No geofence or AI check required for negative decisions. ✅

**Verdict:** ✅ PASS — Retake and rejected transitions bypass restrictive checks correctly.

---

### T6 — State machine trigger on `pass` when geofence is not `'pass'` `[STATIC]`

**Code path:**
1. `v_override` not found (no resolved unconsumed review).
2. `v_latest_ev.geofence_status != 'pass'` → `RAISE EXCEPTION 'State Machine Violation: Geofence verification not passed...'` ✅

**Verdict:** ✅ PASS — Geofence guard is correctly enforced.

---

### T7 — Officer review form: validation of notes `[STATIC]`

**Code path:**
1. Client: `reviewerNotes.trim().length < 5` → `setValidationError(...)` before RPC call. ✅
2. RPC server-side: `IF p_notes IS NULL OR btrim(p_notes) = '' THEN RAISE EXCEPTION` ✅
3. Notes minimum is 5 chars client-side; server enforces non-empty. Server-side validation is slightly weaker (empty vs. 5-char) but both protect the audit trail. ✅

**Verdict:** ✅ PASS — Dual validation at client and server.

---

### T8 — Worker manual_review_requests insert idempotency `[STATIC]`

**Code path:**
1. Worker: `.maybeSingle()` SELECT on `(trip_id, evidence_id)`.
2. If `existingReview` is null → INSERT.
3. If INSERT fails with unique constraint violation (after Migration 018) → `reviewInsertError` logged as warning, execution continues. ✅
4. Trip is already in `manual_review` status regardless of review row creation. ✅

**Race condition:** Two workers could pass step 1 before either completes step 2. Second INSERT hits unique constraint → warning logged. **Non-fatal.** ✅

**Verdict:** ✅ PASS (after Migration 018 adds the UNIQUE index). ⚠️ WARN (before Migration 018 — two active review rows can be created for the same evidence).

---

### T9 — SECURITY DEFINER function protection `[STATIC]`

| Check | Result |
|-------|--------|
| `auth.uid()` checked at function start | ✅ Authentication required |
| Role checked against `profiles.role` | ✅ Officer/admin/super_admin only |
| `search_path = pg_catalog, public, pg_temp` | ✅ Search-path injection blocked |
| FOR UPDATE prevents duplicate resolution | ✅ Concurrency-safe |
| evidence_id back-filled if NULL | ✅ Prevents multi-row subquery bug |
| `WHERE evidence_id = v_evidence_id` strict | ✅ No OR NULL wildcard |
| `consumed_at = NULL` set before trips update | ✅ Trigger can find override |
| Audit log written inside same transaction | ✅ Tamper-proof audit trail |
| `GRANT` to `authenticated, service_role` | ✅ Appropriate |
| Worker uses service_role → `auth.uid()` NULL → cannot call resolve RPC | ✅ Correct architecture |

**Verdict:** ✅ PASS

---

## Section 2: Migration Analysis — Static Analysis

### M1 — Migration 017 correctness `[STATIC]`

**Verdict:** ❌ FAIL — Creates review rows for ALL trip evidence, not just AI-flagged evidence.  
**Action:** Do not apply Migration 017. Apply Migration 018 instead.

---

### M2 — Migration 016 bulk backfill `[STATIC]`

**Verdict:** ⚠️ WARN — Uses `ORDER BY uploaded_at DESC LIMIT 1` which may select the wrong evidence for multi-evidence trips. Already applied to production. Legacy Category B records may exist.  
**Action:** Run Category B diagnostic query from GRAINSHIELD_EVIDENCE_RECONCILIATION.md to identify affected rows. Officer reconciliation required for any found.

---

### M3 — Migration 018 correctness `[STATIC]`

**Analysis:**
- Backfill source: `verification_results WHERE decision = 'manual_review'` ✅
- JOIN chain: `vr → te → trips` with proper `evidence_id` linkage ✅
- Guard: `NOT EXISTS (mrr WHERE trip_id = ? AND evidence_id = ?)` ✅
- Partial UNIQUE index: `WHERE status NOT IN ('resolved', 'escalated')` ✅
- Idempotent: safe to run multiple times ✅
- Skips trips with `created_by IS NULL` to satisfy NOT NULL FK constraint ✅
- Does NOT modify existing rows ✅

**Verdict:** ✅ PASS (static analysis only — pending execution on production data)

---

## Section 3: Concurrent Worker Behavior — Static Analysis

### C1 — Concurrent worker processes `[STATIC]`

**Scenario:** Two worker processes both process the same evidence, both reach `verStatus = 'manual_review'`.

**Step 1 — Claim verification:**
Worker uses `claim_pending_verification` RPC (atomic). Only one worker can claim a given `verification_results` row. Second worker gets empty result — does not proceed. ✅

**Step 2 — Manual review insert:**
Both workers claim DIFFERENT verification jobs for the same trip but both result in `manual_review`. Both check `maybeSingle()` on `(trip_id, evidence_id)` simultaneously. Race condition possible if evidence_id is different between the two jobs (different evidence for same trip). Without UNIQUE index → two active rows.

After Migration 018's partial UNIQUE index → second INSERT fails with constraint violation → warning logged → first row is the authoritative one. ✅

**Verdict:** ✅ PASS after Migration 018. ⚠️ WARN before Migration 018.

---

## Section 4: Live System Observations

### L1 — Worker health check `[EXECUTED]`

**Observation:** Worker daemon (task-6997) started at `2026-11-04T23:05:47Z`, running with `CV_PROVIDER=http`.  
**Task:** task-6997  
**Status:** Running (confirmed by task manager, started in prior session)  
**Log:** `file:///C:/Users/Vansh%20patil/.gemini/antigravity/brain/.../tasks/task-6997.log`

**Note:** Worker uses `CV_PROVIDER=http` mode — calls the Python FastAPI inference service. If the AI service is not running, CV calls fall back to `manual_review` decision per line 217 of worker.js (HTTP error → `decision: "manual_review"`).

---

### L2 — Admin dashboard dev server `[EXECUTED]`

**Observation:** Admin dashboard (task-6788) running on port 3001.  
**Status:** Running (started in prior session).  
**Lint status:** 0 errors after prettier fix in commit `70be08e`.

---

### L3 — Citizen frontend dev server `[EXECUTED]`

**Observation:** Citizen frontend (task-6783) running on port 8080.  
**Status:** Running (started in prior session).

---

### L4 — End-to-end officer review flow `[STAGED — not yet executed]`

**Test plan (would execute in staging with test accounts):**
1. Submit a trip as `driver@grainshield.gov.in` → upload evidence photo.
2. Observe worker processes verification → AI decides `manual_review` (or mock triggers it).
3. Log in as `test_runner_b@grainshield.local` (officer role) → navigate to Verification → find the trip.
4. Confirm review form is visible (review row must exist in `manual_review_requests`).
5. Enter decision "PASS" + notes "Integration test officer approval Sprint 5.1" → submit.
6. Confirm: (a) trip status changes to `pass`, (b) `audit_logs` has `manual_review_pass` entry, (c) `consumed_at` is set on the review row.
7. Attempt to resolve the same review again → expect "already resolved" error. ✅

**Expected outcomes documented. Test not executed on production.**

---

### L5 — Migration 018 pre-flight queries `[STAGED — not yet executed]`

The PRE-01 through PRE-07 diagnostic queries from GRAINSHIELD_MIGRATION_017_CORRECTED_PLAN.md must be run in Supabase SQL Editor before applying Migration 018.

**Expected:**
- `PRE-04` (rows to insert) ≥ 0
- `PRE-05` (old 017 would insert) ≥ `PRE-04` — confirms 017 is wrong
- `PRE-06` (trips with no created_by) = 0 — required before safe application

---

## Section 5: Summary

| Test | Type | Result |
|------|------|--------|
| T1 — Officer review happy path | STATIC | ✅ PASS |
| T2 — Double-resolution race | STATIC | ✅ PASS |
| T3 — No review row guard | STATIC | ✅ PASS |
| T4 — State machine on pass | STATIC | ✅ PASS (well-formed data) |
| T5 — State machine on retake/rejected | STATIC | ✅ PASS |
| T6 — Geofence guard | STATIC | ✅ PASS |
| T7 — Notes validation | STATIC | ✅ PASS |
| T8 — Worker idempotency | STATIC | ✅ PASS (after M018) |
| T9 — SECURITY DEFINER | STATIC | ✅ PASS |
| M1 — Migration 017 | STATIC | ❌ FAIL — do not apply |
| M2 — Migration 016 backfill | STATIC | ⚠️ WARN — legacy records may exist |
| M3 — Migration 018 | STATIC | ✅ PASS |
| C1 — Concurrent workers | STATIC | ✅ PASS (after M018) |
| L1 — Worker health | EXECUTED | ✅ Running |
| L2 — Admin dashboard | EXECUTED | ✅ Running |
| L3 — Citizen frontend | EXECUTED | ✅ Running |
| L4 — E2E officer review | STAGED | ⬜ Not executed |
| L5 — M018 pre-flight | STAGED | ⬜ Not executed |

---

## Section 6: GO / NO-GO for Migration 018

**Overall verdict: CONDITIONAL GO**

Conditions for GO:
- [x] Migration 017 not yet applied ✅
- [ ] PRE-01 through PRE-07 diagnostic queries executed and documented
- [ ] PRE-06 returns 0 rows (all manual_review trips have `created_by`)
- [ ] POST-01 through POST-04 verification run immediately after application

If all conditions are met: **Apply Migration 018 manually via Supabase SQL Editor.**
