/**
 * GrainShield AI — Four Checkpoint Live End-to-End Inference Verification
 *
 * Submits REAL image bytes to the HTTP AI Inference Service (http://127.0.0.1:8000/verify),
 * uploads to private Supabase storage, writes database evidence and verification records,
 * and records comprehensive audit events.
 *
 * Checkpoint 1: First Mile FCI Departure
 * Checkpoint 2: First Mile GSCSCL Arrival (e-POD)
 * Checkpoint 3: Last Mile GSCSCL Departure
 * Checkpoint 4: Last Mile FPS Delivery (e-POD)
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
const CV_API_URL = process.env.CV_API_URL || "http://127.0.0.1:8000/verify";
const CV_API_KEY = process.env.CV_API_KEY || "";

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_DRIVER_ID = "f74695c0-b1b8-4913-865a-58f3bf646cce"; // test_runner_a@grainshield.local
const BUCKET = "trip-evidence";

async function callInferenceApi(imagePath, expectedPlate, stage) {
  const fileBytes = fs.readFileSync(imagePath);
  const blob = new Blob([fileBytes], { type: "image/jpeg" });
  const formData = new FormData();
  formData.append("image", blob, path.basename(imagePath));
  formData.append("expected_plate", expectedPlate);
  if (stage) formData.append("stage", stage);

  const headers = {};
  if (CV_API_KEY) {
    headers["Authorization"] = `Bearer ${CV_API_KEY}`;
  }

  const t0 = Date.now();
  const resp = await fetch(CV_API_URL, {
    method: "POST",
    headers,
    body: formData,
  });
  const latencyMs = Date.now() - t0;

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Inference HTTP ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  return { result: json, latencyMs, imageSize: fileBytes.length };
}

async function runFourCheckpointsLive() {
  console.log("================================================================================");
  console.log("GRAINSHIELD AI — FOUR CHECKPOINT LIVE INFERENCE VERIFICATION");
  console.log("================================================================================\n");

  const reports = [];

  // Fetch benchmark facilities
  const { data: fciOrg } = await client.from("organizations").select("id, latitude, longitude, name").eq("godown_code", "FCI-AMD-01").single();
  const { data: gscOrg } = await client.from("organizations").select("id, latitude, longitude, name").eq("godown_code", "GS-GNR-01").single();
  const { data: fpsOrg } = await client.from("organizations").select("id, latitude, longitude, name").eq("godown_code", "FPS-AMD-001").single();

  // ---------------------------------------------------------------------------
  // Checkpoint 1: FCI Departure (First Mile Initiation)
  // ---------------------------------------------------------------------------
  console.log("[Checkpoint 1] First Mile: FCI Departure (FCI Ahmedabad)");
  const cp1ImgPath = path.join(__dirname, "..", "ai-model", "test_fixtures", "cp1_fci_departure.jpg");
  const assignedPlateFM = "GJ01AB1234";

  // Create First Mile Trip
  const tripCodeFM = "TRIP-LIVE-FM-" + Date.now();
  const { data: tripFM } = await client.from("trips").insert({
    trip_code: tripCodeFM,
    vehicle_number: assignedPlateFM,
    stage: "first_mile",
    origin_org_id: fciOrg.id,
    destination_org_id: gscOrg.id,
    origin: fciOrg.name,
    destination: gscOrg.name,
    created_by: TEST_DRIVER_ID,
    assigned_to: TEST_DRIVER_ID,
    status: "submitted",
    vehicle_category: "heavy_vehicle",
  }).select().single();

  console.log(`  Trip created: ${tripFM.trip_code} (${tripFM.id})`);

  // 1. Submit REAL image to AI Inference Service
  const cp1Inf = await callInferenceApi(cp1ImgPath, assignedPlateFM, "first_mile");
  console.log(`  ✓ AI Inference: ${cp1Inf.result.decision} in ${cp1Inf.latencyMs}ms | Detected: ${cp1Inf.result.detectedPlate} (expected: ${assignedPlateFM})`);

  // 2. Upload image to private Supabase storage
  const cp1StoragePath = `${TEST_DRIVER_ID}/${tripFM.id}/cp1_fci_departure.jpg`;
  await client.storage.from(BUCKET).upload(cp1StoragePath, fs.readFileSync(cp1ImgPath), { contentType: "image/jpeg", upsert: true });

  // 3. Geofence evaluation (fixture-supplied benchmark GPS)
  const fciGps = { lat: 23.0338, lon: 72.5850 }; // Aligned with FCI Ahmedabad
  const { data: cp1Geo } = await client.rpc("verify_trip_geofence", {
    p_trip_id: tripFM.id,
    p_stage: "first_mile",
    p_lat: fciGps.lat,
    p_lon: fciGps.lon,
  });

  // 4. Insert evidence and verification
  const { data: ev1 } = await client.from("trip_evidence").insert({
    trip_id: tripFM.id,
    uploaded_by: TEST_DRIVER_ID,
    stage: "first_mile",
    storage_path: cp1StoragePath,
    original_filename: "cp1_fci_departure.jpg",
    mime_type: "image/jpeg",
    file_size: cp1Inf.imageSize,
    latitude: fciGps.lat,
    longitude: fciGps.lon,
    geofence_status: cp1Geo.status,
    geofence_distance_meters: cp1Geo.distance_meters,
  }).select().single();

  const { data: ver1 } = await client.from("verification_results").insert({
    trip_id: tripFM.id,
    evidence_id: ev1.id,
    status: cp1Inf.result.decision,
    expected_plate: assignedPlateFM,
    detected_plate: cp1Inf.result.detectedPlate,
    plate_match: cp1Inf.result.plateMatch,
    vehicle_detected: cp1Inf.result.vehicleDetected,
    vehicle_type: cp1Inf.result.vehicleType,
    confidence: cp1Inf.result.confidence,
    decision: cp1Inf.result.decision,
    explanation: cp1Inf.result.explanation,
    processor_version: cp1Inf.result.processorVersion,
    processing_completed_at: new Date().toISOString(),
  }).select().single();

  // Advance trip status to in_transit
  await client.from("trips").update({ status: "in_transit" }).eq("id", tripFM.id);

  // Audit event
  const { data: audit1 } = await client.from("audit_logs").insert({
    actor_id: TEST_DRIVER_ID,
    action: "first_mile_departure_verified",
    entity_type: "trips",
    entity_id: tripFM.id,
    trip_id: tripFM.id,
    metadata: {
      checkpoint: 1,
      decision: cp1Inf.result.decision,
      detected_plate: cp1Inf.result.detectedPlate,
      geofence_status: cp1Geo.status,
    },
  }).select().single();

  reports.push({
    checkpoint: "1. FCI Departure (First Mile)",
    tripCode: tripFM.trip_code,
    evidenceId: ev1.id,
    imageSource: "Actual image submitted (cp1_fci_departure.jpg)",
    assignedPlate: assignedPlateFM,
    detectedPlate: cp1Inf.result.detectedPlate,
    ocrDecision: cp1Inf.result.decision,
    fpsCodeExpected: "N/A (First Mile)",
    fpsCodeExtracted: "N/A",
    gpsType: "Demonstration fixture benchmark coordinates (FCI-AMD-01: 23.0338, 72.5850)",
    geofenceDist: `${cp1Geo.distance_meters}m (${cp1Geo.status})`,
    tripStatus: "in_transit",
    auditAction: audit1.action,
  });

  // ---------------------------------------------------------------------------
  // Checkpoint 2: GSCSCL Arrival (First Mile e-POD)
  // ---------------------------------------------------------------------------
  console.log("\n[Checkpoint 2] First Mile: GSCSCL Arrival / e-POD (GSCSCL Gandhinagar)");
  const cp2ImgPath = path.join(__dirname, "..", "ai-model", "test_fixtures", "cp2_gscscl_arrival.jpg");

  const cp2Inf = await callInferenceApi(cp2ImgPath, assignedPlateFM, "first_mile");
  console.log(`  ✓ AI Inference: ${cp2Inf.result.decision} in ${cp2Inf.latencyMs}ms | Detected: ${cp2Inf.result.detectedPlate}`);

  const cp2StoragePath = `${TEST_DRIVER_ID}/${tripFM.id}/cp2_gscscl_arrival.jpg`;
  await client.storage.from(BUCKET).upload(cp2StoragePath, fs.readFileSync(cp2ImgPath), { contentType: "image/jpeg", upsert: true });

  const gscGps = { lat: 23.2200, lon: 72.6450 }; // Aligned with GSCSCL Gandhinagar
  const { data: cp2Geo } = await client.rpc("verify_trip_geofence", {
    p_trip_id: tripFM.id,
    p_stage: "first_mile",
    p_lat: gscGps.lat,
    p_lon: gscGps.lon,
  });

  const { data: ev2 } = await client.from("trip_evidence").insert({
    trip_id: tripFM.id,
    uploaded_by: TEST_DRIVER_ID,
    stage: "first_mile",
    storage_path: cp2StoragePath,
    original_filename: "cp2_gscscl_arrival.jpg",
    mime_type: "image/jpeg",
    file_size: cp2Inf.imageSize,
    latitude: gscGps.lat,
    longitude: gscGps.lon,
    geofence_status: cp2Geo.status,
    geofence_distance_meters: cp2Geo.distance_meters,
  }).select().single();

  const { data: ver2 } = await client.from("verification_results").insert({
    trip_id: tripFM.id,
    evidence_id: ev2.id,
    status: cp2Inf.result.decision,
    expected_plate: assignedPlateFM,
    detected_plate: cp2Inf.result.detectedPlate,
    plate_match: cp2Inf.result.plateMatch,
    vehicle_detected: cp2Inf.result.vehicleDetected,
    vehicle_type: cp2Inf.result.vehicleType,
    confidence: cp2Inf.result.confidence,
    decision: cp2Inf.result.decision,
    explanation: cp2Inf.result.explanation,
    processor_version: cp2Inf.result.processorVersion,
    processing_completed_at: new Date().toISOString(),
  }).select().single();

  await client.from("trips").update({ status: "completed" }).eq("id", tripFM.id);

  const { data: audit2 } = await client.from("audit_logs").insert({
    actor_id: TEST_DRIVER_ID,
    action: "first_mile_epod_completed",
    entity_type: "trips",
    entity_id: tripFM.id,
    trip_id: tripFM.id,
    metadata: {
      checkpoint: 2,
      decision: cp2Inf.result.decision,
      geofence_status: cp2Geo.status,
    },
  }).select().single();

  reports.push({
    checkpoint: "2. GSCSCL Arrival e-POD (First Mile)",
    tripCode: tripFM.trip_code,
    evidenceId: ev2.id,
    imageSource: "Actual image submitted (cp2_gscscl_arrival.jpg)",
    assignedPlate: assignedPlateFM,
    detectedPlate: cp2Inf.result.detectedPlate,
    ocrDecision: cp2Inf.result.decision,
    fpsCodeExpected: "N/A (First Mile)",
    fpsCodeExtracted: "N/A",
    gpsType: "Demonstration fixture benchmark coordinates (GS-GNR-01: 23.2200, 72.6450)",
    geofenceDist: `${cp2Geo.distance_meters}m (${cp2Geo.status})`,
    tripStatus: "completed",
    auditAction: audit2.action,
  });

  // ---------------------------------------------------------------------------
  // Checkpoint 3: GSCSCL Departure (Last Mile Initiation)
  // ---------------------------------------------------------------------------
  console.log("\n[Checkpoint 3] Last Mile: GSCSCL Departure (GSCSCL Gandhinagar -> FPS Ahmedabad)");
  const cp3ImgPath = path.join(__dirname, "..", "ai-model", "test_fixtures", "cp3_gscscl_departure.jpg");
  const assignedPlateLM = "GJ01CD5678";

  const tripCodeLM = "TRIP-LIVE-LM-" + Date.now();
  const { data: tripLM } = await client.from("trips").insert({
    trip_code: tripCodeLM,
    vehicle_number: assignedPlateLM,
    stage: "last_mile",
    origin_org_id: gscOrg.id,
    destination_org_id: fpsOrg.id,
    fps_shop_id: fpsOrg.id,
    origin: gscOrg.name,
    destination: fpsOrg.name,
    created_by: TEST_DRIVER_ID,
    assigned_to: TEST_DRIVER_ID,
    status: "submitted",
    vehicle_category: "light_commercial_vehicle",
  }).select().single();

  console.log(`  Trip created: ${tripLM.trip_code} (${tripLM.id})`);

  const cp3Inf = await callInferenceApi(cp3ImgPath, assignedPlateLM, "last_mile");
  console.log(`  ✓ AI Inference: ${cp3Inf.result.decision} in ${cp3Inf.latencyMs}ms | Detected: ${cp3Inf.result.detectedPlate}`);

  const cp3StoragePath = `${TEST_DRIVER_ID}/${tripLM.id}/cp3_gscscl_departure.jpg`;
  await client.storage.from(BUCKET).upload(cp3StoragePath, fs.readFileSync(cp3ImgPath), { contentType: "image/jpeg", upsert: true });

  const { data: cp3Geo } = await client.rpc("verify_trip_geofence", {
    p_trip_id: tripLM.id,
    p_stage: "last_mile",
    p_lat: gscGps.lat,
    p_lon: gscGps.lon,
  });

  const { data: ev3 } = await client.from("trip_evidence").insert({
    trip_id: tripLM.id,
    uploaded_by: TEST_DRIVER_ID,
    stage: "last_mile",
    storage_path: cp3StoragePath,
    original_filename: "cp3_gscscl_departure.jpg",
    mime_type: "image/jpeg",
    file_size: cp3Inf.imageSize,
    latitude: gscGps.lat,
    longitude: gscGps.lon,
    geofence_status: cp3Geo.status,
    geofence_distance_meters: cp3Geo.distance_meters,
  }).select().single();

  const { data: ver3 } = await client.from("verification_results").insert({
    trip_id: tripLM.id,
    evidence_id: ev3.id,
    status: cp3Inf.result.decision,
    expected_plate: assignedPlateLM,
    detected_plate: cp3Inf.result.detectedPlate,
    plate_match: cp3Inf.result.plateMatch,
    vehicle_detected: cp3Inf.result.vehicleDetected,
    vehicle_type: cp3Inf.result.vehicleType,
    confidence: cp3Inf.result.confidence,
    decision: cp3Inf.result.decision,
    explanation: cp3Inf.result.explanation,
    processor_version: cp3Inf.result.processorVersion,
    processing_completed_at: new Date().toISOString(),
  }).select().single();

  await client.from("trips").update({ status: "in_transit" }).eq("id", tripLM.id);

  const { data: audit3 } = await client.from("audit_logs").insert({
    actor_id: TEST_DRIVER_ID,
    action: "last_mile_departure_verified",
    entity_type: "trips",
    entity_id: tripLM.id,
    trip_id: tripLM.id,
    metadata: {
      checkpoint: 3,
      decision: cp3Inf.result.decision,
      detected_plate: cp3Inf.result.detectedPlate,
    },
  }).select().single();

  reports.push({
    checkpoint: "3. GSCSCL Departure (Last Mile)",
    tripCode: tripLM.trip_code,
    evidenceId: ev3.id,
    imageSource: "Actual image submitted (cp3_gscscl_departure.jpg)",
    assignedPlate: assignedPlateLM,
    detectedPlate: cp3Inf.result.detectedPlate,
    ocrDecision: cp3Inf.result.decision,
    fpsCodeExpected: "FPS-AMD-001 (Destination)",
    fpsCodeExtracted: "N/A (Departure stage)",
    gpsType: "Demonstration fixture benchmark coordinates (GS-GNR-01: 23.2200, 72.6450)",
    geofenceDist: `${cp3Geo.distance_meters}m (${cp3Geo.status})`,
    tripStatus: "in_transit",
    auditAction: audit3.action,
  });

  // ---------------------------------------------------------------------------
  // Checkpoint 4: Fair Price Shop Delivery (Last Mile e-POD)
  // ---------------------------------------------------------------------------
  console.log("\n[Checkpoint 4] Last Mile: Fair Price Shop Delivery / e-POD (FPS Ward 1 Ahmedabad)");
  const cp4ImgPath = path.join(__dirname, "..", "ai-model", "test_fixtures", "cp4_fps_delivery.jpg");

  const cp4Inf = await callInferenceApi(cp4ImgPath, assignedPlateLM, "last_mile");
  console.log(`  ✓ AI Inference: ${cp4Inf.result.decision} in ${cp4Inf.latencyMs}ms | Detected: ${cp4Inf.result.detectedPlate}`);
  console.log(`  ✓ Evidence Checks: person_presence=${cp4Inf.result.evidenceChecks?.person_presence}, banner_detected=${cp4Inf.result.evidenceChecks?.banner_detected}`);

  const cp4StoragePath = `${TEST_DRIVER_ID}/${tripLM.id}/cp4_fps_delivery.jpg`;
  await client.storage.from(BUCKET).upload(cp4StoragePath, fs.readFileSync(cp4ImgPath), { contentType: "image/jpeg", upsert: true });

  const fpsGps = { lat: 23.0250, lon: 72.5700 }; // Aligned with FPS-AMD-001
  const { data: cp4Geo } = await client.rpc("verify_trip_geofence", {
    p_trip_id: tripLM.id,
    p_stage: "last_mile",
    p_lat: fpsGps.lat,
    p_lon: fpsGps.lon,
  });

  const { data: ev4 } = await client.from("trip_evidence").insert({
    trip_id: tripLM.id,
    uploaded_by: TEST_DRIVER_ID,
    stage: "last_mile",
    storage_path: cp4StoragePath,
    original_filename: "cp4_fps_delivery.jpg",
    mime_type: "image/jpeg",
    file_size: cp4Inf.imageSize,
    latitude: fpsGps.lat,
    longitude: fpsGps.lon,
    geofence_status: cp4Geo.status,
    geofence_distance_meters: cp4Geo.distance_meters,
  }).select().single();

  const { data: ver4 } = await client.from("verification_results").insert({
    trip_id: tripLM.id,
    evidence_id: ev4.id,
    status: cp4Inf.result.decision,
    expected_plate: assignedPlateLM,
    detected_plate: cp4Inf.result.detectedPlate,
    plate_match: cp4Inf.result.plateMatch,
    vehicle_detected: cp4Inf.result.vehicleDetected,
    vehicle_type: cp4Inf.result.vehicleType,
    evidence_checks: cp4Inf.result.evidenceChecks,
    confidence: cp4Inf.result.confidence,
    decision: cp4Inf.result.decision,
    explanation: cp4Inf.result.explanation,
    processor_version: cp4Inf.result.processorVersion,
    processing_completed_at: new Date().toISOString(),
  }).select().single();

  await client.from("trips").update({ status: "completed" }).eq("id", tripLM.id);

  const { data: audit4 } = await client.from("audit_logs").insert({
    actor_id: TEST_DRIVER_ID,
    action: "last_mile_epod_completed",
    entity_type: "trips",
    entity_id: tripLM.id,
    trip_id: tripLM.id,
    metadata: {
      checkpoint: 4,
      decision: cp4Inf.result.decision,
      person_presence: cp4Inf.result.evidenceChecks?.person_presence,
      dealer_identity_verified: false,
      banner_detected: cp4Inf.result.evidenceChecks?.banner_detected,
      geofence_status: cp4Geo.status,
    },
  }).select().single();

  const bannerText = cp4Inf.result.evidenceChecks?.banner_scan?.raw_text || "";
  const extractedFps = bannerText.includes("FPS-AMD-001") ? "FPS-AMD-001" : bannerText.slice(0, 30);

  reports.push({
    checkpoint: "4. Fair Price Shop e-POD (Last Mile)",
    tripCode: tripLM.trip_code,
    evidenceId: ev4.id,
    imageSource: "Actual image submitted (cp4_fps_delivery.jpg)",
    assignedPlate: assignedPlateLM,
    detectedPlate: cp4Inf.result.detectedPlate,
    ocrDecision: cp4Inf.result.decision,
    fpsCodeExpected: "FPS-AMD-001",
    fpsCodeExtracted: extractedFps,
    gpsType: "Demonstration fixture benchmark coordinates (FPS-AMD-001: 23.0250, 72.5700)",
    geofenceDist: `${cp4Geo.distance_meters}m (${cp4Geo.status})`,
    tripStatus: "completed",
    auditAction: audit4.action,
  });

  console.log("\n" + "=" * 90);
  console.log("FOUR-CHECKPOINT LIVE EXECUTION REPORT");
  console.log("=" * 90);
  console.table(reports);

  // Output JSON report for audit documentation
  fs.writeFileSync("four_checkpoints_live_results.json", JSON.stringify(reports, null, 2));
  console.log("Written detailed report to four_checkpoints_live_results.json\n");
}

runFourCheckpointsLive().catch((err) => {
  console.error("Four Checkpoint Live Execution Error:", err);
  process.exit(1);
});
