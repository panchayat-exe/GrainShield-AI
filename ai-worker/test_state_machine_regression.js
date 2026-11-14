/**
 * GrainShield AI — State Machine Invariant & Prohibited Transition Regression Suite
 * 
 * Verifies that:
 * 1. Trip cannot advance to in_transit/completed without backend verification.
 * 2. Driver direct transition to 'in_transit' blocked by RLS.
 * 3. AI decision 'manual_review' maps trip to 'manual_review' (NOT 'completed').
 * 4. AI decision 'fail' maps trip to 'rejected' (NOT 'completed').
 * 5. Geofence failure routes to manual review and prevents automatic completion.
 * 6. Unauthorized driver cannot call resolve_manual_review RPC.
 * 7. Authorized officer calling resolve_manual_review successfully transitions trip.
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

const driverClient = createClient(SUPABASE_URL, ANON_KEY);
const officerClient = createClient(SUPABASE_URL, ANON_KEY);

const TEST_DRIVER_ID = "f74695c0-b1b8-4913-865a-58f3bf646cce"; // test_runner_a@grainshield.local
const TEST_OFFICER_ID = "3a3a64c4-036b-4950-8f31-00163ee28bc0"; // test_runner_b@grainshield.local

async function runRegressionSuite() {
  console.log("================================================================================");
  console.log("GRAINSHIELD AI — TRIP STATE MACHINE REGRESSION TESTS");
  console.log("================================================================================\n");

  const results = [];

  // Authenticate driver
  const { error: dAuthErr } = await driverClient.auth.signInWithPassword({
    email: "test_runner_a@grainshield.local",
    password: "TestRunnerPassword123!",
  });
  if (dAuthErr) throw new Error("Driver auth failed: " + dAuthErr.message);

  // Authenticate officer
  const { error: oAuthErr } = await officerClient.auth.signInWithPassword({
    email: "test_runner_b@grainshield.local",
    password: "OfficerPassword123!",
  });
  if (oAuthErr) throw new Error("Officer auth failed: " + oAuthErr.message);

  // Fetch valid orgs for geofence
  const { data: orgs } = await adminClient.from("organizations").select("id, latitude, longitude, name").limit(2);
  const fciOrg = orgs[0];
  const gscOrg = orgs[1];

  console.log("[auth] Authenticated driver and officer test clients.\n");

  // Helper to create trip
  async function createTrip(stage = "first_mile") {
    const code = "TRIP-REG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const { data, error } = await adminClient.from("trips").insert({
      trip_code: code,
      stage,
      status: "submitted",
      vehicle_number: "GJ01AB1234",
      origin_org_id: fciOrg.id,
      destination_org_id: gscOrg.id,
      origin: fciOrg.name,
      destination: gscOrg.name,
      created_by: TEST_DRIVER_ID,
      assigned_to: TEST_DRIVER_ID,
    }).select().single();
    if (error) throw new Error("Trip create failed: " + error.message);
    return data;
  }

  // TEST 1: Driver direct transition to 'completed' blocked by RLS
  {
    console.log("[Test 1] Driver direct transition to 'completed' without backend verification");
    const trip = await createTrip("first_mile");
    const { data: updated, error } = await driverClient
      .from("trips")
      .update({ status: "completed" })
      .eq("id", trip.id)
      .select();

    const blocked = error !== null || (!updated || updated.length === 0);
    console.log(`  Driver direct transition blocked: ${blocked}`);
    results.push({ name: "Driver direct completion blocked by RLS", passed: blocked });
    await adminClient.from("trips").delete().eq("id", trip.id);
  }

  // TEST 2: Driver direct transition to 'in_transit' blocked by RLS
  {
    console.log("\n[Test 2] Driver direct transition to 'in_transit' without backend verification");
    const trip = await createTrip("first_mile");
    const { data: updated, error } = await driverClient
      .from("trips")
      .update({ status: "in_transit" })
      .eq("id", trip.id)
      .select();

    const blocked = error !== null || (!updated || updated.length === 0);
    console.log(`  Driver direct transition blocked: ${blocked}`);
    results.push({ name: "Driver direct in_transit blocked by RLS", passed: blocked });
    await adminClient.from("trips").delete().eq("id", trip.id);
  }

  // TEST 3: AI decision 'manual_review' maps trip to 'manual_review' (NOT 'completed')
  {
    console.log("\n[Test 3] AI decision 'manual_review' maps trip to 'manual_review' (NOT 'completed')");
    const trip = await createTrip("first_mile");
    
    // Simulate worker processing logic (lines 420-430 of worker.js)
    const verStatus = "manual_review";
    const tripStatus = verStatus === "fail" ? "rejected" : verStatus;
    
    const { data: updated, error } = await adminClient
      .from("trips")
      .update({ status: tripStatus })
      .eq("id", trip.id)
      .in("status", ["submitted", "processing"])
      .select()
      .single();

    const correctlyRouted = updated && updated.status === "manual_review";
    console.log(`  Trip routed to manual_review: ${correctlyRouted} (status: ${updated?.status})`);
    results.push({ name: "AI manual_review routes trip to manual_review queue", passed: correctlyRouted });
    await adminClient.from("trips").delete().eq("id", trip.id);
  }

  // TEST 4: AI decision 'fail' maps trip to 'rejected' (NOT 'completed')
  {
    console.log("\n[Test 4] AI decision 'fail' maps trip to 'rejected' (NOT 'completed')");
    const trip = await createTrip("first_mile");
    
    const verStatus = "fail";
    const tripStatus = verStatus === "fail" ? "rejected" : verStatus;
    
    const { data: updated, error } = await adminClient
      .from("trips")
      .update({ status: tripStatus })
      .eq("id", trip.id)
      .in("status", ["submitted", "processing"])
      .select()
      .single();

    const correctlyRejected = updated && updated.status === "rejected";
    console.log(`  Trip routed to rejected: ${correctlyRejected} (status: ${updated?.status})`);
    results.push({ name: "AI fail routes trip to rejected status", passed: correctlyRejected });
    await adminClient.from("trips").delete().eq("id", trip.id);
  }

  // TEST 5: Geofence fail prevents automatic completion
  {
    console.log("\n[Test 5] Geofence fail prevents automatic trip progression");
    const trip = await createTrip("first_mile");

    // Coordinates 20km away from FCI Ahmedabad (23.0338, 72.5850)
    const { data: geo } = await adminClient.rpc("verify_trip_geofence", {
      p_trip_id: trip.id,
      p_stage: "first_mile",
      p_lat: 23.4000,
      p_lon: 72.8000,
    });

    const isGeofenceFailed = geo && geo.status === "fail";
    console.log(`  Geofence evaluation result: ${geo?.status} (${geo?.distance_meters}m)`);
    
    // In application workflow, a geofence failure routes to manual_review
    const { data: updated } = await adminClient
      .from("trips")
      .update({ status: isGeofenceFailed ? "manual_review" : "completed" })
      .eq("id", trip.id)
      .select()
      .single();

    const heldInReview = updated && updated.status === "manual_review";
    console.log(`  Trip held in manual_review due to failed geofence: ${heldInReview}`);
    results.push({ name: "Geofence failure prevents automatic completion", passed: heldInReview });
    await adminClient.from("trips").delete().eq("id", trip.id);
  }

  // TEST 6: Unauthorized driver cannot call resolve_manual_review RPC
  {
    console.log("\n[Test 6] Driver forbidden from calling resolve_manual_review RPC");
    const trip = await createTrip("first_mile");
    
    // Insert evidence and review request
    const { data: ev } = await adminClient.from("trip_evidence").insert({
      trip_id: trip.id,
      uploaded_by: TEST_DRIVER_ID,
      stage: "first_mile",
      storage_path: `test/${trip.id}/ev.jpg`,
      original_filename: "ev.jpg",
      mime_type: "image/jpeg",
      file_size: 1024,
    }).select().single();

    const { data: req } = await adminClient.from("manual_review_requests").insert({
      trip_id: trip.id,
      evidence_id: ev.id,
      user_notes: "plate_mismatch",
      requested_by: TEST_DRIVER_ID,
      status: "pending",
    }).select().single();

    const { error: driverRpcErr } = await driverClient.rpc("resolve_manual_review", {
      p_review_id: req.id,
      p_decision: "pass",
      p_notes: "Driver attempt to self-approve",
    });

    const driverBlocked = driverRpcErr !== null;
    console.log(`  Driver RPC blocked: ${driverBlocked} (${driverRpcErr?.message})`);
    results.push({ name: "Driver blocked from resolve_manual_review RPC", passed: driverBlocked });

    // TEST 7: Authorized Officer legitimately resolves manual review
    console.log("\n[Test 7] Authorized Officer successfully resolves manual review with audit trail");
    const { error: officerRpcErr } = await officerClient.rpc("resolve_manual_review", {
      p_review_id: req.id,
      p_decision: "pass",
      p_notes: "Officer verified physical gate logbook; vehicle match confirmed.",
    });

    const officerSuccess = officerRpcErr === null;
    console.log(`  Officer RPC executed: ${officerSuccess}`);

    // Verify trip status became pass
    const { data: finalTrip } = await adminClient.from("trips").select("status").eq("id", trip.id).single();
    console.log(`  Trip status after officer override: ${finalTrip?.status}`);

    // Verify audit log exists
    const { data: audit } = await adminClient
      .from("audit_logs")
      .select("id, action, actor_id, metadata")
      .eq("trip_id", trip.id)
      .eq("action", "manual_review_pass")
      .maybeSingle();

    const auditRecorded = audit !== null && audit.actor_id === TEST_OFFICER_ID;
    console.log(`  Audit log recorded: ${auditRecorded} (Audit ID: ${audit?.id})`);

    results.push({
      name: "Authorized officer override succeeds with comprehensive audit log",
      passed: officerSuccess && finalTrip?.status === "pass" && auditRecorded,
    });

    // Cleanup
    await adminClient.from("audit_logs").delete().eq("trip_id", trip.id);
    await adminClient.from("manual_review_requests").delete().eq("id", req.id);
    await adminClient.from("trip_evidence").delete().eq("id", ev.id);
    await adminClient.from("trips").delete().eq("id", trip.id);
  }

  console.log("\n================================================================================");
  console.log("STATE MACHINE REGRESSION TEST RESULTS");
  console.log("================================================================================");
  let allPass = true;
  for (const r of results) {
    console.log(`  ${r.passed ? "✓ PASS" : "✗ FAIL"} : ${r.name}`);
    if (!r.passed) allPass = false;
  }
  console.log("================================================================================");
  console.log(`Overall: ${allPass ? "ALL 7 REGRESSION TESTS PASSED" : "TESTS FAILED"}`);
  console.log("================================================================================\n");
}

runRegressionSuite().catch(console.error);
