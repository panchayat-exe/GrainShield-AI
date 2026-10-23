# GrainShield AI — Database

This folder contains all PostgreSQL schema definitions, RLS policies, and database triggers for the GrainShield AI Supabase project.

---

## Applying Migrations

Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/umkjdpgxxylckoohnyco/sql/new) and run each file **in order**:

| Order | File | Purpose |
|-------|------|---------|
| 1 | `migrations/001_core_schema.sql` | 7 tables, enums, indexes, FK constraints |
| 2 | `migrations/002_auth_triggers.sql` | Auto-creates user profiles on signup; role helper functions |
| 3 | `migrations/003_rls_policies.sql` | 20 Row Level Security policies (user isolation + admin bypass) |
| 4 | `migrations/004_audit_triggers.sql` | Auto-writes audit log on every data change |
| 5 | `migrations/005_storage_policies.sql` | Private `trip-evidence` bucket access control |
| 6 | `migrations/006_email_config_notes.sql` | Documentation only — safe to skip |

All migrations are **idempotent** — safe to re-run if already applied.

## Using Supabase CLI

```bash
supabase login
supabase link --project-ref umkjdpgxxylckoohnyco
supabase db push
```

## Schema Overview

```
profiles              → auth.users (1:1)
trips                 → profiles (created_by)
trip_evidence         → trips + profiles (uploaded_by)
verification_results  → trips + trip_evidence
trip_locations        → trips + profiles
manual_review_requests→ trips + trip_evidence + profiles
audit_logs            → trips (immutable history)
```

See `../docs/ADMIN_INTEGRATION.md` for full table schemas, RLS behaviour, and admin integration instructions.

## Rules

- Never modify existing migrations. Add new numbered files (007, 008, …).
- Test migrations on a staging project before applying to production.
- The `trip-evidence` storage bucket must be created manually in the dashboard (Storage → New bucket, Public: **OFF**).
