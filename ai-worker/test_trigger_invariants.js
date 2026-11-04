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

async function testOverrideReusability() {
  console.log("=== TESTING OVERRIDE SCOPING & REUSABILITY ===");

  // 1. Create trip
  const { data: trip } = await adminClient.from("trips").insert({
    trip_code: "TEST-SCOPE-" + Date.now(),
    vehicle_number: "GJ01AB1234",
    stage: "first_mile",
    status: "submitted",
    created_by: TEST_DRIVER_ID,
  }).select().single();

  // Evidence 1 (Checkpoint 1)
  const { data: ev1 } = await adminClient.from("trip_evidence").insert({
    trip_id: trip.id,
    uploaded_by: TEST_DRIVER_ID,
    stage: "first_mile",
    storage_path: `test/${trip.id}/ev1.jpg`,
    original_filename: "ev1.jpg",
    mime_type: "image/jpeg",
    file_size: 1024,
    geofence_status: "pass",
  }).select().single();

  // Review request for Evidence 1
  const { data: req1 } = await adminClient.from("manual_review_requests").insert({
    trip_id: trip.id,
    evidence_id: ev1.id,
    user_notes: "Checkpoint 1 manual review requested",
    requested_by: TEST_DRIVER_ID,
    assigned_reviewer: TEST_OFFICER_ID,
    reviewer_notes: "Officer approved Checkpoint 1 departure",
    status: "resolved",
    resolved_at: new Date().toISOString(),
  }).select().single();

  // Advance to in_transit with override (Should succeed)
  const { error: err1 } = await adminClient.from("trips").update({ status: "in_transit" }).eq("id", trip.id);
  console.log("Checkpoint 1 with resolved review (in_transit):", err1 ? "BLOCKED: " + err1.message : "ALLOWED (SUCCESS)");

  // Now, upload Evidence 2 (Checkpoint 2) with failing geofence & no review request for Evidence 2
  const { data: ev2 } = await adminClient.from("trip_evidence").insert({
    trip_id: trip.id,
    uploaded_by: TEST_DRIVER_ID,
    stage: "first_mile",
    storage_path: `test/${trip.id}/ev2.jpg`,
    original_filename: "ev2.jpg",
    mime_type: "image/jpeg",
    file_size: 1024,
    geofence_status: "fail",
    geofence_distance_meters: 15000.0,
  }).select().single();

  // Try to advance to completed. Does the old review request on Evidence 1 authorize Evidence 2?
  const { error: err2 } = await adminClient.from("trips").update({ status: "completed" }).eq("id", trip.id);
  console.log("Checkpoint 2 with failing geofence (trying to reuse Checkpoint 1 override):", 
    err2 ? "BLOCKED (SECURE!): " + err2.message : "ALLOWED (VULNERABLE: Old override was reused!)");

  // Cleanup
  await adminClient.from("manual_review_requests").delete().eq("trip_id", trip.id);
  await adminClient.from("trip_evidence").delete().eq("trip_id", trip.id);
  await adminClient.from("trips").delete().eq("id", trip.id);
}

testOverrideReusability().catch(console.error);
