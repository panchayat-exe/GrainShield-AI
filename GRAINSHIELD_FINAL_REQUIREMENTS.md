# GrainShield AI — Final Requirements Specification

**Document Version:** 1.0 (Production Release Candidate)  
**Date:** 2026-11-06  
**Repository:** `github.com/panchayat-exe/GrainShield-AI`

---

## 1. System Overview

GrainShield AI is a government-grade grain transport verification platform for the state of Gujarat. It provides end-to-end tracking and AI-powered verification of food grain transport from FCI Mandis through godowns to Fair Price Shops (FPS).

### 1.1 Applications

| Application | Technology | Users |
|-------------|-----------|-------|
| Admin Dashboard | React + Vite (port 3001) | Government officers, admins |
| Citizen Web App | React + Vite (port 8080) | Citizens submitting transport evidence |
| Driver Mobile App | Expo + React Native | Drivers assigned to trips |

### 1.2 Backend

| Component | Technology |
|-----------|-----------|
| Database | Supabase (PostgreSQL 15) |
| Auth | Supabase Auth (email/password) |
| Storage | Supabase Storage (private bucket `trip-evidence`) |
| Realtime | Supabase Realtime (WebSocket channels) |
| Edge Functions | Deno (Supabase) |
| AI Worker | Node.js (ESM) |
| AI Model | Python FastAPI + YOLOv8 |
| Notifications | Resend (email) + Expo Push |

---

## 2. Trip Lifecycle

```
Citizen submits → submitted
Admin dispatches → assigned driver
Worker processes → processing
AI decision → pass | retake | manual_review | error
Admin reviews → pass | rejected | retake
Driver completes → completed
```

### 2.1 Trip ID Format

- **System-generated:** `GS-YYYY-NNNNNN` (e.g. `GS-2026-100042`)
- Generated exclusively by `generate_trip_code()` PostgreSQL function
- Unique globally (enforced by `UNIQUE(trip_code)` constraint)
- Citizens **never** enter or choose their own Trip ID

### 2.2 Checkpoints

| Stage | Checkpoints |
|-------|-------------|
| First Mile | CP1 (FCI Mandi departure), CP2 (Godown arrival) |
| Last Mile | CP3 (Godown departure), CP4 (FPS delivery) |

---

## 3. Functional Requirements

### 3.1 Citizen Application

| ID | Requirement | Status |
|----|-------------|--------|
| C-01 | Register with email, password, full name | ✅ Implemented |
| C-02 | Log in securely | ✅ |
| C-03 | Submit trip with vehicle number, stage, optional origin/destination | ✅ |
| C-04 | **Never enter a Trip ID manually** | ✅ **Implemented in migration 025 + frontend** |
| C-05 | See auto-generated GS-YYYY-NNNNNN on confirmation screen | ✅ |
| C-06 | Upload vehicle photograph (JPG/PNG/WebP ≤10MB) | ✅ |
| C-07 | View processing status in real time | ✅ |
| C-08 | View verification result (pass/retake/rejected) | ✅ |
| C-09 | Retake photo when permitted | ✅ |
| C-10 | View list of own trips (My Trips) with trip_code | ✅ |
| C-11 | View trip details and evidence history | ✅ |
| C-12 | Edit profile (full name, phone, district) | ✅ |
| C-13 | Change password | ✅ |
| C-14 | Reset password via email link | ✅ |
| C-15 | Sign out securely | ✅ |
| C-16 | View help and checkpoint guidance | ✅ |
| C-17 | Live GPS tracking | ✅ |

### 3.2 Admin Dashboard

| ID | Requirement | Status |
|----|-------------|--------|
| A-01 | View dashboard statistics | ✅ |
| A-02 | Search, filter, paginate trips | ✅ |
| A-03 | Dispatch new trips (admin-generated Trip ID) | ✅ |
| A-04 | Assign drivers to trips | ✅ |
| A-05 | Inspect evidence photographs | ✅ |
| A-06 | Perform manual review | ✅ |
| A-07 | View checkpoint context on trip | ✅ |
| A-08 | Live GPS tracking of drivers | ✅ |
| A-09 | Stale GPS warnings (>5 minutes) | ✅ |
| A-10 | Manage registered vehicles | ✅ |
| A-11 | Manage users and roles | ✅ |
| A-12 | View audit logs | ✅ |
| A-13 | Manage failed jobs / DLQ | ✅ |
| A-14 | Generate reports | ✅ |
| A-15 | Receive notifications on trip status changes | ✅ |

### 3.3 Driver Mobile Application

| ID | Requirement | Status |
|----|-------------|--------|
| D-01 | Authenticate securely | ✅ |
| D-02 | Submit trip evidence (auto Trip ID) | ✅ **Updated** |
| D-03 | Offline evidence queuing | ✅ |
| D-04 | Background GPS tracking | ✅ |
| D-05 | View assigned trips | ✅ |
| D-06 | View checkpoint status | ✅ |
| D-07 | Receive push notifications | ✅ |
| D-08 | View verification results | ✅ |
| D-09 | Retake photographs | ✅ |
| D-10 | Manage profile | ✅ |
| D-11 | Change password | ✅ |
| D-12 | Sign out | ✅ |

---

## 4. Non-Functional Requirements

| ID | Requirement | Implementation |
|----|-------------|---------------|
| NF-01 | All database operations enforce RLS | ✅ Migrations 003, 007 |
| NF-02 | Service-role key never exposed to client | ✅ AI Worker server-only |
| NF-03 | Evidence file integrity (checksum) | ✅ SHA-256 on upload |
| NF-04 | Audit log every trip/evidence action | ✅ Triggers + RPC logs |
| NF-05 | Trip ID globally unique | ✅ DB constraint `trips_trip_code_unique` |
| NF-06 | Concurrent trip creation safe | ✅ Retry loop in `citizen_create_trip()` |
| NF-07 | GPS timestamps must be accurate | ✅ Server-side `recorded_at` |
| NF-08 | Stale GPS clearly labelled | ✅ Admin dashboard warning |
| NF-09 | No silent production data changes | ✅ All changes via audit-logged RPCs |

---

## 5. Acceptance Criteria (from Master Prompt)

| Criterion | Test | Status |
|-----------|------|--------|
| Citizen creates trip without entering Trip ID | Submit form with vehicle + stage + photo only | ✅ Passes |
| System returns auto-generated GS-YYYY-NNNNNN | Check confirmation screen | ✅ Passes |
| Arbitrary trip code not accepted as official ID | No trip_code input field exists | ✅ Passes |
| Admin trips unaffected | Admin dispatch modal still works | ✅ Passes |
| All apps show same trip_code | Verified in queries: `trip.trip_code` from DB | ✅ Passes |

---

*Document generated: 2026-11-06*
