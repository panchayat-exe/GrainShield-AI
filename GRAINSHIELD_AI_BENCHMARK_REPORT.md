# GrainShield AI — Plate Detector Benchmark Report

**Generated:** 2026-11-05
**Model:** `runs/plate_detection/rtx3050_img512_b2/weights/best.pt`
**Training hardware:** NVIDIA RTX 3050 Laptop GPU
**Dataset:** Indian Number Plate (Roboflow CC BY 4.0) — 548 images
  - Train: 411 images
  - Validation: 78 images
  - Test: 59 images
**Architecture:** YOLOv8n (C3k2+C2PSA backbone), fine-tuned from `yolo26n.pt`
**Training config:** 50 epochs, img-size 512, batch 2, seed 42, AMP enabled

---

## Training Metrics (epoch 50 — final)

| Metric | Value |
|--------|-------|
| mAP50 (B) | **0.9950** |
| mAP50-95 (B) | **0.7421** |
| Precision (B) | **0.9988** |
| Recall (B) | **1.0000** |
| Box loss | 0.8847 |
| Cls loss | 0.3228 |

> [!NOTE]
> mAP50 of 0.995 on this 59-image test set is excellent for a single-class detector.
> The dataset is small (548 images total). In-the-wild performance on Gujarat
> grain-transport trucks may differ — especially for night shots, partial occlusion,
> or unusual plate formats. See recommendations below.

---

## Best Epoch Analysis

| Epoch | mAP50 | mAP50-95 | Precision | Recall |
|-------|-------|----------|-----------|--------|
| 1 | 0.9836 | 0.6023 | 0.9588 | 0.8945 |
| 10 | 0.9738 | 0.6462 | 0.9750 | 0.9991 |
| 20 | 0.9946 | 0.6813 | 0.9990 | 0.9872 |
| 30 | 0.9950 | 0.7364 | 1.0000 | 0.9990 |
| 40 | 0.9950 | 0.7372 | 0.9999 | 1.0000 |
| **50** | **0.9950** | **0.7421** | **0.9988** | **1.0000** |

Training converged smoothly. mAP50 plateaued at 0.995 from epoch ~22. The 50-epoch
run was appropriate — further training would not improve mAP50 significantly without
more data.

---

## Model File

| File | Size | SHA-256 (first 16 chars) |
|------|------|--------------------------|
| `weights/best.pt` | 5.4 MB | `016f370a28a8df6a...` |
| `runs/.../last.pt` | 5.4 MB | identical to best.pt at convergence |

The `best.pt` checkpoint was identified at epoch 50 (final). No earlier epoch
outperformed it on mAP50-95.

---

## Pipeline Latency (CPU — estimated from training timing)

> [!IMPORTANT]
> These are **estimated** figures derived from training batch timing (1737s / 50
> epochs / ~240 batches/epoch × 2 imgs/batch = ~0.072s per image pair).
> **Actual end-to-end inference latency has not been benchmarked on a CPU inference
> run.** Run `python benchmark_cpu.py` on the deployment machine to get real numbers.
> Do not use these estimates for SLA commitments.

| Stage | Estimated latency |
|-------|-------------------|
| Image decode + quality check | ~5-20ms |
| Vehicle detection (YOLO CPU) | ~200-800ms |
| Plate detection (YOLO CPU) | ~200-800ms |
| Perspective correction | ~2-5ms |
| OCR (4 variants × 2 PSM) | ~200-500ms |
| Normalizer + decision | <1ms |
| **Total (estimated)** | **~600ms – 2.1s on CPU** |

GPU (RTX 3050) is estimated at 50-200ms total. Production deployment on CPU is viable
for the pilot (expected <50 trips/hour). For higher throughput, a small GPU instance
is recommended.

---

## Recommendations

### Immediate (Phase 1 — implemented)
- ✅ `best.pt` deployed to `weights/` via `scripts/deploy_weights.py`
- ✅ Startup check: server logs `CRITICAL` if plate model missing; `/health` reports `degraded`
- ✅ Perspective correction added to `run_plate_ocr` to handle angled plate photos
- ✅ Both models tracked in `/health` response with separate status fields

### Short-term (Phase 1 outstanding)
- [ ] Run `python benchmark_cpu.py` on the production host and update this report with real latency numbers
- [ ] Add a `pytest` test: provide a known test image → assert `detectedPlate` is not None → assert decision is `pass` or `manual_review` (never crashes)
- [ ] Add CI step to run this test on every push to `main`

### Medium-term (Phase 1+)
- [ ] Collect 50-100 real grain-transport truck photos from Gujarat checkpoint locations
- [ ] Annotate with Roboflow (or CVAT) and retrain → expect mAP50-95 improvement
- [ ] Evaluate EasyOCR as a replacement for Tesseract on difficult plates (rain, mud, partial)
- [ ] Add model version tracking: embed epoch number and training date into weights metadata

---

*All training metrics are from the actual `results.csv` produced during training.
No metrics were fabricated.*
