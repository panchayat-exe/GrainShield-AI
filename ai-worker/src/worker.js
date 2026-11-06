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
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ------------------------------------
// Config from environment
// ------------------------------------
// Resolve ai-worker directory and load local .env if not already loaded via CLI
const __dirname = dirname(fileURLToPath(import.meta.url));
const localEnvPath = join(__dirname, "..", ".env");
if (typeof process.loadEnvFile === "function" && existsSync(localEnvPath) && !process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile(localEnvPath);
  } catch {
    // Ignore if already loaded or on syntax warning
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const CV_PROVIDER = process.env.CV_PROVIDER ?? "mock";
const CV_API_URL = process.env.CV_API_URL ?? "";
const CV_API_KEY = process.env.CV_API_KEY ?? "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "15000");
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? "3");
const PROCESSING_TIMEOUT_MS = Number(process.env.PROCESSING_TIMEOUT_MS ?? "90000");
const WORKER_ID = "worker-" + process.pid + "-" + Date.now();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[worker] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in ai-worker/.env",
  );
  process.exit(1);
}

if (
  SUPABASE_SERVICE_ROLE_KEY.includes("YOUR_SERVICE_ROLE_KEY") ||
  SUPABASE_SERVICE_ROLE_KEY.includes("placeholder")
) {
  console.error(
    "[worker] FATAL: SUPABASE_SERVICE_ROLE_KEY is still set to the placeholder string.\n" +
      "The worker cannot authenticate until you set your real service_role secret key in ai-worker/.env.\n" +
      "Get it from: Supabase Dashboard → Settings → API → Project API Keys → service_role (secret)",
  );
  process.exit(1);
}

if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) {
  console.error(
    "[worker] FATAL: SUPABASE_SERVICE_ROLE_KEY contains a publishable/anon key (starts with 'sb_publishable_').\n" +
      "The worker requires the server-side 'service_role' secret key to bypass RLS and process verification jobs.\n" +
      "Get it from: Supabase Dashboard → Settings → API → Project API Keys → service_role (secret)",
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
 * @property {string} decision - 'pass'|'fail'|'retake'|'manual_review'|'error'
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
 * Validates the response schema from the CV API before applying predictions.
 */
function validateCVResponse(data) {
  if (!data || typeof data !== "object") {
    return {
      isValid: false,
      error: "Response is not a valid JSON object",
    };
  }

  const validDecisions = ["pass", "fail", "retake", "manual_review", "error"];
  const decision = typeof data.decision === "string" ? data.decision.toLowerCase() : null;

  if (!decision || !validDecisions.includes(decision)) {
    return {
      isValid: false,
      error: `Invalid or missing decision: "${data.decision}"`,
    };
  }

  return {
    isValid: true,
    result: {
      success: Boolean(data.success),
      imageQuality: typeof data.imageQuality === "string" ? data.imageQuality : null,
      vehicleDetected: typeof data.vehicleDetected === "boolean" ? data.vehicleDetected : null,
      detectedPlate: typeof data.detectedPlate === "string" ? data.detectedPlate : null,
      plateMatch: typeof data.plateMatch === "boolean" ? data.plateMatch : null,
      vehicleType: typeof data.vehicleType === "string" ? data.vehicleType : null,
      confidence: typeof data.confidence === "number" ? Math.max(0, Math.min(1, data.confidence)) : null,
      decision,
      explanation: typeof data.explanation === "string" ? data.explanation : "Verification completed.",
      processorVersion: typeof data.processorVersion === "string" ? data.processorVersion : "grainshield-worker-v1",
      evidenceChecks: (data.evidenceChecks && typeof data.evidenceChecks === "object") ? data.evidenceChecks : null,
      rawOutput: (data.rawOutput && typeof data.rawOutput === "object") ? data.rawOutput : null,
      error: typeof data.error === "string" ? data.error : null,
    },
  };
}

/**
 * Real HTTP CV provider — calls the Python inference service endpoint.
 * The API accepts multipart/form-data with fields: image, expected_plate, stage.
 * It returns structured JSON adhering to the CVResult shape.
 */
async function callHttpProvider(imageBuffer, expectedPlate, stage) {
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: "image/jpeg" });
  formData.append("image", blob, "evidence.jpg");
  formData.append("expected_plate", expectedPlate ?? "");
  if (stage) {
    formData.append("stage", stage);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PROCESSING_TIMEOUT_MS,
  );

  try {
    const headers = {};
    if (CV_API_KEY) {
      headers["Authorization"] = `Bearer ${CV_API_KEY}`;
    }

    const response = await fetch(CV_API_URL, {
      method: "POST",
      headers,
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      return {
        success: false,
        imageQuality: null,
        vehicleDetected: null,
        detectedPlate: null,
        plateMatch: null,
        vehicleType: null,
        confidence: null,
        decision: "manual_review",
        explanation: `CV API returned HTTP ${response.status}: ${errBody.slice(0, 100)}`,
        processorVersion: "http-provider",
        evidenceChecks: null,
        rawOutput: null,
        error: `HTTP ${response.status}`,
      };
    }

    const json = await response.json();
    const validation = validateCVResponse(json);
    if (!validation.isValid) {
      console.warn(`[worker] CV response schema validation failed: ${validation.error}`);
      return {
        success: false,
        imageQuality: null,
        vehicleDetected: null,
        detectedPlate: null,
        plateMatch: null,
        vehicleType: null,
        confidence: null,
        decision: "manual_review",
        explanation: `CV API returned invalid schema: ${validation.error}. Routed to manual review.`,
        processorVersion: "http-provider",
        evidenceChecks: null,
        rawOutput: json,
        error: validation.error,
      };
    }

    return validation.result;
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      imageQuality: null,
      vehicleDetected: null,
      detectedPlate: null,
      plateMatch: null,
      vehicleType: null,
      confidence: null,
      decision: "error",
      explanation: `CV API call failed: ${msg}`,
      processorVersion: "http-provider",
      evidenceChecks: null,
      rawOutput: null,
      error: msg,
    };
  }
}

async function callCVProvider(imageBuffer, expectedPlate, stage) {
  if (CV_PROVIDER === "mock" || !CV_API_URL) {
    return callMockProvider(imageBuffer, expectedPlate);
  }
  return callHttpProvider(imageBuffer, expectedPlate, stage);
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
  const { id, trip_id, evidence_id } = verification;
  console.log(`[worker] Processing verification ${id} for trip ${trip_id}`);

  // The atomic claim_pending_verification RPC has already changed
  // this job to processing and assigned it to this worker.

  // Fetch parent trip to obtain the actual assigned vehicle number and stage
  const { data: tripRow, error: tripErr } = await adminClient
    .from("trips")
    .select("vehicle_number, stage, status")
    .eq("id", trip_id)
    .single();

  if (tripErr || !tripRow) {
    const reason = tripErr?.message || "Trip record not found.";
    await failVerification(
      id,
      trip_id,
      `Cannot verify without the authoritative trip record: ${reason}`,
    );
    return;
  }

  const targetPlate =
    typeof tripRow.vehicle_number === "string"
      ? tripRow.vehicle_number.trim()
      : "";

  if (!targetPlate) {
    await failVerification(
      id,
      trip_id,
      "Trip has no assigned vehicle registration; refusing client-supplied fallback.",
    );
    return;
  }

  // Fetch evidence record (storage path and stage)
  const { data: evidenceRow, error: evErr } = await adminClient
    .from("trip_evidence")
    .select("storage_path, mime_type, stage")
    .eq("id", evidence_id)
    .single();

  if (evErr || !evidenceRow) {
    await failVerification(id, trip_id, "Evidence record not found.");
    return;
  }

  // Use the actual assigned vehicle number as primary comparison source
  const stage = tripRow.stage || evidenceRow.stage || null;

  // Download image
  const imageBuffer = await downloadEvidence(evidenceRow.storage_path);
  if (!imageBuffer) {
    await failVerification(id, trip_id, "Failed to download evidence image.");
    return;
  }

  // Call CV provider with actual image, assigned plate, and stage
  let cvResult;
  try {
    cvResult = await callCVProvider(imageBuffer, targetPlate, stage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failVerification(id, trip_id, `CV provider threw an exception: ${msg}`);
    return;
  }

  const now = new Date().toISOString();

  // Map decision to verification_status
  const verStatusByDecision = {
    pass: "pass",
    fail: "fail",
    retake: "retake",
    manual_review: "manual_review",
    error: "error",
  };

  const verStatus = verStatusByDecision[cvResult.decision] ?? "error";

  // Update verification record
  const { data: updatedVerification, error: updateError } = await adminClient
    .from("verification_results")
    .update({
      status: verStatus,
      image_quality: cvResult.imageQuality ?? null,
      vehicle_detected: cvResult.vehicleDetected ?? null,
      expected_plate: targetPlate || null,
      detected_plate: cvResult.detectedPlate ?? null,
      plate_match: cvResult.plateMatch ?? null,
      vehicle_type: cvResult.vehicleType ?? null,
      evidence_checks: cvResult.evidenceChecks ?? null,
      confidence: cvResult.confidence ?? null,
      decision: cvResult.decision,
      explanation: cvResult.explanation,
      processor_version: cvResult.processorVersion,
      processing_completed_at: now,
      failed_at: verStatus === "error" ? now : null,
      failure_reason:
        verStatus === "error"
          ? (cvResult.error ?? cvResult.explanation ?? "CV provider error")
          : null,
      raw_output: cvResult.rawOutput ?? null,
      claimed_by: null,
      claimed_at: null,
    })
    .eq("id", id)
    .eq("claimed_by", WORKER_ID)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error(`[worker] Failed to update verification ${id}:`, updateError.message);
    return;
  }

  if (!updatedVerification) {
    console.warn(`[worker] Job ${id} is no longer owned by ${WORKER_ID}; skipping trip update and audit.`);
    return;
  }

  // A confirmed verification failure rejects the trip.
  // Technical errors do not automatically change the trip status.
  const tripStatus = verStatus === "fail" ? "rejected" : verStatus;

  if (["pass", "fail", "retake", "manual_review"].includes(verStatus)) {
    // Only update if trip is still open (submitted/processing).
    // Prevents delayed AI worker from silently overwriting an officer's manual review decision.
    const { error: tripUpdateError } = await adminClient
      .from("trips")
      .update({ status: tripStatus })
      .eq("id", trip_id)
      .in("status", ["submitted", "processing"]);

    if (tripUpdateError) {
      console.error(
        `[worker] Failed to update trip ${trip_id}:`,
        tripUpdateError.message,
      );
    }
  }

  // When AI routes to manual_review, create a manual_review_requests row
  // so officers can see and act on it in the admin dashboard.
  // Idempotent: check for existing row first to avoid duplicates on retries.
  if (verStatus === "manual_review") {
    // Check if a review request already exists for this evidence
    const { data: existingReview } = await adminClient
      .from("manual_review_requests")
      .select("id")
      .eq("trip_id", trip_id)
      .eq("evidence_id", evidence_id)
      .maybeSingle();

    if (!existingReview) {
      // requested_by must reference auth.users — use the trip owner as requester
      const { data: tripOwner } = await adminClient
        .from("trips")
        .select("created_by")
        .eq("id", trip_id)
        .maybeSingle();

      const requestedBy = tripOwner?.created_by ?? null;

      if (requestedBy) {
        const { error: reviewInsertError } = await adminClient
          .from("manual_review_requests")
          .insert({
            trip_id,
            evidence_id,
            requested_by: requestedBy,
            user_notes: cvResult.explanation
              ? `AI flagged: ${cvResult.explanation}`
              : "AI could not automatically verify this trip. Manual officer review required.",
            status: "pending",
          });

        if (reviewInsertError) {
          // Non-fatal: log and continue — trip is still in manual_review status
          console.warn(
            `[worker] Could not create manual_review_requests for trip ${trip_id}:`,
            reviewInsertError.message,
          );
        } else {
          console.log(`[worker] Manual review request created for trip ${trip_id}`);
          // Notify citizen: insert audit_log so useNotifications hook fires in citizen web app
          await adminClient.from("audit_logs").insert({
            actor_id: null,
            action: "manual_review_requested",
            entity_type: "manual_review_requests",
            trip_id,
            metadata: {
              reason: cvResult.explanation ?? "AI could not automatically verify this trip.",
              citizen_id: requestedBy,
            },
          }).then(({ error: auditErr }) => {
            if (auditErr) {
              console.warn("[worker] Could not write manual_review_requested audit log:", auditErr.message);
            }
          });
        }
      } else {
        console.warn(`[worker] Trip ${trip_id} has no created_by — skipping review request insert`);
      }
    } else {
      console.log(`[worker] Manual review request already exists for trip ${trip_id} / evidence ${evidence_id}`);
    }
  }

  // Write comprehensive audit log
  await adminClient.from("audit_logs").insert({
    actor_id: null, // system actor
    action: "verification_completed",
    entity_type: "verification_results",
    entity_id: id,
    trip_id,
    metadata: {
      status: verStatus,
      decision: cvResult.decision,
      stage,
      expected_plate: targetPlate,
      detected_plate: cvResult.detectedPlate ?? null,
      plate_match: cvResult.plateMatch ?? null,
      confidence: cvResult.confidence ?? null,
      processor_version: cvResult.processorVersion,
    },
  });

  console.log(
    `[worker] ✓ Verification ${id} completed: ${verStatus} (${cvResult.decision})`,
  );
}


// ------------------------------------
// Dead-Letter Queue helper
// ------------------------------------
/**
 * Inserts a failed-job record into public.failed_jobs (DLQ).
 * Uses service-role key so it always succeeds regardless of RLS.
 */
async function insertFailedJob({ verificationId, tripId, errorMessage, jobStage = "unknown" }) {
  // Check if an unresolved DLQ record already exists for this verification
  const { data: existing } = await adminClient
    .from("failed_jobs")
    .select("id, retry_count")
    .eq("verification_id", verificationId)
    .is("resolved_at", null)
    .maybeSingle();

  if (existing) {
    // Increment retry_count on the existing unresolved record
    const newRetryCount = (existing.retry_count ?? 0) + 1;
    const { error } = await adminClient
      .from("failed_jobs")
      .update({
        retry_count: newRetryCount,
        last_retry_at: new Date().toISOString(),
        error_message: errorMessage,
        worker_id: WORKER_ID,
        job_stage: jobStage,
      })
      .eq("id", existing.id);
    if (error) {
      console.error("[worker] Could not update failed_jobs DLQ retry_count:", error.message);
    } else {
      console.log(`[worker] DLQ retry_count=${newRetryCount} for verification ${verificationId}`);
    }
  } else {
    // First failure for this verification -- insert new DLQ record
    const { error } = await adminClient.from("failed_jobs").insert({
      verification_id: verificationId ?? null,
      trip_id: tripId ?? null,
      error_message: errorMessage,
      worker_id: WORKER_ID,
      job_stage: jobStage,
      retry_count: 0,
    });
    if (error) {
      console.error("[worker] Could not write to failed_jobs DLQ:", error.message);
    } else {
      console.log(`[worker] Dead-letter record created for verification ${verificationId}`);
    }
  }
}

async function failVerification(verificationId, tripId, reason) {
  console.error(`[worker] Failing verification ${verificationId}: ${reason}`);
  const now = new Date().toISOString();

  const { data: failedVerification, error: failureUpdateError } =
    await adminClient
      .from("verification_results")
      .update({
        status: "error",
        explanation: reason,
        failure_reason: reason,
        failed_at: now,
        processing_completed_at: now,
        claimed_by: null,
        claimed_at: null,
      })
      .eq("id", verificationId)
      .eq("claimed_by", WORKER_ID)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();

  if (failureUpdateError) {
    console.error("[worker] Could not record failure:", failureUpdateError.message);
    return;
  }

  if (!failedVerification) {
    console.warn(`[worker] Failure update skipped; worker no longer owns ${verificationId}.`);
    return;
  }

  await adminClient.from("audit_logs").insert({
    actor_id: null,
    action: "verification_completed",
    entity_type: "verification_results",
    entity_id: verificationId,
    trip_id: tripId,
    metadata: { status: "error", reason },
  });

  // Write to dead-letter queue for operator visibility
  await insertFailedJob({
    verificationId,
    tripId,
    errorMessage: reason,
    jobStage: "processing",
  });
}

// ------------------------------------
// Polling loop
// ------------------------------------
const MAX_JOBS_PER_POLL = 5;
let pollInProgress = false;

async function pollAndProcess() {
  // Prevent overlapping polling cycles within this process.
  if (pollInProgress) return;

  pollInProgress = true;

  try {
    // ── Stall recovery: mark jobs stuck in 'processing' for > PROCESSING_TIMEOUT_MS ──
    const stallCutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS).toISOString();
    const { data: stalledJobs } = await adminClient
      .from("verification_results")
      .select("id, trip_id")
      .eq("status", "processing")
      .lt("claimed_at", stallCutoff);

    if (stalledJobs?.length) {
      console.warn(`[worker] Found ${stalledJobs.length} stalled job(s) — marking as error`);
      for (const stalled of stalledJobs) {
        const stallReason = `Job stalled in 'processing' for >${PROCESSING_TIMEOUT_MS}ms without completion`;
        await adminClient
          .from("verification_results")
          .update({
            status: "error",
            explanation: stallReason,
            failure_reason: stallReason,
            processing_completed_at: new Date().toISOString(),
            claimed_by: null,
            claimed_at: null,
          })
          .eq("id", stalled.id)
          .eq("status", "processing");

        await insertFailedJob({
          verificationId: stalled.id,
          tripId: stalled.trip_id,
          errorMessage: stallReason,
          jobStage: "stall_recovery",
        });
      }
    }

    let claimedCount = 0;

    // The RPC atomically claims one pending job per call.
    for (let i = 0; i < MAX_JOBS_PER_POLL; i++) {
      const { data: claimedJobs, error } = await adminClient.rpc(
        "claim_pending_verification",
        { p_worker_id: WORKER_ID },
      );

      if (error) {
        console.error("[worker] Atomic claim RPC failed:", error.message);
        return;
      }

      if (!Array.isArray(claimedJobs)) {
        console.error("[worker] Unexpected response from claim RPC.");
        return;
      }

      if (claimedJobs.length === 0) {
        break;
      }

      const verification = claimedJobs[0];

      if (!verification?.id || !verification?.trip_id || !verification?.evidence_id) {
        console.error("[worker] Claim RPC returned an incomplete job.");
        return;
      }

      claimedCount++;

      console.log(
        `[worker] Claimed job ${verification.id} for trip ${verification.trip_id} as ${WORKER_ID}`,
      );

      try {
        await processVerification(verification);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);

        console.error(
          `[worker] Unexpected processing error for ${verification.id}:`,
          reason,
        );

        try {
          await failVerification(
            verification.id,
            verification.trip_id,
            reason,
          );
        } catch (failureErr) {
          console.error(
            "[worker] Could not record processing failure:",
            failureErr instanceof Error ? failureErr.message : String(failureErr),
          );
        }
      }
    }

    if (claimedCount > 0) {
      console.log(`[worker] Poll cycle claimed ${claimedCount} job(s).`);
    }
  } catch (err) {
    console.error("[worker] Unhandled error in poll loop:", err);
  } finally {
    pollInProgress = false;
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
