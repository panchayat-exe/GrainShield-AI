# GrainShield AI — GPS Physical Device Test Report

**Date:** 2026-11-06  
**Implementation:** `mobile/hooks/use-gps-tracking.ts` + `mobile/app/(app)/tracking.tsx`

> [!IMPORTANT]
> This report covers the GPS implementation audit and what has been verified via code inspection. Items that **require physical Android device testing** are explicitly flagged with ❌ **DEVICE REQUIRED**. No GPS results are fabricated.

---

## 1. GPS Implementation Audit

### 1.1 Core Hook: `use-gps-tracking.ts`

| Feature | Implementation | Status |
|---------|---------------|--------|
| Foreground location request | `expo-location` `watchPositionAsync` | ✅ Code verified |
| Background task registration | `expo-task-manager` `defineTask(LOCATION_TASK)` | ✅ Code verified |
| Permission request (foreground) | `requestForegroundPermissionsAsync()` | ✅ Code verified |
| Permission request (background) | `requestBackgroundPermissionsAsync()` | ✅ Code verified |
| Permission denial handling | Alert shown, tracking not started | ✅ Code verified |
| Push to Supabase | `trip_locations` INSERT with authenticated user | ✅ Code verified |
| Duplicate prevention | `recorded_at` timestamp; deduplication via unique index | ✅ Code verified |
| Stale location warning | Admin dashboard shows last-updated timestamp | ✅ Code verified |
| Offline queue | `lib/offline/outbox.ts` queues locations | ✅ Code verified |
| Reconnection sync | OutboxBanner triggers sync on reconnect | ✅ Code verified |
| Auth-bound uploads | Uses authenticated Supabase client | ✅ Code verified |
| Trip assignment check | RLS enforces `created_by` or `assigned_to` | ✅ Code verified |

### 1.2 Tracking Accuracy

| Field | Source | Notes |
|-------|--------|-------|
| `latitude`, `longitude` | Device GPS | WGS84 |
| `accuracy_meters` | expo-location `coords.accuracy` | Nullable |
| `recorded_at` | Server `now()` on insert | Prevents client clock manipulation |
| `source` | `"mobile_gps"` | Distinguishes from manual entry |

---

## 2. Test Cases — Code Verified

The following behaviors are confirmed by static code analysis:

| Test | Expected | Code Verified |
|------|----------|--------------|
| Foreground tracking starts on button press | `watchPositionAsync` called | ✅ |
| Background tracking registered after permission | `defineTask` + `startLocationUpdatesAsync` | ✅ |
| Tracking stops on trip completion | `stopLocationUpdatesAsync` called | ✅ |
| Permission denied → graceful error | Alert + `gpsStatus = error_permission` | ✅ |
| GPS unavailable → error state shown | `error_unavailable` state displayed | ✅ |
| Location uploads to `trip_locations` | Supabase INSERT in task handler | ✅ |
| Old location displayed with timestamp | Admin map shows `recorded_at` | ✅ |

---

## 3. Physical Device Tests — REQUIRED

> [!CAUTION]
> The following tests CANNOT be verified via emulator or code inspection. They must be executed on a physical Android device before production sign-off.

| Test ID | Test | Steps | Expected | Result |
|---------|------|-------|----------|--------|
| GPS-P-01 | Background GPS while app backgrounded | Start tracking → press Home → drive 1km | Locations continue in DB | ❌ DEVICE REQUIRED |
| GPS-P-02 | GPS after app killed (swipe-away) | Start tracking → kill app → check DB | Locations continue via background task | ❌ DEVICE REQUIRED |
| GPS-P-03 | Battery optimization (Doze mode) | Add app to battery optimization exceptions → background → check frequency | Minimum 1 update per 5 min | ❌ DEVICE REQUIRED |
| GPS-P-04 | Indoor / weak signal | Test inside a concrete building | Accuracy_meters > 50; stale warning appears on admin | ❌ DEVICE REQUIRED |
| GPS-P-05 | Network interruption during GPS push | Disable WiFi/data mid-tracking | Locations queued in outbox; synced on reconnect | ❌ DEVICE REQUIRED |
| GPS-P-06 | Offline → reconnect sync | Track offline for 10 min → restore data | All queued locations uploaded, no duplicates | ❌ DEVICE REQUIRED |
| GPS-P-07 | Checkpoint ordering | Complete CP1 then CP2 on same trip | CP2 not accepted before CP1 is recorded | ❌ DEVICE REQUIRED |
| GPS-P-08 | Multi-device (two drivers same trip) | Two phones track same trip_id | Each upload separate location records | ❌ DEVICE REQUIRED |
| GPS-P-09 | Permission revoked mid-trip | Revoke location permission during active tracking | Tracking pauses, error_permission state shown | ❌ DEVICE REQUIRED |
| GPS-P-10 | Stale GPS admin warning | No location update for 6 minutes | Admin dashboard shows ⚠ Stale GPS banner | ❌ DEVICE REQUIRED |

---

## 4. Physical Device Testing Procedure

### Prerequisites

```bash
# Install Expo Go or build a development client
npx expo start --clear
# Connect Android device via USB
adb devices
# Or test on Android emulator (limited — no background GPS)
```

### Device Requirements

- Android 10+ (API 29+) for background location
- Location permissions: "Allow all the time"
- Battery optimization: disabled for the app
- Developer options: Stay awake enabled for lab testing

### How to Run

1. Open the app on device
2. Log in as a test citizen
3. Submit a test trip
4. Start GPS tracking on the tracking screen
5. Use `adb logcat -s GrainShieldGPS` to monitor logs
6. For background tests: press Home button after starting tracking
7. Check `trip_locations` table in Supabase dashboard every 60 seconds

### Reporting Format

For each test: record device model, Android version, GPS fix time, accuracy, number of location records, any errors.

---

## 5. Emulator Limitations

| Feature | Emulator | Physical Device |
|---------|----------|----------------|
| Foreground GPS | ✅ Works (simulated) | ✅ |
| Background GPS | ⚠️ Unreliable | ✅ Required |
| Battery optimization (Doze) | ❌ Not reproducible | ✅ Required |
| Real signal strength variation | ❌ Not reproducible | ✅ Required |
| Network interruption | Partial (airplane mode) | ✅ Preferred |

---

## 6. Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| `react-native-maps` config plugin not found (v1.14) | Low | ✅ Fixed — removed from app.json plugins; still usable in code |
| Background GPS frequency on aggressive OEMs (Xiaomi, Realme) | High | ⚠️ Requires device-specific battery whitelist |
| expo-location may not wake device from deep sleep | Medium | Needs test on Samsung/Xiaomi with Doze |

---

*Report generated: 2026-11-06. Update after physical device test session.*
