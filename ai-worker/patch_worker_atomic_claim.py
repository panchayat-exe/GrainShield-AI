
from pathlib import Path
import shutil

worker_path = Path("ai-worker/src/worker.js")

if not worker_path.exists():
    raise SystemExit(f"Worker file not found: {worker_path}")

source = worker_path.read_text(encoding="utf-8")

old_poll = '''async function pollAndProcess() {
  try {
    // Fetch up to 5 pending verifications (oldest first, avoid thundering herd)
    const { data: pending, error } = await adminClient
      .from("verification_results")
      .select("id, trip_id, evidence_id")
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
}'''

new_poll = '''// Each process gets its own identity for atomic job ownership.
const WORKER_ID =
  process.env.WORKER_ID ||
  `grainshield-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const MAX_JOBS_PER_POLL = 5;
let pollInProgress = false;

async function pollAndProcess() {
  // Prevent overlapping polling cycles within this process.
  if (pollInProgress) return;

  pollInProgress = true;

  try {
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
}'''

replacements = [
    (
        '''  // Mark as processing (prevent double-pickup)
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
  }''',
        '''  // The atomic claim_pending_verification RPC has already changed
  // this job to processing and assigned it to this worker.''',
    ),
    (
        '''      processing_completed_at: now,
      raw_output: cvResult.rawOutput ?? null,
    })
    .eq("id", id);''',
        '''      processing_completed_at: now,
      failed_at: verStatus === "error" ? now : null,
      failure_reason:
        verStatus === "error"
          ? (cvResult.error ?? cvResult.explanation ?? "CV provider error")
          : null,
      raw_output: cvResult.rawOutput ?? null,
    })
    .eq("id", id)
    .eq("claimed_by", WORKER_ID);''',
    ),
    (
        '''    .update({
      status: "error",
      explanation: reason,
      processing_completed_at: new Date().toISOString(),
    })
    .eq("id", verificationId);''',
        '''    .update({
      status: "error",
      explanation: reason,
      failure_reason: reason,
      failed_at: new Date().toISOString(),
      processing_completed_at: new Date().toISOString(),
    })
    .eq("id", verificationId)
    .eq("claimed_by", WORKER_ID);''',
    ),
    (old_poll, new_poll),
]

# Verify all expected code blocks before modifying the file.
for index, (old, new) in enumerate(replacements, start=1):
    count = source.count(old)
    if count != 1:
        raise SystemExit(
            f"PATCH ABORTED: section {index} matched {count} times; "
            "expected exactly once. No worker changes were written."
        )

backup_path = worker_path.with_name("worker.js.before_atomic_claim.bak")
shutil.copy2(worker_path, backup_path)

for old, new in replacements:
    source = source.replace(old, new, 1)

worker_path.write_text(source, encoding="utf-8")

print("SUCCESS: Atomic worker-claim patch applied.")
print(f"Backup: {backup_path}")
print("Updated:")
print("- Uses claim_pending_verification RPC.")
print("- Processes jobs sequentially, up to five per polling cycle.")
print("- Prevents overlapping polling cycles in the same process.")
print("- Removes the redundant pending-to-processing update.")
print("- Checks claimed_by before updating verification records.")
print("- Records failure_reason and failed_at.")
