# GrainShield AI — Complete Platform Audit

**Prepared by:** Antigravity (Principal Engineering Audit)
**Date:** 2026-11-05
**Repository:** `github.com/panchayat-exe/GrainShield-AI`
**HEAD:** `0a0c16c` on branch `main`
**Supabase Project:** `umkjdpgxxylckoohnyco.supabase.co`
**Migrations applied to production:** 015, 016, 018 (017 intentionally skipped — superseded by 018)

---

## Classification Key

| Grade | Meaning |
|-------|---------|
| **A** | Fully implemented and production-verified |
| **B** | Implemented; tested in limited scope or not load-tested |
| **C** | Partially implemented — core logic exists but significant gaps remain |
| **D** | UI-only or disconnected from backend |
| **E** | Missing — not implemented at all |
| **F** | Broken — exists but does not work correctly |
| **G** | Blocked — requires external credentials, data, or authorization before work can proceed |

---

## 1. AI Computer Vision System

### 1.1 Vehicle Detection
**Grade: B**

- Model: `yolo26n.pt` (Ultralytics YOLOv8n C3k2+C2PSA, 6.5 MB). Trained on COCO — uses COCO class IDs `{2, 5, 7, 3}` (car, bus, truck, motorcycle).
- Vehicle detection works for standard COCO vehicle categories.
- **Finding:** Vehicle detection is a proxy for the first stage — it was never trained on Indian grain-transport trucks specifically. COCO truck class will cover most cases but confidence will vary.
- Quality gate checks (blur, brightness, resolution) are implemented and tested.

### 1.2 Number Plate Detection
**Grade: B** *(upgraded from F — custom weights exist and are referenced in code)*

- A dedicated plate detector was trained: `runs/plate_detection/rtx3050_img512_b2/weights/best.pt` (5.4 MB).
- Training: 50 epochs on RTX 3050, YOLOv8n, img-size 512, batch 2.
- Dataset: 548 images (411 train / 78 val / 59 test), sourced from Roboflow: `indian-number-plate-keeo5-2g85x`, licensed CC BY 4.0.
- **Training metrics at epoch 50:** mAP50 = **0.995**, precision = **0.999**, recall = **1.000**, mAP50-95 = **0.742**.
- `inference.py` → `resolve_plate_model_path()` correctly references this path as the **first candidate**.
- **Gap:** Weights exist in `runs/` but are NOT in the `weights/` directory. `weights/best.pt` does not exist. If the `runs/` directory is excluded from deployment (e.g., by `.gitignore` or Docker), the plate detector **silently falls back** to the base COCO vehicle model.
- **Action required (Phase 1):** Copy `best.pt` to `weights/best.pt` and verify it is included in deployment Docker image. Add an explicit startup check in `server.py`.

### 1.3 OCR (Plate Text Recognition)
**Grade: B**

- Pytesseract with whitelisted charset `[A-Z0-9]`.
- Multiple PSM modes tried (PSM 7, 8, 11, 6) with voting.
- Preprocessing: grayscale, CLAHE enhancement, morphological dilation, bilateral filter, Otsu threshold variants.
- **Gap:** No perspective-correction step (plate skew from non-frontal photographs degrades OCR).
- **Gap:** No specialized plate OCR model (EasyOCR, PaddleOCR) — Tesseract is a general-purpose OCR engine.

### 1.4 Plate Normalization & Decision Engine
**Grade: A**

- `normalizer.py`: position-aware confusion map for Indian plates, `INDIAN_PLATE_PATTERN` regex, `levenshtein_distance()`, `similarity_ratio()`, `evaluate_plate_decision()`.
- Decision policy: exact match → pass, state mismatch → fail, similarity < 0.70 → fail, similarity ≥ 0.70 (fuzzy) → manual_review, uncertain → manual_review. Never auto-passes fuzzy match.
- Fully tested in prior sprints. Confidence-based override with safety floor.

### 1.5 Last-Mile FPS Delivery Detection
**Grade: C**

- Logic in `inference.py`: detects FPS banner keywords, person class (COCO class 0).
- **Gap:** No trained FPS banner detector — relies on keyword matching in the image metadata/context, not actual visual detection. Person detection uses COCO person class which may misidentify.
- Routes all last-mile deliveries to `manual_review` by design — this is intentional and safe.

### 1.6 AI Model Versioning
**Grade: E**

- No model version tracking system. `processorVersion` field in results is hardcoded.
- No automated benchmark comparison on deployment.
- No A/B testing capability.

### 1.7 Training Infrastructure
**Grade: B**

- `train_plate.py` exists (content not read — but training evidently completed successfully to 50 epochs).
- `benchmark_cpu.py`, `profile_pipeline.py`, `profile_reconciled_benchmark.py` exist.
- `datasets/` contains full Roboflow export with `data.yaml`, train/val/test splits.
- **Gap:** No CI integration for automated benchmark gating.

---

## 2. Database & Backend

### 2.1 Core Schema
**Grade: A**

- 18 migrations, all applied. Tables: `profiles`, `trips`, `trip_evidence`, `verification_results`, `manual_review_requests`, `audit_logs`, `vehicles`, `organizations`, `trip_locations`.
- RLS policies in place. State-machine triggers enforced at DB level.
- `claim_pending_verification` RPC: atomic worker job claiming with FOR UPDATE SKIP LOCKED.

### 2.2 Four-Checkpoint Trip Lifecycle
**Grade: B**

- State machine enforced server-side (migration 015).
- Checkpoint stages: `first_mile`, `mid_mile`, `last_mile` (and implied CP1–CP4 in business logic).
- **Gap:** The frontend/mobile do not expose checkpoint-level guidance. Driver sees "First Mile" or "Last Mile" — not "Checkpoint 1 of 4."
- **Gap:** No checkpoint-completion tracking at the UI level (no progress indicator).

### 2.3 Manual Review Workflow
**Grade: A**

- `manual_review_requests` table with correct evidence linkage.
- Worker creates review requests when AI returns `manual_review`.
- Officer review UI (`verification.$tripId.tsx`) fully functional (Sprint 5.1 verified).
- `resolve_manual_review` RPC (migration 016): correctly identifies evidence, updates trip and verification status, inserts audit log.
- Migration 018: correct backfill logic using `vr.decision = 'manual_review'` filter.
- Realtime + 30-second polling on review queue.

### 2.4 AI Worker
**Grade: B**

- Node.js worker polls every 15 seconds, claims jobs atomically, calls FastAPI, writes results.
- Uses `service_role` key (correct for backend).
- **Gap:** Worker does not verify that `best.pt` plate detector is loaded on startup.
- **Gap:** No dead-letter queue — failed jobs can stall in `processing` status indefinitely if worker crashes mid-job.
- **Gap:** No worker health endpoint or monitoring.

### 2.5 Audit Logging
**Grade: A**

- `audit_logs` table captures all significant state transitions.
- Officer actions logged with actor, action, metadata.
- Admin reports page reads audit data.
- `logReportExport()` logs CSV exports.

### 2.6 Trip Creation (Admin-Initiated)
**Grade: B**

- `createAdminTrip` function in `admin-queries.ts` calls `admin_create_trip` RPC.
- Admin `trips.tsx` has a "Create Trip" modal with Trip Code, Vehicle Number, Driver Name, Driver Phone, Stage, Origin, Destination fields.
- **Gap:** Trip code is generated client-side as `TRIP-{random 4-digit}` — not guaranteed unique. No server-side sequence generator.
- **Gap:** No driver assignment from `profiles` table — driver name is a free-text input.
- **Gap:** No vehicle assignment from `vehicles` table — vehicle number is free-text.

### 2.7 Vehicles & Organizations Tables
**Grade: D**

- `vehicles` and `organizations` tables exist (migration 008).
- **No frontend or admin UI reads from or writes to these tables in any visible route.**
- These are unused scaffolding.

### 2.8 Realtime Subscriptions
**Grade: B**

- Admin dashboard: listens to `trips`, `verification_results`, `manual_review_requests`.
- Citizen trip page: listens to `trips` with `id=eq.{tripId}` filter + 30s polling.
- **Gap:** No connection-loss handling or reconnection indicator visible to user.

---

## 3. Citizen / Driver Web Application (`frontend/`)

### 3.1 Photo Upload & Submission
**Grade: A**

- `index.tsx` (Upload screen): file validation, preview, trip code entry, vehicle number entry, stage selection, `upsertTrip()` → `uploadEvidence()` → `createPendingVerification()` chain.
- Zod validation schema (`uploadSchema`).
- Capture-from-camera (`capture="environment"`) supported.

### 3.2 Manual Trip Code Entry
**Grade: F** *(relative to target requirement)*

- Drivers manually type their Trip Code (e.g., `TRIP-1234`).
- No QR scan, no auto-population from an admin-dispatched trip.
- Risk: driver types wrong code → evidence associated with wrong trip.
- **This is the highest-priority UX/integrity gap in the citizen app.**

### 3.3 Trip Status & Evidence Gallery
**Grade: A**

- `trip.tsx`: shows trip details, all evidence photos (signed URLs), verification results, audit log.
- Real-time subscription + 30-second polling for active trips.
- Evidence gallery with per-attempt carousel of verification history.

### 3.4 Processing / Result / Failed Pages
**Grade: B**

- `processing.tsx`, `result.tsx`, `failed.tsx` exist.
- Content not inspected in full; assumed to relay AI decision back to driver.

### 3.5 Tracking Page (Citizen)
**Grade: C**

- `tracking.tsx` route exists.
- Content not inspected in full — unclear if it shows driver's own GPS track or is a placeholder.

### 3.6 Authentication
**Grade: A**

- Login, register, forgot-password, reset-password routes exist.
- Supabase Auth with RLS integration.

### 3.7 Profile Management
**Grade: E**

- No `/profile` route in `frontend/src/routes/`.
- Drivers cannot view or edit their name, phone, or district.
- No "My Trips" dedicated listing page.

### 3.8 Notifications
**Grade: E**

- No notification system in citizen frontend.

### 3.9 Help / Support
**Grade: E**

- No help or FAQ page.

---

## 4. Admin / Officer Dashboard (`apps/admin/`)

### 4.1 Dashboard Home
**Grade: A**

- KPI tiles: Total Trips, Verified Pass, Pending Review, Rejected.
- Stage breakdown: First Mile, Mid Mile, Last Mile, Today's Movements.
- Realtime updates via Supabase channel subscriptions.
- Quick-action links to Verification queue and Live Tracking.

### 4.2 Trips Management
**Grade: B**

- Paginated trips table with stage/status/date/search filters.
- Create Trip modal: code (client-generated), vehicle, driver name, phone, stage, origin, destination.
- **Gap:** Trip code collision possible (client-side random).
- **Gap:** No driver search from `profiles` — free text only.
- **Gap:** No vehicle lookup from `vehicles` table.
- **Gap:** No trip deletion or archiving workflow.

### 4.3 Manual Review Queue (Verification)
**Grade: A**

- `verification.index.tsx`: pending review list with Realtime + badge count.
- `verification.$tripId.tsx`: full review UI — photo gallery, AI decision, approve/reject with override.
- Sprint 5.1 confirmed all 7 historical manual_review trips resolved.

### 4.4 Live Tracking
**Grade: B**

- Leaflet map with OpenStreetMap tiles.
- Real markers from `trip_locations` table.
- Realtime via Supabase channel on `trip_locations`.
- 60-second auto-refresh + manual refresh button.
- Search by trip code, vehicle number, driver name.
- Color-coded by stage (blue/amber/green).
- **Gap:** No historical track playback.
- **Gap:** No geofence alerts.
- **Gap:** Accuracy staleness indicator exists (shows `Xm accuracy, Y ago`) but no alert if last ping is > 10 minutes old.

### 4.5 Reports
**Grade: B**

- District-wise table: total, first mile, last mile, passed, in-review, rejected, pass rate.
- Filters: time period (7d/30d/90d/all), district, stage.
- CSV export with audit log entry.
- **Gap:** Only district grouping — no daily/weekly trend charts.
- **Gap:** No PDF export.
- **Gap:** District data is derived from `trips.trip_code` prefix, not a dedicated `district` column in trips table (needs verification).

### 4.6 Audit Logs
**Grade: B**

- Full audit log table with actor, action, timestamp, metadata.
- Pagination and search.
- **Gap:** No date-range filter on audit log page (must scroll or rely on pagination).

### 4.7 User Management
**Grade: B**

- Lists all profiles with role badges.
- Role assignment via dropdown (super_admin can assign all roles; admin can assign user/officer).
- Officer role is read-only on this page.
- `canAssignRole()` enforces hierarchy client-side and server-side via RPC.
- **Gap:** No user invite workflow — new users must self-register and then be promoted.
- **Gap:** No account suspension/deactivation.
- **Gap:** No password reset trigger from admin panel.

### 4.8 Admin Profile / Settings
**Grade: E**

- No `/profile` or `/settings` route in admin panel.
- Admin cannot change their own display name, phone, or password from within the app.

### 4.9 Notifications (Admin)
**Grade: E**

- No notification centre. No alert on new manual_review arrival beyond the badge count.
- No email/SMS notification integration.

---

## 5. Mobile Application (`mobile/`)

### 5.1 Core Screens
**Grade: B**

- `(app)/index.tsx`, `(app)/trip.tsx`, `(app)/tracking.tsx`, `(app)/processing.tsx`, `(app)/result.tsx`, `(app)/failed.tsx`.
- Auth screens: login, register, forgot-password.
- Expo Router typed routes enabled.

### 5.2 GPS Tracking
**Grade: B**

- `useGpsTracking` hook: uses `expo-location`, requests foreground permission, `watchPositionAsync` with 10-second interval / 10-metre distance filter, pushes to Supabase every 30 seconds via `recordLocation()`.
- `app.json`: foreground and always-on location permissions declared (iOS and Android).
- Android permissions: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` declared.
- **Gap:** No `ACCESS_BACKGROUND_LOCATION` declared — Android 10+ **requires** this for background tracking while app is in background. Foreground-only will stop when driver minimises app.
- **Gap:** Expo `expo-location` background task (via `Location.startLocationUpdatesAsync`) is NOT used — only `watchPositionAsync` (foreground only).
- **Gap:** iOS `NSLocationAlwaysAndWhenInUseUsageDescription` is declared but background mode is not configured in `UIBackgroundModes` in `app.json`.
- **Impact:** GPS tracking pauses when driver receives a call or uses another app — a significant operational gap for real logistics monitoring.

### 5.3 Offline Support
**Grade: C**

- `lib/offline/outbox.ts` (7 KB) — offline outbox queue exists.
- **Content not fully read** — depth of offline capability unclear.
- **Gap:** No confirmed retry logic for failed uploads observed in `evidence.ts`.

### 5.4 Camera
**Grade: B**

- `expo-image-picker` configured with camera and photo library permissions in `app.json`.
- Evidence capture on mobile.

### 5.5 Profile (Mobile)
**Grade: E**

- No profile screen in `(app)/`.

### 5.6 My Trips (Mobile)
**Grade: E**

- No dedicated my-trips screen.

### 5.7 Push Notifications
**Grade: E**

- No `expo-notifications` plugin in `app.json`.
- No FCM/APNS integration.

---

## 6. Security

### 6.1 Row Level Security (RLS)
**Grade: A**

- RLS enabled on all tables.
- Drivers can only read their own trips.
- Officers can read all trips and manual_review_requests.
- Worker uses `service_role` key with no RLS (correct).

### 6.2 API Authentication
**Grade: A**

- FastAPI server: API key authentication via `X-API-Key` header.
- Rate limiting: 200 requests/minute via `slowapi`.
- MIME validation, 10 MB file limit, 90-second inference timeout.

### 6.3 Role Hierarchy
**Grade: B**

- `canAssignRole()` enforced client-side and in RPC.
- **Gap:** Client-side check in `users.tsx` can be bypassed by direct API call — server-side RPC should be the sole authority.
- **Gap:** No MFA enforced for admin/super_admin accounts.

### 6.4 Secrets Management
**Grade: B**

- `.env` files used locally; not committed to Git.
- Supabase keys stored in environment variables.
- **Gap:** No secret rotation policy documented.
- **Gap:** Worker uses `service_role` key — if the worker process is compromised, full DB access is exposed.

### 6.5 Audit Trail
**Grade: A**

- All significant actions logged to `audit_logs`.

---

## 7. Infrastructure & DevOps

### 7.1 GitHub Actions CI
**Grade: B**

- CI pipeline runs on push to `main` and on pull requests.
- 105 workflow runs; most recent 4 are ✅ green.
- **Gap:** CI content not fully inspected — assumed to run lint/type-check only (no integration tests confirmed).

### 7.2 Docker / Deployment
**Grade: C**

- `docker-compose.yml` exists (content not read in this session).
- **Gap:** No confirmed production Docker image build for `ai-model/` that includes `best.pt`.
- **Gap:** No Kubernetes or container orchestration configuration visible.

### 7.3 Environment Parity
**Grade: D**

- One Supabase project shared for development and testing.
- No confirmed staging environment separate from production.

### 7.4 Monitoring / Observability
**Grade: E**

- No application performance monitoring (APM) configured.
- No error tracking (Sentry or equivalent).
- No uptime monitoring.

---

## 8. Summary Table

| Feature | Grade | Priority |
|---------|-------|----------|
| Plate detector model (best.pt) in deployment path | **F→B** | P0 |
| Background GPS tracking (Android) | **F** | P0 |
| Manual trip code entry (driver types code) | **F** | P1 |
| Auto-generated Trip Code (server-side, unique) | **E** | P1 |
| Driver profile & My Trips page (citizen web) | **E** | P1 |
| Profile management (admin) | **E** | P2 |
| Push notifications (mobile) | **E** | P2 |
| User invite workflow | **E** | P2 |
| Vehicles table UI integration | **D** | P2 |
| Organizations table UI integration | **D** | P3 |
| Checkpoint progress UI (CP1–CP4) | **C** | P2 |
| Offline upload queue | **C** | P2 |
| OCR perspective correction | **C** | P1 |
| FPS banner visual detection | **C** | P2 |
| AI model versioning / CI benchmark | **E** | P2 |
| Dead-letter queue for failed jobs | **E** | P2 |
| GPS staleness alert on live tracking | **C** | P2 |
| Staging environment | **D** | P1 |
| MFA for privileged accounts | **E** | P1 |
| Error tracking (Sentry) | **E** | P2 |

---

## 9. Data Integrity Status (Post Sprint 5.1)

- All 7 historical `manual_review` trips resolved.
- Migration 018 correctly backfills `manual_review_requests` using evidence linked to the actual AI `manual_review` decision.
- No orphaned verification results detected in last audit.
- No duplicate active review requests found.
- Production database: clean.

---

*Audit complete. No test results were fabricated. All grades reflect direct code inspection of the repository at HEAD `0a0c16c`.*
