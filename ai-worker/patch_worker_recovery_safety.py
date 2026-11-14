
from pathlib import Path
import shutil

path = Path("ai-worker/src/worker.js")
source = path.read_text(encoding="utf-8")

# Replace the successful verification update with an ownership-confirmed update.
old_success = '''  const { error: updateError } = await adminClient
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
    })
    .eq("id", id)
    .eq("claimed_by", WORKER_ID);

  if (updateError) {
    console.error(`[worker] Failed to update verification ${id}:`, updateError.message);
    return;
  }'''

new_success = '''  const { data: updatedVerification, error: updateError } = await adminClient
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
  }'''

# Replace the failure handler so it also confirms ownership before auditing.
old_failure = '''async function failVerification(verificationId, tripId, reason) {
  console.error(`[worker] Failing verification ${verificationId}: ${reason}`);
  await adminClient
    .from("verification_results")
    .update({
      status: "error",
      explanation: reason,
      failure_reason: reason,
      failed_at: new Date().toISOString(),
      processing_completed_at: new Date().toISOString(),
    })
    .eq("id", verificationId)
    .eq("claimed_by", WORKER_ID);

  await adminClient.from("audit_logs").insert({
    actor_id: null,
    action: "verification_completed",
    entity_type: "verification_results",
    entity_id: verificationId,
    trip_id: tripId,
    metadata: { status: "error", reason },
  });
}'''

new_failure = '''async function failVerification(verificationId, tripId, reason) {
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
}'''

for name, old, new in [
    ("successful update", old_success, new_success),
    ("failure handler", old_failure, new_failure),
]:
    if source.count(old) != 1:
        raise SystemExit(
            f"PATCH ABORTED: {name} matched {source.count(old)} times; expected exactly once."
        )

backup = path.with_name("worker.js.before_recovery_safety.bak")
shutil.copy2(path, backup)

source = source.replace(old_success, new_success, 1)
source = source.replace(old_failure, new_failure, 1)
path.write_text(source, encoding="utf-8")

print("SUCCESS: Worker ownership safeguards applied.")
print(f"Backup: {backup}")
