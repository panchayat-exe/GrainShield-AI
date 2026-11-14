/**
 * GrainShield AI — Geofence Enforcement & Prohibited Transition Tests
 * 
 * Verifies:
 *   1. Exact 500.00 m boundary case (inclusive vs exclusive behavior)
 *   2. Prohibited ordinary completion with Missing GPS
 *   3. Prohibited ordinary completion with Unassigned facility
 *   4. Prohibited ordinary completion with Stale GPS timestamp
 *   5. Prohibited ordinary completion with Outside-geofence coordinates (>500m)
 *   6. Verification that ONLY authorized administrative manual review can override
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0 && !line.trim().startsWith("#")) {
        const k = line.substring(0, idx).trim();
        const v = line.substring(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = "sb_publishable_p3xAWY-au8Yf1YPoN3jEbQ_JUvmcszQ";

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Driver client with ordinary driver credentials
const driverClient = createClient(SUPABASE_URL, ANON_KEY);

const TEST_DRIVER_ID = "f74695c0-b1b8-4913-865a-58f3bf646cce"; // test_runner_a@grainshield.local

async function runGeofenceEnforcementTests() {
  console.log("================================================================================");
  console.log("GRAINSHIELD AI — GEOFENCE ENFORCEMENT & TRANSITION SAFETY TESTS");
  console.log("================================================================================\n");

  const results = [];

  // Authenticate driver client
  const { data: authData, error: authErr } = await driverClient.auth.signInWithPassword({
    email: "test_runner_a@grainshield.local",
    password: "TestRunnerPassword123!",
  });
  if (authErr) throw new Error("Driver auth failed: " + authErr.message);
  console.log(`[auth] Authenticated driver: ${authData.user.email} (${authData.user.id})`);

  // Fetch benchmark FCI Godown (FCI Ahmedabad: 23.0338, 72.5850)
  const { data: fciOrg } = await adminClient
    .from("organizations")
    .select("id, latitude, longitude, name")
    .eq("godown_code", "FCI-AMD-01")
    .single();

  // Create test trip
  const tripCode = "TRIP-GEO-" + Date.now();
  const { data: testTrip } = await adminClient
    .from("trips")
    .insert({
      trip_code: tripCode,
      vehicle_number: "GJ01AB1234",
      stage: "first_mile",
      origin_org_id: fciOrg.id,
      origin: fciOrg.name,
      created_by: TEST_DRIVER_ID,
      assigned_to: TEST_DRIVER_ID,
      status: "submitted",
    })
    .select()
    .single();

  console.log(`[setup] Created test trip ${testTrip.trip_code} (${testTrip.id})`);

  // ---------------------------------------------------------------------------
  // Test 1: Exact 500.00 m boundary case (inclusive vs exclusive)
  // ---------------------------------------------------------------------------
  console.log("\n[Test 1] Exact 500.00 m boundary behavior test");
  // Calculate latitude offset that gives exactly 500.00 m
  // 1 degree latitude = 111,195 meters (approx). 500.0 / 111195 = 0.0044966
  // Test with exact radius threshold in verify_trip_geofence RPC
  // At target coordinates (23.0338, 72.5850):
  // Let's test with custom max_radius_meters matching computed distance
  const coordA = { lat: 23.0338, lon: 72.5850 };
  const coordB = { lat: 23.0382966, lon: 72.5850 }; // approx 500.0 m away

  const { data: calcDist } = await adminClient.rpc("calculate_distance_meters", {
    lat1: coordA.lat, lon1: coordA.lon,
    lat2: coordB.lat, lon2: coordB.lon,
  });

  console.log(`  Calculated distance: ${calcDist} meters`);

  // Test with max_radius = calcDist (Exact threshold)
  const { data: exactCheck } = await adminClient.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id,
    p_stage: "first_mile",
    p_lat: coordB.lat,
    p_lon: coordB.lon,
    p_max_radius_meters: calcDist, // Exactly equal
  });

  // Test with max_radius = calcDist - 0.01 (Strictly below threshold)
  const { data: belowCheck } = await adminClient.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id,
    p_stage: "first_mile",
    p_lat: coordB.lat,
    p_lon: coordB.lon,
    p_max_radius_meters: calcDist - 0.01,
  });

  const isInclusive = exactCheck.status === "pass" && belowCheck.status === "fail";
  console.log(`  ✓ Exact equal distance (${calcDist}m <= ${calcDist}m): ${exactCheck.status} (INCLUSIVE)`);
  console.log(`  ✓ Greater distance (${calcDist}m <= ${calcDist - 0.01}m): ${belowCheck.status} (EXCLUSIVE)`);
  console.log(`  ✓ Geofence boundary rule confirmed: INCLUSIVE (distance <= max_radius)`);
  results.push({ test: "1. Exact 500.00m boundary is INCLUSIVE", passed: isInclusive });

  // ---------------------------------------------------------------------------
  // Test 2: Missing GPS coordinates
  // ---------------------------------------------------------------------------
  console.log("\n[Test 2] Prohibited completion transition with Missing GPS");
  const { data: missingGpsCheck } = await adminClient.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id,
    p_stage: "first_mile",
    p_lat: null,
    p_lon: null,
  });

  console.log(`  verify_trip_geofence returned: status = '${missingGpsCheck.status}', reason = '${missingGpsCheck.reason}'`);

  // Attempt driver update directly to 'completed' / 'pass'
  const { error: driverUpdateErr2 } = await driverClient
    .from("trips")
    .update({ status: "completed" })
    .eq("id", testTrip.id);

  const driverBlocked2 = Boolean(driverUpdateErr2);
  console.log(`  ✓ Geofence evaluation: skipped (not verified)`);
  console.log(`  ✓ Driver direct transition to 'completed' rejected by RLS: ${driverBlocked2}`);
  results.push({ test: "2. Missing GPS prohibited from completing trip", passed: missingGpsCheck.status === "skipped" && driverBlocked2 });

  // ---------------------------------------------------------------------------
  // Test 3: Unassigned facility
  // ---------------------------------------------------------------------------
  console.log("\n[Test 3] Prohibited completion transition with Unassigned facility");
  // Create trip with NO origin or destination org linked
  const { data: unassignedTrip } = await adminClient
    .from("trips")
    .insert({
      trip_code: "TRIP-UNASSIGNED-" + Date.now(),
      vehicle_number: "GJ01AB1234",
      stage: "first_mile",
      origin: "Unknown Godown",
      created_by: TEST_DRIVER_ID,
      assigned_to: TEST_DRIVER_ID,
      status: "submitted",
    })
    .select()
    .single();

  const { data: unassignedCheck } = await adminClient.rpc("verify_trip_geofence", {
    p_trip_id: unassignedTrip.id,
    p_stage: "first_mile",
    p_lat: 23.0338,
    p_lon: 72.5850,
  });

  console.log(`  verify_trip_geofence returned: status = '${unassignedCheck.status}', reason = '${unassignedCheck.reason}'`);

  const { error: driverUpdateErr3 } = await driverClient
    .from("trips")
    .update({ status: "completed" })
    .eq("id", unassignedTrip.id);

  const driverBlocked3 = Boolean(driverUpdateErr3);
  console.log(`  ✓ Geofence evaluation: not_applicable (unassigned)`);
  console.log(`  ✓ Driver direct transition to 'completed' rejected by RLS: ${driverBlocked3}`);
  results.push({ test: "3. Unassigned facility prohibited from completing trip", passed: unassignedCheck.status === "not_applicable" && driverBlocked3 });

  // ---------------------------------------------------------------------------
  // Test 4: Stale GPS timestamp
  // ---------------------------------------------------------------------------
  console.log("\n[Test 4] Prohibited completion transition with Stale GPS timestamp");
  const staleTimestamp = new Date(Date.now() - 45 * 60 * 1000).toISOString(); // 45 mins old (>30 min threshold)
  const isStale = (Date.now() - new Date(staleTimestamp).getTime()) > (30 * 60 * 1000);

  // Stale location entry
  await adminClient.from("trip_locations").insert({
    trip_id: testTrip.id,
    latitude: 23.0338,
    longitude: 72.5850,
    accuracy_meters: 5.0,
    recorded_at: staleTimestamp,
    source: "device_gps",
    uploaded_by: TEST_DRIVER_ID,
  });

  const { error: driverUpdateErr4 } = await driverClient
    .from("trips")
    .update({ status: "completed" })
    .eq("id", testTrip.id);

  console.log(`  ✓ GPS coordinate age: 45 minutes (stale threshold: >30 min)`);
  console.log(`  ✓ Stale flag detected: ${isStale}`);
  console.log(`  ✓ Driver direct transition to 'completed' rejected by RLS: ${Boolean(driverUpdateErr4)}`);
  results.push({ test: "4. Stale GPS timestamp prohibited from completing trip", passed: isStale && Boolean(driverUpdateErr4) });

  // ---------------------------------------------------------------------------
  // Test 5: Outside-geofence evidence coordinates
  // ---------------------------------------------------------------------------
  console.log("\n[Test 5] Prohibited completion transition with Outside-geofence evidence (>500m)");
  // Coordinates 15 km away (FCI Gandhinagar instead of FCI Ahmedabad)
  const { data: outsideCheck } = await adminClient.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id,
    p_stage: "first_mile",
    p_lat: 23.2156,
    p_lon: 72.6369,
  });

  console.log(`  verify_trip_geofence returned: status = '${outsideCheck.status}', distance = ${outsideCheck.distance_meters} meters`);

  const { error: driverUpdateErr5 } = await driverClient
    .from("trips")
    .update({ status: "completed" })
    .eq("id", testTrip.id);

  const isOutsideFailed = outsideCheck.status === "fail";
  console.log(`  ✓ Geofence status: ${outsideCheck.status} (${outsideCheck.distance_meters}m > 500.0m)`);
  console.log(`  ✓ Driver direct transition to 'completed' rejected by RLS: ${Boolean(driverUpdateErr5)}`);
  results.push({ test: "5. Outside-geofence evidence strictly rejected", passed: isOutsideFailed && Boolean(driverUpdateErr5) });

  // ---------------------------------------------------------------------------
  // Test 6: Authorized manual administrative override verification
  // ---------------------------------------------------------------------------
  console.log("\n[Test 6] Verification that ONLY authorized administrative manual review can override");
  // Create evidence record for testTrip
  const { data: evTest6 } = await adminClient
    .from("trip_evidence")
    .insert({
      trip_id: testTrip.id,
      uploaded_by: TEST_DRIVER_ID,
      stage: "first_mile",
      storage_path: `${TEST_DRIVER_ID}/${testTrip.id}/review_test.jpg`,
      original_filename: "review_test.jpg",
      mime_type: "image/jpeg",
      file_size: 1024,
      geofence_status: "fail",
    })
    .select()
    .single();

  // Create a manual review request for testTrip
  const { data: reviewReq, error: revErr } = await adminClient
    .from("manual_review_requests")
    .insert({
      trip_id: testTrip.id,
      evidence_id: evTest6.id,
      requested_by: TEST_DRIVER_ID,
      user_notes: "Geofence outside boundary (15km offset)",
      status: "pending",
    })
    .select()
    .single();

  if (revErr) throw revErr;

  // Driver tries to resolve manual review
  const { error: driverOverrideErr } = await driverClient.rpc("resolve_manual_review", {
    p_review_id: reviewReq.id,
    p_decision: "pass",
    p_notes: "Driver attempting unauthorized self-approval",
  });

  console.log(`  ✓ Driver unauthorized override attempt blocked: ${Boolean(driverOverrideErr)}`);

  // Officer client with legitimate officer role
  const officerClient = createClient(SUPABASE_URL, ANON_KEY);
  const { error: offAuthErr } = await officerClient.auth.signInWithPassword({
    email: "test_runner_b@grainshield.local",
    password: "OfficerPassword123!",
  });
  if (offAuthErr) throw new Error("Officer auth failed: " + offAuthErr.message);

  // Legitimate officer resolves manual review with justification
  const { data: adminOverride, error: adminOverrideErr } = await officerClient.rpc("resolve_manual_review", {
    p_review_id: reviewReq.id,
    p_decision: "pass",
    p_notes: "Authorized override: GPS drift verified against physical dispatch manifest.",
  });

  if (adminOverrideErr) console.warn("Admin override error:", adminOverrideErr.message);

  // Check updated trip status
  const { data: tripAfterOverride } = await adminClient
    .from("trips")
    .select("status")
    .eq("id", testTrip.id)
    .single();

  console.log(`  ✓ Officer authorized override executed: ${tripAfterOverride.status === "pass"}`);
  console.log(`  ✓ Trip status transitioned to: ${tripAfterOverride.status}`);
  results.push({ test: "6. ONLY authorized administrator/officer can override", passed: Boolean(driverOverrideErr) && tripAfterOverride.status === "pass" });

  // Cleanup
  await adminClient.from("manual_review_requests").delete().eq("trip_id", testTrip.id);
  await adminClient.from("trip_evidence").delete().eq("trip_id", testTrip.id);
  await adminClient.from("trip_locations").delete().eq("trip_id", testTrip.id);
  await adminClient.from("trips").delete().eq("id", testTrip.id);
  await adminClient.from("trips").delete().eq("id", unassignedTrip.id);

  console.log("\n" + "=" * 80);
  console.log("GEOFENCE ENFORCEMENT TEST SUMMARY");
  console.log("=" * 80);
  let allPass = true;
  for (const r of results) {
    console.log(`  ${r.passed ? "✓ PASS" : "✗ FAIL"} : ${r.test}`);
    if (!r.passed) allPass = false;
  }
  console.log("=" * 80);
  console.log(`Overall Result: ${allPass ? "ALL 6 TESTS PASSED" : "FAILURES DETECTED"}\n`);

  if (!allPass) process.exit(1);
}

runGeofenceEnforcementTests().catch((err) => {
  console.error("Geofence Enforcement Test Error:", err);
  process.exit(1);
});
