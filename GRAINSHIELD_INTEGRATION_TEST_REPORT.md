# GrainShield AI — Integration Test Report

**Date:** 2026-11-05  
**Method:** Static code analysis of complete workflow  
**Test environment:** No live Supabase access during this test; analysis based on code review

---

## Workflow Under Test

The 13-step end-to-end workflow from dispatch to FPS delivery.

---

## Step-by-Step Analysis

### Step 1: Admin Creates and Dispatches a Trip

**Components:** `apps/admin/src/routes/trips.tsx` → `admin_dispatch_trip` RPC → migration 019

| Check | Status |
|-------|--------|
| Admin must be `admin` or `super_admin` | ✅ Enforced inside RPC |
| Vehicle number required | ✅ |
| Vehicle validated against master registry (post mig-022) | ✅ Fixed in 022 |
| Stage, district, driver selection | ✅ All fields in dispatch modal |
| Trip code generated (GS-YYYY-NNNNNN) | ✅ Sequence-backed |
| Trip inserted in `draft` status | ✅ |
| Audit log written | ✅ |

**Gap:** Before migration 022, any vehicle number is accepted without validation.

---

### Step 2: Unique Trip ID Generated

**Components:** `generate_trip_code()` → `trip_code_seq` sequence

| Check | Status |
|-------|--------|
| Sequence is globally monotonic | ✅ |
| Format GS-YYYY-NNNNNN | ✅ |
| No reuse of codes | ✅ DB UNIQUE constraint on `trip_code` |
| Year embedded | ✅ Uses `to_char(now(), 'YYYY')` |
| Minimum 6-digit suffix | ✅ `lpad(v_seq, 6, '0')` |
| Concurrent dispatch safety | ✅ Sequence `nextval` is atomic |

**Status: ✅ PASS**

---

### Step 3: Vehicle and Driver Assigned

**Components:** `admin_dispatch_trip()` params

| Check | Status |
|-------|--------|
| `vehicle_number` stored on trip | ✅ |
| `vehicle_id` FK stored (post mig-022) | ✅ Fixed |
| `driver_id` FK stored | ✅ |
| Driver must have `user` role | ✅ Validated in RPC |
| Assignment audit logged | ✅ metadata includes vehicle_id, driver_id |

---

### Step 4: Driver Sees the Trip

**Components:** `frontend/src/routes/my-trips.tsx`, `mobile/app/(app)/trip.tsx`

| Check | Status |
|-------|--------|
| Citizen web: trips listed by `auth.uid()` | ✅ RLS enforces user scope |
| Mobile: trip search by trip code | ✅ |
| Driver can see trip status | ✅ |
| Trip shows checkpoint guidance | ✅ Via `help.tsx` FAQ |

**Gap:** Driver is assigned by `driver_id` FK but citizens view trips by their own `auth.uid()` as creator. If the admin creates the trip and assigns a different driver_id, the driver cannot see it in their "My Trips" page. The `my-trips` query filters by `user_id` = current user, not `driver_id`. This is a data model gap — `driver_id` FK on trips is not used in citizen queries.

---

### Step 5: Driver Submits Checkpoint Evidence

**Components:** `frontend/src/routes/index.tsx`, `mobile/app/(app)/index.tsx`

| Check | Status |
|-------|--------|
| Photo required (file input / camera) | ✅ |
| Photo uploaded to Supabase Storage | ✅ `evidence-uploads` bucket |
| Evidence record created in `trip_evidence` | ✅ |
| `pending_verification` created in `verification_results` | ✅ |
| Offline fallback: saves to outbox | ✅ Mobile only |
| Stage selection (first_mile / last_mile) | ✅ Pill selector |

**Gap:** No per-checkpoint enforcement. CP1 and CP2 are both `first_mile` — submitting one photo marks the entire first_mile stage as evidenced.

---

### Step 6: AI Processes the Photograph

**Components:** `ai-worker/src/worker.js`, `ai-model/app.py`

| Check | Status |
|-------|--------|
| Worker polls `claim_pending_verification()` RPC | ✅ |
| Atomic job claiming (no double-processing) | ✅ Mig-009/011 |
| Stale job recovery (5-min DB window) | ✅ Mig-012 |
| Plate detection via YOLOv8 | ✅ |
| OCR with perspective correction | ✅ |
| Plate match against `trips.vehicle_number` | ✅ |
| Result written to `verification_results` | ✅ |
| Status updated to `pass` or `manual_review` | ✅ Via state machine trigger |

**Gap:** Worker stall timeout (90s) is misaligned with DB requeue window (5min). Set `PROCESSING_TIMEOUT_MS=300000` in `ai-worker/.env`.

---

### Step 7: Admin Sees the Result

**Components:** `apps/admin/src/routes/verification.index.tsx`, `verification.$tripId.tsx`

| Check | Status |
|-------|--------|
| Verification queue shows pending reviews | ✅ |
| Realtime updates on `manual_review_requests` | ✅ Dashboard |
| Realtime updates on `trips` table | ✅ Dashboard (added earlier) |
| Signed URL for evidence photo | ✅ |
| AI confidence score displayed | ✅ |
| Detected plate vs expected plate | ✅ |

---

### Step 8: Officer Resolves Uncertain Evidence

**Components:** `apps/admin/src/routes/verification.$tripId.tsx` → `resolveManualReview()` → `resolve_manual_review` RPC

| Check | Status |
|-------|--------|
| Officer can choose: Pass / Retake / Reject | ✅ Radio buttons |
| Notes mandatory | ✅ Min 5 chars validated |
| RPC enforces `officer/admin/super_admin` only | ✅ |
| State machine allows `pass` after manual review override | ✅ Mig-015 |
| 15-minute override consumption window | ✅ Mig-015 line 78 |
| Audit log on resolution | ✅ |

**Gap:** 15-minute window may expire if officer review takes too long. Consider extending or making configurable.

---

### Step 9: Citizen Receives the Decision

**Components:** `frontend/src/routes/result.tsx`, `frontend/src/routes/trip.tsx`

| Check | Status |
|-------|--------|
| `result.tsx` shows PASS banner | ✅ |
| `result.tsx` shows RETAKE banner (new) | ✅ Added this session |
| `result.tsx` shows REJECTED banner (new) | ✅ Added this session |
| `trip.tsx` shows status-change notification banner (new) | ✅ Added this session |
| Realtime subscription on `trips` table | ✅ |
| Auto-refresh polling for active statuses | ✅ 30s interval |
| Mobile `result.tsx` retake guidance | ⏳ Not yet enhanced |

---

### Step 10: GPS Updates Associated with Active Trip

**Components:** `mobile/hooks/use-gps-tracking.ts`, `trip_locations` table

| Check | Status |
|-------|--------|
| GPS started only with `tripId` | ✅ |
| Foreground push every 30s | ✅ |
| Background push on each OS location event (new) | ✅ Fixed this session |
| Admin map shows live position | ✅ |
| Staleness warning after 10 min | ✅ |

---

### Step 11: Next Eligible Checkpoint Becomes Available

**Status:** ⚠️ NOT ENFORCED

The state machine (migration 015) enforces stage-level transitions only. There is no concept of "checkpoint 1 must complete before checkpoint 2" at the database level. The four checkpoints (CP1-CP4) are UI labels in `help.tsx` only.

A driver can submit one photo for `first_mile` and the stage can be marked `pass` without any CP1 vs CP2 distinction.

---

### Step 12: CP4 Final Requirements Evaluated

**Status:** ✅ PARTIAL

Migration 015 includes a check for `last_mile` completion — references a `geofence_status` column on `trip_evidence` (added in migration 013/014). The trigger requires geofence pass for `last_mile → completed` transitions. FPS banner detection is validated.

However, there is no explicit "CP4 final" logic — the system treats any `last_mile` evidence with geofence pass as satisfying the terminal delivery requirement.

---

### Step 13: Trip Completes Only After All Required Conditions Pass

**Components:** State machine trigger `check_trip_status_transition()` (migration 015)

| Check | Status |
|-------|--------|
| Evidence photo required for `pass` | ✅ |
| Officer override OR clean AI PASS required | ✅ |
| Geofence pass required for `last_mile → completed` | ✅ |
| `completed` is a terminal state | ✅ No outbound transitions |
| Completed trip cannot be resubmitted | ✅ Trigger blocks |
| Audit log at completion | ✅ |

**Gap:** No sub-stage checkpoint count enforcement. One photo per stage satisfies all checkpoint requirements for that stage.

---

## Integration Test Summary

| Step | Implemented | Gaps |
|------|-------------|------|
| 1. Admin dispatch | ✅ | Vehicle validation (mig-022 fixes) |
| 2. Trip code | ✅ | None |
| 3. Vehicle/driver assign | ✅ | vehicle_id FK (mig-022 fixes) |
| 4. Driver sees trip | ⚠️ | driver_id not used in citizen trip queries |
| 5. Submit evidence | ✅ | No per-checkpoint enforcement |
| 6. AI processing | ✅ | Worker stall timeout mismatch |
| 7. Admin sees result | ✅ | None |
| 8. Officer review | ✅ | 15-min window may expire |
| 9. Citizen notification | ✅ | Mobile result.tsx not enhanced |
| 10. GPS tracking | ✅ (fixed) | No offline GPS queue |
| 11. Next checkpoint | ❌ | Checkpoints not modeled in DB |
| 12. CP4 evaluation | ⚠️ | Partial — geofence only |
| 13. Trip completion | ✅ | No sub-stage count check |

---

## Critical Gaps Requiring DB Changes

1. **Checkpoint table** — Model CP1/CP2/CP3/CP4 as rows; require each in sequence before the next is enabled.
2. **Driver-sees-trip** — Either change `my-trips` query to `OR driver_id = auth.uid()` or change the data model so dispatched trips are attributed to the driver.

Both require new migrations (023+) and are backlogged for the next sprint.
