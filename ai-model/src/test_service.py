"""
GrainShield AI -- Test Suite for Inference Service
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
from src.server import API_KEY, app

AUTH_HEADERS = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}

client = TestClient(app)

# Use the real test_images directory (always present in the repo)
TEST_IMAGES_DIR = Path(__file__).resolve().parents[1] / "test_images"
SAMPLE_IMAGE_PATH = TEST_IMAGES_DIR / "1.jpeg"


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
            headers=AUTH_HEADERS,
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
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["decision"] == "retake"


def test_plate_verification_real_image():
    """Verify that submitting a real test image returns a structured success response."""
    assert SAMPLE_IMAGE_PATH.exists(), f"Sample image missing: {SAMPLE_IMAGE_PATH}"
    with open(SAMPLE_IMAGE_PATH, "rb") as f:
        img_bytes = f.read()

    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("plate.jpg", img_bytes, "image/jpeg")},
            data={"expected_plate": "GJ05AB1234", "stage": "first_mile"},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        # Decision must be one of the valid values
        assert data["decision"] in ("pass", "fail", "manual_review", "retake")
        assert data["imageQuality"] is not None
        assert "evidenceChecks" in data
        assert "vehicle_detection" in data["evidenceChecks"]
        assert "plate_extraction" in data["evidenceChecks"]
        assert data["processorVersion"] == "2.1.0"


def test_plate_verification_no_expected_plate():
    """Verify that submitting without an expected plate routes to manual_review."""
    assert SAMPLE_IMAGE_PATH.exists(), f"Sample image missing: {SAMPLE_IMAGE_PATH}"
    with open(SAMPLE_IMAGE_PATH, "rb") as f:
        img_bytes = f.read()

    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("plate.jpg", img_bytes, "image/jpeg")},
            data={"stage": "first_mile"},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        # Without expected plate, must never auto-pass
        assert data["decision"] != "pass"


def test_blurry_image_triggers_retake():
    """Verify that a synthetic heavily blurred image triggers retake or manual_review."""
    # Create a 640x480 uniform grey image and apply heavy blur (no edges at all)
    blank = np.full((480, 640, 3), 128, dtype=np.uint8)
    blurred = cv2.GaussianBlur(blank, (51, 51), 0)
    _, encoded = cv2.imencode(".jpg", blurred)

    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("blurred.jpg", encoded.tobytes(), "image/jpeg")},
            data={"expected_plate": "GJ01AB1234", "stage": "first_mile"},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        # Blurry + no vehicle -> retake; blurry + vehicle detected -> manual_review or retake
        assert data["decision"] in ("retake", "manual_review")
        assert data["success"] is True


def test_fps_delivery_routes_to_manual_review_or_retake():
    """Verify that an FPS delivery photograph (blank shop image) is handled safely."""
    blank = np.full((480, 640, 3), 120, dtype=np.uint8)
    # Add text simulating a shop banner
    cv2.putText(blank, "FAIR PRICE SHOP 42", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    _, encoded = cv2.imencode(".jpg", blank)

    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("fps.jpg", encoded.tobytes(), "image/jpeg")},
            data={"expected_plate": "", "stage": "last_mile"},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        # For FPS last-mile with no expected plate, system should route to manual_review or retake
        assert data["decision"] in ("manual_review", "retake")
        assert data["success"] is True


def test_reject_unauthorized_when_api_key_set():
    """Verify that requests without valid Authorization header are rejected with 401."""
    if not API_KEY:
        return
    with TestClient(app) as tc:
        resp = tc.post(
            "/verify",
            files={"image": ("sample.txt", b"not an image", "text/plain")},
            data={"expected_plate": "GJ01AB1234"},
        )
        assert resp.status_code == 401


if __name__ == "__main__":
    print("Running GrainShield AI test suite...")
    test_health_endpoint()
    print("+ test_health_endpoint passed")
    test_reject_unsupported_mime()
    print("+ test_reject_unsupported_mime passed")
    test_reject_empty_file()
    print("+ test_reject_empty_file passed")
    test_reject_unauthorized_when_api_key_set()
    print("+ test_reject_unauthorized_when_api_key_set passed")
    test_plate_verification_real_image()
    print("+ test_plate_verification_real_image passed")
    test_plate_verification_no_expected_plate()
    print("+ test_plate_verification_no_expected_plate passed")
    test_blurry_image_triggers_retake()
    print("+ test_blurry_image_triggers_retake passed")
    test_fps_delivery_routes_to_manual_review_or_retake()
    print("+ test_fps_delivery_routes_to_manual_review_or_retake passed")
    print("\nALL INFERENCE SERVICE TESTS PASSED!")