"""
GrainShield AI — Reconciled Component & Stage Latency Profiler
Measures each isolated stage on real vehicle imagery:
  1. Image Quality Assessment (OpenCV Laplacian blur + brightness)
  2. YOLO26n Vehicle Detection (CPU feedforward)
  3. Dedicated YOLO ALPR Plate Detection
  4. Multi-variant Tesseract Plate OCR (4 variants x 2 PSMs)
  5. Single-pass fast OCR (PSM 7 only)
  6. FPS Banner OCR Scan (2 regions x 2 PSMs)
  7. Plate Normalization & Decision Engine
  8. Full First Mile Pipeline (Stages 1, 2, 3, 4, 7)
  9. Full Last Mile Pipeline (Stages 1, 2, 3, 4, 6, 7)
"""

import sys, os, time
sys.path.append('D:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/ai-model')
import cv2
import numpy as np
import pytesseract
from src.inference import GrainShieldInferenceEngine, assess_image_quality, scan_fps_banner, run_plate_ocr
from src.normalizer import evaluate_plate_decision

engine = GrainShieldInferenceEngine(device="cpu")

# Load real test dataset image with detected vehicle and plate
test_img_path = 'D:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/ai-model/datasets/test/images/video10_1070_jpg.rf.cdad0bad2fde88e2961a104fb465ccc4.jpg'
with open(test_img_path, 'rb') as fp:
    real_bytes = fp.read()

np_arr = np.frombuffer(real_bytes, np.uint8)
real_cv_img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

# Extract real plate crop from image using plate detector
plate_results = engine.plate_model.predict(source=real_cv_img, conf=0.25, device='cpu', verbose=False)[0]
box = [int(v) for v in plate_results.boxes.xyxy[0].tolist()]
plate_crop = real_cv_img[box[1]:box[3], box[0]:box[2]]

N = 10
WARMUP = 2

def measure(fn, n=N):
    for _ in range(WARMUP):
        fn()
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t0) * 1000.0)
    times.sort()
    return {
        "mean": sum(times) / len(times),
        "median": times[len(times) // 2],
        "p95": times[int(len(times) * 0.95)],
        "min": times[0],
        "max": times[-1]
    }

print("Running isolated component benchmarks...")

# 1. Quality
t_quality = measure(lambda: assess_image_quality(real_cv_img))

# 2. Vehicle Model (YOLO26n)
t_vehicle = measure(lambda: engine.vehicle_model.predict(source=real_cv_img, conf=0.25, device='cpu', verbose=False))

# 3. Plate Model (Dedicated YOLO)
t_plate_det = measure(lambda: engine.plate_model.predict(source=real_cv_img, conf=0.25, device='cpu', verbose=False))

# 4. Multi-variant Tesseract Plate OCR
t_ocr_multi = measure(lambda: run_plate_ocr(plate_crop), n=5)

# 5. Fast OCR (single pass PSM 7)
config_fast = "--oem 3 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 --psm 7"
t_ocr_fast = measure(lambda: pytesseract.image_to_string(plate_crop, config=config_fast), n=5)

# 6. FPS Banner OCR Scan
t_fps_banner = measure(lambda: scan_fps_banner(real_cv_img), n=5)

# 7. Decision Engine
t_decision = measure(lambda: evaluate_plate_decision("MHO3092010", "MHO3092010", best_plate_conf=0.85, quality_label="clear", ocr_variant_votes=2), n=100)

# 8. Full Pipeline End-to-End (In-Memory Engine)
t_full_fm = measure(lambda: engine.analyze_image(real_bytes, expected_plate="MHO3092010", stage="first_mile"), n=5)
t_full_lm = measure(lambda: engine.analyze_image(real_bytes, expected_plate="MHO3092010", stage="last_mile"), n=5)

print("\n" + "=" * 80)
print(f"{'Component / Operation':<36} | {'Mean (ms)':<10} | {'Median':<10} | {'P95 (ms)':<10}")
print("-" * 80)
print(f"{'1. Image Quality Assessment':<36} | {t_quality['mean']:<10.2f} | {t_quality['median']:<10.2f} | {t_quality['p95']:<10.2f}")
print(f"{'2. YOLO26n Vehicle Detection':<36} | {t_vehicle['mean']:<10.2f} | {t_vehicle['median']:<10.2f} | {t_vehicle['p95']:<10.2f}")
print(f"{'3. Dedicated ALPR Plate Detector':<36} | {t_plate_det['mean']:<10.2f} | {t_plate_det['median']:<10.2f} | {t_plate_det['p95']:<10.2f}")
print(f"{'4. Plate OCR (8-pass Multi-PSM)':<36} | {t_ocr_multi['mean']:<10.2f} | {t_ocr_multi['median']:<10.2f} | {t_ocr_multi['p95']:<10.2f}")
print(f"{'5. Plate OCR (Fast single-PSM)':<36} | {t_ocr_fast['mean']:<10.2f} | {t_ocr_fast['median']:<10.2f} | {t_ocr_fast['p95']:<10.2f}")
print(f"{'6. FPS Banner OCR Scan (2 regions)':<36} | {t_fps_banner['mean']:<10.2f} | {t_fps_banner['median']:<10.2f} | {t_fps_banner['p95']:<10.2f}")
print(f"{'7. Normalization & Decision Policy':<36} | {t_decision['mean']:<10.3f} | {t_decision['median']:<10.3f} | {t_decision['p95']:<10.3f}")
print("-" * 80)
print(f"{'Full Pipeline: First Mile (1-3)':<36} | {t_full_fm['mean']:<10.2f} | {t_full_fm['median']:<10.2f} | {t_full_fm['p95']:<10.2f}")
print(f"{'Full Pipeline: Last Mile (4 with FPS)':<36} | {t_full_lm['mean']:<10.2f} | {t_full_lm['median']:<10.2f} | {t_full_lm['p95']:<10.2f}")
print("=" * 80)

# Weighted Traffic Reconciliation:
# 9,000 FM trips/month * 2 checkpoints = 18,000 verifications (13.04%)
# 60,000 LM trips/month * 2 checkpoints = 120,000 verifications (86.96%)
# Checkpoints 1, 2, 3 (no banner OCR): 18k + 60k = 78,000 (56.52% of total verifications)
# Checkpoint 4 (with banner OCR): 60,000 (43.48% of total verifications)
w_no_banner = 78000.0 / 138000.0
w_banner = 60000.0 / 138000.0
weighted_full_pipeline = (w_no_banner * t_full_fm['mean']) + (w_banner * t_full_lm['mean'])

print(f"\nOperational Traffic Reconciliation (9,000 FM trips / 60,000 LM trips per month):")
print(f"  Checkpoints 1-3 (No Banner OCR, {w_no_banner*100:.1f}% volume): Mean = {t_full_fm['mean']:.2f} ms")
print(f"  Checkpoint 4 (With Banner OCR, {w_banner*100:.1f}% volume):  Mean = {t_full_lm['mean']:.2f} ms")
print(f"  Overall Operational Weighted Full AI Pipeline Latency:  {weighted_full_pipeline:.2f} ms")
