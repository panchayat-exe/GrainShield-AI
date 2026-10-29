/**
 * Integration Test: Worker to Python CV Inference Service
 * Tests callHttpProvider and validateCVResponse against the live service at http://127.0.0.1:8000/verify
 */

import { readFile } from "fs/promises";
import { join } from "path";

const CV_API_URL = "http://127.0.0.1:8000/verify";
const TEST_IMAGE_PATH = join(
  "..",
  "ai-model",
  "datasets",
  "Indian License Plate Detection.v1i.yolov8",
  "test",
  "images",
  "drop-car-front_1032_jpg.rf.99da9c0cca2a81fab7e32cad6fee2a2a.jpg"
);

function validateCVResponse(data) {
  if (!data || typeof data !== "object") {
    return { isValid: false, error: "Response is not a valid JSON object" };
  }

  const validDecisions = ["pass", "retake", "manual_review", "error"];
  const decision = typeof data.decision === "string" ? data.decision.toLowerCase() : null;

  if (!decision || !validDecisions.includes(decision)) {
    return { isValid: false, error: `Invalid or missing decision: "${data.decision}"` };
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

async function runWorkerIntegrationTest() {
  console.log("Reading test evidence photograph from:", TEST_IMAGE_PATH);
  const imageBuffer = await readFile(TEST_IMAGE_PATH);
  console.log(`Read ${imageBuffer.length} bytes.`);

  // Test 1: Health check
  console.log("\n[TEST 1] Testing Health Endpoint...");
  const healthRes = await fetch("http://127.0.0.1:8000/health");
  if (!healthRes.ok) throw new Error(`Health check failed with ${healthRes.status}`);
  const healthData = await healthRes.json();
  console.log("✓ Health Check Passed:", healthData);

  // Test 2: Matching plate verification
  console.log("\n[TEST 2] Verifying matching plate KA03HN3397 (First Mile)...");
  const form1 = new FormData();
  form1.append("image", new Blob([imageBuffer], { type: "image/jpeg" }), "evidence.jpg");
  form1.append("expected_plate", "KA03HN3397");
  form1.append("stage", "first_mile");

  const res1 = await fetch(CV_API_URL, { method: "POST", body: form1 });
  if (!res1.ok) throw new Error(`HTTP ${res1.status}: ${await res1.text()}`);
  const data1 = await res1.json();
  const val1 = validateCVResponse(data1);
  if (!val1.isValid) throw new Error(`Validation failed: ${val1.error}`);

  console.log("✓ Result 1 validated successfully:");
  console.log("  decision:", val1.result.decision);
  console.log("  detectedPlate:", val1.result.detectedPlate);
  console.log("  plateMatch:", val1.result.plateMatch);
  console.log("  confidence:", val1.result.confidence);
  console.log("  quality:", val1.result.imageQuality);
  console.log("  explanation:", val1.result.explanation);

  if (val1.result.decision !== "pass" || !val1.result.plateMatch) {
    throw new Error(`Expected pass with plateMatch=true, got ${val1.result.decision}`);
  }

  // Test 3: Mismatched plate verification
  console.log("\n[TEST 3] Verifying mismatched plate GJ01ZZ9999...");
  const form2 = new FormData();
  form2.append("image", new Blob([imageBuffer], { type: "image/jpeg" }), "evidence.jpg");
  form2.append("expected_plate", "GJ01ZZ9999");
  form2.append("stage", "first_mile");

  const res2 = await fetch(CV_API_URL, { method: "POST", body: form2 });
  const data2 = await res2.json();
  const val2 = validateCVResponse(data2);
  if (!val2.isValid) throw new Error(`Validation failed: ${val2.error}`);

  console.log("✓ Result 2 validated successfully:");
  console.log("  decision:", val2.result.decision);
  console.log("  plateMatch:", val2.result.plateMatch);
  console.log("  explanation:", val2.result.explanation);

  if (val2.result.decision !== "manual_review" || val2.result.plateMatch !== false) {
    throw new Error(`Expected manual_review with plateMatch=false, got ${val2.result.decision}`);
  }

  console.log("\n=======================================================");
  console.log("✓ ALL WORKER-TO-SERVICE INTEGRATION TESTS PASSED!");
  console.log("=======================================================\n");
}

runWorkerIntegrationTest().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
