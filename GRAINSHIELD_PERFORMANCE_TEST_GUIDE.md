# GrainShield AI — Performance & Load Testing Guide

**Version:** Production RC  
**Date:** 2026-11-06  
**Status:** Pre-production — tests to be executed before go-live

---

## 1. Performance Targets

| Component | Metric | Target |
|---|---|---|
| Citizen trip creation (`citizen_create_trip` RPC) | P95 latency | < 2 000 ms |
| Evidence upload (10 MB image) | P95 upload time | < 8 000 ms |
| AI worker job processing | P95 processing time | < 30 000 ms |
| Admin dashboard initial load | Lighthouse LCP | < 2 500 ms |
| Citizen frontend initial load | Lighthouse LCP | < 2 500 ms |
| Supabase Realtime subscription (100 clients) | Message delivery P95 | < 500 ms |
| PostgreSQL RPC under 50 concurrent users | P99 query time | < 500 ms |
| GPS location insert rate | Throughput | ≥ 100 inserts/s |

---

## 2. Prerequisites

Install k6 (open-source load testing tool):

```bash
# Windows (Chocolatey)
choco install k6

# macOS
brew install k6

# Linux
sudo apt-get install k6
```

Install Artillery (alternative):

```bash
npm install -g artillery
```

Obtain your Supabase project URL and **anon key** (NOT service-role key):

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
```

> [!CAUTION]
> Never use the service-role key in load test scripts. It bypasses RLS and would falsify security-relevant metrics.

---

## 3. Load Test Scripts

### 3.1 Trip Creation RPC (`citizen_create_trip`)

Save as `scripts/load_test_trips.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const tripLatency = new Trend('trip_creation_latency');
const tripErrorRate = new Rate('trip_creation_errors');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 VUs
    { duration: '1m',  target: 50 },   // Ramp up to 50 VUs
    { duration: '2m',  target: 50 },   // Hold 50 VUs
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    'trip_creation_latency': ['p(95)<2000'],
    'trip_creation_errors':  ['rate<0.01'],
    'http_req_duration':     ['p(95)<3000'],
  },
};

const SUPABASE_URL      = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const TEST_JWT          = __ENV.TEST_USER_JWT; // JWT for a test citizen account

export default function () {
  const payload = JSON.stringify({
    vehicle_number:   `GJ${Math.floor(Math.random()*99).toString().padStart(2,'0')}TEST${Math.floor(Math.random()*9999).toString().padStart(4,'0')}`,
    stage:            Math.random() > 0.5 ? 'first_mile' : 'last_mile',
    origin:           'Load Test Origin',
    destination:      'Load Test Destination',
    commodity:        'Wheat',
  });

  const params = {
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${TEST_JWT}`,
    },
  };

  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/citizen_create_trip`,
    payload,
    params
  );

  const success = check(res, {
    'status is 200':          (r) => r.status === 200,
    'has trip_code':          (r) => r.json('trip_code') !== undefined,
    'trip_code format valid': (r) => /^GS-\d{4}-\d{6}$/.test(r.json('trip_code') ?? ''),
  });

  tripLatency.add(res.timings.duration);
  tripErrorRate.add(!success);

  sleep(1);
}
```

**Run:**

```bash
k6 run \
  -e SUPABASE_URL=https://<ref>.supabase.co \
  -e SUPABASE_ANON_KEY=<anon-key> \
  -e TEST_USER_JWT=<citizen-jwt> \
  scripts/load_test_trips.js
```

> [!NOTE]
> To get `TEST_USER_JWT`: sign into the citizen app in DevTools → Application → Local Storage → `sb-<ref>-auth-token` → `access_token`.

---

### 3.2 Evidence Upload (Storage)

Save as `scripts/load_test_upload.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomBytes } from 'k6/crypto';

export const options = {
  stages: [
    { duration: '30s', target: 5  },
    { duration: '2m',  target: 20 },
    { duration: '30s', target: 0  },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<8000'],
  },
};

const SUPABASE_URL      = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const TEST_JWT          = __ENV.TEST_USER_JWT;
const BUCKET            = 'trip-evidence';

export default function () {
  // Generate a 1 MB synthetic JPEG-like payload (not a valid image — for throughput testing only)
  const fakeImageData = randomBytes(1024 * 1024);
  const path = `load-test/${Date.now()}-${__VU}-${__ITER}.jpg`;

  const res = http.put(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    fakeImageData,
    {
      headers: {
        'Content-Type':  'image/jpeg',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${TEST_JWT}`,
      },
    }
  );

  check(res, {
    'upload 200 or 201': (r) => r.status === 200 || r.status === 201,
  });

  sleep(2);
}
```

> [!WARNING]
> Clean up test objects after the run. Use Supabase Dashboard → Storage → `trip-evidence` → delete `load-test/` prefix, or run a cleanup script.

---

### 3.3 Admin Dashboard — API Stress Test

Save as `scripts/load_test_admin_trips.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '3m',
  thresholds: {
    'http_req_duration': ['p(95)<1500'],
  },
};

const SUPABASE_URL      = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const ADMIN_JWT         = __ENV.ADMIN_JWT;

export default function () {
  const res = http.get(
    `${SUPABASE_URL}/rest/v1/trips?select=id,trip_code,status,created_at&order=created_at.desc&limit=50`,
    {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${ADMIN_JWT}`,
      },
    }
  );

  check(res, {
    'status 200': (r) => r.status === 200,
    'has data':   (r) => Array.isArray(r.json()),
  });

  sleep(0.5);
}
```

---

### 3.4 Realtime Subscription Stress Test (Node.js)

Save as `scripts/realtime_stress.js` and run with Node.js:

```javascript
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CLIENT_COUNT      = 100;
const TEST_TRIP_ID      = process.env.TEST_TRIP_ID; // A real trip UUID for testing

const clients = [];
const receivedCounts = new Array(CLIENT_COUNT).fill(0);

async function main() {
  console.log(`Connecting ${CLIENT_COUNT} Realtime clients...`);

  for (let i = 0; i < CLIENT_COUNT; i++) {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const channel = client
      .channel(`trip-verification-${TEST_TRIP_ID}-${i}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'verification_results',
        filter: `trip_id=eq.${TEST_TRIP_ID}`,
      }, (payload) => {
        receivedCounts[i]++;
        console.log(`Client ${i} received update: ${payload.eventType}`);
      })
      .subscribe();

    clients.push({ client, channel });
  }

  console.log('All clients connected. Waiting 30s for messages...');
  await new Promise((r) => setTimeout(r, 30_000));

  const total = receivedCounts.reduce((a, b) => a + b, 0);
  console.log(`Total messages received across ${CLIENT_COUNT} clients: ${total}`);
  console.log(`Min: ${Math.min(...receivedCounts)}, Max: ${Math.max(...receivedCounts)}`);

  process.exit(0);
}

main().catch(console.error);
```

**Run:**

```bash
node scripts/realtime_stress.js
```

> [!NOTE]
> Trigger an update to the test trip's verification record (via admin dashboard or SQL) during the 30s window to send a message to all subscribers.

---

## 4. AI Worker Concurrent Job Test

The AI worker processes jobs from the `verification_results` table. To simulate 50 concurrent jobs:

```sql
-- Run in Supabase SQL Editor (use a TEST trip ID)
-- Creates 50 pending verification records for existing test trips
INSERT INTO verification_results (trip_id, evidence_id, status, expected_plate)
SELECT
  id AS trip_id,
  (SELECT id FROM trip_evidence WHERE trip_id = trips.id LIMIT 1) AS evidence_id,
  'pending',
  vehicle_number
FROM trips
WHERE status = 'submitted'
ORDER BY created_at DESC
LIMIT 50;
```

Then observe AI worker logs for processing throughput:

```bash
# In ai-worker directory
node src/worker.js 2>&1 | tee /tmp/worker_stress.log
```

Expected output pattern:
```
[worker] Processing job <uuid>
[worker] Job <uuid> completed: pass (8231ms)
[worker] Processing job <uuid>
...
```

**Target:** All 50 jobs processed within 10 minutes with < 2% error rate.

> [!IMPORTANT]
> This test requires `CV_PROVIDER=http` and a live AI model service. With `CV_PROVIDER=mock`, all jobs return error immediately — this tests worker throughput only, not AI accuracy.

---

## 5. Frontend Lighthouse Targets

Run Lighthouse audit from Chrome DevTools (or CLI):

```bash
npx lighthouse http://localhost:8080 \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json \
  --output-path=./lighthouse-citizen.json
```

```bash
npx lighthouse http://localhost:3001 \
  --only-categories=performance,accessibility,best-practices \
  --output=json \
  --output-path=./lighthouse-admin.json
```

**Targets:**

| Metric | Citizen App | Admin Dashboard |
|---|---|---|
| Performance score | ≥ 85 | ≥ 80 |
| LCP (Largest Contentful Paint) | < 2 500 ms | < 3 000 ms |
| FID / INP (Interaction to Next Paint) | < 100 ms | < 200 ms |
| CLS (Cumulative Layout Shift) | < 0.1 | < 0.1 |
| Accessibility score | ≥ 90 | ≥ 85 |
| Best Practices score | ≥ 90 | ≥ 90 |

---

## 6. Database Connection Pooling

GrainShield AI uses Supabase's managed PgBouncer.

**Recommended settings** (configure in Supabase Dashboard → Settings → Database → Connection pooling):

| Setting | Value |
|---|---|
| Pool mode | Transaction |
| Max client connections | 100 |
| Default pool size | 15 |
| Min pool size | 2 |
| Reserve pool size | 5 |

> [!TIP]
> For the AI worker (long-running server process), use the **direct connection string** (port 5432) rather than the pooled connection (port 6543). The worker makes few, long-lived connections. Use the pooled connection for the frontend via PostgREST.

---

## 7. GPS Location Insert Rate Test

Each active driver trip inserts a location row every 30 seconds. For N simultaneous drivers:

| Active Drivers | Inserts/min | Inserts/hour |
|---|---|---|
| 10 | 20 | 1 200 |
| 100 | 200 | 12 000 |
| 500 | 1 000 | 60 000 |

Supabase PostgreSQL handles this comfortably at these rates. Monitor with:

```sql
-- Check insert throughput on trip_locations
SELECT
  date_trunc('minute', recorded_at) AS minute,
  COUNT(*) AS inserts
FROM trip_locations
WHERE recorded_at > NOW() - INTERVAL '1 hour'
GROUP BY 1
ORDER BY 1 DESC;
```

---

## 8. Running the Full Test Suite

```bash
# 1. Trip creation load test
k6 run -e SUPABASE_URL=$URL -e SUPABASE_ANON_KEY=$ANON -e TEST_USER_JWT=$JWT scripts/load_test_trips.js

# 2. Upload throughput
k6 run -e SUPABASE_URL=$URL -e SUPABASE_ANON_KEY=$ANON -e TEST_USER_JWT=$JWT scripts/load_test_upload.js

# 3. Admin API
k6 run -e SUPABASE_URL=$URL -e SUPABASE_ANON_KEY=$ANON -e ADMIN_JWT=$AJWT scripts/load_test_admin_trips.js

# 4. Realtime
node scripts/realtime_stress.js

# 5. Lighthouse
npx lighthouse http://localhost:8080 --output=json --output-path=./lighthouse-citizen.json
npx lighthouse http://localhost:3001 --output=json --output-path=./lighthouse-admin.json
```

---

## 9. Interpreting Results

Pass/Fail criteria:

| Test | Pass Condition |
|---|---|
| Trip creation P95 | < 2 000 ms |
| Trip creation error rate | < 1% |
| Upload P95 | < 8 000 ms |
| Admin trips P95 | < 1 500 ms |
| Realtime — all 100 clients receive message | ≥ 95 of 100 clients |
| Lighthouse Performance | ≥ 85 |
| Lighthouse Accessibility | ≥ 90 |

If any test fails:
1. Check Supabase Dashboard → Reports → Query Performance for slow queries.
2. Add database indexes if full table scans appear.
3. Enable Supabase Edge Functions caching for read-heavy endpoints.
4. Consider CDN (Cloudflare) for static assets if LCP is high.

---

*This guide was prepared for GrainShield AI production readiness. All numbers above are targets — actual measured results must be recorded before certifying the system as production-ready.*
