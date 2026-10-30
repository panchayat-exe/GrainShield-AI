"""
GrainShield AI — Inference HTTP Service
Provides a REST API for license plate detection, OCR, and transport verification.
"""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional

# Ensure ai-model directory is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.inference import GrainShieldInferenceEngine, resolve_model_path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MAX_FILE_SIZE_BYTES = int(os.environ.get("MAX_FILE_SIZE_BYTES", str(10 * 1024 * 1024)))  # 10 MB
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/jpg"}
API_KEY = os.environ.get("CV_API_KEY", "").strip()

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


app = FastAPI(
    title="GrainShield AI Inference Service",
    description="Automated photograph verification for Gujarat food grain transport (GSCSCL).",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
async def health_check():
    """Health check endpoint confirming service and model status."""
    is_ready = engine is not None and engine.model is not None
    return {
        "status": "healthy" if is_ready else "initializing",
        "service": "grainshield-inference",
        "version": "1.0.0",
        "model_loaded": is_ready,
        "device": engine.device if engine else "cpu",
        "tesseract": engine.tesseract_cmd if engine else None,
    }


@app.post("/verify")
async def verify_image(
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

    # Run inference pipeline
    try:
        result = engine.analyze_image(
            image_bytes=image_bytes,
            expected_plate=expected_plate,
            stage=stage,
        )
        return result
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
