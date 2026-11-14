# GrainShield AI — Deployment Guide

**Version:** Production Release Candidate  
**Date:** 2026-11-06  
**Repository:** `github.com/panchayat-exe/GrainShield-AI`

---

## 1. Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ LTS | Admin dashboard, Citizen frontend, AI Worker |
| Python | 3.11+ | AI Model Service |
| npm | 10+ | Package management |
| Git | Any | Version control |
| Supabase CLI | Latest | Database migrations, Edge Functions |
| Expo CLI | Latest | Mobile builds |
| Android Studio | 2024+ | Mobile development |

---

## 2. Environment Variables

### Admin Dashboard (`apps/admin/.env`)
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Citizen Frontend (`frontend/.env`)
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### AI Worker (`ai-worker/.env`)
```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # NEVER expose to browser
CV_PROVIDER=http
CV_API_URL=http://localhost:8000/analyze
CV_API_KEY=your-internal-api-key
POLL_INTERVAL_MS=15000
MAX_RETRIES=3
PROCESSING_TIMEOUT_MS=300000
```

### AI Model Service (`ai-model/.env`)
```env
MODEL_PATH=models/best.pt
CONFIDENCE_THRESHOLD=0.6
PORT=8000
```

### Mobile App (`mobile/.env` or `app.json`)
```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Edge Function Secrets (set in Supabase Dashboard → Edge Functions → Secrets)
```
RESEND_API_KEY=your-resend-api-key
EXPO_ACCESS_TOKEN=your-expo-access-token
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## 3. Database Setup

### 3.1 Apply All Migrations (In Order)

Open **Supabase Dashboard → SQL Editor** and apply each migration file in sequence:

```
database/migrations/001_core_schema.sql
database/migrations/002_storage_buckets.sql
database/migrations/003_rls_policies.sql
...
database/migrations/024_checkpoints_table.sql
database/migrations/025_citizen_trip_rpc.sql   ← CRITICAL: apply this last
```

> [!CAUTION]
> Apply migrations in numeric order. Never skip. If a migration fails, fix the error before continuing.

### 3.2 Verify Migration 025

```sql
-- Run in SQL Editor after applying 025
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='trips'
AND column_name IN ('origin_lat','origin_lng','destination_lat','destination_lng','commodity','quantity_kg');
-- Expect: 6 rows

SELECT conname FROM pg_constraint WHERE conname = 'trips_trip_code_unique';
-- Expect: 1 row

SELECT proname, prosecdef FROM pg_proc WHERE proname = 'citizen_create_trip';
-- Expect: citizen_create_trip | t
```

---

## 4. Admin Dashboard

```bash
cd apps/admin
npm install
npm run build      # production build → dist/
# or for development:
npm run dev        # starts on http://localhost:3001
```

**Deploy:** Upload `dist/` to Vercel, Netlify, or any static host.

---

## 5. Citizen Frontend

```bash
cd frontend
npm install
npm run build      # production build → dist/
# or for development:
npm run dev        # starts on http://localhost:8080
```

**Deploy:** Upload `dist/` to Vercel/Netlify.

---

## 6. AI Worker

```bash
cd ai-worker
npm install
# Production:
node src/worker.js
# Or with PM2:
pm2 start src/worker.js --name grainshield-ai-worker --restart-delay=5000
```

> [!IMPORTANT]
> The AI Worker uses `SUPABASE_SERVICE_ROLE_KEY`. Run it only on a secure server. Never expose it in a browser or public endpoint.

---

## 7. AI Model Service

```bash
cd ai-model
pip install -r requirements.txt    # FastAPI, ultralytics, opencv-python, tesseract
uvicorn main:app --host 0.0.0.0 --port 8000
# Or with Docker:
docker build -t grainshield-ai-model .
docker run -p 8000:8000 --env-file .env grainshield-ai-model
```

---

## 8. Edge Function (Notifications)

```bash
# Deploy with Supabase CLI
supabase functions deploy send-trip-notification
# Or deploy via Supabase Dashboard → Edge Functions → Deploy
```

Set secrets in Dashboard → Edge Functions → `send-trip-notification` → Secrets.

---

## 9. Mobile App (Expo)

### Development
```bash
cd mobile
npm install
npx expo start --clear
# Press 'a' for Android emulator, scan QR for Expo Go
```

### Production Build (EAS)
```bash
npm install -g eas-cli
eas build --platform android --profile production
eas submit --platform android   # Submit to Play Store
```

> [!NOTE]
> For background GPS to work on Android, the app must be built as a standalone APK/AAB (not Expo Go). EAS Build is required for production.

---

## 10. Supabase Settings

### Enable Daily Backups
1. Dashboard → Settings → Database → Backups
2. Enable **Point-in-Time Recovery** (PITR) or **Daily Snapshots**
3. Recommended: 7-day retention minimum

### Storage Policies
- Bucket `trip-evidence`: **Private** (not public)
- RLS policies enforced: citizens can only upload to their own path
- Signed URLs: 60-second expiry (see `evidence.ts`)

### Realtime
- Enable for tables: `trips`, `verification_results`, `trip_locations`
- Dashboard → Database → Replication → enable for each table

---

## 11. Post-Deployment Checks

| Check | Command/Action | Expected |
|-------|---------------|---------|
| Admin dashboard loads | Open http://admin-domain | Login page visible |
| Citizen app loads | Open http://citizen-domain | Home page visible |
| Supabase connected | Sign in on citizen app | Redirects to home |
| Trip creation works | Submit form (no trip_code input) | GS-YYYY-NNNNNN shown |
| AI Worker running | Check logs | "Worker started" message |
| Edge Function | Submit trip → check email | Notification received |

---

## 12. Rollback Plan

1. **Frontend/Admin:** Redeploy previous `dist/` build
2. **AI Worker:** `pm2 stop grainshield-ai-worker; git checkout HEAD~1 ai-worker/; pm2 start ...`
3. **Database:** See `GRAINSHIELD_DATABASE_MIGRATION_REVIEW.md` Section 4

---

*Deployment guide generated: 2026-11-06. Update with each production release.*
