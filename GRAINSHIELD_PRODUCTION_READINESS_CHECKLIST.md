# GrainShield AI — Production Readiness Checklist

**Date:** 2026-11-05  
**Version:** Sprint 10 (HEAD: `6d87a3a` + this session's uncommitted changes)  
**Applies to:** Supabase project `umkjdpgxxylckoohnyco.supabase.co`

> [!CAUTION]
> Do NOT apply migration 022 or deploy updated services to production without completing the staging gate tests listed in Section 4.

---

## Section 1 — Migrations

| Migration | File | Staging | Production |
|-----------|------|---------|-----------|
| 001–018 | Various | ✅ Applied | ✅ Applied |
| 019 — Trip code generator | `019_trip_code_generator.sql` | ✅ | ✅ |
| 020 — Failed jobs table | `020_failed_jobs_table.sql` | ✅ | ✅ |
| 021 — Resolve failed job RPC | `021_resolve_failed_job_rpc.sql` | ✅ | ✅ |
| 022 — Hardening (vehicle validation, race fix) | `022_migration_hardening.sql` | ⏳ **Pending** | ❌ Not yet |

**Apply order for 022:** `psql $STAGING_URL < database/migrations/022_migration_hardening.sql`

---

## Section 2 — Environment Variables

### Admin Dashboard (`apps/admin/.env`)
| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_SUPABASE_URL` | ✅ | Project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Anon key |

### Citizen Frontend (`frontend/.env`)
| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_SUPABASE_URL` | ✅ | |
| `VITE_SUPABASE_ANON_KEY` | ✅ | |

### AI Worker (`ai-worker/.env`)
| Variable | Required | Notes |
|----------|----------|-------|
| `SUPABASE_URL` | ✅ | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Bypasses RLS for job claiming |
| `AI_MODEL_URL` | ✅ | e.g. `http://ai-model:8000` |
| `WORKER_ID` | ✅ | Unique per instance for stall recovery |
| `PROCESSING_TIMEOUT_MS` | ✅ Set | **Set to `300000` (5 min)** to match DB stale window |
| `POLL_INTERVAL_MS` | Optional | Default 5000ms |

### AI Model (`ai-model/.env`)
| Variable | Required | Notes |
|----------|----------|-------|
| `MODEL_PATH` | ✅ | Path to YOLOv8 weights |
| `CONFIDENCE_THRESHOLD` | Optional | Default 0.6 |

### Mobile App (`mobile/.env` / `app.json`)
| Variable | Required | Notes |
|----------|----------|-------|
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ | |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ | |

---

## Section 3 — RLS & Auth Configuration

| Check | Status |
|-------|--------|
| `profiles` RLS: users can read/update own row only | ✅ |
| `trips` RLS: users see only their trips | ✅ |
| `trip_evidence` RLS: users see only their evidence | ✅ |
| `verification_results` RLS: users see own trip results | ✅ |
| `manual_review_requests` RLS: officers see all | ✅ |
| `audit_logs` RLS: admins see all | ✅ |
| `failed_jobs` RLS: officers see all; service_role inserts | ✅ |
| `vehicles` RLS: authenticated admins can CRUD | ✅ |
| `trip_locations` RLS: authenticated users can insert own | ✅ |
| Email confirmation required for new users | ✅ Supabase Auth config |
| Password min length enforced | ✅ Supabase Auth config |

---

## Section 4 — Staging Gate Tests (Before Production Deploy)

### Migration 022
- [ ] Apply migration 022 to staging
- [ ] `V022-1`: Confirm `vehicle_id` column on `trips`
- [ ] `V022-2`: Confirm FK constraint `trips_vehicle_id_fkey`
- [ ] `V022-3`: Confirm race fix in `resolve_failed_job` (GET DIAGNOSTICS)
- [ ] `V022-4`: Confirm vehicle validation in `admin_dispatch_trip`
- [ ] `V022-5`: Test: dispatch with fake vehicle → expect error
- [ ] `V022-6`: Test: dispatch with inactive vehicle → expect error
- [ ] `V022-7`: Concurrent `resolve_failed_job` → only 1 audit row

### GPS (Physical Device)
- [ ] Android: background GPS → Supabase `trip_locations` rows appear
- [ ] iOS: background GPS → Supabase `trip_locations` rows appear
- [ ] App killed mid-trip → task resumes on relaunch
- [ ] Airplane mode → no crash → reconnect → push succeeds

### End-to-End Flow
- [ ] Admin dispatches trip with registered vehicle → success
- [ ] Admin dispatches trip with unregistered vehicle → error shown
- [ ] Driver submits photo → AI processes → `pass` or `manual_review`
- [ ] Officer resolves manual review → citizen sees retake/rejected banner
- [ ] Trip completes after `last_mile` with geofence pass

---

## Section 5 — Supabase Storage

| Bucket | Purpose | Public | Status |
|--------|---------|--------|--------|
| `evidence-uploads` | Trip evidence photos | No (signed URLs) | ✅ |

**Policy:** Users can upload to `evidence-uploads/{user_id}/` paths. Admins can read all. No public access.

---

## Section 6 — Known Limitations (Not Production-Ready)

| Limitation | Severity | Notes |
|------------|----------|-------|
| No checkpoint (CP1–CP4) DB enforcement | 🔴 | UI-only labels; one photo satisfies entire stage |
| Driver-sees-dispatched-trip via driver_id | 🟠 | `my-trips` queries by creator, not assigned driver |
| Background GPS not tested on physical device | 🟠 | Code fix applied; device test required |
| Mobile map is a placeholder (no react-native-maps) | 🟡 | Tracking screen shows text placeholder |
| No offline GPS queue | 🟡 | GPS points silently dropped when offline |
| Worker retry_count never incremented | 🟡 | Always 0; not critical for correctness |
| `pass`/`completed` trips invisible on admin live map | 🟡 | May confuse admins tracking active deliveries |
| No email notification to citizen on status change | 🟡 | In-app banner added; email requires SMTP config |
| 15-minute override consumption window on manual review | 🟡 | May expire during long reviews |
| No vehicle number format regex validation | 🟢 | Free text accepted in vehicle form |

---

## Section 7 — What IS Production-Ready

| Feature | Status |
|---------|--------|
| AI photo verification (plate OCR + vehicle detection) | ✅ |
| Trip code generation (GS-YYYY-NNNNNN) | ✅ |
| Trip dispatch via admin RPC | ✅ |
| Manual review officer workflow | ✅ |
| Citizen retake/rejected banners | ✅ |
| Admin dashboard with realtime stats | ✅ |
| Vehicle master registry (CRUD + expiry warnings) | ✅ |
| Vehicle trip history panel | ✅ |
| Failed job DLQ + resolution | ✅ |
| Mobile profile + password change + sign out | ✅ |
| Citizen web profile | ✅ |
| Offline evidence upload queue (mobile) | ✅ |
| Audit logging (all sensitive actions) | ✅ |
| RLS on all tables | ✅ |
| Non-root Docker containers | ✅ |
| docker-compose with healthchecks | ✅ |
| DEPLOYMENT.md with step-by-step instructions | ✅ |
| Foreground GPS tracking + admin live map | ✅ |

---

## Section 8 — Deployment Commands

```bash
# Build and deploy
docker-compose up -d --build

# Apply pending migrations (staging first!)
psql $SUPABASE_STAGING_URL < database/migrations/022_migration_hardening.sql

# Check worker logs
docker-compose logs -f ai-worker

# Check AI model health
curl http://localhost:8000/health
```

---

## Final Go/No-Go

| Gate | Status |
|------|--------|
| All DB migrations 001–021 applied | ✅ GO |
| Migration 022 staged and tested | ⚠️ CONDITIONAL — requires staging |
| GPS physical device tests | ⚠️ CONDITIONAL — requires hardware |
| Checkpoint enforcement | ❌ BACKLOG — not in scope for this sprint |
| Core trip verification workflow | ✅ GO |
| Admin management tools | ✅ GO |
| Security (RLS, RBAC, audit log) | ✅ GO |

**Recommendation:** Deploy migrations 001–021 to production now. Stage and test migration 022, then promote. GPS functionality should be marked Beta until physical device tests pass.
