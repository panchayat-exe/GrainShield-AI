# GrainShield AI — Button Functionality Matrix

**Date:** 2026-11-05  
**Audited by:** Static code analysis (GPS & Button Audit Researcher subagent)  
**Scope:** All 3 apps — Admin, Citizen Web, Mobile

**Legend:**
- ✅ **WORKING** — calls real backend + has error handling
- ⚠️ **PARTIAL** — works but incomplete (no error handling, client-side only filter)
- 🔵 **UI_ONLY** — no backend call (modal opener, navigation link, local state)
- ❌ **BROKEN / FIXED** — was broken, now fixed this session

---

## Admin Dashboard (`apps/admin/`)

### `/` — Dashboard
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| Stats auto-load | `getDashboardStats()` → Supabase | ✅ try/catch | ✅ WORKING |
| Trips tile link | Navigation | N/A | ✅ WORKING |
| Verification tile | Navigation | N/A | ✅ WORKING |
| Live Tracking tile | Navigation | N/A | ✅ WORKING |
| Reports tile | Navigation | N/A | ✅ WORKING |
| Audit Logs tile | Navigation | N/A | ✅ WORKING |
| Realtime subscription (trips/verification/manual_review) | Supabase Realtime | N/A | ✅ WORKING |

### `/trips` — Trip Registry
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `+ Register Trip` | Opens modal | N/A | 🔵 UI_ONLY |
| Modal `Register Trip` submit | `admin_dispatch_trip` RPC | ✅ try/catch + toast | ✅ WORKING |
| Modal `Cancel` | Closes modal | N/A | 🔵 UI_ONLY |
| Stage filter | `getTrips()` Supabase query | ✅ catch + setError | ✅ WORKING |
| Status filter | `getTrips()` | ✅ | ✅ WORKING |
| Date from/to pickers | `getTrips()` | ✅ | ✅ WORKING |
| `Clear dates` | Re-fetches | ✅ | ✅ WORKING |
| `View Details` per row | Navigation to `/verification/$id` | N/A | ✅ WORKING |
| Pagination Prev/Next | `getTrips()` | ✅ | ✅ WORKING |

### `/verification` — Review Queue
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Claim` per row | `assignReviewer()` → Supabase UPDATE | ✅ try/catch + toast | ✅ WORKING |
| `Inspect` link | Navigation | N/A | ✅ WORKING |
| Stage/Status/Date filters | `getReviewQueue()` | ✅ | ✅ WORKING |
| Search input | Client-side filter on loaded rows | None | ⚠️ PARTIAL |
| `New Updates — Refresh` badge | `fetchQueue()` | ✅ | ✅ WORKING |
| Pagination Prev/Next | `getReviewQueue()` | ✅ | ✅ WORKING |

### `/verification/$tripId` — Verification Detail
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Approve (PASS)` radio | Sets local state | None | 🔵 UI_ONLY |
| `Request Retake` radio | Sets local state | None | 🔵 UI_ONLY |
| `Reject (FAIL)` radio | Sets local state | None | 🔵 UI_ONLY |
| `Confirm [decision]` | `resolveManualReview()` → `resolve_manual_review` RPC | ✅ try/catch + error display | ✅ WORKING |
| `View Full Resolution` (evidence) | `window.open(signedUrl)` | N/A | ✅ WORKING |
| `Follow on Live Map` | Navigation | N/A | ✅ WORKING |
| Notes textarea | Local state | None | 🔵 UI_ONLY |

### `/live-tracking` — Live Map
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Refresh positions` | `getActiveTripLocations()` | ✅ catch + setError | ✅ WORKING |
| Search input | Client-side filter | None | ⚠️ PARTIAL |
| Search/Clear button | Clears `search` state | None | ❌ → ✅ **FIXED** |
| TripCard sidebar click | Local map pan | None | ✅ WORKING |
| Map marker click | Local select | None | ✅ WORKING |
| Realtime GPS updates | Supabase Realtime | N/A | ✅ WORKING |

### `/users` — User Management
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| Role dropdown | `updateUserRole()` → `manage_user_role` RPC | ✅ try/catch + toast | ✅ WORKING |
| Search input | `getProfiles()` Supabase query | ✅ | ✅ WORKING |
| Pagination Prev/Next | `loadProfiles()` | ✅ | ✅ WORKING |

> **Note:** The direct `profiles` UPDATE fallback in `updateUserRole` was **removed this session** to enforce RPC-level RBAC. Only `manage_user_role` RPC is now used.

### `/audit-logs` — Audit Log
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Export Audit Trail (CSV)` | Client-side CSV from loaded data | N/A | ✅ WORKING |
| `Details` eye icon | Opens modal | None | 🔵 UI_ONLY |
| Modal `Close` | Closes modal | None | 🔵 UI_ONLY |
| Action/Date filters | `getAuditLogs()` | ✅ | ✅ WORKING |
| Search input | Client-side filter | None | ⚠️ PARTIAL |
| Pagination Prev/Next | `getAuditLogs()` | ✅ | ✅ WORKING |

### `/reports` — Reports
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `CSV Report` (top) | `downloadCSV()` + `logReportExport()` audit | ✅ catch + toast | ✅ WORKING |
| `Export Dataset` card | Same as above | ✅ | ✅ WORKING |
| Per-district `Download` | `downloadCSV([district])` | ✅ | ✅ WORKING |
| Period/District/Stage selects | `getReportStats()` | ✅ | ✅ WORKING |

### `/failed-jobs` — Failed Job Queue
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Resolve` per row | Opens modal | None | 🔵 UI_ONLY |
| Modal `Mark Resolved` | `resolve_failed_job` RPC | ✅ try/catch + toast | ✅ WORKING |
| Modal `Cancel` | Closes modal | None | 🔵 UI_ONLY |
| `Refresh` | `fetchJobs()` Supabase query | ✅ | ✅ WORKING |
| `Show resolved` checkbox | Re-fetches | ✅ | ✅ WORKING |
| Trip link | Navigation | N/A | ✅ WORKING |

### `/vehicles` — Vehicle Registry
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `+ Register Vehicle` | Opens modal | None | 🔵 UI_ONLY |
| Modal `Save Vehicle` | `upsertVehicle()` Supabase upsert | ✅ try/catch + toast | ✅ WORKING |
| `Edit` per row | Opens modal | None | 🔵 UI_ONLY |
| `Trips` per row (new) | `getVehicleTripHistory()` | ✅ setHistoryLoading | ✅ WORKING |
| `Deactivate / Activate` toggle | `toggleVehicleActive()` Supabase UPDATE | ✅ try/catch + toast | ✅ WORKING |
| Search input | `getVehicles()` debounced | ✅ | ✅ WORKING |
| Pagination Prev/Next | `getVehicles()` | ✅ | ✅ WORKING |
| History panel `×` close | Clears local state | None | 🔵 UI_ONLY |

### `/login` — Admin Login
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Sign In to Admin Portal` | `adminSignIn()` Supabase auth | ✅ try/catch + setError | ✅ WORKING |
| `Forgot password?` | Opens modal | None | 🔵 UI_ONLY |
| `Send Recovery Link` | `adminResetPassword()` | ✅ try/catch + setError | ✅ WORKING |

### `/profile` — Admin Profile
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Save Profile` | `supabase.from('profiles').update()` | ✅ catch + setSaveError | ✅ WORKING |
| `Change Password` | `supabase.auth.updateUser({password})` | ✅ catch + setPwError | ✅ WORKING |

---

## Citizen Web (`frontend/`)

### `/` — Upload
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Submit` | `upsertTrip` + `uploadEvidence` + `createPendingVerification` | ✅ try/catch + setError | ✅ WORKING |
| `Reset` | Clears local state | None | 🔵 UI_ONLY |
| `Sign In` gate | Navigation | N/A | ✅ WORKING |
| File picker | Local validation + preview | ✅ inline | ✅ WORKING |
| Stage pill selector | Local state | None | 🔵 UI_ONLY |

### `/trip` — Trip Details
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| Data load (auto) | 4 parallel Supabase queries | ✅ setNotFound | ✅ WORKING |
| Realtime subscription | Supabase Realtime | N/A | ✅ WORKING |
| Status-change banner (new) | Derived from realtime state | None | ✅ WORKING |
| Retake banner upload CTA (new) | Navigation to `/` | N/A | ✅ WORKING |
| `Check processing` link | Navigation | N/A | ✅ WORKING |
| `Upload a new photo` link | Navigation | N/A | ✅ WORKING |

### `/result` — Result
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| Data load (auto) | 3 parallel queries + signed URL | ✅ setNotAuthorized | ✅ WORKING |
| `Retake Required` banner (new) | Shows when `trip.status === 'retake'` | N/A | ✅ WORKING |
| `Rejected` banner (new) | Shows when `trip.status === 'rejected'` | N/A | ✅ WORKING |
| `Upload New Photo` button (new) | Navigation to `/` | N/A | ✅ WORKING |
| `Back to Trip Report` | Navigation | N/A | ✅ WORKING |
| Auto-refresh polling (new) | `getTripById()` every 20s | None | ⚠️ PARTIAL |

### `/processing` — Processing
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| Polling 3s | `getLatestVerification()` | None (silent) | ⚠️ PARTIAL |
| Realtime subscription | `subscribeToTripVerifications` | N/A | ✅ WORKING |
| `View Result` / `Trip Details` links | Navigation | N/A | ✅ WORKING |

### `/my-trips` — My Trips
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `View` per row | Navigation | N/A | ✅ WORKING |
| `New Upload` link | Navigation | N/A | ✅ WORKING |
| Pagination Prev/Next | Supabase re-fetch | ✅ | ✅ WORKING |

### `/profile` — Citizen Profile
| Button / Control | Backend Call | Error Handling | Status |
|-----------------|-------------|----------------|--------|
| `Save Profile` | `supabase.from('profiles').update()` | ✅ catch + setSaveError | ✅ WORKING |
| `Change Password` | `supabase.auth.updateUser()` | ✅ catch + setPwError | ✅ WORKING |

### Auth routes — Login / Register / Forgot Password / Reset Password
| Screen | Key Button | Status |
|--------|-----------|--------|
| Login | `Sign In` | ✅ WORKING |
| Register | `Register` | ✅ WORKING |
| Forgot Password | `Send Reset Link` | ✅ WORKING |
| Reset Password | `Update Password` + session listener | ✅ WORKING |

---

## Mobile App (`mobile/`)

### Upload Screen `(app)/index.tsx`
| Button | Status |
|--------|--------|
| `Take Photo` | ✅ WORKING |
| `From Gallery` | ✅ WORKING |
| `Retake` / `Gallery` (after photo) | ✅ WORKING |
| `Submit` (online) | ✅ WORKING |
| `Submit` → saves to outbox (offline) | ✅ WORKING |
| `Reset` | 🔵 UI_ONLY |
| Stage pills | 🔵 UI_ONLY |

### Processing `(app)/processing.tsx`
| Button | Status |
|--------|--------|
| Pull-to-refresh | ✅ WORKING |
| `Refresh Status` | ✅ WORKING |
| `Sync to Cloud & Verify` (outbox) | ✅ WORKING |
| Polling (2s) | ⚠️ PARTIAL (silent catch) |

### Trip Details `(app)/trip.tsx`
| Button | Status |
|--------|--------|
| `Check processing` | ✅ WORKING |
| `Upload new photo` | ✅ WORKING |

### Failed/Review `(app)/failed.tsx`
| Button | Status |
|--------|--------|
| `Retake Photo` | ✅ WORKING |
| `Send for Manual Review` | ✅ WORKING |
| `Back to Trip Report` | ✅ WORKING |

### Profile `(app)/profile.tsx`
| Button | Status |
|--------|--------|
| `Save Profile` | ✅ WORKING |
| `Change Password` | ✅ WORKING |
| `Sign Out` | ❌ → ✅ **FIXED** (now has try/catch) |

### Auth — Login / Register / Forgot Password
| Screen | Key Button | Status |
|--------|-----------|--------|
| Login | `Sign In` | ✅ WORKING |
| Login | `Work in Offline Field Mode` | ✅ WORKING |
| Register | `Register` | ✅ WORKING |
| Forgot Password | `Send Reset Link` | ✅ WORKING |

### GPS Tracking `(app)/tracking.tsx`
| Button | Status |
|--------|--------|
| `Search` trip code | ✅ WORKING |
| `Start Sharing` GPS | ⚠️ PARTIAL (no error on push fail; no status gate) |
| `Stop` GPS | ✅ WORKING |

---

## Summary of Fixes Applied This Session

| Fix | File | Severity |
|-----|------|----------|
| Live-tracking search button now clears search | `live-tracking.tsx` | 🟡 |
| `updateUserRole` RBAC fallback removed | `admin-queries.ts` | 🟠 |
| Background GPS now pushes to Supabase | `use-gps-tracking.ts` | 🔴 |
| Mobile profile `signOut` has try/catch | `(app)/profile.tsx` | 🟢 |
| Citizen retake/rejected banners | `result.tsx`, `trip.tsx` | 🟡 |
| Vehicle trip history panel + "Trips" button | `vehicles.tsx` | 🟡 |

---

## Remaining Known Issues

| Issue | File | Priority |
|-------|------|----------|
| Checkpoint table missing — CP1–CP4 not enforced in DB | Schema | 🔴 Sprint N+1 |
| Driver-sees-dispatched-trip via `driver_id` | `my-trips.tsx` service layer | 🟠 Sprint N+1 |
| Mobile map is a placeholder (no react-native-maps) | `tracking.tsx` | 🟡 Sprint N+1 |
| No offline GPS queue | `use-gps-tracking.ts` | 🟡 Sprint N+1 |
| GPS deduplication (stationary push) | `use-gps-tracking.ts` | 🟢 Backlog |
| Processing polling silent exception swallow | `processing.tsx` | 🟢 Backlog |
| `pass`/`completed` trips vanish from live-tracking map | `admin-queries.ts` | 🟡 Backlog |


---

## UPDATE — 2026-11-06 (Migration 025 + Auto Trip ID)

### Changes Applied This Update

| Fix | File | Status |
|-----|------|--------|
| **REMOVED Trip ID input field (citizen web)** | `frontend/src/routes/index.tsx` | ✅ **FIXED** |
| Citizen form now calls `citizen_create_trip()` RPC | `frontend/src/lib/services/trips.ts` | ✅ **FIXED** |
| Confirmation screen shows auto-generated GS-YYYY-NNNNNN | `frontend/src/routes/index.tsx` | ✅ **FIXED** |
| **REMOVED Trip ID input field (mobile)** | `mobile/app/(app)/index.tsx` | ✅ **FIXED** |
| Mobile calls `createCitizenTrip()` RPC | `mobile/lib/services/trips.ts` | ✅ **FIXED** |
| Mobile shows Trip ID in Alert on submit | `mobile/app/(app)/index.tsx` | ✅ **FIXED** |
| `tripSubmitSchema` added (no trip_code) | `frontend/src/lib/validation/index.ts` | ✅ **FIXED** |
| `tripSubmitSchema` added (mobile) | `mobile/lib/validation/index.ts` | ✅ **FIXED** |
| Mobile types synced: driver_id, vehicle_id, lat/lng columns | `mobile/lib/supabase/types.ts` | ✅ **FIXED** |
| Checkpoint table CP1–CP4 ordering enforced | Migration 024 | ✅ **FIXED** |
| Offline outbox: placeholder "PENDING" until online sync | `mobile/app/(app)/index.tsx` | ✅ NOTED |

### Updated Upload Screen Status

**Citizen Web (`frontend/src/routes/index.tsx`)**
| Button / Element | Backend Call | Status |
|-----------------|-------------|--------|
| ~~Trip ID input~~ | ~~N/A~~ | 🔧 **REMOVED** |
| Vehicle Number input | Validation only | ✅ WORKING |
| Trip Stage select | Validation only | ✅ WORKING |
| Origin input (optional) | Passed to RPC | ✅ WORKING |
| Destination input (optional) | Passed to RPC | ✅ WORKING |
| Commodity input (optional) | Passed to RPC | ✅ WORKING |
| `Submit Trip` button | `citizen_create_trip()` RPC → evidence upload | ✅ WORKING |
| Confirmation banner | Shows GS-YYYY-NNNNNN | ✅ WORKING |
| Auto-redirect to /processing | setTimeout(2500) | ✅ WORKING |
| `Reset` button | Local state reset | ✅ UI_ONLY |
| File picker (camera/gallery) | File validation | ✅ WORKING |

**Mobile (`mobile/app/(app)/index.tsx`)**
| Button / Element | Status |
|-----------------|--------|
| ~~Trip ID TextInput~~ | 🔧 **REMOVED** |
| Vehicle Number input | ✅ WORKING |
| Stage pills (First/Last Mile) | ✅ UI_ONLY (local state) |
| Take Photo | ✅ WORKING |
| From Gallery | ✅ WORKING |
| `Submit` (online) | `createCitizenTrip()` RPC → Alert shows GS-YYYY-NNNNNN | ✅ WORKING |
| `Submit` (offline) | Saves to outbox with PENDING code | ✅ WORKING |
| `Reset` | Local state | ✅ UI_ONLY |

### Updated Remaining Known Issues

| Issue | Priority | Status |
|-------|----------|--------|
| Offline mobile trip sync: trip_code remains PENDING until sync | Medium | ⚠️ Needs outbox sync flow update to call RPC online |
| Origin/destination map visualization | Medium | Backlog |
| Rate limiting on `citizen_create_trip()` RPC | Medium | Backlog |
| Processing polling silent exception swallow | Low | Backlog |
| GPS deduplication (stationary push) | Low | Backlog |
