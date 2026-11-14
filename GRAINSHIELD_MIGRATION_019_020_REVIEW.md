# GrainShield AI — Migration Review: 019, 020, 021, 022

**Audit Date:** 2026-11-05  
**Audited by:** Static security analysis (Migration Security Reviewer subagent)  
**Applies to:** Supabase project `umkjdpgxxylckoohnyco.supabase.co`

---

## Overview

| Migration | File | Status | Critical Gaps |
|-----------|------|--------|---------------|
| 019 | `019_trip_code_generator.sql` | ✅ Applied | Vehicle not validated at dispatch |
| 020 | `020_failed_jobs_table.sql` | ✅ Applied | Implicit service_role grant |
| 021 | `021_resolve_failed_job_rpc.sql` | ✅ Applied | Race condition audit dup |
| 022 | `022_migration_hardening.sql` | ⏳ Staging only | Remediates 019/020/021 gaps |

---

## Migration 019 — Trip Code Generator

### Checklist

| Check | Result |
|-------|--------|
| `BEGIN/COMMIT` wrapping | ✅ PASS |
| Sequence created with `IF NOT EXISTS` | ✅ PASS |
| Sequence synchronized from existing trip codes | ✅ PASS |
| `generate_trip_code()` uses `SECURITY DEFINER` | ✅ PASS |
| `SET search_path = ''` on function | ✅ PASS |
| `REVOKE ALL` on sequence from public/anon/authenticated/service_role | ✅ PASS |
| `admin_dispatch_trip()` validates driver role | ✅ PASS |
| `admin_dispatch_trip()` validates vehicle against master registry | ❌ GAP — no check |
| Duplicate trip code guard (preflight) | ✅ PASS |
| Audit log written on dispatch | ✅ PASS |

**Gap:** `admin_dispatch_trip()` does not verify that `vehicle_number` exists in the `vehicles` master table or is active. Any text string is accepted. → **Fixed in Migration 022.**

### Verification SQL

```sql
-- V019-1: Confirm trip code sequence exists
SELECT sequencename, start_value, increment_by
  FROM pg_sequences
 WHERE schemaname = 'public'
   AND sequencename = 'trip_code_seq';

-- V019-2: Confirm generate_trip_code() security settings
SELECT proname, prosecdef, proconfig
  FROM pg_proc
 WHERE proname = 'generate_trip_code'
   AND pronamespace = 'public'::regnamespace;
-- Expected: prosecdef=true, proconfig={search_path=}

-- V019-3: Confirm trip code format is correct
SELECT trip_code FROM public.trips
 WHERE trip_code ~ '^GS-[0-9]{4}-[0-9]{6,}$'
 LIMIT 5;
```

---

## Migration 020 — Failed Jobs Table

### Checklist

| Check | Result |
|-------|--------|
| `BEGIN/COMMIT` wrapping | ✅ PASS |
| `DROP POLICY IF EXISTS` before `CREATE POLICY` | ✅ PASS (after user fix) |
| `Officers can view failed jobs` RLS policy | ✅ PASS |
| No INSERT RLS needed (service_role bypasses) | ✅ PASS |
| `retry_count` and `last_retry_at` columns present | ✅ PASS |
| Explicit `GRANT INSERT TO service_role` | ⚠️ MISSING (implicit only) |
| Index on `resolved_at` for unresolved jobs | ✅ PASS |
| Idempotent | ✅ PASS |

**Gap:** Service_role INSERT is implicit (bypass). An explicit GRANT makes intent auditable. → **Fixed in Migration 022.**

### Verification SQL

```sql
-- V020-1: Table exists with all columns
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'failed_jobs'
 ORDER BY ordinal_position;

-- V020-2: RLS policies
SELECT policyname, cmd, roles
  FROM pg_policies
 WHERE tablename = 'failed_jobs';

-- V020-3: Unresolved jobs
SELECT COUNT(*) FROM public.failed_jobs WHERE resolved_at IS NULL;
```

---

## Migration 021 — Resolve Failed Job RPC

### Checklist

| Check | Result |
|-------|--------|
| `SECURITY DEFINER` | ✅ PASS |
| `SET search_path = ''` | ✅ PASS |
| Auth check (`auth.uid() IS NULL`) | ✅ PASS |
| Role check (`admin/super_admin/officer` only) | ✅ PASS |
| Rejects already-resolved jobs | ✅ PASS |
| `REVOKE ALL FROM PUBLIC, anon, service_role` | ✅ PASS |
| `GRANT EXECUTE TO authenticated` | ✅ PASS |
| Audit log written | ✅ PASS |
| Race condition guard on UPDATE | ⚠️ GAP — WHERE guard present but audit log still runs if 0 rows updated |
| `GET DIAGNOSTICS` row count after UPDATE | ❌ MISSING |

**Gap:** If two officers resolve the same job simultaneously, the second UPDATE matches 0 rows (WHERE guard works) but the audit log INSERT still executes, creating a duplicate audit entry. → **Fixed in Migration 022.**

### Verification SQL

```sql
-- V021-1: Function security settings
SELECT proname, prosecdef, proconfig
  FROM pg_proc
 WHERE proname = 'resolve_failed_job'
   AND pronamespace = 'public'::regnamespace;

-- V021-2: Grant check
SELECT grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE routine_name = 'resolve_failed_job';

-- V021-3: Test resolution (use a real job ID)
-- SELECT resolve_failed_job('uuid-here', 'Test resolution note');
```

---

## Migration 022 — Hardening (Staging Only)

**File:** `database/migrations/022_migration_hardening.sql`  
**Status:** ⏳ Written, NOT yet applied to production.

### Changes

1. **Race-safe `resolve_failed_job()`** — adds `GET DIAGNOSTICS v_rows_updated = ROW_COUNT` after UPDATE; skips audit if 0 rows affected.
2. **Explicit `GRANT INSERT/SELECT ON failed_jobs TO service_role`** — makes intent auditable.
3. **`vehicle_id` nullable FK column on `trips`** — references `vehicles(id) ON DELETE SET NULL`.
4. **Vehicle backfill** — matches `trips.vehicle_number` to `vehicles.vehicle_number` (case-insensitive) and populates `vehicle_id` where unambiguous.
5. **Hardened `admin_dispatch_trip()`** — validates vehicle exists in master registry and is active before inserting trip; populates `vehicle_id` FK.

### Staging Instructions

```bash
# Step 1: Connect to staging Supabase
psql "$SUPABASE_STAGING_URL" < database/migrations/022_migration_hardening.sql

# Step 2: Run V022-1 — vehicle_id column exists
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='trips' AND column_name='vehicle_id';

# Step 3: Run V022-2 — FK constraint
SELECT conname FROM pg_constraint
 WHERE conrelid='public.trips'::regclass AND conname='trips_vehicle_id_fkey';

# Step 4: Test vehicle validation
SELECT admin_dispatch_trip('FAKE-VEHICLE', 'first_mile', 'Ahmedabad');
-- Expected: { "success": false, "error": "Vehicle FAKE-VEHICLE is not registered..." }

# Step 5: Test inactive vehicle
-- First make a vehicle inactive, then:
SELECT admin_dispatch_trip('GJ05AB1234', 'first_mile', 'Ahmedabad');
-- Expected: { "success": false, "error": "...marked inactive..." }

# Step 6: Race condition test (concurrent sessions)
-- Open two psql sessions, run resolve_failed_job with same job_id simultaneously
-- Verify only 1 audit_logs row created

# Step 7: Backfill verification
SELECT COUNT(*) FROM public.trips WHERE vehicle_id IS NOT NULL;
```

---

## Cross-Migration Gaps (From Extended Audit)

| Priority | Gap | Migration | Action |
|----------|-----|-----------|--------|
| 🔴 HIGH | No vehicle validation at dispatch | 019 | ✅ Fixed in 022 |
| 🔴 HIGH | No `vehicle_id` FK on trips | 008/001 | ✅ Fixed in 022 |
| 🟡 MED | Race-audit duplicate | 021 | ✅ Fixed in 022 |
| 🟡 MED | Implicit `service_role` INSERT on `failed_jobs` | 020 | ✅ Fixed in 022 |
| 🟡 MED | Worker stall timeout mismatch (90s vs 5min DB) | 012/worker | ⏳ Set `PROCESSING_TIMEOUT_MS=300000` in `.env` |
| 🟢 LOW | Helper functions in 008 lack `SET search_path` | 008 | Backlog — Migration 023 |
| 🟢 LOW | `set_updated_at()` uses `SET search_path = public` | 001 | Backlog — Migration 023 |
| 🟢 LOW | Worker `retry_count` never incremented | worker.js | Update worker to upsert on conflict |
| ℹ️ INFO | `expected_plate` returned by claim RPC but unused | 012 | Document only |

---

## Worker Recommendation

Set in `ai-worker/.env`:
```
PROCESSING_TIMEOUT_MS=300000
```
This aligns the worker's in-process stall detection with the DB's 5-minute stale-job requeue window in migration 012.
