
/**
 * Integration Test: Python CV Inference Service
 * Run from the ai-worker directory using: npm test
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CV_API_URL = "http://127.0.0.1:8000/verify";
const HEALTH_URL = "http://127.0.0.1:8000/health";

// This path is relative to the ai-worker working directory.
const TEST_IMAGE_PATH = resolve("..", "ai-model", "test_images", "1.jpeg");

const VALID_DECISIONS = [
  "pass",
  "fail",
  "retake",
  "manual_review",
  "error",
];

function validateCVResponse(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Response is not a valid JSON object");
  }

  const decision =
    typeof data.decision === "string"
      ? data.decision.toLowerCase()
      : null;

  if (!VALID_DECISIONS.includes(decision)) {
    throw new Error(`Invalid decision returned: ${data.decision}`);
  }

  return {
    decision,
    detectedPlate:
      typeof data.detectedPlate === "string" ? data.detectedPlate : null,
    plateMatch:
      typeof data.plateMatch === "boolean" ? data.plateMatch : null,
    explanation:
      typeof data.explanation === "string"
        ? data.explanation
        : "No explanation returned",
  };
}

async function verifyImage(imageBuffer, expectedPlate) {
  const form = new FormData();

  form.append(
    "image",
    new Blob([imageBuffer], { type: "image/jpeg" }),
    "evidence.jpg"
  );

  form.append("expected_plate", expectedPlate);
  form.append("stage", "first_mile");

  if (!process.env.CV_API_KEY) {
  throw new Error("CV_API_KEY is missing from ai-worker/.env");
}

const response = await fetch(CV_API_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.CV_API_KEY}`,
  },
  body: form,
});

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `CV service returned HTTP ${response.status}: ${responseText}`
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error("CV service returned invalid JSON");
  }

  return validateCVResponse(data);
}

async function runIntegrationTests() {
  console.log("============================================");
  console.log(" GRAINSHIELD AI - CV SERVICE INTEGRATION TEST");
  console.log("============================================");

  console.log("\n[SETUP] Reading test image:");
  console.log(TEST_IMAGE_PATH);

  const imageBuffer = await readFile(TEST_IMAGE_PATH);
  console.log(`Image loaded: ${imageBuffer.length} bytes`);

  // Test 1: Health endpoint
  console.log("\n[TEST 1] CV service health check");

  const healthResponse = await fetch(HEALTH_URL);

  if (!healthResponse.ok) {
    throw new Error(`Health check failed: HTTP ${healthResponse.status}`);
  }

  console.log("PASS: CV service is responding");

  // Test 2: Correct assigned registration
  console.log("\n[TEST 2] Correct registration: GJ09KX3567");

  const correct = await verifyImage(imageBuffer, "GJ09KX3567");

  console.log("Decision:", correct.decision);
  console.log("Detected plate:", correct.detectedPlate);
  console.log("Plate match:", correct.plateMatch);
  console.log("Explanation:", correct.explanation);

  if (correct.detectedPlate !== "GJ09KX3567") {
    throw new Error(
      `Expected detected plate GJ09KX3567, got ${correct.detectedPlate}`
    );
  }

  if (correct.plateMatch !== true) {
    throw new Error("Correct registration was not matched");
  }

  // This sample currently has low OCR consensus, so manual review is expected.
  if (correct.decision !== "manual_review") {
    throw new Error(
      `Expected manual_review for this low-consensus sample, got ${correct.decision}`
    );
  }

  console.log("PASS: Correct plate detected and safely sent for review");

  // Test 3: Incorrect assigned registration
  console.log("\n[TEST 3] Incorrect registration: MH12DE1433");

  const incorrect = await verifyImage(imageBuffer, "MH12DE1433");

  console.log("Decision:", incorrect.decision);
  console.log("Detected plate:", incorrect.detectedPlate);
  console.log("Plate match:", incorrect.plateMatch);
  console.log("Explanation:", incorrect.explanation);

  if (incorrect.plateMatch !== false) {
    throw new Error("Incorrect registration was not rejected as a mismatch");
  }

  if (incorrect.decision !== "fail") {
    throw new Error(
      `Expected fail for a confirmed plate mismatch, got ${incorrect.decision}`
    );
  }

  console.log("PASS: Incorrect registration was rejected");

  console.log("\n============================================");
  console.log(" ALL CV SERVICE INTEGRATION TESTS PASSED");
  console.log("============================================");
}

runIntegrationTests().catch((error) => {
  console.error("\nINTEGRATION TEST FAILED:");
  console.error(error.message);
  process.exit(1);
});
