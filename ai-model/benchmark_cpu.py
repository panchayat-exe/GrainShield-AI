import time
import os
import cv2
import numpy as np
from src.inference import GrainShieldInferenceEngine

def main():
    engine = GrainShieldInferenceEngine(device="cpu")

    # Generate synthetic 640x480 test image simulating vehicle with number plate
    img = np.ones((480, 640, 3), dtype=np.uint8) * 180
    cv2.rectangle(img, (100, 150), (540, 420), (50, 50, 50), -1)  # Vehicle body
    cv2.rectangle(img, (220, 320), (420, 380), (255, 255, 255), -1)  # Plate
    cv2.putText(img, "GJ05AB1234", (230, 365), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    _, buf = cv2.imencode(".jpg", img)
    img_bytes = buf.tobytes()

    print("\nWarmup run...")
    engine.analyze_image(img_bytes, expected_plate="GJ05AB1234", stage="first_mile")

    print("\nStarting CPU inference benchmark (10 iterations)...")
    latencies = []
    for i in range(10):
        t0 = time.perf_counter()
        res = engine.analyze_image(img_bytes, expected_plate="GJ05AB1234", stage="first_mile")
        t1 = time.perf_counter()
        elapsed = t1 - t0
        latencies.append(elapsed)
        dec = res.get("decision", "unknown")
        print(f"  Iteration {i+1}: {elapsed*1000:.1f} ms (decision: {dec})")

    avg_ms = (sum(latencies) / len(latencies)) * 1000
    median_ms = sorted(latencies)[len(latencies) // 2] * 1000
    throughput_per_sec = 1000.0 / avg_ms
    throughput_per_hour = throughput_per_sec * 3600

    print("\n" + "=" * 50)
    print("CPU PERFORMANCE BENCHMARK (REAL MEASUREMENTS)")
    print("=" * 50)
    print(f"Hardware: Intel/AMD CPU (x86_64, Windows, 1 worker thread)")
    print(f"Device: cpu")
    print(f"Mean Latency: {avg_ms:.1f} ms")
    print(f"Median Latency: {median_ms:.1f} ms")
    print(f"Single-worker Throughput: {throughput_per_sec:.2f} images/second ({throughput_per_hour:.0f} images/hour)")
    print(f"Sustained 69,000 photos/month load: {69000 / throughput_per_hour:.1f} hours of computation")
    print(f"Daily processing burden (69,000 / 30 = 2,300/day): {2300 / throughput_per_hour:.2f} hours/day")
    print("=" * 50)

if __name__ == "__main__":
    main()
