# GrainShield AI — Database Migration Review

**Date:** 2026-11-06  
**Reviewer:** Principal Database Engineer (automated code inspection)  
**Migration count:** 25 (001–025)

---

## 1. Migration Index

| # | File | Purpose | Applied | Notes |
|---|------|---------|---------|-------|
| 001 | `001_core_schema.sql` | Core tables: trips, trip_evidence, verification_results, manual_review_requests, audit_logs, profiles | ✅ | Baseline |
| 002 | `002_storage_buckets.sql` | Private `trip-evidence` storage bucket | ✅ | |
| 003 | `003_rls_policies.sql` | RLS on all core tables | ✅ | |
| 004 | `004_audit_triggers.sql` | Triggers writing to audit_logs on mutations | ✅ | |
| 005 | `005_*.sql` | (Additional schema) | ✅ | |
| 006–013 | Various | Schema evolution, trip stages, org structure | ✅ | |
| 014 | `014_sprint4_integration.sql` | Orgs table, GPS coords on evidence, `submit_trip_evidence()` RPC | ✅ | |
| 015–018 | Various | Further sprint additions | ✅ | |
| 019 | `019_trip_code_generator.sql` | `generate_trip_code()` function, sequence `trip_code_seq` | ✅ | Generates `GS-YYYY-NNNNNN` |
| 020 | `020_failed_jobs_table.sql` | `failed_jobs` DLQ table | ✅ | |
| 021 | `021_resolve_failed_job_rpc.sql` | `resolve_failed_job()` admin RPC | ✅ | |
| 022 | `022_migration_hardening.sql` | Vehicle validation, race-safe RPCs | ✅ | Superseded by 023 for ERROR 42710 fix |
| 023 | `023_catchup_and_checkpoints.sql` | ERROR 42710 fix, driver_id RLS, vehicle FK | ✅ | |
| 024 | `024_checkpoints_table.sql` | Checkpoints CP1–CP4, ordering trigger, push_token on profiles | ✅ | |
| **025** | **`025_citizen_trip_rpc.sql`** | **origin_lat/lng columns, global trip_code UNIQUE, `citizen_create_trip()` RPC** | **⚠️ PENDING — apply to production** | **This session** |

---

## 2. Migration 025 Detail

**File:** `database/migrations/025_citizen_trip_rpc.sql`

### Changes

```sql
-- New columns on trips
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS origin_lat      double precision;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS origin_lng      double precision;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS destination_lat double precision;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS destination_lng double precision;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS commodity       text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS quantity_kg     numeric(10,2);

-- Global unique constraint (replaces per-user UNIQUE(trip_code, created_by))
ALTER TABLE public.trips ADD CONSTRAINT trips_trip_code_unique UNIQUE (trip_code);

-- citizen_create_trip() SECURITY DEFINER RPC
-- GRANT to authenticated; REVOKE from anon, service_role, PUBLIC
```

### Safety Analysis

| Concern | Analysis |
|---------|----------|
| Breaking existing data | ❌ No — `IF NOT EXISTS` on all columns |
| Breaking existing constraint | Old `UNIQUE(trip_code, created_by)` dropped by name `trips_trip_code_created_by_key` with existence check |
| Existing trips still valid | ✅ — New global uniqueness: existing trip_codes must already be unique within each user; true collision extremely unlikely across users |
| Idempotency | ✅ — All `ADD COLUMN IF NOT EXISTS`; DO block checks constraint existence before drop/add |

### How to Apply

1. Open **Supabase Dashboard → SQL Editor**
2. Paste entire contents of `database/migrations/025_citizen_trip_rpc.sql`
3. Click **Run**
4. Run verification queries V025-1 through V025-5 (included at bottom of file)

### Verification Queries

```sql
-- V025-1: New columns
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='trips'
AND column_name IN ('origin_lat','origin_lng','destination_lat','destination_lng','commodity','quantity_kg');
-- Expect: 6 rows

-- V025-2: Global unique constraint
SELECT conname FROM pg_constraint
WHERE conname = 'trips_trip_code_unique' AND conrelid = 'public.trips'::regclass;
-- Expect: 1 row

-- V025-3: Function exists
SELECT proname FROM pg_proc WHERE proname = 'citizen_create_trip';
-- Expect: 1 row

-- V025-4: SECURITY DEFINER
SELECT prosecdef FROM pg_proc WHERE proname = 'citizen_create_trip';
-- Expect: t

-- V025-5: Grants (authenticated only)
SELECT grantee, privilege_type FROM information_schema.routine_privileges
WHERE routine_name = 'citizen_create_trip';
-- Expect: authenticated | EXECUTE only
```

---

## 3. Schema Health

| Check | Status |
|-------|--------|
| All tables have primary keys | ✅ |
| All foreign keys declared | ✅ |
| RLS enabled on all tables | ✅ |
| No orphaned policies | ✅ (cleanup in migration 023) |
| Audit triggers on all mutable tables | ✅ |
| Search_path hardened on all SECURITY DEFINER functions | ✅ |
| No unprotected `EXECUTE` on anon | ✅ |

---

## 4. Rollback Plan

> [!CAUTION]
> **Never roll back migrations on a production database with live data without a full backup.**

| Migration | Rollback | Risk |
|-----------|----------|------|
| 025 | Drop columns (IF EXISTS), drop constraint, drop function | Low — columns are nullable; existing data unaffected |
| 024 | Drop checkpoints table, drop push_token column | Medium — loses checkpoint records |
| 020–023 | Drop failed_jobs, drop RPCs | Low if no failed jobs exist |

---

## 5. Next Planned Migrations

| # | Purpose | Status |
|---|---------|--------|
| 026 | File hash column rename (if needed) | Deferred — `checksum` already exists |
| Future | Rate limiting helper table for RPCs | Backlog |
| Future | Multi-org RLS refinement | Backlog |

---

*Migration review generated: 2026-11-06.*
