/**
 * GrainShield AI — Computer Vision Verification Worker
 *
 * This Node.js worker:
 *  1. Polls Supabase for verification_results with status='pending'
 *  2. Downloads the private evidence photograph via a signed URL
 *  3. Calls the configured CV provider to analyze the image
 *  4. Updates the verification_results record with the real outcome
 *  5. Updates the parent trip status accordingly
 *  6. Writes an audit log entry
 *
 * The worker uses SUPABASE_SERVICE_ROLE_KEY (server-only) to bypass RLS
 * for trusted writes. It never exposes this key to any frontend.
 *
 * Setup:
 *   cp .env.example .env   # Fill in real values
 *   npm install
 *   npm start
 */

import { createClient } from "@supabase/supabase-js";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ------------------------------------
// Config from environment
// ------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CV_PROVIDER = process.env.CV_PROVIDER ?? "mock";
const CV_API_URL = process.env.CV_API_URL ?? "";
const CV_API_KEY = process.env.CV_API_KEY ?? "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "15000");
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? "3");
const PROCESSING_TIMEOUT_MS = Number(process.env.PROCESSING_TIMEOUT_MS ?? "30000");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[worker] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env",
  );
  process.exit(1);
}

// Service-role admin client — bypasses RLS for trusted writes
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ------------------------------------
// CV Provider Interface
// ------------------------------------

/**
 * @typedef {Object} CVResult
 * @property {boolean} success
 * @property {string|null} imageQuality - 'clear'|'blurry'|'dark'|'overexposed'
 * @property {boolean|null} vehicleDetected
 * @property {string|null} detectedPlate
 * @property {boolean|null} plateMatch
 * @property {string|null} vehicleType
 * @property {number|null} confidence - 0.0 to 1.0
 * @property {string} decision - 'pass'|'retake'|'manual_review'|'error'
 * @property {string} explanation
 * @property {string} processorVersion
 * @property {object|null} rawOutput
 * @property {string|null} error
 */

/**
 * Mock CV provider — used when CV_PROVIDER=mock.
 * Returns a deterministic "pending" result to indicate the real provider
 * is not configured. Does NOT fabricate a real pass result.
 */
async function callMockProvider(_imageBuffer, _expectedPlate) {
  console.log("[worker][mock] Mock CV provider active — no real analysis performed.");
  return {
    success: false,
    imageQuality: null,
    vehicleDetected: null,
    detectedPlate: null,
    plateMatch: null,
    vehicleType: null,
    confidence: null,
    decision: "error",
    explanation:
      "No AI provider is configured. Set CV_PROVIDER, CV_API_URL, and CV_API_KEY in the worker .env to enable real verification.",
    processorVersion: "mock-v0",
    rawOutput: null,
    error: "CV provider not configured",
  };
}

/**
 * Real HTTP CV provider — calls an external API endpoint.
 * The API must accept multipart/form-data with fields: image, expected_plate.
 * It must return JSON matching the CVResult shape.
 *
 * Swap this for your actual provider (Google Vision, Azure, custom model, etc.)
 */
async function callHttpProvider(imageBuffer, expectedPlate) {
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: "image/jpeg" });
  formData.append("image", blob, "evidence.jpg");
  formData.append("expected_plate", expectedPlate ?? "");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PROCESSING_TIMEOUT_MS,
  );

  try {
    const response = await fetch(CV_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${CV_API_KEY}` },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        decision: "error",
        explanation: `CV API returned HTTP ${response.status}`,
        processorVersion: "http-provider",
        error: `HTTP ${response.status}`,
      };
    }

    const json = await response.json();
    return { success: true, processorVersion: "http-provider-v1", ...json };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      decision: "error",
      explanation: `CV API call failed: ${msg}`,
      processorVersion: "http-provider",
      error: msg,
    };
  }
}

async function callCVProvider(imageBuffer, expectedPlate) {
  if (CV_PROVIDER === "mock" || !CV_API_URL) {
    return callMockProvider(imageBuffer, expectedPlate);
  }
  return callHttpProvider(imageBuffer, expectedPlate);
}

// ------------------------------------
// Download evidence photograph
// ------------------------------------
async function downloadEvidence(storagePath) {
  const { data, error } = await adminClient.storage
    .from("trip-evidence")
    .download(storagePath);

  if (error || !data) {
    console.error("[worker] Failed to download evidence:", storagePath, error?.message);
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ------------------------------------
// Core job processor
// ------------------------------------
async function processVerification(verification) {
  const { id, trip_id, evidence_id, expected_plate } = verification;
  console.log(`[worker] Processing verification ${id} for trip ${trip_id}`);

  // Mark as processing (prevent double-pickup)
  const { error: markError } = await adminClient
    .from("verification_results")
    .update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending"); // Idempotency guard

  if (markError) {
    console.warn(`[worker] Could not mark ${id} as processing:`, markError.message);
    return; // Another worker may have picked it up
  }

  // Fetch evidence storage path
  const { data: evidenceRow, error: evErr } = await adminClient
    .from("trip_evidence")
    .select("storage_path, mime_type")
    .eq("id", evidence_id)
    .single();

  if (evErr || !evidenceRow) {
    await failVerification(id, trip_id, "Evidence record not found.");
    return;
  }

  // Download image
  const imageBuffer = await downloadEvidence(evidenceRow.storage_path);
  if (!imageBuffer) {
    await failVerification(id, trip_id, "Failed to download evidence image.");
    return;
  }

  // Call CV provider
  let cvResult;
  try {
    cvResult = await callCVProvider(imageBuffer, expected_plate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failVerification(id, trip_id, `CV provider threw an exception: ${msg}`);
    return;
  }

  const now = new Date().toISOString();

  // Map decision to verification_status and trip_status
  const verStatus =
    cvResult.decision === "pass"
      ? "pass"
      : cvResult.decision === "retake"
        ? "retake"
        : cvResult.decision === "manual_review"
          ? "manual_review"
          : "error";

  const tripStatus =
    verStatus === "pass"
      ? "pass"
      : verStatus === "manual_review"
        ? "manual_review"
        : verStatus === "retake"
          ? "retake"
          : trip_id; // fallback — don't change status on error

  // Update verification record
  const { error: updateError } = await adminClient
    .from("verification_results")
    .update({
      status: verStatus,
      image_quality: cvResult.imageQuality ?? null,
      vehicle_detected: cvResult.vehicleDetected ?? null,
      detected_plate: cvResult.detectedPlate ?? null,
      plate_match: cvResult.plateMatch ?? null,
      vehicle_type: cvResult.vehicleType ?? null,
      confidence: cvResult.confidence ?? null,
      decision: cvResult.decision,
      explanation: cvResult.explanation,
      processor_version: cvResult.processorVersion,
      processing_completed_at: now,
      raw_output: cvResult.rawOutput ?? null,
    })
    .eq("id", id);

  if (updateError) {
    console.error(`[worker] Failed to update verification ${id}:`, updateError.message);
    return;
  }

  // Update trip status
  if (verStatus !== "error") {
    await adminClient
      .from("trips")
      .update({ status: tripStatus })
      .eq("id", trip_id);
  }

  // Write audit log
  await adminClient.from("audit_logs").insert({
    actor_id: null, // system actor
    action: "verification_completed",
    entity_type: "verification_results",
    entity_id: id,
    trip_id,
    metadata: {
      status: verStatus,
      decision: cvResult.decision,
      processor_version: cvResult.processorVersion,
    },
  });

  console.log(
    `[worker] ✓ Verification ${id} completed: ${verStatus} (${cvResult.decision})`,
  );
}

async function failVerification(verificationId, tripId, reason) {
  console.error(`[worker] Failing verification ${verificationId}: ${reason}`);
  await adminClient
    .from("verification_results")
    .update({
      status: "error",
      explanation: reason,
      processing_completed_at: new Date().toISOString(),
    })
    .eq("id", verificationId);

  await adminClient.from("audit_logs").insert({
    actor_id: null,
    action: "verification_completed",
    entity_type: "verification_results",
    entity_id: verificationId,
    trip_id: tripId,
    metadata: { status: "error", reason },
  });
}

// ------------------------------------
// Polling loop
// ------------------------------------
async function pollAndProcess() {
  try {
    // Fetch up to 5 pending verifications (oldest first, avoid thundering herd)
    const { data: pending, error } = await adminClient
      .from("verification_results")
      .select("id, trip_id, evidence_id, expected_plate")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);

    if (error) {
      console.error("[worker] Poll error:", error.message);
      return;
    }

    if (!pending || pending.length === 0) return;

    console.log(`[worker] Found ${pending.length} pending verification(s)`);

    // Process sequentially to avoid overloading the CV API
    for (const verification of pending) {
      await processVerification(verification);
    }
  } catch (err) {
    console.error("[worker] Unhandled error in poll loop:", err);
  }
}

// ------------------------------------
// Startup
// ------------------------------------
console.log(`
╔══════════════════════════════════════════════╗
║   GrainShield AI — Verification Worker       ║
║   CV Provider : ${(CV_PROVIDER + "                    ").slice(0, 26)}║
║   Poll Interval: ${(POLL_INTERVAL_MS + "ms                   ").slice(0, 25)}║
╚══════════════════════════════════════════════╝
`);

if (CV_PROVIDER === "mock") {
  console.warn(
    "[worker] ⚠️  Running with mock CV provider. " +
      "Set CV_PROVIDER=http, CV_API_URL, and CV_API_KEY to enable real verification.\n",
  );
}

// Run once immediately, then on interval
await pollAndProcess();
setInterval(() => void pollAndProcess(), POLL_INTERVAL_MS);

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM received. Shutting down.");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[worker] SIGINT received. Shutting down.");
  process.exit(0);
});
