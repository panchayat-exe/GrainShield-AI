# GrainShield AI

AI-powered photograph verification for food grain transport — Government of Gujarat, PS000006.

---

## The Problem

Gujarat State Civil Supplies Corporation Ltd. (GSCSCL) tracks food grain transport from FCI Godowns to Fair Price Shops using a Vehicle Location Tracking System. Roughly 69,000 trip photographs are submitted every month. Manual review of each photograph is slow, inconsistent, and difficult to scale.

GrainShield AI automates this verification process. It checks whether each photograph contains the correct vehicle, a legible registration plate matching the assigned trip, an appropriate vehicle category, and adequate image quality — then records an auditable decision for every submission.

---

## Verification Workflows

### First Mile

| Step | Location | What the driver photographs |
|------|----------|-----------------------------|
| Trip start | FCI Godown | Vehicle at departure |
| e-POD | GSCSCL Godown | Vehicle at arrival |

### Last Mile

| Step | Location | What the driver photographs |
|------|----------|-----------------------------|
| Trip start | GSCSCL Godown | Vehicle at departure |
| e-POD | Fair Price Shop | FPS owner/person + FPS identification board |

Each verification produces one of four outcomes: **Pass**, **Fail**, **Retake**, or **Manual Review**.

---

## Repository Structure

```
GrainShield-AI/
├── frontend/                    # Citizen / driver web application
│   ├── src/
│   │   ├── routes/              # File-based pages (TanStack Router)
│   │   │   ├── __root.tsx       # App shell, HTML document
│   │   │   ├── index.tsx        # / — photograph upload
│   │   │   ├── processing.tsx   # /processing — live verification status
│   │   │   ├── result.tsx       # /result — pass confirmation
│   │   │   ├── failed.tsx       # /failed — manual review request
│   │   │   ├── trip.tsx         # /trip — trip detail + audit log
│   │   │   ├── tracking.tsx     # /tracking — GPS sharing
│   │   │   ├── login.tsx        # /login
│   │   │   ├── register.tsx     # /register
│   │   │   ├── forgot-password.tsx
│   │   │   └── auth/
│   │   │       └── reset-password.tsx
│   │   ├── components/
│   │   │   ├── AppShell.tsx     # Authenticated layout, notification bell
│   │   │   └── ui/              # shadcn/ui component library
│   │   ├── hooks/
│   │   │   ├── use-auth.ts
│   │   │   ├── use-gps-tracking.ts
│   │   │   └── use-notifications.ts
│   │   ├── lib/
│   │   │   ├── auth/            # signIn, signUp, signOut, resetPassword
│   │   │   ├── services/        # trips, evidence, verification, tracking, reviews, audit
│   │   │   ├── supabase/        # Browser client + TypeScript DB types
│   │   │   └── validation/      # Zod schemas for forms and file uploads
│   │   └── test/
│   │       ├── security.test.ts # Input validation + anonymous RLS tests
│   │       └── app-routing.test.tsx
│   ├── public/                  # Static assets (favicon, robots.txt)
│   ├── .env.example             # Environment variable template
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── database/                    # Supabase schema and migrations
│   ├── migrations/
│   │   ├── 001_core_schema.sql
│   │   ├── 002_auth_triggers.sql
│   │   ├── 003_rls_policies.sql
│   │   ├── 004_audit_triggers.sql
│   │   └── 005_storage_policies.sql
│   └── README.md
│
├── ai-worker/                   # Verification worker service (Node.js)
│   ├── src/
│   │   └── worker.js            # Polls Supabase, calls CV API, writes results
│   ├── .env.example
│   ├── package.json
│   └── README.md
│
├── docs/
│   └── ADMIN_INTEGRATION.md     # Reference for building the future admin dashboard
│
├── .github/
│   ├── workflows/ci.yml         # Lint → type-check → test → build
│   └── PULL_REQUEST_TEMPLATE.md
│
├── .editorconfig
├── .gitignore
└── README.md
```

---

## System Architecture

```
┌─────────────────────────────┐     ┌────────────────────────────────────┐
│  frontend/                  │     │  Admin Dashboard                   │
│  Citizen / Driver Web App   │     │  (future — separate repository)    │
│  React 19 · TanStack Start  │     │  Same Supabase project             │
└──────────────┬──────────────┘     └────────────────┬───────────────────┘
               │                                     │
               ▼                                     ▼
    ┌──────────────────────────────────────────────────────┐
    │  Supabase                                            │
    │  PostgreSQL · Auth · Storage · Realtime              │
    │  Migrations: database/migrations/                    │
    └──────────────────────────┬───────────────────────────┘
                               │
               ┌───────────────▼───────────────┐
               │  ai-worker/                   │
               │  Verification Worker          │
               │  Polls pending verifications  │
               │  Calls CV API · Writes result │
               └───────────────────────────────┘
                               │
               ┌───────────────▼───────────────┐
               │  Computer Vision API          │
               │  (Team B — not yet connected) │
               └───────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| UI framework | React 19 |
| Routing + SSR | TanStack Start · TanStack Router v1.170 |
| Build tool | Vite 8 |
| Styling | Tailwind CSS v4 · shadcn/ui |
| Language | TypeScript (strict) |
| Forms | React Hook Form · Zod |
| Data fetching | TanStack Query v5 |
| Backend | Supabase (PostgreSQL · Auth · Storage · Realtime) |
| Verification worker | Node.js 20+ (ESM) |
| Testing | Vitest · Testing Library |

---

## Local Development

### Prerequisites

- Node.js 20 or later
- A Supabase project with migrations applied (see `database/README.md`)

### 1. Clone and install

```bash
git clone https://github.com/panchayat-exe/GrainShield-AI.git
cd GrainShield-AI/frontend
npm install
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

The development server starts at **http://localhost:8080**.

> Use `npm run dev`, not `npm run preview`. TanStack Start requires the dev server for SSR — `vite preview` only serves static files and all routes return 404.

### 2. Frontend commands

```bash
cd frontend

npm run dev          # Development server — http://localhost:8080
npm run build        # Production build (client + SSR bundles)
npm run lint         # ESLint
npm run format       # Prettier
npm test             # Unit + anonymous RLS tests
npm run test:watch   # Vitest watch mode
npx tsc --noEmit     # TypeScript type check
```

### 3. AI worker

```bash
cd ai-worker
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CV_* variables
npm install
npm start
```

The worker runs in **mock mode** by default (`CV_PROVIDER=mock`). Set `CV_PROVIDER=http` and supply `CV_API_URL` + `CV_API_KEY` when the CV API is available.

---

## Environment Variables

### Frontend (`frontend/.env`)

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is safe in the browser — it is subject to Row Level Security.

### AI Worker (`ai-worker/.env`)

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...   # Server-only — bypasses RLS
CV_PROVIDER=mock                          # or 'http' for real CV API
CV_API_URL=                               # Your CV API endpoint
CV_API_KEY=                               # Your CV API key
POLL_INTERVAL_MS=15000
MAX_RETRIES=3
```

> Never add `SUPABASE_SERVICE_ROLE_KEY` to the frontend `.env` or any `VITE_*` variable.

---

## Database Setup

See `database/README.md` for full instructions. Quick summary:

1. Apply `database/migrations/` files **001 → 005** in order via Supabase SQL Editor.
2. Create the `trip-evidence` storage bucket (Dashboard → Storage → New bucket, Public: **OFF**).
3. Add `http://localhost:8080/auth/reset-password` to Auth → URL Configuration → Redirect URLs.
4. After registering, promote your account to super_admin:

```sql
update public.profiles
set role = 'super_admin'
where email = 'your-email@example.com';
```

---

## Implementation Status

### Phase 1 — Citizen/User Backend ✅ Complete

| Feature | Status |
|---------|--------|
| Auth (register, login, password reset) | ✅ |
| User profiles | ✅ |
| Trip creation + retrieval | ✅ |
| Photograph upload (private storage, SHA-256 dedup) | ✅ |
| Verification queue (pending record on upload) | ✅ |
| Real-time verification status (Supabase Realtime) | ✅ |
| Manual review request submission | ✅ |
| GPS location sharing | ✅ |
| In-app notifications | ✅ |
| Full audit trail per trip | ✅ |
| Row Level Security (user isolation) | ✅ |

### Phase 2 — AI Integration ⏳ Pending Team B

| Feature | Status |
|---------|--------|
| Computer vision API connection | Pending (Team B) |
| Registration plate OCR | Pending (Team B) |
| Vehicle category classification | Pending (Team B) |
| Image quality assessment | Pending (Team B) |
| Pass / Fail / Retake / Manual Review logic | Pending (Team B) |

Integration boundary defined in `docs/ADMIN_INTEGRATION.md` §8. No DB migrations needed.

### Phase 3 — Admin Dashboard ⏳ Pending

Admin frontend not yet delivered. Admin backend (RLS, role functions) already complete — same Supabase project. See `docs/ADMIN_INTEGRATION.md`.

---

## Team Structure

| Team | Members | Responsibilities |
|------|---------|-----------------|
| Frontend & Backend | Aditya, Neel, Vansh | `frontend/`, `database/`, AI integration |
| AI Development | Nidhish, Prathmesh | `ai-worker/` CV logic, OCR, decision rules |
| Research & Direction | Project lead | Problem research, UI/UX, coordination |
| Presentation | Disha | Slides and presentation materials |

---

## Security

- The Supabase publishable key is safe in client-side code when RLS is enabled (it is).
- `SUPABASE_SERVICE_ROLE_KEY` must only exist in `ai-worker/.env` — never in frontend code or `VITE_*` variables.
- All evidence photographs are in a private storage bucket. Signed URLs with short expiry are generated server-side.
- RLS prevents any user from accessing another user's trips, evidence, or results.
- Admin access is controlled by a `role` column in `profiles`. Users cannot self-promote.

---

## Contributing

This is a student hackathon project (SFIC 2025). External contributions are not accepted.

For team members:
1. Branch from `main`.
2. Run `cd frontend && npm run lint && npm test && npm run build` before opening a PR.
3. Never commit `.env` files or real credentials.
4. New DB migrations must be numbered sequentially (007, 008, …) and idempotent.
