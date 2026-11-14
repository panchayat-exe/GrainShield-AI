# GrainShield AI — Security Audit

**Date:** 2026-11-06  
**Auditor:** Automated static analysis (code inspection of all migrations, routes, services)  
**Scope:** Full stack — Database, Edge Functions, AI Worker, Admin, Citizen, Mobile

---

## 1. Authentication

| Control | Implementation | Status |
|---------|---------------|--------|
| Email/password auth | Supabase Auth (bcrypt) | ✅ |
| Session management | Supabase JWT (httpOnly cookie / secure storage) | ✅ |
| Token refresh | Supabase client auto-refresh | ✅ |
| Password policy | Min 8 chars (enforced client + DB-level) | ✅ |
| Password reset flow | EMAIL → magic link → `PASSWORD_RECOVERY` event → update | ✅ |
| Session invalidation on sign-out | `supabase.auth.signOut()` called | ✅ |
| Mobile secure storage | `expo-secure-store` (not AsyncStorage for tokens) | ✅ |
| Anonymous access blocked | `anon` role cannot call any sensitive RPC | ✅ |

---

## 2. Authorization (Row Level Security)

### 2.1 Table Policies

| Table | Policy | Verified |
|-------|--------|---------|
| `profiles` | Own read/update only | ✅ Migration 003 |
| `trips` | Citizens: own trips only; Admins: all; Drivers: assigned_to or driver_id | ✅ Migration 003, 019 |
| `trip_evidence` | Uploader read; Admins all | ✅ Migration 003, 007 |
| `verification_results` | Own trip evidence; Admins all; Officers assigned | ✅ |
| `manual_review_requests` | Reviewer or admin | ✅ |
| `audit_logs` | Read-only; INSERT via triggers/RPCs only | ✅ |
| `trip_locations` | Driver (uploaded_by) + admin | ✅ |
| `checkpoints` | Read: all authenticated; Write: admin/officer only | ✅ |
| `failed_jobs` | Admin only | ✅ |
| `vehicles` | Admin CRUD; authenticated read | ✅ |

### 2.2 RPC Security

| Function | Security | Permissions |
|----------|----------|-------------|
| `citizen_create_trip()` | SECURITY DEFINER, SET search_path='' | GRANT to `authenticated` only |
| `generate_trip_code()` | Called only inside `citizen_create_trip` | Not directly callable by anon |
| `admin_dispatch_trip()` | Server-side admin check | GRANT to `authenticated`; role check inside |
| `resolve_failed_job()` | Admin-only check inside | GRANT to `authenticated`; role check inside |
| `submit_trip_evidence()` | SECURITY DEFINER | GRANT to `authenticated` only |

---

## 3. Data Integrity

| Control | Implementation | Status |
|---------|---------------|--------|
| Evidence SHA-256 checksum | `crypto.subtle.digest` before upload; stored in `trip_evidence.checksum` | ✅ |
| Evidence file never replaced | `upsert: false` in Supabase storage upload | ✅ |
| Audit log on every trip action | Triggers on INSERT to `trips`, `trip_evidence` | ✅ |
| Audit log on RPC actions | Manual INSERT in each SECURITY DEFINER function | ✅ |
| Trip code globally unique | `UNIQUE(trip_code)` DB constraint (migration 025) | ✅ |
| Concurrent insert safety | Retry loop in `citizen_create_trip()` on `unique_violation` | ✅ |
| Status machine enforcement | `verification_results.status` constrained by enum | ✅ |
| No destructive migrations auto-applied | All migrations require manual SQL Editor run | ✅ |

---

## 4. Secret Management

| Secret | Location | Exposure Risk | Status |
|--------|----------|--------------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | `ai-worker/.env` only | Server-only process; never in browser | ✅ Safe |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env` | Public (by design; RLS enforces access) | ✅ Acceptable |
| `RESEND_API_KEY` | Supabase Edge Function secrets | Never in repo | ✅ Safe |
| `EXPO_ACCESS_TOKEN` | Edge Function secrets | Never in repo | ✅ Safe |
| `CV_API_KEY` | `ai-worker/.env` | Server-only | ✅ Safe |
| `.env` files | `.gitignore` excludes them | Never committed | ✅ Verified |

---

## 5. Network Security

| Control | Status |
|---------|--------|
| All Supabase endpoints HTTPS | ✅ (Supabase enforced) |
| Storage signed URLs (60s expiry) | ✅ `createSignedUrl(storagePath, 60)` |
| Storage bucket private (not public) | ✅ `trip-evidence` bucket is private |
| AI Worker → AI Model: internal network only | ✅ Not exposed externally |
| Edge Functions: Supabase JWT verification | ✅ |

---

## 6. Input Validation

| Layer | Control | Status |
|-------|---------|--------|
| Citizen form | Zod `tripSubmitSchema` (no trip_code; vehicle regex; stage enum) | ✅ |
| File upload | MIME type + size check before upload | ✅ |
| RPC server-side | Vehicle number length + charset + coordinate range checks | ✅ |
| Admin form | Vehicle regex `GJ[0-9]{2}[A-Z]{1,2}[0-9]{4}` | ✅ |
| SQL injection | Parameterized queries via Supabase JS client | ✅ |
| XSS | React auto-escapes JSX; no `dangerouslySetInnerHTML` | ✅ |

---

## 7. Identified Risks (Remaining)

| Risk | Severity | Mitigation |
|------|----------|-----------|
| AI Worker uses service-role key — if compromised, full DB access | High | Key rotation policy needed; restrict to dedicated DB user (future) |
| OCR may accept wrong plate on low-quality images | Medium | Confidence threshold + manual review routing |
| Background GPS battery drain on aggressive OEMs | Low | User documentation; battery whitelist instructions |
| No rate limiting on `citizen_create_trip()` | Medium | Supabase doesn't support per-user RPC rate limits natively; consider Edge Function wrapper |

---

## 8. Checklist

- [x] RLS enabled on all tables
- [x] Service-role key never in browser
- [x] Anon access blocked on all sensitive RPCs
- [x] SECURITY DEFINER RPCs use `SET search_path = ''`
- [x] Evidence checksums stored
- [x] Signed URLs expire in 60 seconds
- [x] No hardcoded credentials in repo
- [x] Audit log on all mutations
- [x] Password min-length enforced
- [ ] Rate limiting on RPC calls (future work)
- [ ] AI Worker restricted DB user (future work — currently uses service-role)

---

*Security audit generated: 2026-11-06. Re-audit after any new RPC, storage policy, or auth change.*
