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

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_DRIVER_ID = "f74695c0-b1b8-4913-865a-58f3bf646cce";
const TEST_OFFICER_ID = "3a3a64c4-036b-4950-8f31-00163ee28bc0";

async function testOverrideReusabilityAndInvariants() {
  console.log("================================================================================");
  console.log("GRAINSHIELD AI — TRIGGER INVARIANTS & OVERRIDE REUSABILITY REGRESSION SUITE");
  console.log("================================================================================\n");

  // 1. Create a fresh test trip
  const { data: trip, error: tripErr } = await adminClient.from("trips").insert({
    trip_code: "REGRESS-SCOPE-" + Date.now(),
    vehicle_number: "GJ01AB1234",
    stage: "first_mile",
    status: "submitted",
    created_by: TEST_DRIVER_ID,
  }).select().single();

  if (tripErr) throw new Error("Failed to create test trip: " + tripErr.message);
  console.log(`[Setup] Created test trip: ${trip.trip_code} (${trip.id})`);

  // Evidence 1 (Checkpoint 1) with failing geofence to test override requirement
  const { data: ev1 } = await adminClient.from("trip_evidence").insert({
    trip_id: trip.id,
    uploaded_by: TEST_DRIVER_ID,
    stage: "first_mile",
    storage_path: `test/${trip.id}/ev1.jpg`,
    original_filename: "ev1.jpg",
    mime_type: "image/jpeg",
    file_size: 1024,
    geofence_status: "fail", // Requires officer override
    geofence_distance_meters: 8500.0,
  }).select().single();

  // Test 1: Direct transition to 'pass' without override MUST be rejected
  const { error: errDirect } = await adminClient.from("trips").update({ status: "pass" }).eq("id", trip.id);
  console.log("\n[Test 1: Direct unverified advance without override]");
  console.log("  Outcome:", errDirect ? "BLOCKED AS EXPECTED (SECURE): " + errDirect.message : "FAILED: Unverified transition allowed!");

  // Create manual review request for Evidence 1
  const { data: req1 } = await adminClient.from("manual_review_requests").insert({
    trip_id: trip.id,
    evidence_id: ev1.id,
    user_notes: "[DEMONSTRATION/TEST] Checkpoint 1 departure review requested",
    requested_by: TEST_DRIVER_ID,
    assigned_reviewer: TEST_OFFICER_ID,
    reviewer_notes: "[DEMONSTRATION/TEST] Authorized officer approved departure override",
    status: "resolved",
    resolved_at: new Date().toISOString(),
  }).select().single();
  console.log(`[Setup] Created resolved manual review override: ${req1.id} for evidence: ${ev1.id}`);

  // Test 2: Advance to 'pass' with resolved override on Evidence 1
  const { error: errAuth } = await adminClient.from("trips").update({ status: "pass" }).eq("id", trip.id);
  console.log("\n[Test 2: Authorized transition to 'pass' with valid override]");
  console.log("  Outcome:", errAuth ? "BLOCKED: " + errAuth.message : "ALLOWED (SUCCESS: Valid override authorized transition)");

  // Test 3: SAME-EVIDENCE REUSE REGRESSION TEST
  // Attempt a SECOND transition (e.g. from 'pass' to 'completed') on the SAME evidence without a new review request
  const { error: errReuseSameEv } = await adminClient.from("trips").update({ status: "completed" }).eq("id", trip.id);
  console.log("\n[Test 3: Same-Evidence Override Reuse (Attempt second transition on same evidence)]");
  console.log("  Outcome:", errReuseSameEv ? "BLOCKED AS EXPECTED (SECURE: Override consumed, cannot be reused on same evidence): " + errReuseSameEv.message : "VULNERABLE: Same override authorized a second transition!");

  // Test 4: DIFFERENT-CHECKPOINT REUSE REGRESSION TEST
  // Upload Evidence 2 (Checkpoint 2) with failing geofence & no override for Evidence 2
  const { data: ev2 } = await adminClient.from("trip_evidence").insert({
    trip_id: trip.id,
    uploaded_by: TEST_DRIVER_ID,
    stage: "first_mile",
    storage_path: `test/${trip.id}/ev2.jpg`,
    original_filename: "ev2.jpg",
    mime_type: "image/jpeg",
    file_size: 1024,
    geofence_status: "fail",
    geofence_distance_meters: 12000.0,
  }).select().single();

  const { error: errReuseDiffEv } = await adminClient.from("trips").update({ status: "completed" }).eq("id", trip.id);
  console.log("\n[Test 4: Different-Checkpoint Override Reuse (Attempt transition using prior checkpoint override)]");
  console.log("  Outcome:", errReuseDiffEv ? "BLOCKED AS EXPECTED (SECURE: Prior checkpoint override does not apply to new evidence): " + errReuseDiffEv.message : "VULNERABLE: Prior override authorized subsequent checkpoint!");

  // Cleanup
  console.log("\n[Cleanup] Removing temporary test artifacts...");
  await adminClient.from("manual_review_requests").delete().eq("trip_id", trip.id);
  await adminClient.from("trip_evidence").delete().eq("trip_id", trip.id);
  await adminClient.from("trips").delete().eq("id", trip.id);
  console.log("[Cleanup] Done. Audit records in audit_logs preserved.\n");
}

testOverrideReusabilityAndInvariants().catch(console.error);
