"""
GrainShield AI — Detailed Stage Latency Profiler & Weighting Formula
Measures exact component and stage latencies separately for First Mile and Last Mile:
  - First Mile Full Pass (Vehicle + ALPR + OCR)
  - First Mile Early Exit (Blurry / Dark / No Vehicle)
  - First Mile Manual Review (Vehicle Present, Plate Occluded)
  - Last Mile Full Pass (Vehicle + ALPR + OCR + FPS Banner OCR)
Computes exact empirical Mean, Median, P95, and Min/Max with sample count N=20.
"""

import time
import cv2
import numpy as np
from src.inference import GrainShieldInferenceEngine, assess_image_quality, scan_fps_banner, run_plate_ocr

engine = GrainShieldInferenceEngine(device="cpu")

# 1. Clear vehicle image with readable plate (GJ01AB1234)
img_clear = np.ones((480, 640, 3), dtype=np.uint8) * 140
cv2.rectangle(img_clear, (100, 120), (540, 420), (50, 60, 80), -1)
cv2.rectangle(img_clear, (160, 260), (480, 380), (30, 30, 30), -1)
cv2.rectangle(img_clear, (220, 310), (420, 370), (250, 250, 250), -1)
cv2.putText(img_clear, "GJ01AB1234", (230, 355), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
_, enc_clear = cv2.imencode(".jpg", img_clear)
bytes_clear = enc_clear.tobytes()

# 2. Blurry / Dark image (Early exit)
img_dark = np.ones((480, 640, 3), dtype=np.uint8) * 15 # low brightness < 40
_, enc_dark = cv2.imencode(".jpg", img_dark)
bytes_dark = enc_dark.tobytes()

# 3. Vehicle present, but plate occluded / missing (Manual Review path)
img_occluded = np.ones((480, 640, 3), dtype=np.uint8) * 140
cv2.rectangle(img_occluded, (100, 120), (540, 420), (50, 60, 80), -1)
cv2.rectangle(img_occluded, (160, 260), (480, 380), (30, 30, 30), -1)
# No plate drawn
_, enc_occluded = cv2.imencode(".jpg", img_occluded)
bytes_occluded = enc_occluded.tobytes()

# 4. Last Mile FPS Delivery (with Banner + Person + Vehicle + Plate)
img_lastmile = np.ones((480, 640, 3), dtype=np.uint8) * 160
cv2.rectangle(img_lastmile, (50, 20), (590, 100), (255, 255, 255), -1)
cv2.putText(img_lastmile, "FPS-AMD-001 GUJARAT FOOD & CIVIL SUPPLIES", (70, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 100, 0), 2)
cv2.rectangle(img_lastmile, (160, 180), (560, 440), (80, 80, 90), -1)
cv2.rectangle(img_lastmile, (250, 350), (430, 400), (250, 250, 250), -1)
cv2.putText(img_lastmile, "GJ01CD5678", (260, 385), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
cv2.circle(img_lastmile, (100, 240), 30, (210, 180, 150), -1) # Person
_, enc_lm = cv2.imencode(".jpg", img_lastmile)
bytes_lm = enc_lm.tobytes()

N = 20
WARMUP = 3

def profile_path(fn, name):
    for _ in range(WARMUP):
        fn()
    times = []
    for _ in range(N):
        t0 = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t0) * 1000.0)
    times_sorted = sorted(times)
    mean = sum(times) / len(times)
    median = times_sorted[len(times) // 2]
    p95 = times_sorted[int(len(times) * 0.95)]
    return {
        "name": name,
        "n": N,
        "mean_ms": round(mean, 2),
        "median_ms": round(median, 2),
        "p95_ms": round(p95, 2),
        "min_ms": round(times_sorted[0], 2),
        "max_ms": round(times_sorted[-1], 2),
    }

print("Running profiling benchmarks (N=20 iterations each)...")
res_fm_clear = profile_path(lambda: engine.analyze_image(bytes_clear, expected_plate="GJ01AB1234", stage="first_mile"), "First Mile Full Pass")
res_fm_early = profile_path(lambda: engine.analyze_image(bytes_dark, expected_plate="GJ01AB1234", stage="first_mile"), "Early Exit (Quality)")
res_fm_manual = profile_path(lambda: engine.analyze_image(bytes_occluded, expected_plate="GJ01AB1234", stage="first_mile"), "Manual Review (Occluded)")
res_lm_full = profile_path(lambda: engine.analyze_image(bytes_lm, expected_plate="GJ01CD5678", stage="last_mile"), "Last Mile Full (with Banner)")

print("\n" + "=" * 90)
print(f"{'Workload Path':<32} | {'N':<3} | {'Mean (ms)':<10} | {'Median':<10} | {'P95 (ms)':<10} | {'Min - Max'}")
print("-" * 90)
for r in [res_fm_clear, res_fm_early, res_fm_manual, res_lm_full]:
    print(f"{r['name']:<32} | {r['n']:<3} | {r['mean_ms']:<10.1f} | {r['median_ms']:<10.1f} | {r['p95_ms']:<10.1f} | {r['min_ms']:.1f} - {r['max_ms']:.1f} ms")
print("=" * 90)

# Exact Weighted Latency Calculation
# Stage Distribution:
#   Checkpoint 1 (FM Departure): 25%
#   Checkpoint 2 (FM Arrival e-POD): 25%
#   Checkpoint 3 (LM Departure): 25%
#   Checkpoint 4 (LM FPS Delivery e-POD with Banner): 25%
#
# Path Outcome Distribution within Stages 1-3 (75% of volume):
#   - Clear plate match: 70%
#   - Early exit (blurry/dark): 20%
#   - Manual review (occluded): 10%
#
# Stage 4 (25% of volume): Always executes FPS banner OCR (approx 530 ms) in addition to vehicle/plate scan.

t_fm_weighted = (0.70 * res_fm_clear["mean_ms"]) + (0.20 * res_fm_early["mean_ms"]) + (0.10 * res_fm_manual["mean_ms"])
t_lm_weighted = (0.70 * res_lm_full["mean_ms"]) + (0.20 * res_fm_early["mean_ms"]) + (0.10 * res_fm_manual["mean_ms"])

t_overall_weighted = (0.75 * t_fm_weighted) + (0.25 * t_lm_weighted)

print("\n=== EXACT WEIGHTED AVERAGE DERIVATION ===")
print(f"First Mile (Stages 1-3) Weighted Latency: {t_fm_weighted:.2f} ms")
print(f"  Formula: (0.70 * {res_fm_clear['mean_ms']:.1f} ms) + (0.20 * {res_fm_early['mean_ms']:.1f} ms) + (0.10 * {res_fm_manual['mean_ms']:.1f} ms)")
print(f"Last Mile (Stage 4) Weighted Latency:      {t_lm_weighted:.2f} ms")
print(f"  Formula: (0.70 * {res_lm_full['mean_ms']:.1f} ms) + (0.20 * {res_fm_early['mean_ms']:.1f} ms) + (0.10 * {res_fm_manual['mean_ms']:.1f} ms)")
print(f"Overall Logistics Workload Weighted Latency: {t_overall_weighted:.2f} ms")
print(f"  Formula: (0.75 * {t_fm_weighted:.2f} ms) + (0.25 * {t_lm_weighted:.2f} ms) = {t_overall_weighted:.2f} ms")
print("=" * 90)
