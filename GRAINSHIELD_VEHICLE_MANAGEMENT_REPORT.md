# GrainShield AI — Vehicle Management Report

**Date:** 2026-11-05  
**Sprint:** Phase 7+ Vehicle Registry

---

## Schema (Migration 008)

The `vehicles` master table was created in `database/migrations/008_vehicles_organizations.sql`.

### Key Columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Auto-generated |
| `vehicle_number` | text UNIQUE NOT NULL | Normalized, e.g. `GJ05AB1234` |
| `vehicle_type` | enum | `truck / mini_truck / tempo / tractor / other` |
| `capacity_tonnes` | numeric | Payload capacity |
| `owner_name` | text | |
| `owner_phone` | text | |
| `registration_expiry` | date | Expiry warning UI |
| `insurance_expiry` | date | Expiry warning UI |
| `fitness_expiry` | date | Expiry warning UI |
| `is_active` | boolean DEFAULT true | Soft activation flag |
| `organization_id` | uuid FK → `organizations(id)` | Optional |
| `notes` | text | Admin notes |

### Trip Linkage (Post Migration 022)

| Column | Type | Notes |
|--------|------|-------|
| `trips.vehicle_id` | uuid FK → `vehicles(id)` | Added by migration 022, nullable |
| `trips.vehicle_number` | text | Pre-existing text field (retained for history) |

---

## Admin UI Capabilities

**Route:** `apps/admin/src/routes/vehicles.tsx`

| Feature | Status |
|---------|--------|
| View all vehicles (paginated, 50/page) | ✅ Working |
| Search by vehicle number (ilike) | ✅ Working |
| Filter active-only | ✅ Working (via `activeOnly` param) |
| View vehicle details | ✅ Working (table rows with all columns) |
| Expiry warnings (< 30 days = amber, expired = red) | ✅ Working |
| Register new vehicle | ✅ Working — modal form |
| Edit vehicle details | ✅ Working — same modal, pre-filled |
| Activate / Deactivate vehicle | ✅ Working — toggle button with confirmation |
| View vehicle trip history | ✅ Working — slide-over panel (added this sprint) |
| Assign vehicle to driver | ⏳ Not yet — trips link vehicle at dispatch only |

---

## Vehicle Registration Validation

| Validation | Status |
|------------|--------|
| Unique vehicle number (DB UNIQUE constraint) | ✅ Enforced |
| Vehicle number normalization (uppercase, no spaces) | ✅ Via `normalize_vehicle_number()` trigger |
| Duplicate active registration prevention | ✅ DB UNIQUE guarantees one record per number |
| Format validation (GJ05AB1234) | ⚠️ No regex check in UI form — free text accepted |

**Recommendation:** Add a regex validator in the vehicle form modal:  
`/^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$/` for Indian registration plates.

---

## Trip History Panel (New)

The vehicle detail page now shows a slide-over panel with the last 20 trips associated with that vehicle number. Each trip row shows:

- Trip code (GS-YYYY-NNNNNN)
- Stage (first_mile / mid_mile / last_mile)
- Status with colour-coded badge
- District
- Driver name
- Creation date

**Data source:** `trips` table, filtered by `vehicle_number ILIKE ?`, ordered by `created_at DESC`, limited to 20.

---

## Dispatch Validation (Migration 022)

After migration 022 is applied, `admin_dispatch_trip()` will:

1. Verify `vehicle_number` exists in `vehicles` master table (case-insensitive match).
2. Verify `is_active = true`.
3. Populate `trips.vehicle_id` FK on successful dispatch.
4. Return a descriptive error if the vehicle is unknown or inactive.

Before migration 022, any free-text vehicle number was accepted without validation.

---

## Gaps and Backlog

| Gap | Severity | Effort |
|-----|----------|--------|
| No driver ↔ vehicle assignment table (many-to-many) | 🟡 MEDIUM | Medium |
| No `vehicles` table on RLS — open to all authenticated admin roles | 🟢 LOW | Low |
| No vehicle number format regex validation in UI form | 🟢 LOW | Low |
| Verification history per vehicle (view AI results for a vehicle) | 🟡 MEDIUM | Medium |
| Vehicle utilization rate / pass-rate analytics in reports page | 🟢 LOW | High |
| `organization_id` FK — no organization management UI | 🟢 LOW | Medium |

---

## Auditable Assignment History

Vehicle-to-trip assignments are recorded via:
- `audit_logs` table (action: `trip_dispatched`, metadata includes `vehicle_id` and `vehicle_number`)
- `trips` table itself (FK `vehicle_id` immutable after creation)

Historical queries:
```sql
-- All trips for a vehicle
SELECT trip_code, stage, status, created_at
  FROM public.trips
 WHERE vehicle_number ILIKE 'GJ05AB1234'
 ORDER BY created_at DESC;

-- Audit trail for vehicle dispatches
SELECT action, metadata, created_at
  FROM public.audit_logs
 WHERE action = 'trip_dispatched'
   AND (metadata->>'vehicle_number') ILIKE 'GJ05AB1234'
 ORDER BY created_at DESC;
```
