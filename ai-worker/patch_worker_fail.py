
from pathlib import Path
import shutil

worker_path = Path("ai-worker/src/worker.js")

if not worker_path.exists():
    raise SystemExit(f"Worker file not found: {worker_path}")

source = worker_path.read_text(encoding="utf-8")

replacements = [
    (
        'const validDecisions = ["pass", "retake", "manual_review", "error"];',
        'const validDecisions = ["pass", "fail", "retake", "manual_review", "error"];',
    ),
    (
        'const { id, trip_id, evidence_id, expected_plate } = verification;',
        'const { id, trip_id, evidence_id } = verification;',
    ),
    (
        """  if (tripErr) {
    console.warn(`[worker] Could not fetch trip ${trip_id}:`, tripErr.message);
  }""",
        """  if (tripErr || !tripRow) {
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
  }""",
    ),
    (
        """  const targetPlate = tripRow?.vehicle_number || expected_plate || "";
  const stage = tripRow?.stage || evidenceRow?.stage || null;""",
        """  const stage = tripRow.stage || evidenceRow.stage || null;""",
    ),
    (
        """  const verStatus =
    cvResult.decision === "pass"
      ? "pass"
      : cvResult.decision === "retake"
        ? "retake"
        : cvResult.decision === "manual_review"
          ? "manual_review"
          : "error";""",
        """  const verStatusByDecision = {
    pass: "pass",
    fail: "fail",
    retake: "retake",
    manual_review: "manual_review",
    error: "error",
  };

  const verStatus = verStatusByDecision[cvResult.decision] ?? "error";""",
    ),
    (
        """  // Update trip status on verified outcomes
  if (["pass", "retake", "manual_review"].includes(verStatus)) {
    await adminClient
      .from("trips")
      .update({ status: verStatus })
      .eq("id", trip_id);
  }""",
        """  // A confirmed verification failure rejects the trip.
  // Technical errors do not automatically change the trip status.
  const tripStatus = verStatus === "fail" ? "rejected" : verStatus;

  if (["pass", "fail", "retake", "manual_review"].includes(verStatus)) {
    const { error: tripUpdateError } = await adminClient
      .from("trips")
      .update({ status: tripStatus })
      .eq("id", trip_id);

    if (tripUpdateError) {
      console.error(
        `[worker] Failed to update trip ${trip_id}:`,
        tripUpdateError.message,
      );
    }
  }""",
    ),
    (
        '.select("id, trip_id, evidence_id, expected_plate")',
        '.select("id, trip_id, evidence_id")',
    ),
    (
        "* @property {string} decision - 'pass'|'retake'|'manual_review'|'error'",
        "* @property {string} decision - 'pass'|'fail'|'retake'|'manual_review'|'error'",
    ),
]

# Validate every expected code block before modifying anything.
for index, (old, new) in enumerate(replacements, start=1):
    count = source.count(old)
    if count != 1:
        raise SystemExit(
            f"PATCH ABORTED: replacement {index} matched {count} times; "
            "expected exactly once. No changes were written."
        )

# Keep a backup before applying changes.
backup_path = worker_path.with_name("worker.js.before_fail_mapping.bak")
shutil.copy2(worker_path, backup_path)

for old, new in replacements:
    source = source.replace(old, new, 1)

worker_path.write_text(source, encoding="utf-8")

print("Worker patch applied successfully.")
print(f"Backup created: {backup_path}")
print("Changes:")
print("- Added fail to accepted CV decisions.")
print("- Removed untrusted expected_plate fallback.")
print("- Added authoritative trip and assigned-plate checks.")
print("- Mapped fail to verification status fail.")
print("- Mapped failed trips to rejected.")
print("- Removed expected_plate from the worker polling query.")
