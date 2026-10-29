"""
GrainShield AI — Test Suite for Inference Service
Tests the FastAPI endpoints, file validations, image quality checks, and decision rules.
"""

import sys
from pathlib import Path

# Ensure ai-model directory is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import io
import cv2
import numpy as np
from fastapi.testclient import TestClient
from src.server import app

client = TestClient(app)

DATASET_DIR = Path(__file__).resolve().parents[1] / "datasets" / "Indian License Plate Detection.v1i.yolov8" / "test" / "images"
SAMPLE_IMAGE_PATH = DATASET_DIR / "drop-car-front_1032_jpg.rf.99da9c0cca2a81fab7e32cad6fee2a2a.jpg"


def test_health_endpoint():
    """Verify health endpoint reports healthy with model and tesseract available."""
    with TestClient(app) as tc:
        resp = tc.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["model_loaded"] is True
        assert data["service"] == "grainshield-inference"


def test_reject_unsupported_mime():
    """Verify rejection of invalid file type with 400 and structured response."""
    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("sample.txt", b"not an image", "text/plain")},
            data={"expected_plate": "GJ01AB1234"},
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["decision"] == "retake"
        assert "Unsupported file type" in data["explanation"]


def test_reject_empty_file():
    """Verify rejection of empty file (0 bytes)."""
    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("empty.jpg", b"", "image/jpeg")},
            data={"expected_plate": "GJ01AB1234"},
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["decision"] == "retake"


def test_plate_verification_pass():
    """Verify that a genuine matching plate yields decision='pass'."""
    assert SAMPLE_IMAGE_PATH.exists(), f"Sample image missing: {SAMPLE_IMAGE_PATH}"
    with open(SAMPLE_IMAGE_PATH, "rb") as f:
        img_bytes = f.read()

    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("plate.jpg", img_bytes, "image/jpeg")},
            data={"expected_plate": "KA03HN3397", "stage": "first_mile"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["decision"] == "pass"
        assert data["plateMatch"] is True
        assert data["vehicleDetected"] is True
        assert data["confidence"] > 0.70
        assert data["imageQuality"] == "clear"


def test_plate_verification_mismatch_manual_review():
    """Verify that a plate mismatch routes to manual review, never auto-pass."""
    with open(SAMPLE_IMAGE_PATH, "rb") as f:
        img_bytes = f.read()

    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("plate.jpg", img_bytes, "image/jpeg")},
            data={"expected_plate": "GJ01ZZ9999", "stage": "first_mile"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["decision"] == "manual_review"
        assert data["plateMatch"] is False
        assert "does not match" in data["explanation"]


def test_blurry_image_triggers_retake():
    """Verify that a synthetic heavily blurred image is classified as blurry and triggers retake."""
    # Create a 640x480 dark grey image with no features and heavy blur
    blank = np.full((480, 640, 3), 128, dtype=np.uint8)
    blurred = cv2.GaussianBlur(blank, (51, 51), 0)
    _, encoded = cv2.imencode(".jpg", blurred)

    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("blurred.jpg", encoded.tobytes(), "image/jpeg")},
            data={"expected_plate": "GJ01AB1234", "stage": "first_mile"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["decision"] in ("retake", "manual_review")
        assert data["imageQuality"] == "blurry" or data["decision"] == "retake"


def test_fps_delivery_routes_to_manual_review():
    """Verify that an FPS delivery photograph without vehicle plate is safely routed to manual review."""
    blank = np.full((480, 640, 3), 120, dtype=np.uint8)
    # Add random text simulating a shop banner
    cv2.putText(blank, "FAIR PRICE SHOP #42", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    _, encoded = cv2.imencode(".jpg", blank)

    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("fps.jpg", encoded.tobytes(), "image/jpeg")},
            data={"expected_plate": "", "stage": "last_mile"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["decision"] == "manual_review"
        assert "FPS" in data["explanation"]


if __name__ == "__main__":
    print("Running GrainShield AI test suite...")
    test_health_endpoint()
    print("✓ test_health_endpoint passed")
    test_reject_unsupported_mime()
    print("✓ test_reject_unsupported_mime passed")
    test_reject_empty_file()
    print("✓ test_reject_empty_file passed")
    test_plate_verification_pass()
    print("✓ test_plate_verification_pass passed")
    test_plate_verification_mismatch_manual_review()
    print("✓ test_plate_verification_mismatch_manual_review passed")
    test_blurry_image_triggers_retake()
    print("✓ test_blurry_image_triggers_retake passed")
    test_fps_delivery_routes_to_manual_review()
    print("✓ test_fps_delivery_routes_to_manual_review passed")
    print("\nALL INFERENCE SERVICE TESTS PASSED!")
