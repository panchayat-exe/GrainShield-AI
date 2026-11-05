from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/ai-worker/src/worker.js")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# ── 1. Add insertFailedJob() helper right before failVerification ──
INSERT_HELPER = '''
// ------------------------------------
// Dead-Letter Queue helper
// ------------------------------------
/**
 * Inserts a failed-job record into public.failed_jobs (DLQ).
 * Uses service-role key so it always succeeds regardless of RLS.
 */
async function insertFailedJob({ verificationId, tripId, errorMessage, jobStage = "unknown" }) {
  const { error } = await adminClient.from("failed_jobs").insert({
    verification_id: verificationId ?? null,
    trip_id: tripId ?? null,
    error_message: errorMessage,
    worker_id: WORKER_ID,
    job_stage: jobStage,
  });
  if (error) {
    console.error("[worker] Could not write to failed_jobs DLQ:", error.message);
  } else {
    console.log(`[worker] ⚠ Dead-letter record created for verification ${verificationId}`);
  }
}

'''

FAIL_MARKER = "async function failVerification("
if "insertFailedJob" not in text:
    idx = text.find(FAIL_MARKER)
    text = text[:idx] + INSERT_HELPER + text[idx:]
    print("✓ Added insertFailedJob() DLQ helper")
else:
    print("✓ insertFailedJob already present")

# ── 2. Wire DLQ into failVerification — insert after audit log ──
OLD_FAIL_END = '''  await adminClient.from("audit_logs").insert({
    actor_id: null,
    action: "verification_completed",
    entity_type: "verification_results",
    entity_id: verificationId,
    trip_id: tripId,
    metadata: { status: "error", reason },
  });
}'''

NEW_FAIL_END = '''  await adminClient.from("audit_logs").insert({
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
}'''

if "dead-letter queue for operator" not in text:
    if OLD_FAIL_END in text:
        text = text.replace(OLD_FAIL_END, NEW_FAIL_END)
        print("✓ Wired DLQ into failVerification")
    else:
        print("⚠ failVerification end pattern not found exactly")
else:
    print("✓ DLQ already wired into failVerification")

# ── 3. Add stall recovery to pollAndProcess (before the main claim loop) ──
OLD_POLL_START = '''  try {
    let claimedCount = 0;

    // The RPC atomically claims one pending job per call.
    for (let i = 0; i < MAX_JOBS_PER_POLL; i++) {'''

NEW_POLL_START = '''  try {
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
    for (let i = 0; i < MAX_JOBS_PER_POLL; i++) {'''

if "Stall recovery" not in text:
    if OLD_POLL_START in text:
        text = text.replace(OLD_POLL_START, NEW_POLL_START)
        print("✓ Added stall recovery to pollAndProcess")
    else:
        print("⚠ poll loop start pattern not found exactly")
else:
    print("✓ Stall recovery already present")

# Write back
FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print(f"\n✅ worker.js patched ({len(text)} chars)")
