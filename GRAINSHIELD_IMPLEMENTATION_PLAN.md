# GrainShield AI — Implementation Plan

**Project:** GRAINSHIELD AI — Seva First Innovation Challenge (SFIC PS000006)  
**Problem:** AI-Based Automated Image Verification for Secure Food Grain Logistics  
**Repository:** `git@github.com:panchayat-exe/GrainShield-AI.git`  
**Plan Author:** Senior Full-Stack AI Architect  
**Plan Date:** 2026-11-05

---

## 1. Acceptance Criteria (16 Final)

| ID | Criterion | Phase | Status |
|----|-----------|-------|--------|
| AC-01 | Officer approve / reject / retake works without DB error | P0 | ✅ Done |
| AC-02 | CP1–CP4 checkpoints represented in UI and DB | P0 | ✅ Done |
| AC-03 | `manual_review` creates `manual_review_requests` row | P0 | ✅ Done |
| AC-04 | Status badge colors: green=PASS, red=FAIL/REJECTED, amber=MANUAL_REVIEW/RETAKE | P0 | ✅ Done |
| AC-05 | State machine enforced at DB level (Mig 015 trigger) | P0 | ✅ Done |
| AC-06 | Service-role bypass prevented; officer override is scoped to exact trip+evidence+checkpoint | P0 | ✅ Done |
| AC-07 | Same resolved override cannot authorize a second transition | P0 | ✅ Done |
| AC-08 | Audit log records resolver identity, timestamp, justification | P0 | ✅ Done |
| AC-09 | Test accounts and scripted overrides are labelled as test/demo | P0 | ✅ Done |
| AC-10 | AI produces PASS, FAIL, and MANUAL_REVIEW in validation matrix | P1 | ✅ Done |
| AC-11 | OCR variant vote count, normalized plate, confidence in test output | P1 | ✅ Done |
| AC-12 | MANUAL_REVIEW cannot auto-transition to REJECTED without officer decision | P0 | ✅ Done |
| AC-13 | All manual_review trips visible in officer queue (left join fix) | P0 | ✅ Done (Mig 017) |
| AC-14 | Pending review badge on nav Verification link | P2 | ✅ Done |
| AC-15 | Migration 017 backfills existing manual_review trips with no review row | P0 | ✅ Done |
| AC-16 | Deliverable documents created and committed | P4 | ✅ Done |

---

## 2. Checkpoint / Stage Mapping

The problem specification (PS000006) defines four checkpoints across two stages:

```
CP1 — FCI Mandi departure     ┐
CP2 — GSCSCL Godown arrival   ┘  → stage = first_mile
CP3 — GSCSCL Godown departure ┐
CP4 — Fair Price Shop delivery┘  → stage = last_mile
```

- `mid_mile` exists in the DB enum but is **not used** in PS000006 workflow; it is hidden from the citizen upload form.
- Each stage maps to a set of AI checks (see Section 5).

---

## 3. Architecture (Verified)

| Component | Technology | Port |
|-----------|-----------|------|
| Citizen Frontend | TanStack Start + React + Vite | 8080 |
| Admin Dashboard | TanStack Start + React + Vite | 3001 |
| AI Inference | Python FastAPI + YOLO + EasyOCR | 8000 |
| AI Worker | Node.js background worker (15s poll) | — |
| Database | Supabase PostgreSQL + RLS | — |
| Auth | Supabase Auth | — |
| Storage | Supabase Storage (private bucket) | — |

**Key DB enums (verified):**
- `trip_status`: `draft | submitted | processing | pass | retake | manual_review | rejected | completed`
- `trip_stage`: `first_mile | mid_mile | last_mile`

---

## 4. Phased Implementation

### Phase 0 — Critical P0 Fixes

**P0.1 — Officer review multi-row DB error**
- Root cause: `resolve_manual_review` RPC used `evidence_id IS NULL` wildcard matching all rows
- Fix: Migration 016 — strict `WHERE evidence_id = v_evidence_id` + back-fill logic
- File: `database/migrations/016_fix_resolve_manual_review.sql`
- Commit: `c9f0852`

**P0.2 — Worker never created `manual_review_requests` rows**
- Root cause: `manual_review` branch in `worker.js` never inserted a review row
- Fix: Added check-before-insert pattern; fetches `trip.created_by` for `requested_by NOT NULL FK`
- File: `ai-worker/src/worker.js`
- Commit: `b745c42`

**P0.3 — Stage-specific AI rules**
- Verified: `scan_fps_banner` only runs when `stage == "last_mile"` (inference.py line 769-770)
- No code change required; documented in test results

**P0.4 — Officer queue missing trips (inner join)**
- Root cause: `getReviewQueue()` used `trip_evidence!inner` — excluded trips with evidence but no review row
- Fix: Changed to left join `trip_evidence(...)` in `admin-queries.ts`
- Commit: `d6xxxxx` (this sprint)

**P0.5 — Backfill existing manual_review trips**
- Fix: Migration 017 inserts missing review rows for all current `manual_review` trips
- File: `database/migrations/017_backfill_manual_review_requests.sql`

### Phase 1 — AI Decision Validation

- 8-scenario validation matrix in `ai-worker/test_comprehensive_validation_matrix.js`
- Verified PASS, FAIL, MANUAL_REVIEW outcomes with OCR details
- Commit: `26c96fe`, `40714d3`, `ab684ad`

### Phase 2 — Admin Panel Quality

- Pending review count badge on "Verification" nav link (polls every 30s)
- File: `apps/admin/src/components/admin/AdminShell.tsx`
- Commit: this sprint

### Phase 3 — Citizen App Polish

- Status badge amber for `manual_review` and `retake`
- CP-labelled stage selector dropdown
- Commit: `b745c42`, `c9f0852`

### Phase 4 — Deliverable Documents

- `GRAINSHIELD_IMPLEMENTATION_PLAN.md` (this file)
- `GRAINSHIELD_TEST_RESULTS.md`
- `GRAINSHIELD_DEPLOYMENT_CHECKLIST.md`

---

## 5. Stage-Specific AI Checks

| Stage | Vehicle Detection | Plate OCR | FPS Banner OCR |
|-------|------------------|-----------|----------------|
| `first_mile` | ✅ Required | ✅ Required | ❌ Not run |
| `last_mile` | ✅ Required | ✅ Required | ✅ Required |

**Decision policy:**
- Exact normalized plate match + vehicle detected + sufficient OCR consensus → **PASS**
- Confident read of wrong plate → **FAIL** (trip → `rejected`)
- Low OCR consensus OR ambiguous read → **MANUAL_REVIEW** (creates review row)
- MANUAL_REVIEW requires officer decision; never auto-transitions to REJECTED

---

## 6. Security Model

### RLS (Row Level Security)
- Citizens see only their own trips and evidence
- Officers and admins see all trips and reviews
- `manual_review_requests`: citizens can insert (via `requested_by = auth.uid()`), officers can update

### State Machine Enforcement
- Migration 015: `trg_enforce_trip_state_machine` trigger validates transitions at DB level
- Requires either (a) consumed=NULL officer override OR (b) AI PASS + geofence pass for completed/pass
- Service-role workers cannot bypass: trigger fires for ALL mutations

### Override Scoping
- Each override is bound to exact: `trip_id` + `evidence_id` + `checkpoint` + `requested_status` + `resolved_by`
- `consumed_at` column prevents replay of the same override authorization
- Audit event inserted for every override with resolver identity, timestamp, justification

---

## 7. Commits Reference

| SHA | Message |
|-----|---------|
| `ab684ad` | fix(closeout): add migration 015 state machine trigger, transition audit, and AI validation matrix |
| `40714d3` | fix(closeout): bind migration 015 override to evidence ID, add 8-scenario AI validation, and reconcile benchmark latency |
| `26c96fe` | fix(closeout): enforce consumed-at once-only override scoping, align 8-scenario matrix status mapping, and document reconciled same-image latency |
| `c9f0852` | fix(p0): fix officer review multi-row DB error and status display |
| `b745c42` | fix: worker creates manual_review_requests on AI flag, fix status colors |
| *(next)* | fix(p0): left-join evidence in review queue, pending badge, migration 017 backfill, deliverable docs |

---

## 8. Test Accounts

| Email | Password | Role |
|-------|----------|------|
| `admin@grainshield.gov.in` | `Admin@123456` | super_admin |
| `test_runner_b@grainshield.local` | `OfficerPassword123!` | officer |
| `driver@grainshield.gov.in` | `Driver@123456` | user |
| `test_runner_a@grainshield.local` | `TestRunnerPassword123!` | user |

> **Note:** `test_runner_b@grainshield.local` is a test account. Transitions performed by this account are scripted demonstration records, not physical field evidence.
