"""Patch server.py: add plate model check to lifespan + upgrade /health endpoint."""
import sys
from pathlib import Path

file = Path(__file__).parent.parent / "src" / "server.py"
text = file.read_text(encoding="utf-8")

# ── Patch 1: import datetime + resolve_plate_model_path ─────────────────────
old1 = "from src.inference import GrainShieldInferenceEngine, resolve_model_path\n"
new1 = (
    "import datetime\n\n"
    "from src.inference import GrainShieldInferenceEngine, resolve_model_path, resolve_plate_model_path\n"
)
if old1 not in text:
    # Already patched in a previous run
    print("[INFO] import patch already applied")
else:
    text = text.replace(old1, new1)
    print("[OK] Patch 1: imports updated")

# ── Patch 2: global state variables ─────────────────────────────────────────
old2 = "# Global engine instance pre-loaded at startup\nengine: Optional[GrainShieldInferenceEngine] = None\n"
new2 = (
    "# Global engine instance and health metadata pre-loaded at startup\n"
    "engine: Optional[GrainShieldInferenceEngine] = None\n"
    "_startup_time: Optional[datetime.datetime] = None\n"
    '_plate_model_status: str = "not_loaded"\n'
)
if old2 not in text:
    print("[INFO] global state patch already applied")
else:
    text = text.replace(old2, new2)
    print("[OK] Patch 2: global state variables added")

# ── Patch 3: lifespan function ───────────────────────────────────────────────
old3 = (
    "@asynccontextmanager\nasync def lifespan(app: FastAPI):\n"
    "    global engine\n"
    "    model_path = resolve_model_path()\n"
    '    print(f"[service] Preloading GrainShield model from: {model_path}")\n'
    '    requested_device = os.environ.get("GRAINSHIELD_DEVICE", "auto").strip().lower()\n'
    "\n"
    "    try:\n"
    "        import torch\n"
    "        cuda_available = torch.cuda.is_available()\n"
    "    except Exception:\n"
    "        cuda_available = False\n"
    "\n"
    '    if requested_device in {"", "auto"}:\n'
    '        inference_device = "cuda:0" if cuda_available else "cpu"\n'
    '    elif requested_device.startswith("cuda") and not cuda_available:\n'
    "        raise RuntimeError(\n"
    '            "CUDA was requested but is unavailable. Check the PyTorch CUDA installation."\n'
    "        )\n"
    "    else:\n"
    "        inference_device = requested_device\n"
    "\n"
    '    print(f"[service] Selected inference device: {inference_device}")\n'
    "    engine = GrainShieldInferenceEngine(\n"
    "        model_path=model_path,\n"
    "        device=inference_device,\n"
    "    )\n"
    '    print(f"[service] Model loaded successfully. Tesseract: {engine.tesseract_cmd}")\n'
    "    yield\n"
    '    print("[service] Shutting down inference service.")\n'
    "    _executor.shutdown(wait=False)\n"
)
new3 = (
    "@asynccontextmanager\nasync def lifespan(app: FastAPI):\n"
    "    global engine, _startup_time, _plate_model_status\n"
    "    _startup_time = datetime.datetime.utcnow()\n"
    "\n"
    "    # Resolve and validate both models before loading\n"
    "    model_path = resolve_model_path()\n"
    '    print(f"[service] Vehicle model: {model_path}")\n'
    "\n"
    "    try:\n"
    "        plate_model_path = resolve_plate_model_path()\n"
    '        print(f"[service] Plate model:   {plate_model_path}")\n'
    '        _plate_model_status = "found"\n'
    "    except FileNotFoundError as exc:\n"
    "        # Log CRITICAL -- service continues in degraded mode (no plate detector).\n"
    "        # All verifications will route to manual_review when no plate found.\n"
    '        print(f"[service] CRITICAL: plate model not found -- {exc}")\n'
    "        print(\n"
    '            "[service]          Run:  python scripts/deploy_weights.py\\n"\n'
    '            "[service]          Or set PLATE_MODEL_PATH env var before starting."\n'
    "        )\n"
    '        _plate_model_status = "missing"\n'
    "        plate_model_path = None\n"
    "\n"
    '    requested_device = os.environ.get("GRAINSHIELD_DEVICE", "auto").strip().lower()\n'
    "\n"
    "    try:\n"
    "        import torch\n"
    "        cuda_available = torch.cuda.is_available()\n"
    "    except Exception:\n"
    "        cuda_available = False\n"
    "\n"
    '    if requested_device in {"", "auto"}:\n'
    '        inference_device = "cuda:0" if cuda_available else "cpu"\n'
    '    elif requested_device.startswith("cuda") and not cuda_available:\n'
    "        raise RuntimeError(\n"
    '            "CUDA was requested but is unavailable. Check the PyTorch CUDA installation."\n'
    "        )\n"
    "    else:\n"
    "        inference_device = requested_device\n"
    "\n"
    '    print(f"[service] Inference device: {inference_device}")\n'
    "    engine = GrainShieldInferenceEngine(\n"
    "        model_path=model_path,\n"
    "        device=inference_device,\n"
    "        plate_model_path=plate_model_path,\n"
    "    )\n"
    '    _plate_model_status = "loaded"\n'
    "    print(\n"
    '        f"[service] Both models loaded. "\n'
    '        f"Vehicle: {engine.model_path.name}. "\n'
    '        f"Plate: {engine.plate_model_path.name}. "\n'
    '        f"Tesseract: {engine.tesseract_cmd}"\n'
    "    )\n"
    "    yield\n"
    '    print("[service] Shutting down inference service.")\n'
    "    _executor.shutdown(wait=False)\n"
)

# Normalise CRLF -> LF for matching then restore
text_lf = text.replace("\r\n", "\n")
old3_lf = old3.replace("\r\n", "\n")
new3_lf = new3.replace("\r\n", "\n")

if old3_lf not in text_lf:
    print("[INFO] lifespan patch already applied or not found")
else:
    text_lf = text_lf.replace(old3_lf, new3_lf)
    print("[OK] Patch 3: lifespan updated")

# ── Patch 4: health endpoint ─────────────────────────────────────────────────
old4 = (
    '@app.get("/health")\n'
    '@app.get("/")\n'
    '@limiter.limit("120/minute")\n'
    "async def health_check(request: Request):\n"
    '    """Health check endpoint confirming service and model status."""\n'
    "    is_ready = engine is not None and engine.vehicle_model is not None\n"
    "    return {\n"
    '        "status": "healthy" if is_ready else "initializing",\n'
    '        "service": "grainshield-inference",\n'
    '        "version": "1.0.0",\n'
    '        "model_loaded": is_ready,\n'
    '        "device": engine.device if engine else "cpu",\n'
    '        "tesseract": engine.tesseract_cmd if engine else None,\n'
    "    }\n"
)
new4 = (
    '@app.get("/health")\n'
    '@app.get("/")\n'
    '@limiter.limit("120/minute")\n'
    "async def health_check(request: Request):\n"
    "    \"\"\"\n"
    "    Health check endpoint confirming service and both model statuses.\n"
    "\n"
    '    Returns status="healthy" only when both models are loaded.\n'
    '    Returns status="degraded" when plate model is missing -- service is\n'
    "    still operational but all verifications will route to manual_review.\n"
    '    Returns status="initializing" when engine is not yet ready.\n'
    '    """\n'
    "    vehicle_ready = engine is not None and engine.vehicle_model is not None\n"
    "    plate_ready = engine is not None and engine.plate_model is not None\n"
    "    both_ready = vehicle_ready and plate_ready\n"
    "\n"
    "    uptime_seconds = None\n"
    "    if _startup_time is not None:\n"
    "        uptime_seconds = int(\n"
    "            (datetime.datetime.utcnow() - _startup_time).total_seconds()\n"
    "        )\n"
    "\n"
    "    return {\n"
    '        "status": "healthy" if both_ready else ("degraded" if vehicle_ready else "initializing"),\n'
    '        "service": "grainshield-inference",\n'
    '        "version": engine.version if engine else "unknown",\n'
    '        "models": {\n'
    '            "vehicle_detector": {\n'
    '                "loaded": vehicle_ready,\n'
    '                "path": str(engine.model_path.name) if engine else None,\n'
    "            },\n"
    '            "plate_detector": {\n'
    '                "loaded": plate_ready,\n'
    '                "status": _plate_model_status,\n'
    '                "path": str(engine.plate_model_path.name) if (engine and plate_ready) else None,\n'
    "            },\n"
    "        },\n"
    '        "device": engine.device if engine else "cpu",\n'
    '        "tesseract": engine.tesseract_cmd if engine else None,\n'
    '        "uptime_seconds": uptime_seconds,\n'
    "    }\n"
)
old4_lf = old4.replace("\r\n", "\n")
new4_lf = new4.replace("\r\n", "\n")

if old4_lf not in text_lf:
    print("[INFO] health patch already applied or not found")
else:
    text_lf = text_lf.replace(old4_lf, new4_lf)
    print("[OK] Patch 4: /health endpoint upgraded")

# Write with original line endings (CRLF to match the file)
final = text_lf.replace("\n", "\r\n")
file.write_bytes(final.encode("utf-8"))
print(f"\n[DONE] {file} written successfully")
