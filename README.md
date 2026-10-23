# GrainShield AI

AI-powered photograph verification for food grain transport — Government of Gujarat, PS000006.

---

## The Problem

Gujarat State Civil Supplies Corporation Ltd. (GSCSCL) tracks food grain transport from FCI Godowns to Fair Price Shops using a Vehicle Location Tracking System. Roughly 69,000 trip photographs are submitted every month. Manual review of each photograph is slow, inconsistent, and difficult to scale.

GrainShield AI automates this verification process. It checks whether each photograph contains the correct vehicle, a legible registration plate that matches the assigned trip, an appropriate vehicle category, and adequate image quality — then records an auditable decision for every submission.

---

## Verification Workflows

### First Mile

| Step       | Location      | What the driver photographs |
| ---------- | ------------- | --------------------------- |
| Trip start | FCI Godown    | Vehicle at departure        |
| e-POD      | GSCSCL Godown | Vehicle at arrival          |

The AI engine checks the vehicle, registration plate, vehicle category, and image quality.

### Last Mile

| Step       | Location        | What the driver photographs                 |
| ---------- | --------------- | ------------------------------------------- |
| Trip start | GSCSCL Godown   | Vehicle at departure                        |
| e-POD      | Fair Price Shop | FPS owner/person + FPS identification board |

The AI engine checks that the correct person and identification board are present, along with applicable image-quality rules.

Each verification produces one of four outcomes: **Pass**, **Fail**, **Retake** (image quality insufficient), or **Manual Review** (flagged for a human officer).

---

## System Architecture

```
┌─────────────────────────────┐     ┌────────────────────────────────────┐
│  Citizen / Driver Web App   │     │  Admin Dashboard                   │
│  (this repository)          │     │  (future — separate frontend)      │
│  React 19 · TanStack Start  │     │  Same Supabase project             │
└──────────────┬──────────────┘     └────────────────┬───────────────────┘
               │                                     │
               │         Supabase                    │
               ▼                                     ▼
    ┌──────────────────────────────────────────────────────┐
    │  PostgreSQL · Auth (GoTrue) · Storage · Realtime     │
    │  Project: umkjdpgxxylckoohnyco.supabase.co           │
    └──────────────────────────┬───────────────────────────┘
                               │
               ┌───────────────▼───────────────┐
               │  GG_USER_BCKED/               │
               │  Verification Worker          │
               │  Node.js · polls pending      │
               │  verifications · calls CV API │
               └───────────────────────────────┘
                               │
               ┌───────────────▼───────────────┐
               │  Computer Vision API          │
               │  (Team B — not yet connected) │
               └───────────────────────────────┘
```

**Row Level Security** ensures every database query is scoped to the authenticated user. Administrators see all records because their `role` field in the `profiles` table grants broader RLS access — no separate database or schema is required.

---

## Repository Structure

```
GrainGuard-AI/
├── src/
│   ├── routes/               # File-based routes (TanStack Router)
│   │   ├── __root.tsx        # App shell, QueryClient, HTML document
│   │   ├── index.tsx         # / — photograph upload form
│   │   ├── processing.tsx    # /processing — real-time verification status
│   │   ├── result.tsx        # /result — pass confirmation
│   │   ├── failed.tsx        # /failed — manual review request
│   │   ├── trip.tsx          # /trip — trip detail and audit history
│   │   ├── tracking.tsx      # /tracking — GPS sharing
│   │   ├── login.tsx         # /login
│   │   ├── register.tsx      # /register
│   │   ├── forgot-password.tsx
│   │   └── auth/
│   │       └── reset-password.tsx
│   ├── components/
│   │   ├── AppShell.tsx      # Authenticated layout, notification bell
│   │   └── ui/               # shadcn/ui component library
│   ├── hooks/
│   │   ├── use-auth.ts       # Auth state, profile, sign-out
│   │   ├── use-gps-tracking.ts
│   │   └── use-notifications.ts
│   ├── lib/
│   │   ├── auth/             # signIn, signUp, signOut, resetPassword
│   │   ├── services/         # trips, evidence, verification, tracking, reviews, audit
│   │   ├── supabase/         # Browser client, TypeScript DB types
│   │   └── validation/       # Zod schemas for all forms and file uploads
│   └── test/
│       ├── security.test.ts  # Input validation + anonymous RLS tests
│       └── app-routing.test.tsx
├── supabase/migrations/
│   ├── 001_core_schema.sql   # 7 tables, enums, indexes
│   ├── 002_auth_triggers.sql # Profile auto-creation, role helpers
│   ├── 003_rls_policies.sql  # Row Level Security (20 policies)
│   ├── 004_audit_triggers.sql
│   └── 005_storage_policies.sql
├── GG_USER_BCKED/            # AI verification worker (Node.js)
│   └── src/worker.js
├── docs/
│   └── ADMIN_INTEGRATION.md  # Reference for building the future admin dashboard
├── .github/
│   ├── workflows/ci.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── .env.example
└── README.md
```

---

## Technology Stack

| Layer               | Technology                                        |
| ------------------- | ------------------------------------------------- |
| UI framework        | React 19                                          |
| Routing + SSR       | TanStack Start · TanStack Router v1.170           |
| Build tool          | Vite 8                                            |
| Styling             | Tailwind CSS v4 · shadcn/ui                       |
| Language            | TypeScript (strict)                               |
| Forms               | React Hook Form · Zod                             |
| Data fetching       | TanStack Query v5                                 |
| Backend             | Supabase (PostgreSQL · Auth · Storage · Realtime) |
| Verification worker | Node.js 20+ (ESM)                                 |
| Testing             | Vitest · Testing Library                          |

---

## Local Development

### Prerequisites

- Node.js 20 or later
- A Supabase project with the migrations applied (see below)

### Setup

```bash
git clone https://github.com/panchayat-exe/GrainGuard-AI.git
cd GrainGuard-AI
npm install
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

The development server starts at **http://localhost:8080**.

> Use `npm run dev`, not `npm run preview`. TanStack Start requires the dev server for SSR — `vite preview` serves static files only and all routes return 404.

### Available Commands

```bash
npm run dev          # Development server (port 8080, SSR, live reload)
npm run build        # Production build (client + SSR bundles)
npm run preview      # Preview the production build (static only — limited)
npm run lint         # ESLint
npm run format       # Prettier
npm test             # Unit and anonymous RLS tests
npm run test:watch   # Vitest in watch mode
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is safe to expose to the browser. It is subject to Row Level Security.

Never add `SUPABASE_SERVICE_ROLE_KEY` to the frontend `.env`. That key belongs only in the `GG_USER_BCKED/.env` file used by the server-side worker.

---

## Supabase Setup

### 1. Apply database migrations

Open the Supabase Dashboard → SQL Editor and run each file in order:

| File                                           | Purpose                                                     |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `supabase/migrations/001_core_schema.sql`      | Creates all 7 tables, enums, and indexes                    |
| `supabase/migrations/002_auth_triggers.sql`    | Auto-creates user profiles on signup; role helper functions |
| `supabase/migrations/003_rls_policies.sql`     | 20 Row Level Security policies                              |
| `supabase/migrations/004_audit_triggers.sql`   | Automatic audit log entries on data changes                 |
| `supabase/migrations/005_storage_policies.sql` | Private storage bucket access control                       |

All migrations are idempotent — safe to re-run if already applied.

### 2. Create the storage bucket

Dashboard → Storage → New bucket:

- **Name:** `trip-evidence`
- **Public:** OFF

### 3. Configure Auth redirect URLs

Dashboard → Authentication → URL Configuration → Redirect URLs:

- `http://localhost:8080/auth/reset-password` (development)
- Your production domain (when deployed)

### 4. Set your super admin account

After registering your account through the app, run in the SQL Editor:

```sql
update public.profiles
set role = 'super_admin'
where email = 'your-email@example.com';
```

---

## Verification Worker

The worker polls Supabase for pending verifications and calls the configured computer vision API.

```bash
cd GG_USER_BCKED
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CV_* variables
npm install
npm start
```

The worker is currently in **mock mode** (`CV_PROVIDER=mock`). It marks verifications as `error` rather than producing real pass/fail decisions. Switch to `CV_PROVIDER=http` and supply `CV_API_URL` and `CV_API_KEY` when the computer vision API is available.

---

## Implementation Status

### Phase 1 — Citizen / User Backend (current)

| Feature                               | Status   |
| ------------------------------------- | -------- |
| User registration and login           | Complete |
| Password reset via email              | Complete |
| User profiles                         | Complete |
| Trip creation and retrieval           | Complete |
| Photograph upload (private storage)   | Complete |
| SHA-256 duplicate detection           | Complete |
| Verification queue (pending record)   | Complete |
| Real-time verification status updates | Complete |
| Manual review request submission      | Complete |
| GPS location sharing                  | Complete |
| In-app notifications                  | Complete |
| Audit log (full trail per trip)       | Complete |
| Row Level Security (user isolation)   | Complete |
| Anonymous RLS tests                   | Complete |

### Phase 2 — AI Integration

| Feature                                    | Status           |
| ------------------------------------------ | ---------------- |
| Computer vision API connection             | Pending (Team B) |
| Registration plate OCR                     | Pending (Team B) |
| Vehicle category classification            | Pending (Team B) |
| Image quality assessment                   | Pending (Team B) |
| Pass / Fail / Retake / Manual Review logic | Pending (Team B) |

The worker integration boundary is defined in `docs/ADMIN_INTEGRATION.md` §8. The database schema is already complete — no migrations will be needed when the CV API is connected.

### Phase 3 — Admin Dashboard

| Feature                             | Status                                           |
| ----------------------------------- | ------------------------------------------------ |
| Admin frontend                      | Not started (separate repository, separate team) |
| Admin backend (RLS, role functions) | Complete — same Supabase project                 |

See `docs/ADMIN_INTEGRATION.md` for the complete admin integration reference.

---

## Team Structure

| Team                 | Members             | Responsibilities                                                 |
| -------------------- | ------------------- | ---------------------------------------------------------------- |
| Frontend & Backend   | Aditya, Neel, Vansh | Citizen web app, Supabase backend, admin backend, AI integration |
| AI Development       | Nidhish, Prathmesh  | Computer vision, OCR, verification decision logic                |
| Research & Direction | Project lead        | Problem research, UI/UX planning, project coordination           |
| Presentation         | Disha               | Slides and presentation materials                                |

---

## Security

- The Supabase publishable key is safe to include in client-side code when Row Level Security is enabled (it is).
- The service role key must never appear in the frontend, in `VITE_*` variables, or in source control.
- All evidence photographs are stored in a private bucket. Signed URLs with short expiry are generated server-side.
- RLS policies prevent any user from reading another user's trips, evidence, or verification results.
- Admin access is granted by a `role` column in the `profiles` table. Users cannot promote their own role.

To report a security concern, contact the team lead directly.

---

## Contributing

This is a student project developed under SFIC 2025. External contributions are not accepted during active development.

For team members:

1. Branch from `main`.
2. Follow the existing naming conventions (`kebab-case` for files, `PascalCase` for components).
3. Run `npm run lint`, `npm test`, and `npm run build` before opening a pull request.
4. Never commit `.env` or any file containing real credentials.
5. Database migrations must be idempotent and numbered sequentially (006, 007, …).
