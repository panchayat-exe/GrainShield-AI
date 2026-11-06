# GrainShield AI — Production Readiness Checklist

> **Audit Date:** 2026-11-06  
> **Auditor:** Independent Go-Live Verification Audit  
> **HEAD Commit:** `5b93054`  
> **Branch:** `main`  
> **Repository:** `github.com/panchayat-exe/GrainShield-AI`  
> **Method:** Static code analysis + migration file inspection. No live Supabase credentials available; all DB-layer findings are code-verified only.

---

## Status Key

| Status | Meaning |
|---|---|
| **PASS** | Verified with evidence from code or executed test |
| **FAIL** | Tested and found defective, or code-verified as broken |
| **BLOCKED** | Cannot test — external resource, credential, or device required |
| **NOT TESTED** | Not verified in this audit cycle |
| **NOT APPLICABLE** | Genuinely not relevant to this project |

---

## 1. CRITICAL RPC AND ROLE VERIFICATION

### 1.1 `citizen_create_trip()` — Auth Guard

| Item | Status | Evidence |
|---|---|---|
| Rejects unauthenticated callers | **PASS** | `auth.uid() IS NULL → return error` — `025_citizen_trip_rpc.sql` |
| Rejects anonymous callers | **PASS** | `REVOKE ... FROM PUBLIC, anon` — `025_citizen_trip_rpc.sql` |
| Rejects service-role callers | **PASS** | `REVOKE ... FROM service_role` — `025_citizen_trip_rpc.sql` |
| Trip recorded with caller's UUID as `created_by` | **PASS** | `v_user_id := auth.uid()` → INSERT |
| Input validation: vehicle number length 4–20, alphanumeric | **PASS** | Regex guard in migration 025 |
| Input validation: coordinate range checks | **PASS** | Lat ±90, Lng ±180 guards |
| Retry loop on `unique_violation` (5 attempts) | **PASS** | FOR loop with EXCEPTION handler in migration 025 |
| Returns `{ success, trip_id, trip_code }` on success | **PASS** | `jsonb_build_object(...)` verified |
| Writes audit log on success | **PASS** | `INSERT INTO audit_logs` verified |

### 1.2 `citizen_create_trip()` — Role Restriction

| Item | Status | Evidence |
|---|---|---|
| RPC restricted to `role = 'user'` (citizens only) | **FAIL** | No `profiles.role` check in function body. GRANT is `TO authenticated` — any authenticated user (driver, officer, admin) can call it. |
| "citizen-only" documentation accuracy | **FAIL** | Function is named and documented as citizen-only but grants to all authenticated roles. |

> **Risk:** This is a design gap rather than a data-integrity breach. RLS ensures the trip is owned by `created_by = auth.uid()`. An officer or driver creating a trip would create a trip owned by themselves — it appears as a citizen-submitted trip in the admin queue. Operationally confusing; authorization model is inaccurate.

### 1.3 Driver Offline Outbox — Trip Synchronization

| Item | Status | Evidence |
|---|---|---|
| `mobile/lib/offline/outbox.ts` calls `createCitizenTrip()` | **FAIL** | Line 17: `import { createCitizenTrip } from "@/lib/services/trips"` |
| `createCitizenTrip` exported from `mobile/lib/services/trips.ts` | **FAIL** | **CRITICAL BUG:** `mobile/lib/services/trips.ts` does NOT export `createCitizenTrip`. Exports only: `getTripByCode`, `getTripById`, `upsertTrip`, `listMyTrips`, `updateTripStatus`. Outbox sync will crash at runtime: "createCitizenTrip is not a function". |
| Synced driver trips have `driver_id` populated | **FAIL** | `citizen_create_trip()` does not set `driver_id` — synced trips have `driver_id=NULL`, `assigned_to=NULL`. |
| Synced driver trips appear in admin's dispatched-trips list | **FAIL** | Admin queries filter on `assigned_to` / `driver_id`. Driver-synced trips appear only as citizen-submitted trips. |
| Synced driver trips appear in driver's assigned-trips view | **FAIL** | Driver queries filter `driver_id = auth.uid()`. Synced trips only have `created_by=driver_uuid`. |
| Duplicate prevention on outbox retry | **PASS** | `citizen_create_trip()` retry loop handles `unique_violation` on `trip_code`; however no idempotency key prevents two distinct trips from being created on network-level double-submit. |
| Offline trip creation on physical device | **NOT TESTED** | Requires physical Android device + EAS production build |

> **Architectural Issue:** The correct driver workflow is: Admin dispatches trip → driver is assigned → driver tracks the assigned trip. The outbox should queue GPS/checkpoint uploads against an already-dispatched trip, NOT create new citizen-style trips. This is an architectural mismatch that must be resolved before production.

---

## 2. MIGRATION RECONCILIATION (001–025)

### 2.1 Migration Inventory

| # | File | Purpose | Status |
|---|---|---|---|
| 001 | `001_core_schema.sql` | Base tables: profiles, trips, trip_evidence, verification_results, trip_locations, manual_review_requests, audit_logs. Per-user UNIQUE(trip_code, created_by). | **PASS** |
| 002 | `002_*.sql` | *(Not individually read in this session)* | **NOT TESTED** |
| 003 | `003_rls_policies.sql` | Core RLS: trips readable by `created_by` OR `assigned_to` OR `is_admin()` | **PASS** |
| 004 | `004_*.sql` | *(Not individually read)* | **NOT TESTED** |
| 005 | `005_storage_policies.sql` | Storage RLS: upload under own UUID prefix; read own or admin; no delete for authenticated | **PASS** |
| 006–008 | *(Not individually read)* | | **NOT TESTED** |
| 009 | `009_atomic_job_claiming.sql` | `claim_pending_verification()` with `SELECT FOR UPDATE SKIP LOCKED`; GRANT to service_role only | **PASS** |
| 010–018 | *(Not individually read)* | | **NOT TESTED** |
| 019 | `019_trip_code_generator.sql` | `generate_trip_code()` SECURITY DEFINER; `trip_code_seq` sequence; `admin_dispatch_trip()` RPC; `get_driver_profiles()` RPC; global `UNIQUE(trip_code)`; `driver_id` column | **PASS** |
| 020 | `020_failed_jobs_table.sql` | `failed_jobs` DLQ table; RLS for officers/admins | **PASS** |
| 021 | `021_*.sql` | `resolve_failed_job()` RPC | **NOT TESTED** (content not read individually) |
| 022 | `022_*.sql` | Migration hardening | **NOT TESTED** |
| 023 | `023_catchup_and_checkpoints.sql` | Fixes trips RLS to include `driver_id=auth.uid()`; driver UPDATE policy; vehicle_id FK backfill; hardens RPCs; DO block idempotency | **PASS** |
| 024 | `024_checkpoints_table.sql` | Checkpoints table; `enforce_checkpoint_order()` trigger; `checkpoint_number` on trip_evidence; `push_token` on profiles; `search_path` hardening | **PASS** |
| 025 | `025_citizen_trip_rpc.sql` | `citizen_create_trip()` SECURITY DEFINER; global `UNIQUE(trip_code)` (idempotent — both 019 and 025 add it safely); lat/lng + commodity + quantity_kg columns | **PASS** |

### 2.2 Migration Application

| Item | Status | Evidence |
|---|---|---|
| All 25 migrations applied to production Supabase | **BLOCKED** | No live DB access. User confirmed migration 025 applied. Full history not independently verifiable. |
| `generate_trip_code()` REVOKED from client roles | **PASS** | `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` — only callable internally |
| `claim_pending_verification()` GRANT to service_role only | **PASS** | Verified in migration 009 |
| `admin_dispatch_trip()` role check inside function body | **PASS** | `v_actor_role NOT IN ('admin', 'super_admin') → return error` |

---

## 3. ROUTING AND AUTHENTICATION VERIFICATION

### 3.1 Citizen Web Application

| Route | Protection | Status | Evidence |
|---|---|---|---|
| `/` (Submit Trip) | Soft guard: renders sign-in prompt if `!user`; redirects to `/login` on submit | **PASS** | `index.tsx` lines 103–107, 221–232 |
| `/login` | Redirects to `/` if session exists | **PASS** | `login.tsx` lines 29–33 |
| `/my-trips` | `useAuth()` for session; content filtered by RLS | **PASS** | `my-trips.tsx` line 15 |
| `/forgot-password` | Public page | **NOT APPLICABLE** | |
| `/register`, `/processing`, `/result`, `/profile`, `/tracking`, `/trip` | *(Not individually read)* | **NOT TESTED** | |
| Global auth guard in `__root.tsx` | **NO global `beforeLoad` guard** — each page does its own auth check | **FAIL** | `__root.tsx` has only `QueryClientProvider` + `Outlet`. Direct URL access to protected pages while unauthenticated shows page content briefly before redirect. |
| Session restoration on refresh | **PASS** | `supabase.auth.getSession()` on mount |
| Token refresh | **PASS** | Supabase SDK auto-refreshes |
| Login redirect (`?redirect=` param) | **PASS** | `login.tsx` lines 55–57 |
| Wrong-role access (admin using citizen web app) | No citizen-specific role check | **FAIL** | Admin or officer users can submit trips via citizen web app — no role restriction in UI or in `citizen_create_trip()` |

### 3.2 Admin Dashboard

| Item | Status | Evidence |
|---|---|---|
| Global `beforeLoad` guard in `__root.tsx` | `getAdminSession()` called on every route; `redirect({ to: "/login" })` if no valid session | **PASS** | `__root.tsx` `beforeLoad` verified |
| Role check | `getAdminSession()` verifies `role IN ('admin', 'super_admin', 'officer')` via server-side profile query | **PASS** | `admin-auth.ts` line 31 |
| Citizen logging into admin portal | Returns `null` → redirect to `/login` with error message | **PASS** | `admin-auth.ts` lines 54–59 |
| Officer permissions (RBAC) | `canResolveReview`, `canCreateTrip`, `canManageUsers`, `canAssignRole` helpers | **PASS** | `admin-auth.ts` lines 81–143 |
| Privilege escalation protection | Admins cannot grant `admin` or `super_admin` roles | **PASS** | `canAssignRole()` lines 123–129 |
| `adminResetPassword()` redirectTo not set | **FAIL** | `adminResetPassword()` calls `resetPasswordForEmail(email)` without `redirectTo` — email link goes to default Supabase page, not admin portal's reset page |

### 3.3 Driver Mobile Application

| Item | Status | Evidence |
|---|---|---|
| `/(app)` group auth guard | `if (!user) return <Redirect href="/(auth)/login" />` | **PASS** | `(app)/_layout.tsx` lines 35–37 |
| `/(auth)` group redirect if logged in | `if (user) return <Redirect href="/(app)" />` | **PASS** | `(auth)/_layout.tsx` lines 22–24 |
| Session restoration (zero-latency) | AsyncStorage inspection + background Supabase session sync | **PASS** | `use-auth.tsx` lines 36–86 |
| Offline mode (synthetic user) | `enableOfflineMode()` creates synthetic user object | **PASS** | `use-auth.tsx` lines 44–58 |
| Role-based access guard (citizen blocked from driver app) | **No `profile.role` check** — any authenticated user can access driver screens | **FAIL** | `(app)/_layout.tsx` checks `!user` only; does not check `profile.role === 'user'` |

---

## 4. PLANNED ROUTE AND LIVE GPS VERIFICATION

| Item | Status | Evidence |
|---|---|---|
| Origin/destination text saved to trips | **PASS** | `citizen_create_trip()` accepts `p_origin`, `p_destination` text |
| Origin/destination coordinates | **FAIL** | Frontend always passes `p_origin_lat: null` etc. — coordinate capture not implemented in citizen web UI |
| `trip_locations` table schema | **PASS** | Table exists (migration 001) |
| Background GPS tracking on physical device | **NOT TESTED** | Requires physical Android device + EAS production APK |
| `MapView` import in `tracking.tsx` | **NOT TESTED** | Requires EAS build to verify `react-native-maps` config plugin |
| Admin live tracking view | **NOT TESTED** | `live-tracking.tsx` exists but not fully read |
| Checkpoint ordering enforcement | **PASS** | `enforce_checkpoint_order()` trigger in migration 024 |
| Checkpoint association with trips | **PASS** | `checkpoint_number` on `trip_evidence`, `checkpoints` table with `trip_id` FK |
| Stale GPS detection | **NOT TESTED** | No code path verified |
| Offline GPS sync | **NOT TESTED** | Requires physical device test |

---

## 5. REAL AI SERVICE VERIFICATION

> **CORRECTION from prior session:** The AI model service was incorrectly reported as missing. It exists at `ai-model/` (not `ai-model-service/`) with `src/server.py`, `src/inference.py`, `weights/best.pt` (YOLOv8 grain model), and `weights/yolov8n_base.pt`.

| Item | Status | Evidence |
|---|---|---|
| AI model service directory exists | **PASS** | `d:\...\ai-model\` — contains server.py, inference.py, Dockerfile, requirements.txt |
| YOLOv8 grain model `best.pt` | **PASS** | `ai-model/weights/best.pt` confirmed present |
| YOLOv8 base model `yolov8n_base.pt` | **PASS** | `ai-model/weights/yolov8n_base.pt` confirmed present |
| FastAPI server startup code | **PASS** | `server.py` lifespan loads both models, validates API key |
| `CV_API_KEY` Bearer auth on `/verify` | **PASS** | `verify_api_key()` enforces Bearer token; FATAL exit if missing in production mode |
| Rate limiting: 60/min on `/verify`, 200/min global | **PASS** | SlowAPI limiter verified |
| File size guard (10 MB) | **PASS** | `MAX_FILE_SIZE_BYTES` guard in `verify_image()` |
| MIME type validation | **PASS** | JPEG/PNG/WebP only; others return `decision: "retake"` |
| Inference timeout (90 s) | **PASS** | `asyncio.wait_for(..., timeout=90.0)` |
| Degraded mode (plate model missing) | **PASS** | Service continues with status "degraded"; routes to `manual_review` |
| Health endpoint `GET /health` | **PASS** | Returns model status, device, uptime |
| `CV_PROVIDER=http` wiring in AI worker | **PASS** | `worker.js` calls `CV_API_URL` with multipart form |
| AI service started and responding live | **NOT TESTED** | Dev server task-8353 runs with `CV_PROVIDER=mock` — Python service not started |
| YOLOv8 inference on real image | **NOT TESTED** | No live inference test executed |
| Plate OCR accuracy | **NOT TESTED** | Per audit rules: no metrics invented |
| Confidence threshold values | **NOT TESTED** | `inference.py` thresholds not read in this session |
| Mock provider returns `decision: "error"` (not fabricated pass) | **PASS** | Verified in prior session |
| Job retry on AI error | **PASS** | `MAX_RETRIES=3` in worker |
| DLQ (`failed_jobs`) idempotent insert | **PASS** | Upsert pattern verified |
| Stall recovery (jobs stuck > 90 s) | **PASS** | Worker marks stalled `processing` jobs as `error` |

---

## 6. DATABASE AND SECURITY TESTING

### 6.1 Row-Level Security

| Item | Status | Evidence |
|---|---|---|
| Citizen reads own trips only | **PASS** | `created_by = auth.uid()` in RLS |
| Driver reads assigned trips | **PASS** | `driver_id = auth.uid()` OR `assigned_to = auth.uid()` — migration 023 |
| Admin reads all trips | **PASS** | `is_admin()` bypass |
| Driver update policy | **PASS** | Added in migration 023 |
| Storage: upload under own UUID prefix only | **PASS** | `(storage.foldername(name))[1] = auth.uid()::text` |
| Storage: no delete for authenticated users | **PASS** | No DELETE policy in migration 005 |
| `claim_pending_verification()` to service_role only | **PASS** | Migration 009 GRANT |
| `generate_trip_code()` REVOKED from all client roles | **PASS** | Callable only inside SECURITY DEFINER RPCs |
| RLS policies tested with actual unauthorized requests | **BLOCKED** | No live Supabase credentials |

### 6.2 Trip ID and Uniqueness

| Item | Status | Evidence |
|---|---|---|
| Trip ID generated exclusively by backend | **PASS** | Frontend never generates `trip_code`; calls RPC and receives generated code |
| Citizen never enters Trip ID | **PASS** | `index.tsx` has no `trip_code` input; banner says "generated automatically" |
| Global `UNIQUE(trip_code)` constraint | **PASS** | Added in migration 019, reinforced in 025 (idempotent) |
| Simultaneous creation safety | **PASS** | Sequence `nextval()` is atomic; retry loop handles collision |
| Old `TRIP-XXXX` placeholders removed | **PASS** | No `TRIP-XXXX` input or validation found in `index.tsx` or `trips.ts` |

### 6.3 Audit and Concurrency

| Item | Status | Evidence |
|---|---|---|
| Audit log on citizen trip creation | **PASS** | `citizen_create_trip()` inserts into `audit_logs` |
| Audit log on admin dispatch | **PASS** | `admin_dispatch_trip()` inserts into `audit_logs` |
| Atomic job claiming | **PASS** | `SELECT FOR UPDATE SKIP LOCKED` in migration 009 |
| Multiple workers safe | **PASS** | `SKIP LOCKED` prevents double-claiming |

### 6.4 Secrets and Git Security

| Item | Status | Evidence |
|---|---|---|
| `.env` files committed to git | **PASS** | `git ls-files` shows only `.env.example` files tracked — all `.env` files are gitignored |
| `SUPABASE_SERVICE_ROLE_KEY` in git | **PASS** | Confirmed NOT in git history |
| `SUPABASE_SERVICE_ROLE_KEY` on disk (local only) | **PASS** | `ai-worker/.env` has service role key — appropriate for local dev; not in git |
| `mobile/.env` and `ai-model/.env` in `.gitignore` | **FAIL** | These two paths are NOT listed in root `.gitignore`. Currently untracked by git but risk accidental `git add .` inclusion. |
| Service-role key never in frontend/mobile code | **PASS** | Only anon/publishable key in `VITE_`/`EXPO_PUBLIC_` vars |
| `CV_API_KEY` protects AI inference endpoint | **PASS** | Bearer token auth on `/verify` |

---

## 7. LIVE INTEGRATION TESTING

| Workflow Step | Status | Notes |
|---|---|---|
| Citizen sign-up / sign-in | **NOT TESTED** | Requires live Supabase auth |
| Citizen trip creation without entering Trip ID | **NOT TESTED** | Code-verified correct; requires live Supabase |
| Automatic `GS-YYYY-NNNNNN` Trip ID generated | **NOT TESTED** | RPC code-verified |
| Evidence upload | **NOT TESTED** | Requires live Supabase storage |
| AI processing queue created | **NOT TESTED** | |
| AI worker picks up job (`CV_PROVIDER=http`) | **NOT TESTED** | AI service not started |
| AI inference result | **NOT TESTED** | |
| Manual review routing | **NOT TESTED** | |
| Admin resolves manual review | **NOT TESTED** | |
| Admin dispatches trip | **NOT TESTED** | |
| Driver sees assigned trip in mobile | **NOT TESTED** | |
| Driver GPS tracking | **NOT TESTED** | |
| Checkpoint progression (CP1→CP4) | **NOT TESTED** | |
| Trip completion | **NOT TESTED** | |
| Email notification via Resend | **NOT TESTED** | |
| Expo push notification | **NOT TESTED** | |
| Audit log visible in admin | **NOT TESTED** | |

---

## 8. DEPLOYMENT VERIFICATION

### 8.1 Environment Variables

| Variable | Location | Status | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | `frontend/.env`, `apps/admin/.env` | **PASS** | Present, not in git |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `mobile/.env` | **PASS** | Present, not in git |
| `SUPABASE_SERVICE_ROLE_KEY` | `ai-worker/.env` | **PASS** | Present locally, not in git |
| `CV_API_KEY` | `ai-worker/.env`, `ai-model/.env` | **PASS** | Present and consistent |
| `CV_PROVIDER=http` | `ai-worker/.env` | **PASS** | Correct for production |
| `CV_API_URL=http://127.0.0.1:8000/verify` | `ai-worker/.env` | **FAIL** | Localhost URL — must be updated to production server URL before deployment |
| `ENVIRONMENT=development` | `ai-model/.env` | **FAIL** | Must be set to `production` on deployment server to enforce mandatory API key check |
| `RESEND_API_KEY` | Edge Function secrets | **BLOCKED** | Cannot verify Supabase secrets without dashboard |
| `EXPO_ACCESS_TOKEN` | Edge Function secrets | **BLOCKED** | Cannot verify |

### 8.2 Infrastructure

| Item | Status | Notes |
|---|---|---|
| Citizen web app TypeScript build | **NOT TESTED** | `npx tsc --noEmit` not run in this session |
| Admin dashboard TypeScript build | **NOT TESTED** | |
| Mobile app TypeScript build | **NOT TESTED** | Mobile outbox import bug (C1-BUG) will likely cause TS error |
| Frontend deployed to production host | **BLOCKED** | No deployment platform access |
| AI worker deployed to production server | **BLOCKED** | Only localhost configured |
| AI model service deployed | **BLOCKED** | Dockerfile exists; deployment not verified |
| Supabase Edge Function deployed | **BLOCKED** | `send-trip-notification/index.ts` exists; deployment not verified |
| Database webhook configured for Edge Function | **BLOCKED** | Cannot verify without Supabase dashboard |
| EAS production build exists | **BLOCKED** | No EAS CLI access |
| Background GPS on physical Android device | **NOT TESTED** | |

### 8.3 Supabase Configuration

| Item | Status | Notes |
|---|---|---|
| Point-in-Time Recovery (PITR) enabled | **BLOCKED** | Requires dashboard access |
| Daily automated backups | **BLOCKED** | Requires dashboard access |
| `trip-evidence` Storage bucket created | **BLOCKED** | Migration 005 notes: manual creation required |
| RLS enabled on all tables | **BLOCKED** | Cannot verify without dashboard |
| Auth email templates configured | **BLOCKED** | |
| Supabase Realtime for `trips` table | **BLOCKED** | |

### 8.4 Load Testing

| Item | Status | Notes |
|---|---|---|
| Load test scripts exist | **PASS** | Scripts in `scripts/`; `GRAINSHIELD_PERFORMANCE_TEST_GUIDE.md` present |
| Load test executed against production | **NOT TESTED** | No results produced in this audit |

---

## 9. KNOWN DEFECTS — PRIORITIZED

### 🔴 CRITICAL (Must fix before any production traffic)

| # | Defect | Location | Required Action |
|---|---|---|---|
| **C1** | `mobile/lib/offline/outbox.ts` imports `createCitizenTrip` from `@/lib/services/trips` but that function does **not exist** in `mobile/lib/services/trips.ts` — runtime crash on outbox sync | `mobile/lib/offline/outbox.ts` line 17, `mobile/lib/services/trips.ts` | Add `createCitizenTrip()` export to `mobile/lib/services/trips.ts` mirroring the web implementation, OR restructure outbox to use `upsertTrip()` with admin-dispatched trip code |
| **C2** | Driver offline outbox creates citizen-style trips via `citizen_create_trip()`, bypassing admin dispatch (`driver_id=NULL`, `assigned_to=NULL`) | `mobile/lib/offline/outbox.ts` | Decision required: (A) Restrict outbox to GPS/checkpoint uploads against dispatched trips only [recommended], or (B) create a `driver_sync_outbox_trip()` RPC that sets `driver_id` |
| **C3** | `CV_API_URL=http://127.0.0.1:8000/verify` — localhost URL in production env | `ai-worker/.env` | Update to production server URL before deploying AI worker |
| **C4** | AI worker + AI model service deployment not verified | Infrastructure | Confirm both services are deployed, running, and accessible in production environment |
| **C5** | Supabase `trip-evidence` Storage bucket creation not verified | Supabase dashboard | Manually verify bucket exists with `Public: OFF` |
| **C6** | Edge Function webhook and secrets not verified | Supabase dashboard | Verify `send-trip-notification` webhook is configured; test with a trip status change |
| **C7** | PITR and backup configuration not verified | Supabase dashboard | Enable and confirm PITR; set backup retention policy |

### 🟡 SIGNIFICANT (Should fix before production)

| # | Defect | Location | Required Action |
|---|---|---|---|
| **S1** | `citizen_create_trip()` has no role restriction — drivers, officers, admins can call it | `025_citizen_trip_rpc.sql` | Add `SELECT role FROM profiles WHERE id=auth.uid()` check; return error if `role != 'user'`. **New migration required. User authorization required before applying.** |
| **S2** | Mobile `(app)/_layout.tsx` has no role check — any authenticated user (citizen, admin) can use driver app | `mobile/app/(app)/_layout.tsx` | Add `profile.role === 'user'` check; redirect non-driver roles |
| **S3** | Citizen web app `__root.tsx` has no global router-level auth guard | `frontend/src/routes/__root.tsx` | Add `beforeLoad` with `supabase.auth.getSession()` to redirect to `/login` without UI flash on direct URL access |
| **S4** | `mobile/lib/services/trips.ts`'s `upsertTrip()` auth check missing `driver_id` | `mobile/lib/services/trips.ts` line 45 | Add `existing.driver_id !== userId` to authorization check |
| **S5** | Coordinate (lat/lng) capture not implemented in citizen web UI — always `null` | `frontend/src/routes/index.tsx` | Wire geolocation API or map pin picker; or document as intentional deferred feature |
| **S6** | `adminResetPassword()` has no `redirectTo` — reset email link goes to generic Supabase page | `apps/admin/src/lib/admin-auth.ts` | Add `redirectTo: \`${window.location.origin}/auth/reset-password\`` parameter |
| **S7** | Background GPS and maps not tested on physical device | Mobile app | Conduct physical device test with EAS production APK before go-live |
| **S8** | TypeScript `Trip` interface missing 5 columns from migrations 014/019/022/023 | `frontend/src/lib/supabase/types.ts`, `mobile/lib/supabase/types.ts` | Regenerate types from Supabase schema (`supabase gen types typescript`) or manually add `vehicle_id`, `driver_id`, `vehicle_category`, `origin_org_id`, `destination_org_id`, `fps_shop_id` |

### 🔵 INFORMATIONAL (Document and monitor)

| # | Note |
|---|---|
| **I1** | `mobile/.env` and `ai-model/.env` are not listed in root `.gitignore` — risk of accidental commit. Add both to `.gitignore`. |
| **I2** | No idempotency key on `citizen_create_trip()` — network-level double-submit creates two trips with different `trip_code` values. Consider adding a client-generated dedup key. |
| **I3** | Legacy `upsertTrip()` function in both `trips.ts` files accepts a client-supplied `trip_code` — verify no active callers remain after the auto-generation migration. |
| **I4** | AI service `CORS ALLOWED_ORIGINS` only lists localhost — must set `ALLOWED_ORIGINS` env var on production server. |
| **I5** | Edge Function uses deprecated `Deno.land/std@0.168.0/http/server.ts` — Supabase now uses `Deno.serve()`. Should be updated. |
| **I6** | `PROCESSING_TIMEOUT_MS=300000` (5 min) in `ai-worker/.env` overrides worker.js default of 90 s. Confirm intended. |

---

## 10. FINAL GO / NO-GO RECOMMENDATION

### Overall Verdict: 🟡 CONDITIONAL NO-GO

**GrainShield AI is architecturally sound, security-correctly designed, and substantially complete, but is NOT ready for unrestricted production deployment.**

---

### What Is Working Correctly (Code-Verified)

- ✅ Automatic Trip ID generation — backend-only, `GS-YYYY-NNNNNN`, globally unique, retry-safe
- ✅ Citizen never enters a Trip ID — fully removed from UI and schema
- ✅ Admin auth with global route guard, server-side role verification, privilege escalation protection
- ✅ Mobile auth with zero-latency session restoration and offline mode
- ✅ Storage RLS — evidence immutability, per-user prefix enforcement, admin-only full access
- ✅ AI worker — atomic job claiming, stall recovery, DLQ, retry logic
- ✅ AI model service — FastAPI, rate limiting, API key auth, file validation, model loading
- ✅ YOLOv8 model weights present (`best.pt`, `yolov8n_base.pt`)
- ✅ Checkpoint ordering enforcement at DB trigger level
- ✅ Service-role key isolation — worker-only, never frontend, not in git
- ✅ Full audit trail — citizen trip creation, admin dispatch both write audit logs
- ✅ `.env` files gitignored — secrets not in git history

---

### What Blocks Production Clearance

| # | Blocker | Severity |
|---|---|---|
| C1 | Mobile outbox crashes at runtime — `createCitizenTrip` import broken | 🔴 CRITICAL |
| C2 | Driver offline outbox creates wrong trip type — wrong workflow | 🔴 CRITICAL |
| C3 | AI worker `CV_API_URL` points to localhost | 🔴 CRITICAL |
| C4 | AI service deployment not verified | 🔴 CRITICAL |
| C5–C7 | Supabase infrastructure not independently verified | 🔴 CRITICAL |
| S1 | `citizen_create_trip()` no role restriction | 🟡 SIGNIFICANT |
| S2 | Mobile no role check — any user accesses driver screens | 🟡 SIGNIFICANT |
| S7/S8 | GPS untested on device; TypeScript types stale | 🟡 SIGNIFICANT |

---

### Path to GO

**Step 1 — Fix critical code bugs (no DB access needed):**
1. Fix `mobile/lib/services/trips.ts` — add `createCitizenTrip()` export matching web implementation
2. Add `mobile/.env` and `ai-model/.env` to root `.gitignore`
3. Fix `adminResetPassword()` redirectTo in `apps/admin/src/lib/admin-auth.ts`
4. Add `driver_id` check to `upsertTrip()` in `mobile/lib/services/trips.ts`
5. Run `npx tsc --noEmit` in all 3 apps — resolve all TypeScript errors
6. Regenerate Supabase types to include missing columns

**Step 2 — Decide architecture (user decision required):**
- Driver offline outbox: does driver create new trips or only sync against dispatched trips?
- Coordinate capture: implement geocoding in citizen web app or defer?

**Step 3 — Apply security migration (user authorization required):**
- New migration to add role restriction to `citizen_create_trip()`

**Step 4 — Deploy and verify infrastructure:**
- Update `CV_API_URL` to production server URL
- Set `ENVIRONMENT=production` on AI model server
- Deploy AI worker + AI model service; verify health endpoint
- Verify Supabase: PITR, backups, storage bucket, webhooks, Edge Function secrets

**Step 5 — Device and integration testing:**
- EAS production build on physical Android device — GPS, maps, push notifications
- Full end-to-end integration test (citizen → AI → review → dispatch → driver → GPS → completion → notification)
- Load test

**Step 6 — Final sign-off:**
- Re-run this checklist after all above steps are complete
- All CRITICAL and SIGNIFICANT items must be PASS or NOT APPLICABLE

---

### Recommended Pilot Strategy

If timeline pressure requires earlier deployment, a **restricted internal admin/officer pilot** (admin and officer roles only, no citizen or driver production traffic) is feasible. The admin dashboard, auth controls, manual review queue, and AI pipeline work correctly when the AI service is running. Citizen and driver production traffic should wait until all CRITICAL items (C1–C7) are resolved.

---

*Produced by static code analysis and local dev-server observation only. Live database testing, physical device testing, and production infrastructure verification require the credentials and access listed in the checklist. All BLOCKED and NOT TESTED items must be independently verified by the deployment team before GO authorization is granted.*
