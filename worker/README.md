# GrainShield AI — Backend Worker

AI Computer Vision verification worker and backend services for GrainShield AI.

## What this does

This Node.js worker polls Supabase every 15 seconds for `verification_results` records with `status='pending'`, downloads the private evidence photograph, calls the configured Computer Vision API, and writes the verified result back to Supabase.

## Setup

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Fill in your values in .env:
#    SUPABASE_URL=https://umkjdpgxxylckoohnyco.supabase.co
#    SUPABASE_SERVICE_ROLE_KEY=eyJ...  (from Dashboard → Settings → API)
#    CV_PROVIDER=mock  (or 'http' when you have a real endpoint)
#    CV_API_URL=https://your-cv-api.example.com/verify
#    CV_API_KEY=your-key

# 3. Install dependencies
npm install

# 4. Run
npm start          # production
npm run dev        # development with auto-reload
```

## CV Provider Configuration

| `CV_PROVIDER` | Behaviour |
|---|---|
| `mock` (default) | Marks verifications as `error` with a "not configured" explanation. No fake results. |
| `http` | Posts the image + expected plate to `CV_API_URL` with Bearer auth. |

### Expected CV API response format

```json
{
  "imageQuality": "clear",
  "vehicleDetected": true,
  "detectedPlate": "GJ01AB1234",
  "plateMatch": true,
  "vehicleType": "Truck",
  "confidence": 0.97,
  "decision": "pass",
  "explanation": "Plate matches, vehicle detected, clear image.",
  "processorVersion": "your-model-v1.0",
  "rawOutput": {}
}
```

`decision` must be one of: `pass` | `retake` | `manual_review` | `error`

## Security

- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — keep it secret, server-side only
- Never commit `.env`
- This worker runs as a trusted system actor; it uses `actor_id: null` in audit logs

## Deployment

Deploy as a long-running Node.js process on any server (Railway, Fly.io, a VPS, etc.).

```bash
# With PM2
npm install -g pm2
pm2 start src/worker.js --name grainshield-worker
pm2 save
```

## .gitignore

```
node_modules/
.env
```
