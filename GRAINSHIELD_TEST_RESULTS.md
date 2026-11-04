# GrainShield AI — Test Results

**Project:** GRAINSHIELD AI — SFIC PS000006  
**Test Date:** 2026-11-05  
**HEAD Commit:** `b745c42` → pending `d6xxxxx` (this sprint)  
**Tester:** Automated + Manual

---

## 1. TypeScript Build Checks

| App | Command | Exit Code | Result |
|-----|---------|-----------|--------|
| Admin Dashboard | `npx tsc --noEmit` | 0 | ✅ PASS |
| Citizen Frontend | `npx tsc --noEmit` | 0 | ✅ PASS |

Both apps compile with zero TypeScript errors after all P0 fixes.

---

## 2. Officer Review Workflow (P0.1)

### Test: Approve a manual_review trip

**Pre-condition:** A trip exists in `manual_review` status with a corresponding `manual_review_requests` row.

**Steps:**
1. Sign in to Admin at `http://localhost:3001` as `admin@grainshield.gov.in`
2. Navigate to Verification → click trip in queue
3. Enter justification notes (≥5 chars), select "Approve", click Confirm

**Expected:** Trip status transitions to `pass`, audit log entry created, no DB error.  
**Previous behaviour (before fix):** `Review failed: more than one row returned by a subquery`  
**Root cause fixed:** Migration 016 — `WHERE evidence_id = v_evidence_id` strict match  
**Status:** ✅ FIXED — Migration 016 deployed to production Supabase

### Test: Guard when no review row exists

**Steps:**
1. Navigate to a `manual_review` trip that has no `manual_review_requests` row

**Expected:** Error message shown: "No pending review request found for this trip…"  
**Status:** ✅ FIXED — guard added in `verification.$tripId.tsx`

---

## 3. AI Worker — manual_review_requests Creation (P0.2)

**Test:** Submit a new trip through citizen portal; wait for AI worker poll cycle (15s)

**Expected behaviour (after fix):**
- Worker calls AI inference → decision: `manual_review`
- Worker checks for existing review row (idempotent)
- Worker fetches `trip.created_by` (satisfies `requested_by NOT NULL FK`)
- Worker inserts row into `manual_review_requests` with `status = 'pending'`
- Row appears in Admin verification queue

**Status:** ✅ FIXED — `ai-worker/src/worker.js` updated in commit `b745c42`

---

## 4. Stage-Specific AI Checks (P0.3)

| Stage | FPS Banner OCR | Plate OCR | Vehicle Detection |
|-------|---------------|-----------|------------------|
| `first_mile` | ❌ NOT run | ✅ Run | ✅ Run |
| `last_mile` | ✅ Run | ✅ Run | ✅ Run |

**Verification:** `ai-model/inference.py` lines 769-770:
```python
if stage == "last_mile":
    # scan_fps_banner runs only here
```

**Status:** ✅ CONFIRMED — no code change required; stage flows correctly from worker to CV API

---

## 5. AI Decision Validation Matrix

The following 8-scenario matrix was verified in `ai-worker/test_comprehensive_validation_matrix.js`:

| Scenario | Input | Expected Decision | Actual Trip Status | Result |
|----------|-------|------------------|-------------------|--------|
| S1 | Clear image, exact plate match | PASS | pass | ✅ |
| S2 | Different registered plate, confident OCR | FAIL | rejected | ✅ |
| S3 | One character difference in plate | MANUAL_REVIEW | manual_review | ✅ |
| S4 | Low OCR confidence / blurry | MANUAL_REVIEW | manual_review | ✅ |
| S5 | FPS banner correct, last_mile | PASS | pass | ✅ |
| S6 | FPS banner mismatch, last_mile | FAIL | rejected | ✅ |
| S7 | Vehicle not detected | MANUAL_REVIEW | manual_review | ✅ |
| S8 | Multiple OCR variant disagreement | MANUAL_REVIEW | manual_review | ✅ |

**Decision policy verified:**
- `PASS` requires: exact normalized plate match + vehicle detected + OCR consensus ≥ threshold
- `FAIL` requires: confident read of wrong registration
- `MANUAL_REVIEW` on: low consensus, ambiguous read, single-char difference
- `MANUAL_REVIEW` **never** auto-transitions to `rejected` without officer decision

---

## 6. Status Color Display

| Status | Expected Color | Location | Result |
|--------|---------------|----------|--------|
| `pass` | Green | citizen trip.tsx, failed.tsx | ✅ |
| `rejected` | Red | citizen trip.tsx, failed.tsx | ✅ |
| `retake` | Amber | citizen trip.tsx, failed.tsx | ✅ FIXED |
| `manual_review` | Amber | citizen trip.tsx, failed.tsx | ✅ FIXED |
| `processing` | Blue | citizen processing.tsx | ✅ |

---

## 7. Officer Queue — All manual_review Trips Visible (P0.4)

**Root cause:** `getReviewQueue()` used `trip_evidence!inner` join — excluded trips with evidence but no review row.

**Fix:** Changed to left join: `trip_evidence(id, original_filename, storage_path, uploaded_at)` (removed `!inner`)

**Status:** ✅ FIXED — `apps/admin/src/lib/admin-queries.ts`

---

## 8. Migration 017 — Backfill

**SQL:** `database/migrations/017_backfill_manual_review_requests.sql`

**What it does:**
1. Inserts missing `manual_review_requests` rows for all current `manual_review` trips
2. Idempotent: `NOT EXISTS` guard prevents duplicates
3. Adds `consumed_at` column (idempotent, already in 016)
4. Adds indexes for query performance

**Status:** ✅ CREATED — requires manual application in Supabase SQL Editor

---

## 9. Pending Review Badge

**Feature:** Verification nav link shows a red badge with count of pending reviews.

**Implementation:** `apps/admin/src/components/admin/AdminShell.tsx`
- Calls `getDashboardStats()` on mount
- Polls every 30 seconds
- Shows badge when `pendingReview > 0`

**Status:** ✅ IMPLEMENTED

---

## 10. State Machine Security (Migration 015)

| Test | Expected | Result |
|------|----------|--------|
| Ordinary auth transitions valid states | Allowed | ✅ |
| Service-role direct write (bypass attempt) | Blocked by trigger | ✅ |
| Officer override without consumed_at | Allowed once | ✅ |
| Replay of same override (consumed_at set) | Blocked | ✅ |
| Transition without matching evidence_id | Blocked | ✅ |
| Unauthorized resolver (not matching officer) | Blocked | ✅ |

---

## 11. Known Limitations (Non-blocking)

| Item | Notes |
|------|-------|
| Leaflet map double-init warning | Only in React strict mode dev; guarded in production. No action needed. |
| `trip.tsx` no realtime polling | Trip status updates require manual refresh or navigate-away. Low priority. |
| `mid_mile` stage exists in DB | Not used in PS000006; hidden from citizen upload form. |
| Test records in audit log | 4 override transitions performed by `test_runner_b@grainshield.local` are scripted demonstration records. Physical field evidence was not independently verified. |

---

## 12. Evidence Gallery (Phase 2 — Commit 85fea06)

| Item | Expected | Result |
|------|----------|--------|
| All evidence items shown (not just first) | Full gallery card per evidence | ✅ |
| Each card shows AI decision label | Colour-coded PASS/FAIL/MANUAL_REVIEW | ✅ |
| Signed URLs loaded in parallel | All photos load concurrently | ✅ |
| Full-resolution link per photo | Opens in new tab | ✅ |

---

## 13. Leaflet Strict-Mode Fix (Phase 2 — Commit 85fea06)

| Item | Before | After |
|------|--------|-------|
| live-tracking.tsx Leaflet double-init error | [Unhandled rejection] Map container already initialized | ✅ Fixed — cancelled flag + post-import guard |
| 	racking.tsx citizen map | Same guard already in place | ✅ No change needed |

---

## 14. Trip Status Realtime (Phase 3 — Commit 85fea06)

| Item | Expected | Result |
|------|----------|--------|
| Status updates live when in processing | Realtime channel fires on UPDATE | ✅ |
| 30s polling fallback | setInterval active while in active status | ✅ |
| Terminal statuses don't poll | pass / rejected / completed → no subscription | ✅ |
| Cleanup on unmount | Channel removed, interval cleared | ✅ |

---

## 15. TypeScript Final Check (HEAD 85fea06)

| App | Exit Code | Result |
|-----|-----------|--------|
| Admin Dashboard | 0 | ✅ PASS |
| Citizen Frontend | 0 | ✅ PASS |