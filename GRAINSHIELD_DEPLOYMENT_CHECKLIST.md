# GrainShield AI — Deployment Checklist

**Project:** GRAINSHIELD AI — SFIC PS000006  
**Version:** Sprint 4 MVP  
**HEAD:** `b745c42` + pending commit (this sprint)

> [!IMPORTANT]
> Never apply DB migrations to the remote Supabase production database automatically.  
> Always run migrations manually in the Supabase SQL Editor and confirm results before proceeding.

---

## 1. Environment Variables

### AI Worker (`ai-worker/.env`)

```env
SUPABASE_URL=https://umkjdpgxxylckoohnyco.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key — never commit>
CV_PROVIDER=http
CV_API_URL=http://127.0.0.1:8000
POLL_INTERVAL_MS=15000
```

### Citizen Frontend (`frontend/.env` or Vite env)

```env
VITE_SUPABASE_URL=https://umkjdpgxxylckoohnyco.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_p3xAWY-au8Yf1YPoN3jEbQ_JUvmcszQ
```

### Admin Dashboard (`apps/admin/.env`)

```env
VITE_SUPABASE_URL=https://umkjdpgxxylckoohnyco.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_p3xAWY-au8Yf1YPoN3jEbQ_JUvmcszQ
```

### AI Inference (`ai-model/.env` or system)

```env
# No secrets required for local dev; API is unauthenticated on localhost:8000
```

---

## 2. Database Migrations

Apply in order in the **Supabase SQL Editor** (`https://supabase.com/dashboard/project/umkjdpgxxylckoohnyco/sql`):

| # | File | Description | Applied |
|---|------|-------------|---------|
| 001 | `database/migrations/001_initial_schema.sql` | Initial schema | ✅ |
| 002–014 | (various) | Incremental schema changes | ✅ |
| 015 | `database/migrations/015_trip_state_machine_enforcement.sql` | DB-level state machine trigger | ✅ |
| 016 | `database/migrations/016_fix_resolve_manual_review.sql` | Fix resolve_manual_review RPC | ✅ Applied |
| 017 | `database/migrations/017_backfill_manual_review_requests.sql` | Backfill missing review rows | ⬜ **Apply now** |

### How to apply Migration 017

1. Open Supabase SQL Editor
2. Open `database/migrations/017_backfill_manual_review_requests.sql`
3. Paste and run
4. Verify with the query at the bottom of the migration file:
   ```sql
   SELECT t.id, t.trip_code, t.status, COUNT(mrr.id) AS review_rows
   FROM trips t
   LEFT JOIN manual_review_requests mrr ON mrr.trip_id = t.id
   WHERE t.status = 'manual_review'
   GROUP BY t.id, t.trip_code, t.status;
   ```
   Every row should show `review_rows >= 1`.

---

## 3. Server Startup Commands

Run in separate terminals (or as background processes):

### AI Inference (FastAPI)

```powershell
cd "d:\Grain_Guard_AI\GS_USER_FNTED\GG_USER_FNTED\ai-model"
# Ensure Python environment is activated
uvicorn inference:app --host 0.0.0.0 --port 8000 --reload
```

### AI Worker (Node.js)

```powershell
cd "d:\Grain_Guard_AI\GS_USER_FNTED\GG_USER_FNTED\ai-worker"
node --env-file=.env src/worker.js
```

### Citizen Frontend (Dev)

```powershell
cd "d:\Grain_Guard_AI\GS_USER_FNTED\GG_USER_FNTED\frontend"
npm run dev
# → http://localhost:8080
```

### Admin Dashboard (Dev)

```powershell
cd "d:\Grain_Guard_AI\GS_USER_FNTED\GG_USER_FNTED\apps\admin"
npm run dev
# → http://localhost:3001
```

---

## 4. Post-Deployment Verification

### 4.1 Health Checks

```powershell
# AI Inference
Invoke-RestMethod http://127.0.0.1:8000/health

# Admin Dashboard (browser)
# Navigate to http://localhost:3001 → should load login page

# Citizen Frontend (browser)
# Navigate to http://localhost:8080 → should load home page
```

### 4.2 Officer Review Workflow

1. Sign in to Admin (`http://localhost:3001`) as `admin@grainshield.gov.in` / `Admin@123456`
2. Navigate to Verification
3. Find a trip in the queue with status `manual_review`
4. Enter justification (≥5 chars), select Approve, click Confirm
5. ✅ Trip should transition to `pass` without error
6. ✅ Audit log entry should appear in Audit Logs page

### 4.3 AI Worker Creates Review Rows

1. Sign in to Citizen app (`http://localhost:8080`)
2. Create a new trip and upload a photo
3. Wait up to 30 seconds for the worker poll
4. Check Admin verification queue — trip should appear

### 4.4 State Machine Verification

```sql
-- In Supabase SQL Editor: verify trigger exists and is enabled
SELECT trigger_name, event_manipulation, action_statement, trigger_enabled
FROM information_schema.triggers
WHERE trigger_name = 'trg_enforce_trip_state_machine';
```

Expected: one row, `trigger_enabled = 'O'` (Origin)

---

## 5. Test Accounts

| Email | Password | Role | Notes |
|-------|----------|------|-------|
| `admin@grainshield.gov.in` | `Admin@123456` | super_admin | Primary admin/officer account |
| `test_runner_b@grainshield.local` | `OfficerPassword123!` | officer | **Test account** — scripted overrides only |
| `driver@grainshield.gov.in` | `Driver@123456` | user | Citizen/driver test account |
| `test_runner_a@grainshield.local` | `TestRunnerPassword123!` | user | Citizen test account |

> [!WARNING]
> `test_runner_b@grainshield.local` is a **test account**. Audit log entries from this account are scripted demonstration records. Do not interpret them as independently verified physical field evidence.

---

## 6. Rollback Procedures

### Admin Queries (admin-queries.ts)

If the left-join change causes any issue, revert by adding `!inner` back:
```ts
// In getReviewQueue():
trip_evidence!inner(id, original_filename, storage_path, uploaded_at)
```

### Migration 017

The migration is non-destructive (INSERT only, with NOT EXISTS guard). To undo:
```sql
-- Remove backfilled rows only (they have the specific user_notes text)
DELETE FROM manual_review_requests
WHERE user_notes = 'Backfilled by Migration 017: AI flagged this trip for manual review.';
```

---

## 7. GitHub CI

| Workflow | File | Triggers |
|---------|------|---------|
| CI | `.github/workflows/ci.yml` | Push to main, PRs |

Check CI status at: `https://github.com/panchayat-exe/GrainShield-AI/actions`

### Open Pull Requests

| PR | Branch | Status | Action |
|----|--------|--------|--------|
| #4 | `fix/plate-ocr-confidence` | Open | ✅ 8/8 tasks done — merge or close |
| #3 | `main` | Open | Close (work already on main) |

---

## 8. Checklist Summary

- [ ] Migration 017 applied to production Supabase
- [ ] All 4 servers running (AI Inference, AI Worker, Frontend, Admin)
- [ ] Officer review workflow tested end-to-end
- [ ] Verification queue shows all manual_review trips
- [ ] Pending review badge visible in admin nav
- [ ] TypeScript builds pass: Admin ✅, Frontend ✅
- [ ] GitHub HEAD SHA verified and pushed
- [ ] PR #4 merged or closed
- [ ] Audit log entries preserved (do not delete test records)
