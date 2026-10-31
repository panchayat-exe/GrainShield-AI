"""
GrainShield AI -- Inference HTTP Service
Provides a REST API for license plate detection, OCR, and transport verification.
"""

from __future__ import annotations

import asyncio
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional

# Ensure ai-model directory is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from src.inference import GrainShieldInferenceEngine, resolve_model_path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MAX_FILE_SIZE_BYTES = int(os.environ.get("MAX_FILE_SIZE_BYTES", str(10 * 1024 * 1024)))  # 10 MB
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/jpg"}
API_KEY = os.environ.get("CV_API_KEY", "").strip()

_raw_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://localhost:8080,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:8080"
)
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").lower()
if not API_KEY:
    if ENVIRONMENT == "production":
        print("[security] FATAL: CV_API_KEY must be set in production. Exiting.")
        sys.exit(1)
    else:
        print("[security] WARNING: CV_API_KEY is not set. /verify endpoint is unprotected.")
        print("[security]          Set CV_API_KEY in .env for production deployments.")

# Thread pool for blocking inference calls
_executor = ThreadPoolExecutor(max_workers=2)

# Global engine instance pre-loaded at startup
engine: Optional[GrainShieldInferenceEngine] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    model_path = resolve_model_path()
    print(f"[service] Preloading GrainShield model from: {model_path}")
    engine = GrainShieldInferenceEngine(model_path=model_path, device="cpu")
    print(f"[service] Model loaded successfully. Tesseract: {engine.tesseract_cmd}")
    yield
    print("[service] Shutting down inference service.")
    _executor.shutdown(wait=False)


app = FastAPI(
    title="GrainShield AI Inference Service",
    description="Automated photograph verification for Gujarat food grain transport (GSCSCL).",
    version="1.0.0",
    lifespan=lifespan,
)

# Rate limiting
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Security Helper
# ---------------------------------------------------------------------------
def verify_api_key(authorization: Optional[str] = None):
    """If CV_API_KEY is configured in the environment, verifies Bearer token."""
    if not API_KEY:
        return  # Open for local worker calls if key is not set
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )
    token = authorization.replace("Bearer ", "").strip()
    if token != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
        )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
@app.get("/")
@limiter.limit("120/minute")
async def health_check(request: Request):
    """Health check endpoint confirming service and model status."""
    is_ready = engine is not None and engine.vehicle_model is not None
    return {
        "status": "healthy" if is_ready else "initializing",
        "service": "grainshield-inference",
        "version": "1.0.0",
        "model_loaded": is_ready,
        "device": engine.device if engine else "cpu",
        "tesseract": engine.tesseract_cmd if engine else None,
    }


@app.post("/verify")
@limiter.limit("10/minute")
async def verify_image(
    request: Request,
    image: UploadFile = File(...),
    expected_plate: Optional[str] = Form(None),
    stage: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
):
    """
    Analyzes an uploaded evidence photograph.
    Expects multipart/form-data with:
      - image: Uploaded JPEG/PNG/WebP file
      - expected_plate: Expected registration number (optional but recommended)
      - stage: Transport stage: 'first_mile' | 'mid_mile' | 'last_mile' (optional)
    """
    verify_api_key(authorization)

    if not engine:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Inference engine is not yet initialized",
        )

    # Validate MIME type
    content_type = (image.content_type or "").lower()
    if content_type and content_type not in ALLOWED_MIME_TYPES:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "imageQuality": None,
                "vehicleDetected": False,
                "detectedPlate": None,
                "plateMatch": False,
                "vehicleType": None,
                "confidence": 0.0,
                "decision": "retake",
                "explanation": f"Unsupported file type: {content_type}. Please upload JPEG, PNG, or WebP.",
                "processorVersion": engine.version,
                "evidenceChecks": {"mime_type": {"passed": False, "type": content_type}},
                "rawOutput": None,
                "error": f"Invalid MIME type: {content_type}",
            },
        )

    # Read image bytes with size limit guard
    image_bytes = await image.read()
    if len(image_bytes) == 0:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "imageQuality": None,
                "vehicleDetected": False,
                "detectedPlate": None,
                "plateMatch": False,
                "vehicleType": None,
                "confidence": 0.0,
                "decision": "retake",
                "explanation": "Uploaded file is empty (0 bytes). Please select a valid photo.",
                "processorVersion": engine.version,
                "evidenceChecks": {"file_size": {"passed": False, "bytes": 0}},
                "rawOutput": None,
                "error": "Empty file",
            },
        )

    if len(image_bytes) > MAX_FILE_SIZE_BYTES:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={
                "success": False,
                "imageQuality": None,
                "vehicleDetected": False,
                "detectedPlate": None,
                "plateMatch": False,
                "vehicleType": None,
                "confidence": 0.0,
                "decision": "retake",
                "explanation": f"Photograph exceeds maximum permitted size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB.",
                "processorVersion": engine.version,
                "evidenceChecks": {"file_size": {"passed": False, "bytes": len(image_bytes)}},
                "rawOutput": None,
                "error": "File size exceeds limit",
            },
        )

    # Run inference pipeline in thread pool with timeout
    try:
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                lambda: engine.analyze_image(
                    image_bytes=image_bytes,
                    expected_plate=expected_plate,
                    stage=stage,
                )
            ),
            timeout=90.0
        )
        return result
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Inference timeout after 90s")
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "imageQuality": None,
                "vehicleDetected": False,
                "detectedPlate": None,
                "plateMatch": False,
                "vehicleType": None,
                "confidence": 0.0,
                "decision": "error",
                "explanation": f"Inference processing error: {str(e)}",
                "processorVersion": engine.version if engine else "unknown",
                "evidenceChecks": None,
                "rawOutput": None,
                "error": str(e),
            },
        )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    print(f"Starting GrainShield AI Inference Service on http://{host}:{port}")
    uvicorn.run("src.server:app", host=host, port=port, reload=False)