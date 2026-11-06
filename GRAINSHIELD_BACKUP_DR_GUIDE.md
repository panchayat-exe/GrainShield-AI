# GrainShield AI — Backup & Disaster Recovery Guide

**Version:** Production RC  
**Date:** 2026-11-06  
**RTO Target:** < 4 hours  
**RPO Target:** < 24 hours (daily backup) / < 5 minutes (with PITR enabled)

---

## 1. Overview

GrainShield AI stores all critical data in Supabase (PostgreSQL + Storage). This guide covers:
- Supabase automatic daily backups
- Point-in-Time Recovery (PITR)
- Storage bucket backup
- Environment variable backup
- Recovery procedures
- RTO/RPO commitments
- Escalation contacts

---

## 2. Database Backups

### 2.1 Automatic Daily Backups (Supabase)

Supabase automatically creates daily snapshots on **Pro** and higher plans.

**To enable and verify:**

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your GrainShield project
3. Navigate to **Settings → Database**
4. Scroll to the **Backups** section
5. Confirm backups are listed (Supabase Pro: 7-day retention, Team: 14-day, Enterprise: 30-day)

> [!IMPORTANT]
> Daily backups are only available on **Pro plan and above**. If you are on the Free plan, upgrade immediately before going to production. Supabase Free plan has NO automatic backups.

**Manual backup (any plan):**

```bash
# Install pg_dump
# On Windows: use the PostgreSQL binaries or pgAdmin

pg_dump \
  "postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file="grainshield_backup_$(date +%Y%m%d_%H%M%S).dump"
```

**Connection string location:** Supabase Dashboard → Settings → Database → Connection string (use the direct connection, port 5432).

> [!CAUTION]
> Never commit the database password to Git. Store it in a password manager or secrets vault.

---

### 2.2 Point-in-Time Recovery (PITR)

PITR allows restoration to any point within the retention window (up to minutes).

**To enable PITR:**

1. Supabase Dashboard → **Settings → Database → Point in Time Recovery**
2. Click **Enable PITR**
3. Select retention period (minimum 7 days recommended)

> [!NOTE]
> PITR is available on **Supabase Pro** plan and above. It increases storage costs (WAL segments are retained). For GrainShield AI, PITR is strongly recommended given that audit logs, evidence records and trip data are legally significant.

**To restore using PITR:**

1. Go to Supabase Dashboard → Settings → Backups
2. Click **Restore to a point in time**
3. Select the target timestamp
4. Confirm restore — this creates a NEW project with the restored data
5. Update all application environment variables to point to the new project
6. Test all applications before switching production traffic

---

### 2.3 Pre-Migration Snapshot Procedure

Before applying any database migration:

```bash
# 1. Create a named snapshot in Supabase Dashboard
#    Settings → Database → Backups → "Create Snapshot" (if supported)
#    OR: perform a pg_dump manually

pg_dump \
  "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  --format=custom \
  --file="pre_migration_$(date +%Y%m%d).dump"

# 2. Store the dump file in a secure location (not in the Git repo)
# 3. Apply the migration
# 4. Run verification queries
# 5. If the migration fails: restore from the dump
```

---

## 3. Storage Bucket Backup

GrainShield AI uses the `trip-evidence` Supabase Storage bucket for photograph evidence.

### 3.1 List all objects

```bash
curl "https://<ref>.supabase.co/storage/v1/object/list/trip-evidence" \
  -H "Authorization: Bearer <service-role-key>" \
  -H "apikey: <service-role-key>"
```

### 3.2 Download all objects (Node.js script)

Save as `scripts/backup_storage.js`:

```javascript
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Required for storage access
);

const BUCKET = 'trip-evidence';
const BACKUP_DIR = `./storage_backup_${new Date().toISOString().slice(0, 10)}`;

async function backupStorage() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  let page = 0;
  const PAGE_SIZE = 100;

  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('', { limit: PAGE_SIZE, offset: page * PAGE_SIZE });

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const file of data) {
      const { data: blob, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(file.name);

      if (dlErr) {
        console.error(`Failed to download ${file.name}:`, dlErr.message);
        continue;
      }

      const localPath = path.join(BACKUP_DIR, file.name.replace(/\//g, '_'));
      fs.writeFileSync(localPath, Buffer.from(await blob.arrayBuffer()));
      console.log(`Backed up: ${file.name}`);
    }

    page++;
  }

  console.log(`Storage backup complete: ${BACKUP_DIR}`);
}

backupStorage().catch(console.error);
```

> [!NOTE]
> Run this script on a schedule (e.g., weekly) or before any major changes. Storage backup can be large — use an external drive or cloud storage (AWS S3, Google Drive) as the destination.

---

## 4. Environment Variable Backup

All GrainShield AI secrets must be backed up in a **secure vault**, NOT in Git.

### 4.1 Variables to back up

| Application | Variable | Purpose |
|---|---|---|
| `frontend/` | `VITE_SUPABASE_URL` | Supabase project URL |
| `frontend/` | `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `apps/admin/` | `VITE_SUPABASE_URL` | Supabase project URL |
| `apps/admin/` | `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `mobile/` | `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `mobile/` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `ai-worker/` | `SUPABASE_URL` | Supabase project URL |
| `ai-worker/` | `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (privileged) |
| `ai-worker/` | `CV_PROVIDER` | `http` or `mock` |
| `ai-worker/` | `CV_API_URL` | URL of AI model service |
| `supabase/functions/` | `RESEND_API_KEY` | Email delivery |
| `supabase/functions/` | `EXPO_ACCESS_TOKEN` | Push notifications |

### 4.2 Recommended vault

Use one of:
- **Bitwarden** (free, self-hostable)
- **1Password Teams**
- **HashiCorp Vault**
- **AWS Secrets Manager**
- **Google Cloud Secret Manager**

> [!CAUTION]
> The `SUPABASE_SERVICE_ROLE_KEY` grants full database access bypassing RLS. Treat it as a root password. Rotate it immediately if it is ever exposed.

---

## 5. Recovery Procedures

### 5.1 Scenario A — Accidental Data Deletion

**Example:** A migration accidentally drops a table or deletes records.

**Recovery steps:**

1. Immediately **pause all write traffic** (take frontend offline or disable the API).
2. Identify the timestamp of the accidental deletion.
3. Use PITR to restore to 1 minute before the deletion.
4. Export the missing records from the restored database.
5. Import the missing records into the production database using `INSERT ... ON CONFLICT DO NOTHING`.
6. Verify data integrity.
7. Resume traffic.

**Estimated RTO:** 1–2 hours (with PITR enabled).

---

### 5.2 Scenario B — Complete Supabase Project Loss

**Example:** Project accidentally deleted, or account locked.

**Recovery steps:**

1. Create a **new Supabase project**.
2. Restore the database from the latest `pg_dump` file:
   ```bash
   pg_restore \
     --no-owner \
     --no-privileges \
     -d "postgresql://postgres:<new-password>@db.<new-ref>.supabase.co:5432/postgres" \
     grainshield_backup_YYYYMMDD.dump
   ```
3. Run any migrations applied AFTER the backup date:
   ```bash
   # In Supabase SQL Editor, apply migrations in order:
   # 001_initial_schema.sql through 025_citizen_trip_rpc.sql
   # Only apply migrations not covered by the backup
   ```
4. Restore Storage objects using the storage backup script (upload to new bucket).
5. Update all `.env` files with new project URL and keys.
6. Update Supabase Edge Function secrets.
7. Redeploy Edge Functions.
8. Test all three applications end-to-end.
9. Update DNS / deployment configuration to point to the new project.

**Estimated RTO:** 3–4 hours (with backups available).

---

### 5.3 Scenario C — AI Worker Failure

**Example:** AI worker crashes; all jobs remain in `pending` status.

**Recovery steps:**

1. Restart the AI worker: `node src/worker.js`
2. The worker polls for `pending` jobs on startup — no manual intervention required.
3. If jobs remain stuck after restart, check for jobs in the DLQ (`failed_jobs` table):
   ```sql
   SELECT * FROM failed_jobs ORDER BY created_at DESC LIMIT 20;
   ```
4. Retry failed jobs via Admin Dashboard → Failed Jobs → Retry All.
5. If the AI model service is down, switch to manual review mode:
   - In Admin Dashboard → Verification, manually review pending evidence.

**Estimated RTO:** < 15 minutes (worker restart).

---

### 5.4 Scenario D — Storage Bucket Corruption or Accidental Deletion

**Example:** Evidence images deleted from `trip-evidence` bucket.

**Recovery steps:**

1. Restore images from the most recent storage backup (upload script run in reverse).
2. Verify file checksums match the `checksum` column in `trip_evidence`:
   ```sql
   SELECT id, file_path, checksum FROM trip_evidence WHERE trip_id = '<trip-id>';
   ```
3. If checksums match, evidence integrity is confirmed.
4. If checksums do not match, the evidence is considered tampered — flag for manual review.

---

## 6. Backup Schedule Recommendation

| Backup Type | Frequency | Retention | Method |
|---|---|---|---|
| Supabase automatic snapshot | Daily | 7 days (Pro) | Supabase automatic |
| Manual `pg_dump` | Weekly | 90 days | External storage |
| Storage bucket backup | Weekly | 90 days | External storage |
| Pre-migration snapshot | Before each migration | Until next migration | External storage |
| Environment variable vault | Continuous | Permanent | Secure vault |

---

## 7. RTO / RPO Summary

| Failure Scenario | RPO (Data Loss) | RTO (Downtime) |
|---|---|---|
| Accidental record deletion (PITR enabled) | < 5 minutes | 1–2 hours |
| Accidental record deletion (daily backup only) | < 24 hours | 2–3 hours |
| Complete project loss (with pg_dump + storage backup) | ≤ last backup | 3–4 hours |
| AI worker crash | 0 (jobs remain in DB) | < 15 minutes |
| Storage object deletion (with storage backup) | ≤ last backup | 1–2 hours |
| Edge Function outage | 0 (no data loss) | < 30 minutes |

---

## 8. Contact Escalation

If Supabase is completely down:

1. Check [status.supabase.com](https://status.supabase.com) for incident reports.
2. If the outage is Supabase-side, GrainShield AI is unavailable until Supabase recovers — no workaround exists (the backend is Supabase-managed).
3. Communicate expected recovery time to field officers via SMS/phone.
4. When Supabase recovers, verify all Realtime subscriptions reconnect (the frontend reconnects automatically via exponential back-off).

**Internal escalation path:**

| Priority | Contact | Channel |
|---|---|---|
| P1 — Production down | GSCSCL IT Head | Phone/WhatsApp |
| P2 — Partial degradation | GrainShield Technical Lead | Email + Slack |
| P3 — Scheduled maintenance | All stakeholders | Email |

---

## 9. Disaster Recovery Drill

Execute a DR drill **quarterly**:

1. Create a pg_dump of the production database.
2. Create a NEW Supabase project (test project).
3. Restore the dump to the test project.
4. Apply any pending migrations.
5. Update `.env.test` files to point to the test project.
6. Run the citizen frontend against the test project and verify trip creation works.
7. Confirm all 10 `GRAINSHIELD_*.md` report files and migration files are intact in the Git repo.
8. Document the drill result (date, duration, findings) and update this guide.

---

*This guide was prepared for GrainShield AI production readiness. Review and update after each infrastructure change.*
