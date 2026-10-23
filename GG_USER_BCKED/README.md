# GrainShield AI — Verification Worker

Server-side Node.js worker that polls Supabase for pending verification jobs, calls the configured computer vision API, and writes results back to the database.

This component is part of the GrainShield AI project (PS000006, Government of Gujarat).

---

## How it works

1. Every 15 seconds (configurable), the worker queries `verification_results` for records with `status = 'pending'`.
2. For each pending record, it downloads the private evidence photograph via a Supabase signed URL.
3. It sends the image to the configured CV provider and receives structured verification output.
4. It updates the `verification_results` record with the outcome (`pass`, `retake`, `manual_review`, or `error`).
5. It updates the parent trip status and writes an audit log entry.

---

## Setup

```bash
cp .env.example .env
# Fill in the required variables (see below)
npm install
npm start
```

### Environment variables

| Variable                    | Required  | Description                                                       |
| --------------------------- | --------- | ----------------------------------------------------------------- |
| `SUPABASE_URL`              | Yes       | Your Supabase project URL                                         |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes       | Service role key — grants full DB access, never expose to browser |
| `CV_PROVIDER`               | No        | `mock` (default) or `http`                                        |
| `CV_API_URL`                | If `http` | Base URL of the CV API                                            |
| `CV_API_KEY`                | If `http` | API key for the CV provider                                       |
| `POLL_INTERVAL_MS`          | No        | Polling interval in milliseconds (default: 15000)                 |
| `MAX_RETRIES`               | No        | Max retry attempts per verification (default: 3)                  |

---

## CV Providers

### mock (default)

Does not call any external service. Marks all verifications as `error` with a note that the mock provider is active. Use this during development and before the CV API is available.

### http

Sends a multipart POST request to `CV_API_URL/analyze` with the image file attached. Expects a JSON response with `imageQuality`, `vehicleDetected`, `detectedPlate`, `plateMatch`, `vehicleType`, `confidence`, `decision`, and `explanation` fields.

The CV API integration point is defined in `../docs/ADMIN_INTEGRATION.md` §8.

---

## Development

```bash
npm run dev     # Start with file watching (auto-restarts on changes)
npm start       # Start without watching
```

Node.js 20 or later is required. The worker uses `--env-file=.env` to load environment variables — no `dotenv` package is needed.

---

## Security

- The service role key bypasses all Row Level Security. Keep it in `.env` only, never in source control.
- `.env` is already listed in `.gitignore`.
- The worker never exposes the service role key to the browser or to any log output.
