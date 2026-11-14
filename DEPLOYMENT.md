# GrainShield AI — Deployment Guide

**Project:** GrainShield AI — SFIC PS000006  
**Organisation:** Gujarat State Civil Supplies Corporation Ltd. (GSCSCL)  
**Challenge:** Seva First Innovation Challenge (SFIC)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        GrainShield AI                            │
│                                                                  │
│  ┌────────────────┐   ┌────────────────┐   ┌─────────────────┐  │
│  │ Citizen Portal │   │ Admin Dashboard│   │  Mobile App     │  │
│  │ (React/Vite)   │   │ (React/Vite)   │   │ (Expo/RN)       │  │
│  │ Static CDN     │   │ Static CDN     │   │ EAS Build       │  │
│  └───────┬────────┘   └───────┬────────┘   └────────┬────────┘  │
│          │                    │                     │            │
│          └────────────────────┼─────────────────────┘            │
│                               │                                  │
│                    ┌──────────▼─────────┐                        │
│                    │  Supabase Cloud    │                        │
│                    │  PostgreSQL + Auth │                        │
│                    │  Storage + RLS     │                        │
│                    └──────────┬─────────┘                        │
│                               │                                  │
│          ┌────────────────────┼─────────────────────┐            │
│          │                   │                      │            │
│  ┌───────▼────────┐  ┌───────▼────────┐             │            │
│  │  AI Worker     │  │  AI Model      │             │            │
│  │  (Node.js)     │──│  (FastAPI)     │             │            │
│  │  Docker        │  │  Docker        │             │            │
│  └────────────────┘  └────────────────┘             │            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Pre-Deployment Checklist

### Database (Supabase)

- [ ] All migrations 001–020 applied in order (see [Migration Order](#migration-order))
- [ ] RLS enabled on all tables: `trips`, `profiles`, `trip_evidence`, `verification_results`, `manual_review_requests`, `audit_logs`, `gps_pings`, `vehicles`, `failed_jobs`
- [ ] State-machine triggers verified: `update_trip_status_trigger` active
- [ ] Supabase Auth email templates configured
- [ ] Storage buckets `trip-evidence` and `vehicle-photos` created with correct policies
- [ ] `anon` key in Supabase Dashboard → Project Settings → API (safe to expose)
- [ ] `service_role` key stored **only** in AI Worker `.env` (never in frontend)

### AI Model Service

- [ ] YOLO weights (`weights/best.pt`) present in `ai-model/weights/`
- [ ] Tesseract installed and accessible in container (`/usr/bin/tesseract`)
- [ ] `ai-model/.env` configured (see [Environment Variables](#environment-variables))
- [ ] `GET /health` returns `{"status":"ok"}` before connecting worker
- [ ] `CV_API_KEY` set in production (empty key causes startup failure in `ENVIRONMENT=production`)

### AI Worker

- [ ] `ai-worker/.env` configured (see [Environment Variables](#environment-variables))
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (required — worker uses service role)
- [ ] `CV_API_URL` points to running AI Model service
- [ ] DLQ table `failed_jobs` exists (migration 020 applied)

### Frontend (Citizen Portal)

- [ ] `frontend/.env` configured
- [ ] Build output: `npm run build` in `frontend/`
- [ ] Deploy `frontend/dist/` to CDN

### Admin Dashboard

- [ ] `apps/admin/.env` configured
- [ ] Build output: `npm run build` in `apps/admin/`
- [ ] Deploy `apps/admin/dist/` to CDN

### Mobile App

- [ ] `mobile/.env` or `eas.json` environment variables configured
- [ ] `eas build --platform android --profile production`
- [ ] Submit to Play Store / TestFlight

---

## Migration Order

Apply migrations in this exact order using Supabase Dashboard → SQL Editor:

| # | File | Description |
|---|------|-------------|
| 001 | `001_initial_schema.sql` | Core tables: trips, profiles |
| 002 | `002_auth_triggers.sql` | Auto-create profile on signup |
| 003 | `003_rls_policies.sql` | Row-level security policies |
| 004 | `004_trip_evidence.sql` | Trip evidence storage table |
| 005 | `005_verification_results.sql` | AI verification result records |
| 006 | `006_manual_review.sql` | Manual review request workflow |
| 007 | `007_audit_logs.sql` | Audit trail logging |
| 008 | `008_vehicles_organizations.sql` | Vehicle registry |
| 009 | `009_gps_pings.sql` | GPS location tracking |
| 010 | `010_trip_lifecycle.sql` | Trip state-machine triggers |
| 011 | `011_storage_policies.sql` | Supabase Storage bucket RLS |
| 012 | `012_worker_rpcs.sql` | Worker claim/release RPCs |
| 013 | `013_admin_rpcs.sql` | Admin dashboard RPCs |
| 014 | `014_indexes.sql` | Performance indexes |
| 015 | `015_review_evidence_link.sql` | evidence_id FK on review requests |
| 016 | `016_review_evidence_backfill.sql` | Backfill evidence associations |
| 017 | `017_review_backfill_v2.sql` | ⚠ Inspect before applying — evidence-matching backfill |
| 018 | `018_unique_active_review.sql` | Unique index: one active review per trip/evidence |
| 019 | `019_trip_code_generator.sql` | Trip code sequence (GS-YYYY-NNNNNN) + dispatch RPC |
| 020 | `020_failed_jobs_table.sql` | Dead-letter queue for failed AI jobs |

> **⚠ IMPORTANT:** Migration 017 was intentionally not applied to production due to evidence-association ambiguity. Review the data audit report before applying. Apply migration 018 after 017.

### How to Apply a Migration

1. Open **Supabase Dashboard** → your project → **SQL Editor**
2. Open `database/migrations/<NNN>_*.sql`
3. Paste the full content into the SQL editor
4. Click **Run** — verify no errors
5. Repeat for each migration in order

---

## Environment Variables

### `frontend/.env`

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

### `apps/admin/.env`

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### `ai-model/.env`

```env
CV_API_KEY=<strong-random-secret>        # Required in production
ALLOWED_ORIGINS=https://your-citizen-app.com,https://your-admin.com
ENVIRONMENT=production
TESSERACT_CMD=/usr/bin/tesseract         # Pre-installed in Docker image
MODEL_PATH=weights/best.pt
MAX_FILE_SIZE_BYTES=10485760
HOST=0.0.0.0
PORT=8000
```

### `ai-worker/.env`

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...         # ⚠ NEVER expose — full DB access
CV_PROVIDER=http
CV_API_URL=http://ai-inference:8000/verify   # Docker service name
CV_API_KEY=<same-as-ai-model-CV_API_KEY>
POLL_INTERVAL_MS=15000
MAX_RETRIES=3
PROCESSING_TIMEOUT_MS=90000
```

### `mobile/.env` (or `eas.json` environment)

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

---

## Running with Docker Compose

```bash
# 1. Copy and configure env files
cp ai-model/.env.example  ai-model/.env
cp ai-worker/.env.example ai-worker/.env
# Edit both files with real values

# 2. Place YOLO weights
mkdir -p ai-model/weights
cp /path/to/best.pt ai-model/weights/best.pt

# 3. Start services
docker compose up --build -d

# 4. Check health
curl http://localhost:8000/health
# Expected: {"status": "ok", "model": "loaded", ...}

# 5. View logs
docker compose logs -f ai-worker
docker compose logs -f ai-inference
```

---

## Health Check URLs

| Service | URL | Expected Response |
|---------|-----|-------------------|
| AI Model | `GET http://localhost:8000/health` | `{"status":"ok"}` |
| AI Model | `GET http://localhost:8000/` | Service info JSON |
| Supabase | Supabase Dashboard → Project Health | All services green |

---

## Deploying Frontend to Production

### Option A — Vercel / Netlify (Recommended)

```bash
# Citizen Portal
cd frontend
npm run build
# Deploy dist/ folder to Vercel/Netlify

# Admin Dashboard
cd apps/admin
npm run build
# Deploy dist/ folder (can be separate site or sub-path)
```

Set environment variables in Vercel/Netlify dashboard (not in `.env` files).

### Option B — Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
npm run build
firebase deploy
```

### Option C — Nginx Static

```nginx
server {
    listen 80;
    root /var/www/grainshield/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Deploying AI Services to Cloud Run

```bash
# AI Model
gcloud run deploy grainshield-ai-model \
  --source ./ai-model \
  --port 8000 \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --set-env-vars "ENVIRONMENT=production,CV_API_KEY=YOUR_KEY" \
  --region asia-south1

# AI Worker
gcloud run deploy grainshield-ai-worker \
  --source ./ai-worker \
  --port 8080 \
  --memory 512Mi \
  --min-instances 1 \
  --set-env-vars "SUPABASE_URL=...,CV_API_URL=https://grainshield-ai-model-url/verify" \
  --region asia-south1
```

---

## Expo Mobile Build

```bash
cd mobile

# Install EAS CLI
npm install -g eas-cli
eas login

# Configure (first time)
eas build:configure

# Build for Android
eas build --platform android --profile production

# Build for iOS
eas build --platform ios --profile production

# Submit to store
eas submit --platform android
```

---

## CI/CD Pipeline

The existing GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push/PR:

| Job | Checks |
|-----|--------|
| `frontend` | Lint, TypeScript, unit tests, build |
| `admin` | TypeScript, unit tests, build |
| `mobile` | TypeScript, unit tests |
| `ai-model` | Python syntax, pytest unit tests |

> All CI jobs must pass before merging to `main`.

---

## Known Production Limitations

| # | Limitation | Mitigation |
|---|------------|------------|
| 1 | YOLO model weights not in repo (too large for Git) | Store in GCS/S3; mount as Docker volume |
| 2 | Tesseract OCR accuracy depends on image quality | Instruct drivers to upload clear, well-lit photos |
| 3 | OCR result classified as `uncertain` does not auto-fail trip | Requires manual officer review — this is intentional |
| 4 | GPS background tracking requires driver location permission | App requests permission on first launch with explanation |
| 5 | Expo mobile requires network for Supabase auth | Offline mode shows cached last-known status only |
| 6 | Migration 017 not applied | Requires officer reconciliation for 7 historical ambiguous records first |
| 7 | `failed_jobs` table requires migration 020 | Apply before deploying updated ai-worker |
| 8 | `admin_dispatch_trip` RPC requires migration 019 | Apply before using Trip Dispatch feature in admin |

---

## Security Notes

- **Service role key** (`SUPABASE_SERVICE_ROLE_KEY`) must only exist in `ai-worker/.env` — never in any frontend or mobile code.
- **RLS** is enabled on all tables. Never disable RLS to bypass errors — fix the policy instead.
- **CV_API_KEY** authenticates the worker→model connection. Use a strong random value in production (`openssl rand -hex 32`).
- **Audit logs** are append-only — do not truncate `audit_logs` in production.
- All database state-machine triggers (`update_trip_status_trigger`) must remain active.

---

## Support & Contacts

| Role | Responsibility |
|------|---------------|
| Database Admin | Apply migrations, monitor Supabase health |
| Backend Ops | Monitor AI worker logs, resolve DLQ items |
| Field Officers | Manual review of flagged trips in Admin Dashboard |
| Mobile Admin | Manage EAS builds, Play Store submissions |

---

*Last updated: November 2026 — Sprint 9 (Phase 9: Production Deployment Prep)*
