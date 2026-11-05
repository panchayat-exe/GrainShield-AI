# GrainShield AI — AI Accuracy Report

**Date:** 2026-11-06  
**Model:** YOLOv8 (grain detection + vehicle detection)  
**Pipeline version:** `ai-model/` + `ai-worker/src/worker.js`

> [!IMPORTANT]
> This report reflects the **actual current state** of the AI pipeline. Accuracy figures are NOT fabricated. Where evaluation has not been executed against a labeled dataset, this is explicitly stated. The required steps to obtain real metrics are listed.

---

## 1. Pipeline Architecture

```
Evidence photograph (uploaded to Supabase Storage)
        ↓
AI Worker (Node.js) — claims pending verification_result record
        ↓  signed URL download
AI Model Service (Python FastAPI + YOLOv8)
        ↓  POST /analyze
Decision: pass | fail | retake | manual_review | error
        ↓
verification_results updated, trip status updated, audit log written
```

---

## 2. Grain Detection (YOLOv8)

### 2.1 Configuration

| Parameter | Value |
|-----------|-------|
| Framework | Ultralytics YOLOv8 |
| Model weights | `ai-model/models/` |
| Confidence threshold | Configurable via `CONFIDENCE_THRESHOLD` env (default 0.6) |
| Input preprocessing | Resize to 640×640, normalize [0,1] |
| Output | Bounding boxes + class confidence scores |

### 2.2 Confidence Routing Logic

| Confidence | Decision |
|-----------|----------|
| ≥ CONFIDENCE_THRESHOLD | `pass` (grain detected, plate matched) |
| 0.4 – threshold | `manual_review` (uncertain) |
| < 0.4 | `retake` (insufficient quality) |
| Exception / timeout | `error` → DLQ |

### 2.3 Evaluation Status

> [!WARNING]
> **No labeled test dataset has been evaluated against this model in the current deployment.**
> The following metrics are **NOT measured** — they require a proper evaluation run.

| Metric | Required Dataset | Status |
|--------|-----------------|--------|
| Detection precision | Labeled grain images | ❌ Not measured |
| Detection recall | Labeled grain images | ❌ Not measured |
| F1 score | Labeled grain images | ❌ Not measured |
| False positive rate | Non-grain images | ❌ Not measured |
| False negative rate | Labeled grain images | ❌ Not measured |
| Performance by image quality | Low/medium/high quality sets | ❌ Not measured |

### 2.4 Data Collection Plan (to obtain real metrics)

1. **Collect 500+ labeled images** per category:
   - Grain-loaded vehicle at mandi (expected: pass)
   - Grain-loaded vehicle at godown/FPS (expected: pass)
   - Empty vehicle (expected: fail)
   - Non-grain cargo (expected: fail)
   - Poor lighting / night / motion blur (expected: retake or manual_review)
   - Partial occlusion (expected: manual_review)

2. **Split:** 70% train / 15% validation / 15% test

3. **Run evaluation:**
   ```bash
   cd ai-model
   python evaluate.py --weights models/best.pt --data data/grain_eval.yaml --split test
   ```

4. **Report** precision, recall, F1, mAP50, mAP50-95 by class.

---

## 3. Number-Plate OCR Pipeline

### 3.1 Architecture

| Stage | Component | Status |
|-------|-----------|--------|
| Vehicle detection | YOLOv8 | ✅ Configured |
| Plate region crop | OpenCV bounding box | ✅ |
| Perspective correction | OpenCV warpPerspective | ✅ |
| OCR | Tesseract / EasyOCR (requires config) | ⚠️ Requires `TESSERACT_CMD` env or EasyOCR install |
| Text normalization | Regex: `^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$` | ✅ |
| Plate match | Normalized OCR result vs. expected_plate | ✅ |

### 3.2 Known Limitations

| Condition | Expected Behavior | Current Handling |
|-----------|------------------|-----------------|
| Night / low-light images | Poor OCR accuracy | Routes to `manual_review` if confidence < threshold |
| Motion blur | OCR fails | Routes to `retake` |
| Dirty/damaged plates | Partial read | Routes to `manual_review` |
| Multiple vehicles | May detect wrong plate | Largest/closest plate used |
| Gujarati script plates | Not validated | ⚠️ May fail — needs training data |

### 3.3 OCR Accuracy Evaluation

> [!WARNING]
> **OCR accuracy has not been measured against a labeled dataset.** The following test cases are REQUIRED before production sign-off.

**Required test set (minimum 200 images):**
- Indian plate formats: `GJ01AB1234`, `GJ-01-AB-1234`, `GJ 01 AB 1234`
- Different font sizes and styles
- Daylight, overcast, artificial light
- Angles: ±15°, ±30° horizontal, ±10° vertical
- Motion blur (simulated)
- Partially obscured (mud, dust)

**Metrics to report:**
- Exact-match accuracy (full plate correct)
- Character-level accuracy (avg correct chars / total chars)
- False accept rate (wrong plate accepted as match)

---

## 4. AI Worker — Operational Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Poll interval | 15 seconds | Configurable via POLL_INTERVAL_MS |
| Max retries per job | 3 | Configurable via MAX_RETRIES |
| Processing timeout | 90 seconds | Configurable via PROCESSING_TIMEOUT_MS |
| DLQ behavior | Writes to `failed_jobs` | Admin can resolve via `/failed-jobs` |
| Stall recovery | Jobs stuck > timeout reclaimed | Worker restarts reclaim stalled jobs |
| Audit log | Written on every outcome | ✅ |

---

## 5. CV Provider Configuration

The worker supports two modes:

| CV_PROVIDER | Behavior |
|------------|----------|
| `mock` (default) | Returns `error` — **DO NOT use in production** |
| `http` | Posts to `CV_API_URL` with `Authorization: Bearer CV_API_KEY` |

**To activate real AI:**
```env
# ai-worker/.env
CV_PROVIDER=http
CV_API_URL=http://localhost:8000/analyze
CV_API_KEY=your-internal-api-key
```

---

## 6. Required Actions Before Production Sign-Off

- [ ] Collect and label evaluation dataset (Section 2.4)
- [ ] Run evaluation script; report precision/recall/F1
- [ ] Configure OCR backend (Tesseract or EasyOCR)
- [ ] Run OCR accuracy test (Section 3.3)
- [ ] Set CV_PROVIDER=http with real model URL
- [ ] Set PROCESSING_TIMEOUT_MS=300000 (5 min) to match DB stale window
- [ ] Load test with 50 concurrent jobs

---

*Report generated: 2026-11-06. Update after each model retraining or threshold change.*
