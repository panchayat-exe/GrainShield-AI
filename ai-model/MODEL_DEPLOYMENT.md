# GrainShield AI — Model Deployment Guide

## First-time setup on a new machine

```bash
# 1. Clone the repository
git clone https://github.com/panchayat-exe/GrainShield-AI.git
cd GrainShield-AI/ai-model

# 2. Create virtual environment and install dependencies
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 3. Deploy the trained plate detector weights
python scripts/deploy_weights.py
```

The script copies `runs/plate_detection/rtx3050_img512_b2/weights/best.pt`
into `weights/best.pt` and verifies the SHA-256 checksum.

**Why is `weights/best.pt` not in Git?**
Large binary model files are excluded from the repository to keep clone times fast.
The trained weights live in `runs/` (also gitignored) and must be deployed locally.
In a CI/CD pipeline, download `best.pt` from a secure artifact store (e.g., GitHub
Releases or a private S3 bucket) and place it at `ai-model/weights/best.pt`.

## Health check

After starting the server, verify both models loaded:

```bash
curl http://localhost:8000/health
```

Expected response when healthy:
```json
{
  "status": "healthy",
  "service": "grainshield-inference",
  "version": "2.1.0",
  "models": {
    "vehicle_detector": { "loaded": true, "path": "yolo26n.pt" },
    "plate_detector": { "loaded": true, "status": "loaded", "path": "best.pt" }
  },
  "device": "cpu",
  "tesseract": "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
  "uptime_seconds": 12
}
```

If `plate_detector.status` is `"missing"`, run `python scripts/deploy_weights.py`
and restart the server. All verifications will route to `manual_review` until
the plate model is available.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLATE_MODEL_PATH` | _(auto-detected)_ | Absolute path to `best.pt`. Overrides all defaults. |
| `MODEL_PATH` | _(auto-detected)_ | Absolute path to vehicle detection model. |
| `GRAINSHIELD_DEVICE` | `auto` | `cpu`, `cuda:0`, or `auto` (prefers CUDA if available). |
| `CV_API_KEY` | _(none)_ | API key for `/verify` endpoint. Required in production. |
| `ENVIRONMENT` | `development` | Set to `production` to enforce API key requirement. |
| `HOST` | `127.0.0.1` | Bind address for the uvicorn server. |
| `PORT` | `8000` | Port for the uvicorn server. |

## Re-training the plate detector

```bash
cd ai-model
python src/train_plate.py
```

Requires CUDA. After training completes, re-deploy:
```bash
python scripts/deploy_weights.py
```
