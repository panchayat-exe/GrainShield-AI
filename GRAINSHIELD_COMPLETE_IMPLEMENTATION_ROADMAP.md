# GrainShield AI — Complete Implementation Roadmap

**Version:** 1.0
**Date:** 2026-11-05
**HEAD at planning time:** `0a0c16c`
**Basis:** GRAINSHIELD_COMPLETE_PLATFORM_AUDIT.md

---

## Implementation Principles

1. **Fix before feature.** Broken items (F-grade) are addressed before new capabilities.
2. **No production migration without explicit approval.** Every schema change is authored, reviewed, and explicitly authorized before execution.
3. **Preserve existing RLS, state machine, and audit protections.**
4. **No hardcoded trip IDs, fake GPS coordinates, simulated AI decisions.**
5. **Incrementally commit, CI must stay green.**
6. **Ask for external credentials — never invent them.**

---

## Phase 1 — AI Model Hardening
*Priority: P0 / P1 | Estimated complexity: Medium | Duration: 2–3 days*

### Objective
Ensure the trained plate-detector (`best.pt`) is reliably loaded in every deployment, improve OCR robustness, and add a benchmark gate to CI.

### Tasks

#### 1.1 — Copy `best.pt` to `weights/` directory [P0, 30 min]
```
ai-model/runs/plate_detection/rtx3050_img512_b2/weights/best.pt
→ ai-model/weights/best.pt
```
- Verify it is tracked by Git (not excluded by `.gitignore`).
- If `.gitignore` excludes `weights/*.pt`, add a `.gitkeep` exception and document LFS or manual deployment.

#### 1.2 — Add startup model check in `server.py` [P0, 1 hour]
- On FastAPI startup event, call `resolve_plate_model_path()`.
- If plate model not found, log a `CRITICAL` error and set a health flag to `degraded`.
- Expose `/health` endpoint that returns `{"status": "ok"}` or `{"status": "degraded", "reason": "plate_model_missing"}`.

#### 1.3 — Verify two-stage pipeline integration [P0, 2 hours]
- Confirm `inference.py` uses `best.pt` for plate region cropping (stage 2) and the COCO vehicle model only for vehicle detection (stage 1).
- Write a unit test: provide a test image of an Indian truck with a readable plate; assert `detected_plate` is not None and `plate_match` is computed.
- Document the test result — do not fabricate.

#### 1.4 — OCR perspective correction [P1, 1 day]
- Add `cv2.getPerspectiveTransform` + `cv2.warpPerspective` step after plate region crop.
- Use the four corners of the plate bounding box from the YOLO detection to deskew before OCR.
- Test on 5 real plate images at various angles.

#### 1.5 — Benchmark report [P1, 2 hours]
- Run `benchmark_cpu.py` on the current pipeline (with `best.pt` loaded).
- Produce `GRAINSHIELD_AI_BENCHMARK_REPORT.md` with actual latency (p50, p95, p99), mAP, precision, recall.
- Do not claim any metric without running the benchmark.

#### 1.6 — CI benchmark gate [P2, 1 day]
- Add GitHub Actions step: run inference on 5 known test images; assert `mAP50 > 0.90` and `avg_latency_ms < 5000`.
- Fail the build if threshold is not met.

**Dependencies:** None — purely local AI model work.
**External requirements:** None.

---

## Phase 2 — Automatic Trip Generation & Lifecycle
*Priority: P1 | Estimated complexity: Medium-High | Duration: 3–4 days*

### Objective
Eliminate manual Trip Code entry by drivers. Admin dispatches trips with server-generated unique codes. Drivers see only their assigned trips and join by QR scan or trip selection — not by typing a code.

### Tasks

#### 2.1 — Server-side Trip Code generator [P1, 2 hours]
Write migration `019_trip_code_sequence.sql`:
```sql
CREATE SEQUENCE trip_code_seq START 100001;

CREATE OR REPLACE FUNCTION generate_trip_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'GS-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('trip_code_seq')::TEXT, 6, '0');
END;
$$;

ALTER TABLE trips ALTER COLUMN trip_code SET DEFAULT generate_trip_code();
```
- **Do not apply to production until explicitly authorized.**
- Verify existing `trip_code` unique constraint does not conflict.

#### 2.2 — Driver assignment from `profiles` [P1, 3 hours]
- Update admin `trips.tsx` Create Trip modal:
  - Replace driver name free-text with a searchable dropdown populated by `getProfiles({ role: 'user' })`.
  - Store `driver_id` (UUID) on the trip record.
  - Add `driver_id UUID REFERENCES profiles(id)` column to `trips` table in migration `019` (nullable for backward compatibility).

#### 2.3 — Vehicle assignment from `vehicles` table [P1, 2 hours]
- Update Create Trip modal:
  - Replace vehicle number free-text with a searchable dropdown from `vehicles` table.
  - On select, auto-populate the RC number field.

#### 2.4 — Citizen app: show assigned trips [P1, 1 day]
- Add `/my-trips` route to `frontend/src/routes/`.
- Query: `SELECT * FROM trips WHERE driver_id = auth.uid() ORDER BY created_at DESC`.
- Display trip code, stage, status, created date.
- Link each row to `/trip?tripId={id}` for full detail.

#### 2.5 — Remove manual Trip Code field from Upload screen [P1, 2 hours]
- Replace the `Trip Code` text input with a trip selector:
  - If driver has assigned trips → show a dropdown of their pending/active trips.
  - If trip is selected, `tripCode` and `vehicleNumber` auto-populate from the trip record.
  - If driver has no assigned trip, show a message: "No active trip assigned. Contact your dispatch officer."
- Keep backward compatibility: if `driver_id` is null, the existing manual entry path remains temporarily.

#### 2.6 — QR Code on trip dispatch (optional, P3)
- Admin "Create Trip" produces a QR code encoding the `trip_id`.
- Driver scans QR → app opens the trip automatically.
- Deferred to Phase 3+.

**Dependencies:** 2.1 → 2.2 → 2.3 → 2.4 → 2.5 (sequential).
**External requirements:** None for core. QR scan requires `expo-camera` QR scanning (optional).

---

## Phase 3 — GPS Reliability
*Priority: P1 | Estimated complexity: Medium | Duration: 2 days*

### Objective
Fix Android background GPS tracking so location is captured even when the driver minimises the app.

### Tasks

#### 3.1 — Add `ACCESS_BACKGROUND_LOCATION` permission [P1, 1 hour]
In `mobile/app.json` → `android.permissions`, add:
```
"android.permission.ACCESS_BACKGROUND_LOCATION"
```
In `expo-location` plugin config, add `"isAndroidBackgroundLocationEnabled": true`.

#### 3.2 — Switch to `Location.startLocationUpdatesAsync` [P1, 4 hours]
- Register a background task using `TaskManager.defineTask`.
- Replace `watchPositionAsync` (foreground only) with `startLocationUpdatesAsync` (foreground + background).
- Background task pushes to Supabase via `recordLocation()`.
- Handle task cancellation on `stopTracking()`.
- Test: minimise app → drive 500m → verify `trip_locations` rows are inserted.

#### 3.3 — iOS background mode [P1, 2 hours]
- Add `UIBackgroundModes: ["location"]` to iOS infoPlist in `app.json`.
- Confirm `NSLocationAlwaysAndWhenInUseUsageDescription` matches iOS App Store requirements.
- Note: Apple requires explicit justification for background location — draft the user-facing explanation.

#### 3.4 — Staleness alert on admin live-tracking [P2, 2 hours]
- In `live-tracking.tsx`, if `recordedAt` is > 10 minutes ago, show a yellow warning on that vehicle's card: "⚠ Last signal 12 min ago."
- No backend change needed — purely UI.

#### 3.5 — GPS status indicator in mobile trip screen [P2, 2 hours]
- Show a persistent status bar in the mobile tracking/trip screen: "🟢 GPS Active" / "🟡 Paused" / "🔴 GPS Error."
- Use `gpsStatus` from `useGpsTracking`.

**Dependencies:** 3.1 → 3.2 → 3.3.
**External requirements:** Apple Developer account for TestFlight distribution (Phase 9).

---

## Phase 4 — Citizen / Driver Application Completion
*Priority: P1–P2 | Estimated complexity: Medium | Duration: 3 days*

### Tasks

#### 4.1 — Driver Profile Page (web + mobile) [P1, 1 day]
- Add `frontend/src/routes/profile.tsx`:
  - Display: full name, email, phone, district, role.
  - Edit: full name, phone, district (Supabase `profiles` table UPDATE).
  - Change password via Supabase Auth `updateUser({ password })`.
- Add `mobile/app/(app)/profile.tsx` with equivalent functionality.
- Both must use Supabase Auth `useAuth()` for identity.

#### 4.2 — My Trips Page (web) [P1, 4 hours]
- `frontend/src/routes/my-trips.tsx`:
  - List all trips where `user_id = auth.uid()`.
  - Columns: Trip Code, Stage, Status, Created At, link to Trip Detail.
  - Pagination (20 per page).

#### 4.3 — Trip Progress Indicator [P2, 4 hours]
- In the Upload screen and My Trips list, show a checkpoint progress bar:
  - CP1: First Mile departure photo.
  - CP2: First Mile arrival photo.
  - CP3: Last Mile departure photo.
  - CP4: Last Mile delivery photo.
- Derive progress from `trip_evidence` count and stage values.

#### 4.4 — Help & FAQ Page [P2, 2 hours]
- `frontend/src/routes/help.tsx`: static FAQ about how to use the app, checkpoint requirements, what manual review means.
- `mobile/app/(app)/help.tsx`: same content.

#### 4.5 — Navigation Improvements (web) [P2, 2 hours]
- Add links to Profile, My Trips, Help in the mobile navigation footer.
- Ensure "Back" navigation works correctly on all screens.

**Dependencies:** Phase 2.4 (assigned trips) is a prerequisite for 4.2.

---

## Phase 5 — Admin / Officer Platform Completion
*Priority: P2 | Estimated complexity: Medium | Duration: 3 days*

### Tasks

#### 5.1 — Admin Profile Page [P2, 2 hours]
- `apps/admin/src/routes/profile.tsx`:
  - Display and edit: full name, district, phone.
  - Change password.
  - Show current role.

#### 5.2 — User Invite Workflow [P2, 1 day]
- Add "Invite User" button in `users.tsx`.
- Call Supabase Auth `admin.inviteUserByEmail({ email, options: { data: { role: 'officer' } } })`.
- Invited users receive a magic-link email and set their password on first login.
- **Requires:** Supabase service-role key in admin backend (already available via worker). Need to expose as a secure RPC or Edge Function.

#### 5.3 — Account Suspension [P2, 4 hours]
- Add a `suspended` boolean column to `profiles` (migration `020`).
- Update RLS: if `suspended = true`, deny all data access.
- Admin UI: "Suspend" / "Reactivate" button on user row.

#### 5.4 — Reports: Trend Charts [P2, 1 day]
- Add a daily trend line chart (trips submitted vs. verified pass vs. review) using a lightweight charting library (Recharts or Chart.js).
- Data source: group `trips` by `DATE(created_at)` with status breakdown.

#### 5.5 — Notifications Centre (Admin) [P2, 1 day]
- Implement a simple notification bell in the admin nav bar.
- On new `manual_review_requests` INSERT, push a notification: "New review required: trip TRIP-XXXX."
- Use Supabase Realtime subscription already established on the dashboard.
- Persist notifications in `audit_logs` with `action = 'notification_created'`.

#### 5.6 — Audit Log Date Filter [P2, 2 hours]
- Add date-from / date-to filter inputs to `audit-logs.tsx`.
- Pass to `getAuditLogs({ dateFrom, dateTo })` in `admin-queries.ts`.

**Dependencies:** 5.2 requires Supabase invite configuration (G-grade dependency — see Phase 6 requirements document).

---

## Phase 6 — Identity, Profiles, Roles & Permissions
*Priority: P1–P2 | Estimated complexity: Low-Medium | Duration: 1–2 days*

### Tasks

#### 6.1 — Profile Auto-Creation on Registration [P1, 2 hours]
- Verify that `profiles` row is created automatically via Supabase Auth `on_auth_user_created` trigger (migration 001).
- If the trigger is missing or partial, write a repair migration.
- Test: register a new account → confirm `profiles` row exists with correct `user_id`.

#### 6.2 — Role Hierarchy Enforcement Server-Side Only [P2, 2 hours]
- Remove client-side `canAssignRole()` check from `users.tsx`.
- The RPC `update_user_role` is the sole authority — it already enforces hierarchy.
- Client should display the error returned by the RPC, not compute permission locally.

#### 6.3 — MFA for Admin / Super Admin [P1, 1 day]
- Enable Supabase MFA (TOTP) for accounts with `role IN ('admin', 'super_admin')`.
- Add MFA enrollment step to admin login flow in `apps/admin/src/routes/login.tsx`.
- **Requires:** Supabase project MFA setting enabled (G-grade — requires project settings access).

---

## Phase 7 — Cross-Platform Integration
*Priority: P2 | Estimated complexity: High | Duration: 1 week*

### Tasks

#### 7.1 — Vehicles Table UI
- Add `apps/admin/src/routes/vehicles.tsx`: CRUD for registered vehicles (plate number, type, owner, organization).
- Link to `vehicles` FK in trip creation (Phase 2.3).

#### 7.2 — Organizations Table UI
- Add `apps/admin/src/routes/organizations.tsx`: CRUD for GSCSCL godowns, FCI mandis, FPS shops.
- Link origin/destination in trip creation from organizations.

#### 7.3 — 4-Checkpoint Workflow Enforcement
- Enforce at the UI level that CP1 and CP2 (first_mile) are completed before CP3 and CP4 (last_mile) can be submitted.
- Read `trip_evidence` count per stage to determine which checkpoint is next.
- Show: "Checkpoint 2 of 4 — Last mile departure photograph required."

#### 7.4 — Trip Completion Workflow
- When all 4 checkpoints are submitted and verified, automatically transition trip status to `completed`.
- Notify driver: "Your trip has been successfully verified and closed."

**Dependencies:** Phase 2 (assigned trips), Phase 4 (profile pages).

---

## Phase 8 — Security, Reliability & Scalability
*Priority: P1–P2 | Estimated complexity: Medium | Duration: 1 week*

### Tasks

#### 8.1 — Dead-Letter Queue for Worker [P1, 1 day]
- If a worker job fails (AI model error, network timeout), write to a `failed_jobs` table with error details.
- Admin panel: "Failed Jobs" list with retry button.
- Prevent jobs from staying in `processing` indefinitely — add a 10-minute timeout that marks stalled jobs as `error`.

#### 8.2 — Worker Health Endpoint [P2, 2 hours]
- Add `/health` to the AI FastAPI server.
- Worker checks this endpoint on startup.
- If AI server is down, worker pauses job claiming and logs `CRITICAL`.

#### 8.3 — Error Tracking [P2, 1 day]
- Integrate Sentry (or equivalent) into:
  - `ai-model/src/server.py` (Python SDK).
  - `ai-worker/src/worker.js` (JavaScript SDK).
  - `apps/admin` (React SDK).
  - `frontend` (React SDK).
- **Requires:** Sentry DSN — see requirements document.

#### 8.4 — Rate Limiting on Admin API [P2, 2 hours]
- Add rate limiting to `update_user_role` RPC (max 20 role changes per hour per actor).
- Log excessive role-change attempts to `audit_logs`.

#### 8.5 — Supabase Staging Project [P1, 1 day]
- Create a separate Supabase project for staging.
- Run all migrations in staging first.
- Mirror production RLS policies.
- **Requires:** Supabase organisation access — see requirements document.

#### 8.6 — Secrets Rotation Policy [P2, 2 hours]
- Document: how to rotate `SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY`.
- Add rotation reminder to `GRAINSHIELD_DEPLOYMENT_CHECKLIST.md`.

---

## Phase 9 — QA, Field Validation & Deployment Preparation
*Priority: P1 | Estimated complexity: High | Duration: 1–2 weeks*

### Tasks

#### 9.1 — Integration Test Suite [P1, 2 days]
- End-to-end test: register driver → admin creates trip → driver uploads photo → AI processes → result returned.
- Test: manual_review → officer approves → trip status becomes `completed`.
- Test: duplicate trip code → verify rejection.
- Use a dedicated test Supabase project.

#### 9.2 — Field Trial (Pilot) [P1, 1 week]
- Select 1 district, 3–5 drivers, 1 officer.
- Run 10 real trips through the system.
- Collect: AI accuracy vs. officer override rate, GPS drop frequency, upload failure rate, review resolution time.
- Document findings in `GRAINSHIELD_PILOT_REPORT.md`.

#### 9.3 — Android APK Build & Distribution [P2, 1 day]
- Run `eas build --platform android` with Expo EAS.
- Distribute via internal testing track on Google Play or direct APK.
- **Requires:** Google Play Developer account or EAS subscription.

#### 9.4 — Government Security Assessment [G, timeline unknown]
- Formal penetration test by CERT-In empanelled auditor.
- VAPT report required before GSCSCL production deployment.
- **Requires:** External authorization — cannot be self-performed.

#### 9.5 — Production Deployment Checklist [P1, 1 day]
- Update `GRAINSHIELD_DEPLOYMENT_CHECKLIST.md` with all Phase 1–8 items.
- Confirm: all migrations staged, secrets rotated, MFA enabled, error tracking live, staging environment verified.

---

## Phased Implementation Schedule

```
Week 1:  Phase 1 (AI hardening) + Phase 3.1-3.3 (GPS fix) + Phase 6.1 (profile trigger)
Week 2:  Phase 2 (Trip auto-generation) + Phase 4.1-4.2 (profile + my-trips pages)
Week 3:  Phase 5 (Admin completion) + Phase 8.1-8.2 (worker reliability)
Week 4:  Phase 7 (Cross-platform integration) + Phase 4.3-4.5 (checkpoint UI)
Week 5+: Phase 8.3-8.6 (security) + Phase 9 (QA and deployment)
```

---

## Open Architectural Questions for User Decision

These questions must be answered before specific phases can be completed. See `GRAINSHIELD_REQUIRED_ACCESS_AND_INFORMATION.md`.

| # | Question | Affects |
|---|----------|---------|
| A | Do trips originate from GSCSCL dispatch system, or are all trips admin-initiated inside GrainShield? | Phase 2 entirely |
| B | Can authorized Indian vehicle plate images be provided for training a larger model? | Phase 1.1+ |
| C | Should GPS track continuously in background even when driver app is minimised? | Phase 3 |
| D | Who approves new Field Officers — the same admin, or a GSCSCL super-admin? | Phase 6 |
| E | Is the target deployment a controlled pilot (1 district) or full Gujarat rollout? | Phase 9 |
| F | Is VLTS (Vehicle Location Tracking System) integration required, and are API credentials available? | Phase 7+ |
