/**
 * GrainShield AI – Citizen Frontend Unit Tests
 * Run: npm test (vitest run)
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Plate normalization helpers (duplicated from inference logic for frontend validation)
// ---------------------------------------------------------------------------
function cleanPlateText(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const INDIAN_PLATE_RE = /^[A-Z]{2}\d{2}[A-Z]{1,3}\d{1,4}$/;

function isValidIndianPlate(plate: string): boolean {
  return INDIAN_PLATE_RE.test(plate);
}

// ---------------------------------------------------------------------------
// Decision display helpers
// ---------------------------------------------------------------------------
type Decision = "pass" | "fail" | "retake" | "manual_review" | "error";

function decisionLabel(d: Decision): string {
  const labels: Record<Decision, string> = {
    pass: "Verified ✓",
    fail: "Failed ✗",
    retake: "Retake Required",
    manual_review: "Under Review",
    error: "Processing Error",
  };
  return labels[d] ?? "Unknown";
}

function decisionColor(d: Decision): string {
  const colors: Record<Decision, string> = {
    pass: "text-green-600",
    fail: "text-red-600",
    retake: "text-amber-600",
    manual_review: "text-blue-600",
    error: "text-gray-500",
  };
  return colors[d] ?? "text-gray-500";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("cleanPlateText", () => {
  it("strips spaces", () => expect(cleanPlateText("GJ 05 AB 1234")).toBe("GJ05AB1234"));
  it("uppercases", () => expect(cleanPlateText("gj05ab1234")).toBe("GJ05AB1234"));
  it("strips hyphens", () => expect(cleanPlateText("GJ-05-AB-1234")).toBe("GJ05AB1234"));
  it("handles empty", () => expect(cleanPlateText("")).toBe(""));
  it("handles null-like", () => expect(cleanPlateText(undefined as unknown as string)).toBe(""));
});

describe("isValidIndianPlate", () => {
  it("valid standard plate", () => expect(isValidIndianPlate("GJ05AB1234")).toBe(true));
  it("valid short series", () => expect(isValidIndianPlate("MH12D1234")).toBe(true));
  it("rejects too short", () => expect(isValidIndianPlate("GJ05")).toBe(false));
  it("rejects leading digit", () => expect(isValidIndianPlate("12GJ5AB1234")).toBe(false));
  it("rejects empty", () => expect(isValidIndianPlate("")).toBe(false));
});

describe("decisionLabel", () => {
  it("pass label", () => expect(decisionLabel("pass")).toBe("Verified ✓"));
  it("retake label", () => expect(decisionLabel("retake")).toBe("Retake Required"));
  it("manual_review label", () => expect(decisionLabel("manual_review")).toBe("Under Review"));
  it("fail label", () => expect(decisionLabel("fail")).toBe("Failed ✗"));
});

describe("decisionColor", () => {
  it("pass is green", () => expect(decisionColor("pass")).toContain("green"));
  it("fail is red", () => expect(decisionColor("fail")).toContain("red"));
  it("retake is amber", () => expect(decisionColor("retake")).toContain("amber"));
});

describe("stage labels", () => {
  const stageLabel: Record<string, string> = {
    first_mile: "First Mile",
    mid_mile: "Mid Mile",
    last_mile: "Last Mile",
  };
  it("maps all three stages", () => {
    expect(stageLabel["first_mile"]).toBe("First Mile");
    expect(stageLabel["mid_mile"]).toBe("Mid Mile");
    expect(stageLabel["last_mile"]).toBe("Last Mile");
  });
  it("returns undefined for unknown", () => {
    expect(stageLabel["unknown"]).toBeUndefined();
  });
});
