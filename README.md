# GrainShield AI

> **AI-powered photograph verification for Gujarat food-grain logistics**
>
> Problem Statement PS000006 — Food, Civil Supplies & Consumer Affairs Dept., Gujarat Government
> Gujarat State Civil Supplies Corporation Ltd. (GSCSCL)

---

## What It Does

GrainShield AI automatically verifies 69,000+ trip photographs per month across the food-grain supply chain:

| Stage | Description | Evidence Required |
|-------|-------------|-------------------|
| **First Mile** | FCI Godown → GSCSCL Godown | Vehicle + registration plate |
| **Mid Mile** | In transit | Vehicle + plate |
| **Last Mile** | GSCSCL Godown → Fair Price Shop | Vehicle + plate + FPS person present |

Each photograph is analysed by the AI pipeline and receives one of four decisions:

| Decision | Meaning |
|----------|---------|
| ✅ **PASS** | All mandatory checks verified with high confidence |
| ❌ **FAIL** | Evidence clearly violates a mandatory requirement |
| 🔄 **RETAKE** | Image quality issue the driver can fix by retaking |
| 👁️ **MANUAL REVIEW** | Uncertain evidence requiring officer judgement |

---

## Monorepo Structure

```
GrainShield-AI/
├── frontend/          # Citizen web app (React + Vite, port 8080)
├── apps/admin/        # Admin dashboard (TanStack Start, port 3001)
├── mobile/            # Driver mobile app (React Native / Expo)
├── ai-model/          # Python AI inference server (FastAPI, port 8000)
├── ai-worker/         # Node.js verification job worker
├── database/
│   └── migrations/    # 009 sequential SQL migrations (Supabase)
├── docker-compose.yml # Local dev orchestration
└── .github/workflows/
    └── ci.yml         # 4-job CI: frontend · admin · mobile · ai-model
```

---

## AI Pipeline (v2.1.0)

```
Image Upload
    │
    ▼
Image Quality Check  ──── blurry/dark/overexposed/low-res ──▶ RETAKE
    │ clear
    ▼
YOLO26n Vehicle Detection (Ultralytics C3k2+C2PSA architecture: car/bus/truck/motorcycle/person)
    │ no vehicle
    ▼ ──────────────────────────────────────────────────────▶ MANUAL REVIEW
    │ vehicle(s) found
    ▼
OpenCV Plate Region Finder
  bilateral filter → Canny edges → contour aspect-ratio filter (2:1–8:1)
  top-3 plate candidates per vehicle
    │ no plate region
    ▼ ──────────────────────────────────────────────────────▶ RETAKE
    │ plate crop found
    ▼
Multi-PSM Tesseract OCR
  (adaptive / CLAHE / Otsu preprocessing, PSM 7/8/13)
    │
    ▼
Indian Plate Normalization  GJ05AB1234
  position-aware confusion map (O→0, I→1 at digit positions only)
    │
    ▼
Levenshtein Similarity Match vs. assigned vehicle
  exact / confusion → PASS
  similarity ≥ 70%  → MANUAL REVIEW
  valid plate, sim < 50% → FAIL
  OCR unclear        → MANUAL REVIEW / RETAKE
```

**Benchmark (15 test images):**
- Vehicle detection: 15/15 (100 %)
- Plate region candidates extracted: avg 7 per image
- Average latency: **12.2 s** (down from 37.75 s in v1.0 — 3× improvement)

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| Python | 3.12 |
| Tesseract OCR | 5.x |
| Git | any |

### 1. Clone

```bash
git clone git@github.com:panchayat-exe/GrainShield-AI.git
cd GrainShield-AI
```

### 2. Environment Variables

```bash
# Citizen frontend
cp frontend/.env.example frontend/.env

# Admin dashboard
cp apps/admin/.env.example apps/admin/.env

# AI worker (fill in Supabase service_role key)
cp ai-worker/.env.example ai-worker/.env

# AI inference server
cp ai-model/.env.example ai-model/.env
```

### 3. Install dependencies

```bash
# Citizen frontend
cd frontend && npm install

# Admin dashboard
cd apps/admin && npm install

# Mobile app
cd mobile && npm install

# AI worker
cd ai-worker && npm install

# AI model (Python)
cd ai-model && pip install -r requirements.txt
```

### 4. Run all services

```bash
# Terminal 1 — AI inference server
cd ai-model
python src/server.py

# Terminal 2 — AI worker
cd ai-worker
node --env-file=.env src/worker.js

# Terminal 3 — Citizen frontend
cd frontend
npm run dev       # http://localhost:8080

# Terminal 4 — Admin dashboard
cd apps/admin
npm run dev       # http://localhost:3001
```

### 5. Docker (optional)

```bash
docker compose up
```

---

## Database Migrations

All migrations live in `database/migrations/`. Apply them in order in the Supabase SQL Editor:

| Migration | Description |
|-----------|-------------|
| `001_core_schema.sql` | trips, evidence, verifications, profiles |
| `002_auth_triggers.sql` | Auto-create profile on signup |
| `003_rls_policies.sql` | Row-Level Security for all tables |
| `004_audit_triggers.sql` | Automatic audit log on every write |
| `005_storage_policies.sql` | trip-evidence bucket policies |
| `006_email_config_notes.sql` | Email setup notes |
| `007_admin_rls_policies.sql` | Admin-specific RLS + `is_admin()` helper |
| `008_vehicles_organizations.sql` | Vehicles master + organisations (demo data) |
| `009_atomic_job_claiming.sql` | `claim_pending_verification()` RPC |
| `010_add_fail_verification_status.sql` | Added `fail` verification status enum |
| `011_secure_atomic_claim_function.sql` | Secure atomic job claiming with service_role restriction |
| `012_worker_stale_job_recovery.sql` | Automatic recovery of stale jobs (>5m) with retry tracking |

---

## Access & Roles (Supabase Auth)

User accounts and roles are managed via Supabase Auth and the `public.profiles` table:

| Role | Access Level | Description |
|------|--------------|-------------|
| `super_admin` | Full Administrative Access | Admin Dashboard (`apps/admin`), manual reviews, user management, audit logs |
| `user` | Driver / Citizen Access | Citizen Web App (`frontend`), trip submission, evidence photo upload |

> [!NOTE] Passwords must never be committed to repository files. Development and officer accounts are configured in the Supabase Dashboard (`Authentication -> Users`).

---

## Running Tests

```bash
# AI model unit tests (21 tests)
cd ai-model
python -m pytest tests/ -v

# AI validation benchmark (requires annotated images)
python validation/run_validation.py

# Citizen frontend (vitest)
cd frontend
npm test

# Admin dashboard (vitest)
cd apps/admin
npm test

# Mobile (vitest)
cd mobile
npm test
```

---

## Security

- **Authentication**: Supabase Auth (JWT) on all API routes
- **Row-Level Security**: Enforced on every table — users only see their own trips
- **Admin access**: `is_admin()` database function gates all admin queries
- **AI API**: `CV_API_KEY` bearer token; rate-limited to 10 req/min per IP (SlowAPI)
- **CORS**: `ALLOWED_ORIGINS` environment variable — no wildcard in production
- **Signed URLs**: Evidence photographs served via 300-second expiring signed URLs

---

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main`:

| Job | Steps |
|-----|-------|
| `frontend` | lint → tsc → vitest → build |
| `admin` | tsc → vitest → build |
| `mobile` | tsc → vitest |
| `ai-model` | syntax check → pytest |

---

## Project Team

- **Problem Statement**: PS000006 — SFIC Hackathon
- **Department**: Food, Civil Supplies & Consumer Affairs, Gujarat
- **Organisation**: GSCSCL (Gujarat State Civil Supplies Corporation Ltd.)
- **AI Team**: Nidhish, Prathmesh
- **Development**: Full-stack (React, Node.js, Python, Supabase)
