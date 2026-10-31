"""
GrainShield AI -- Validation Runner

Runs the AI pipeline against annotated test images and reports accuracy metrics.
"""
import json
import sys
import time
from pathlib import Path

# Add ai-model to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.inference import GrainShieldInferenceEngine, resolve_model_path

ANNOTATIONS_FILE = Path(__file__).parent / "annotations.json"
TEST_IMAGES_DIR = Path(__file__).resolve().parents[1] / "test_images"


def run_validation():
    print("=" * 60)
    print("GrainShield AI -- Validation Run")
    print("=" * 60)

    with open(ANNOTATIONS_FILE) as f:
        annotations = json.load(f)

    engine = GrainShieldInferenceEngine(model_path=resolve_model_path())

    results = []
    annotated_count = sum(1 for a in annotations if a.get("annotated"))

    print(f"\nTotal images: {len(annotations)}")
    print(f"Annotated: {annotated_count}")
    print(f"Pending annotation: {len(annotations) - annotated_count}\n")

    for ann in annotations:
        img_path = TEST_IMAGES_DIR / ann["image"]
        if not img_path.exists():
            print(f"  [SKIP] {ann['image']} - file not found")
            continue

        t0 = time.time()
        with open(img_path, "rb") as f:
            image_bytes = f.read()

        result = engine.analyze_image(
            image_bytes=image_bytes,
            expected_plate=ann.get("expected_plate") if ann.get("expected_plate") != "UNKNOWN" else None,
        )
        elapsed = time.time() - t0

        actual_decision = result.get("decision", "error")
        expected_decision = ann.get("expected_decision", "manual_review")
        detected_plate = result.get("detectedPlate") or ""
        vehicle_detected = result.get("vehicleDetected", False)

        decision_match = actual_decision == expected_decision if ann.get("annotated") else None

        row = {
            "image": ann["image"],
            "annotated": ann.get("annotated", False),
            "expected_decision": expected_decision,
            "actual_decision": actual_decision,
            "decision_correct": decision_match,
            "vehicle_detected": vehicle_detected,
            "plate_candidates": result.get("rawOutput", {}).get("plate_candidates", 0) if result.get("rawOutput") else 0,
            "detected_plate": detected_plate,
            "expected_plate": ann.get("expected_plate", "UNKNOWN"),
            "latency_s": round(elapsed, 2),
        }
        results.append(row)

        status_label = "[OK]" if decision_match else ("[SKIP]" if decision_match is None else "[FAIL]")
        print(f"  {status_label} {ann['image']:20s} | decision={actual_decision:13s} | plate={detected_plate or '(none)':12s} | {elapsed:.2f}s")

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Total run:         {len(results)}")
    print(f"  Vehicle detected:  {sum(1 for r in results if r['vehicle_detected'])}/{len(results)}")
    print(f"  Plate candidates:  {sum(1 for r in results if r['plate_candidates'] > 0)}/{len(results)}")
    print(f"  Plate text found:  {sum(1 for r in results if r['detected_plate'])}/{len(results)}")

    annotated_results = [r for r in results if r["annotated"]]
    if annotated_results:
        correct = sum(1 for r in annotated_results if r["decision_correct"])
        print(f"  Decision accuracy: {correct}/{len(annotated_results)} ({correct/len(annotated_results)*100:.0f}%)")

    if results:
        avg_lat = sum(r["latency_s"] for r in results) / len(results)
        print(f"  Avg latency:       {avg_lat:.2f}s")
        print(f"  Min latency:       {min(r['latency_s'] for r in results):.2f}s")
        print(f"  Max latency:       {max(r['latency_s'] for r in results):.2f}s")

    # Save results
    out = Path(__file__).parent / "validation_results.json"
    with open(out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n  Results saved to: {out}")


if __name__ == "__main__":
    run_validation()