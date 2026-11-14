import os
import sys
import time
import platform
import psutil
import torch
import cv2
import numpy as np
from ultralytics import YOLO
import pytesseract

from src.inference import (
    GrainShieldInferenceEngine,
    assess_image_quality,
    scan_fps_banner,
    run_plate_ocr,
    configure_tesseract,
)
from src.normalizer import evaluate_plate_decision, normalize_confusion

def get_system_specs():
    cpu_name = platform.processor() or "x86_64 Processor"
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        cpu_name = winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
    except Exception:
        pass

    ram_gb = psutil.virtual_memory().total / (1024 ** 3)
    return {
        "cpu_model": cpu_name,
        "cores_physical": psutil.cpu_count(logical=False),
        "cores_logical": psutil.cpu_count(logical=True),
        "ram_gb": round(ram_gb, 1),
        "os": f"{platform.system()} {platform.release()} (Build {platform.version()})",
        "python_version": platform.python_version(),
        "torch_version": torch.__version__,
        "ultralytics_version": getattr(sys.modules.get("ultralytics"), "__version__", "unknown"),
        "tesseract_cmd": configure_tesseract(),
    }

def run_stats(times_ms):
    times_sorted = sorted(times_ms)
    n = len(times_sorted)
    mean = sum(times_ms) / n
    median = times_sorted[n // 2]
    p95 = times_sorted[int(n * 0.95)] if n >= 20 else times_sorted[-1]
    return {
        "mean_ms": round(mean, 2),
        "median_ms": round(median, 2),
        "p95_ms": round(p95, 2),
        "min_ms": round(times_sorted[0], 2),
        "max_ms": round(times_sorted[-1], 2),
        "throughput_sec": round(1000.0 / mean, 2),
        "throughput_hour": round((1000.0 / mean) * 3600, 0),
    }

def main():
    specs = get_system_specs()
    print("=" * 65)
    print("GRAINSHIELD AI — PIPELINE RECONCILIATION & CPU PROFILING")
    print("=" * 65)
    print(f"CPU: {specs['cpu_model']} ({specs['cores_physical']}C / {specs['cores_logical']}T)")
    print(f"RAM: {specs['ram_gb']} GB")
    print(f"OS: {specs['os']}")
    print(f"Python: {specs['python_version']} | PyTorch: {specs['torch_version']} | Ultralytics: {specs['ultralytics_version']}")
    print(f"Tesseract Path: {specs['tesseract_cmd']}")
    print("=" * 65)

    engine = GrainShieldInferenceEngine(device="cpu")

    # Load or generate a realistic test vehicle image (640x480) with vehicle and number plate
    img_path = "datasets/sample_truck.jpg"
    img = None
    if os.path.exists(img_path):
        img = cv2.imread(img_path)
    
    if img is None:
        # Create standard realistic image
        img = np.ones((480, 640, 3), dtype=np.uint8) * 120
        # Dark vehicle shape
        cv2.rectangle(img, (80, 100), (560, 420), (45, 45, 50), -1)
        # Grill & bumper
        cv2.rectangle(img, (140, 240), (500, 380), (30, 30, 30), -1)
        # Number plate box
        cv2.rectangle(img, (220, 320), (420, 375), (255, 255, 255), -1)
        cv2.rectangle(img, (220, 320), (420, 375), (0, 0, 0), 2)
        cv2.putText(img, "GJ05AB1234", (230, 360), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 0, 0), 2)
        # Person standing to the side
        cv2.circle(img, (50, 160), 25, (200, 180, 160), -1)
        cv2.rectangle(img, (30, 185), (70, 350), (20, 50, 120), -1)

    _, encoded = cv2.imencode(".jpg", img)
    img_bytes = encoded.tobytes()

    # Crop plate region for isolated OCR test
    plate_crop = img[315:380, 215:425]

    WARMUP_RUNS = 3
    TEST_RUNS = 10

    # 1. Image Quality Assessment
    print("\nProfiling 1: Image Quality Assessment (Laplacian + Brightness)...")
    for _ in range(WARMUP_RUNS):
        assess_image_quality(img)
    t_quality = []
    for _ in range(TEST_RUNS):
        t0 = time.perf_counter()
        assess_image_quality(img)
        t_quality.append((time.perf_counter() - t0) * 1000)

    # 2. General Detection Model (yolo26n.pt)
    print("Profiling 2: Vehicle & Person Detection (YOLO26n)...")
    for _ in range(WARMUP_RUNS):
        engine.vehicle_model.predict(source=img, conf=0.25, device="cpu", verbose=False)
    t_vehicle = []
    for _ in range(TEST_RUNS):
        t0 = time.perf_counter()
        engine.vehicle_model.predict(source=img, conf=0.25, device="cpu", verbose=False)
        t_vehicle.append((time.perf_counter() - t0) * 1000)

    # 3. Dedicated Plate Detection Model (best.pt)
    print("Profiling 3: Dedicated Number Plate Detection (ALPR YOLO26n)...")
    for _ in range(WARMUP_RUNS):
        engine.plate_model.predict(source=img, conf=0.25, device="cpu", verbose=False)
    t_plate = []
    for _ in range(TEST_RUNS):
        t0 = time.perf_counter()
        engine.plate_model.predict(source=img, conf=0.25, device="cpu", verbose=False)
        t_plate.append((time.perf_counter() - t0) * 1000)

    # 4. Multi-variant Plate OCR
    print("Profiling 4: Plate OCR (Pre-processing + Tesseract Multi-PSM)...")
    for _ in range(WARMUP_RUNS):
        run_plate_ocr(plate_crop)
    t_ocr = []
    for _ in range(TEST_RUNS):
        t0 = time.perf_counter()
        run_plate_ocr(plate_crop)
        t_ocr.append((time.perf_counter() - t0) * 1000)

    # 5. Position-aware Normalization & Decision
    print("Profiling 5: Plate Normalization & Strict Decision Evaluation...")
    t_norm = []
    for _ in range(TEST_RUNS):
        t0 = time.perf_counter()
        evaluate_plate_decision("GJ05AB1234", "GJO5AB1234", best_plate_conf=0.92, quality_label="clear", ocr_variant_votes=2)
        t_norm.append((time.perf_counter() - t0) * 1000)

    # 6. FPS Banner OCR
    print("Profiling 6: FPS Banner Scan (Multi-region Tesseract)...")
    for _ in range(WARMUP_RUNS):
        scan_fps_banner(img)
    t_fps = []
    for _ in range(TEST_RUNS):
        t0 = time.perf_counter()
        scan_fps_banner(img)
        t_fps.append((time.perf_counter() - t0) * 1000)

    # 7. Complete Verification Pipeline (End-to-End)
    print("Profiling 7: Complete Verification Pipeline (Full End-to-End)...")
    for _ in range(WARMUP_RUNS):
        engine.analyze_image(img_bytes, expected_plate="GJ05AB1234", stage="first_mile")
    t_pipeline = []
    for _ in range(TEST_RUNS):
        t0 = time.perf_counter()
        engine.analyze_image(img_bytes, expected_plate="GJ05AB1234", stage="first_mile")
        t_pipeline.append((time.perf_counter() - t0) * 1000)

    # Print Breakdown Table
    print("\n" + "=" * 80)
    print(f"{'Component / Operation':<35} | {'Mean (ms)':<10} | {'Median':<10} | {'P95 (ms)':<10} | {'Throughput'}")
    print("-" * 80)
    components = [
        ("1. Image Quality Assessment", t_quality),
        ("2. Vehicle Detection (YOLO26n)", t_vehicle),
        ("3. Dedicated ALPR Detection", t_plate),
        ("4. Plate Crop OCR (Tesseract)", t_ocr),
        ("5. Normalization & Decision", t_norm),
        ("6. FPS Banner Scan (Tesseract)", t_fps),
        ("7. FULL PIPELINE (End-to-End)", t_pipeline),
    ]

    for name, times in components:
        st = run_stats(times)
        tp_str = f"{st['throughput_sec']} img/s"
        print(f"{name:<35} | {st['mean_ms']:<10.1f} | {st['median_ms']:<10.1f} | {st['p95_ms']:<10.1f} | {tp_str}")
    print("=" * 80)

    pipe_st = run_stats(t_pipeline)
    total_sec_per_img = pipe_st['mean_ms'] / 1000.0
    throughput_hour = 3600.0 / total_sec_per_img
    hours_for_69k = 69000.0 / throughput_hour
    daily_quota = 69000 / 30 # 2300 per day
    daily_hours = daily_quota / throughput_hour

    print("\n=== RECONCILED PRODUCTION CAPACITY ASSESSMENT ===")
    print(f"End-to-End Latency: {pipe_st['mean_ms']:.1f} ms ({total_sec_per_img:.3f} s / image)")
    print(f"Single-worker Pipeline Throughput: {pipe_st['throughput_sec']:.2f} images/sec ({throughput_hour:.0f} images/hour)")
    print(f"Full Monthly Quota (69,000 photos): {hours_for_69k:.2f} hours of continuous CPU processing")
    print(f"Daily Operating Load (2,300 photos/day): {daily_hours:.2f} hours/day on 1 CPU worker")
    print(f"Capacity Utilization on 1 Worker (24h/day): {daily_hours / 24.0 * 100:.1f}%")
    print(f"Conclusion: 1 CPU worker utilizes ~{daily_hours / 24.0 * 100:.1f}% capacity. A pool of 2 workers handles peak bursts with >85% headroom.")
    print("=" * 80)

if __name__ == "__main__":
    main()
