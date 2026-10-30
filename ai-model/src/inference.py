"""
GrainShield AI — Computer Vision Inference Engine
Loads YOLO license-plate detection model and runs OCR & quality checks.
"""

from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import pytesseract
from ultralytics import YOLO

# ---------------------------------------------------------------------------
# Path Configuration & Defaults
# ---------------------------------------------------------------------------
AI_MODEL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AI_MODEL_DIR.parent

DEFAULT_MODEL_CANDIDATES = [
    Path(os.environ.get("MODEL_PATH", "")),
    REPO_ROOT / "runs" / "detect" / "runs" / "plate_detection" / "baseline" / "weights" / "best.pt",
    AI_MODEL_DIR.parent / "runs" / "detect" / "runs" / "plate_detection" / "baseline" / "weights" / "best.pt",
    AI_MODEL_DIR / "runs" / "plate_detection" / "baseline" / "weights" / "best.pt",
    REPO_ROOT / "runs" / "detect" / "train" / "weights" / "best.pt",
    # Fallback: base pretrained YOLO model (lower plate accuracy but allows server to start)
    AI_MODEL_DIR / "yolo26n.pt",
    REPO_ROOT / "ai-model" / "yolo26n.pt",
]

DEFAULT_TESSERACT_PATHS = [
    Path(os.environ.get("TESSERACT_CMD", "")),
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
]

OCR_CONFIG_BASE = (
    "--oem 3 "
    "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

# Character confusions typical in Indian license plate OCR
CONFUSION_MAP = {
    "O": "0",
    "I": "1",
    "Z": "2",
    "S": "5",
    "B": "8",
}


def configure_tesseract() -> str:
    """Finds and configures the Tesseract binary path."""
    for path in DEFAULT_TESSERACT_PATHS:
        if path and str(path) != "." and path.is_file():
            pytesseract.pytesseract.tesseract_cmd = str(path)
            return str(path)

    cmd = shutil.which("tesseract")
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
        return cmd

    return pytesseract.pytesseract.tesseract_cmd


def resolve_model_path() -> Path:
    """Resolves the trained plate detection model path."""
    for candidate in DEFAULT_MODEL_CANDIDATES:
        if candidate and str(candidate) != "." and candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(
        "Trained plate detection model not found. "
        "Checked default paths and MODEL_PATH environment variable."
    )


def clean_plate_text(raw: str) -> str:
    """Normalizes license plate string: uppercase, letters and digits only."""
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def normalize_confusion(text: str) -> str:
    """Replaces easily confused letters with digits for resilient comparison."""
    cleaned = clean_plate_text(text)
    return "".join(CONFUSION_MAP.get(c, c) for c in cleaned)


def levenshtein_distance(s1: str, s2: str) -> int:
    """Computes Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    previous_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]


def similarity_ratio(s1: str, s2: str) -> float:
    """Computes a normalized similarity score between 0.0 and 1.0."""
    max_len = max(len(s1), len(s2))
    if max_len == 0:
        return 1.0
    dist = levenshtein_distance(s1, s2)
    return max(0.0, 1.0 - (dist / max_len))


# ---------------------------------------------------------------------------
# Quality Assessment
# ---------------------------------------------------------------------------
def assess_image_quality(image: np.ndarray) -> Dict[str, Any]:
    """
    Computes image quality metrics:
    - Dimensions (resolution)
    - Blur score (Laplacian variance)
    - Brightness / darkness (mean luminance)
    """
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean_brightness = float(np.mean(gray))

    # Assessment thresholds
    is_low_res = (w < 320 or h < 240)
    is_blurry = laplacian_var < 50.0
    is_dark = mean_brightness < 40.0
    is_overexposed = mean_brightness > 235.0

    if is_blurry:
        quality_label = "blurry"
    elif is_dark:
        quality_label = "dark"
    elif is_overexposed:
        quality_label = "overexposed"
    else:
        quality_label = "clear"

    return {
        "label": quality_label,
        "width": w,
        "height": h,
        "blur_score": round(laplacian_var, 2),
        "blur_threshold": 50.0,
        "is_blurry": is_blurry,
        "mean_brightness": round(mean_brightness, 2),
        "is_dark": is_dark,
        "is_overexposed": is_overexposed,
        "is_low_res": is_low_res,
    }


# ---------------------------------------------------------------------------
# Plate OCR Pipeline
# ---------------------------------------------------------------------------
def run_plate_ocr(crop: np.ndarray) -> Tuple[str, List[Dict[str, Any]], str]:
    """
    Applies multi-stage image preprocessing and Tesseract OCR with multiple PSMs.
    Returns: (best_text, all_candidates, best_method)
    """
    if crop is None or crop.size == 0:
        return "", [], "empty_crop"

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.copyMakeBorder(gray, 14, 14, 14, 14, cv2.BORDER_CONSTANT, value=255)
    gray = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    otsu = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    adaptive = cv2.adaptiveThreshold(
        clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )

    variants = [
        ("adaptive", adaptive),
        ("clahe", clahe),
        ("otsu", otsu),
        ("grayscale", gray),
    ]

    candidates: List[Dict[str, Any]] = []

    for method_name, processed in variants:
        for psm in (7, 8, 13):
            config = f"{OCR_CONFIG_BASE} --psm {psm}"
            try:
                raw_text = pytesseract.image_to_string(processed, config=config)
            except Exception:
                continue

            cleaned = clean_plate_text(raw_text)
            if not cleaned:
                continue

            # Score based on typical Indian plate length (8-10 alphanumeric chars)
            score = len(cleaned)
            if 8 <= len(cleaned) <= 10:
                score += 5
            elif 5 <= len(cleaned) <= 7:
                score += 2
            elif len(cleaned) < 5:
                score -= 3

            # Bonus for starting with typical state code format (2 letters)
            if re.match(r"^[A-Z]{2}\d{1,2}", cleaned):
                score += 4

            candidates.append({
                "score": score,
                "text": cleaned,
                "raw": raw_text.strip(),
                "method": f"{method_name}-psm{psm}",
            })

    if not candidates:
        return "", [], "no_readable_text"

    candidates.sort(key=lambda c: c["score"], reverse=True)
    best = candidates[0]
    return best["text"], candidates, best["method"]


# ---------------------------------------------------------------------------
# Inference Engine Class
# ---------------------------------------------------------------------------
class GrainShieldInferenceEngine:
    def __init__(self, model_path: Optional[Path] = None, device: str = "cpu"):
        self.device = device
        self.tesseract_cmd = configure_tesseract()
        self.model_path = model_path or resolve_model_path()
        self.model = YOLO(str(self.model_path))
        self.version = "grainshield-yolo-v1"

    def analyze_image(
        self,
        image_bytes: bytes,
        expected_plate: Optional[str] = None,
        stage: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Runs complete analysis on an uploaded image:
        1. Decode image and validate structure.
        2. Assess image quality (blur, darkness, resolution).
        3. Detect plate bounding boxes with YOLO model.
        4. Crop plates and perform OCR.
        5. Evaluate stage-specific rules and plate matching.
        6. Determine defensible decision: pass | retake | manual_review.
        """
        # Step 1: Decode image
        np_arr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if image is None or image.size == 0:
            return {
                "success": False,
                "imageQuality": None,
                "vehicleDetected": False,
                "detectedPlate": None,
                "plateMatch": False,
                "vehicleType": None,
                "confidence": 0.0,
                "decision": "retake",
                "explanation": "Image could not be decoded. The file may be corrupted or unsupported.",
                "processorVersion": self.version,
                "evidenceChecks": {"decode": {"passed": False}},
                "rawOutput": None,
                "error": "Failed to decode image",
            }

        quality = assess_image_quality(image)
        height, width = quality["height"], quality["width"]

        # Step 2: YOLO Detection
        results = self.model.predict(
            source=image,
            conf=0.25,
            device=self.device,
            verbose=False,
        )[0]

        detected_boxes: List[Dict[str, Any]] = []
        if results.boxes is not None and len(results.boxes) > 0:
            for box in results.boxes:
                conf = float(box.conf[0])
                coords = [int(v) for v in box.xyxy[0].tolist()]
                detected_boxes.append({
                    "confidence": round(conf, 4),
                    "box": coords,
                })

        vehicle_detected = len(detected_boxes) > 0
        best_plate_text = ""
        best_plate_conf = 0.0
        best_method = "none"
        best_crop_box: Optional[List[int]] = None
        all_candidates: List[Dict[str, Any]] = []

        # Sort by confidence descending
        detected_boxes.sort(key=lambda b: b["confidence"], reverse=True)

        for b in detected_boxes:
            conf = b["confidence"]
            x1, y1, x2, y2 = b["box"]
            x1 = max(0, min(x1, width - 1))
            x2 = max(0, min(x2, width))
            y1 = max(0, min(y1, height - 1))
            y2 = max(0, min(y2, height))

            crop = image[y1:y2, x1:x2]
            if crop.size == 0:
                continue

            text, candidates, method = run_plate_ocr(crop)
            if candidates:
                all_candidates.extend(candidates)

            if text and not best_plate_text:
                best_plate_text = text
                best_plate_conf = conf
                best_method = method
                best_crop_box = [x1, y1, x2, y2]

        if not best_plate_conf and detected_boxes:
            best_plate_conf = detected_boxes[0]["confidence"]
            best_crop_box = detected_boxes[0]["box"]

        # Step 3: Registration Matching
        normalized_expected = clean_plate_text(expected_plate or "")
        normalized_detected = clean_plate_text(best_plate_text)

        plate_match = False
        similarity = 0.0

        if normalized_expected and normalized_detected:
            # Check exact match
            if normalized_expected == normalized_detected:
                plate_match = True
                similarity = 1.0
            else:
                # Check normalized confusion match (e.g. 0/O, 8/B)
                conf_exp = normalize_confusion(normalized_expected)
                conf_det = normalize_confusion(normalized_detected)
                if conf_exp == conf_det:
                    plate_match = True
                    similarity = 0.98
                else:
                    similarity = similarity_ratio(normalized_expected, normalized_detected)
                    # If high similarity (e.g. 1 character off in 10-char plate), plateMatch is False for strict safety
                    plate_match = False

        # Step 4: Stage & Evidence Rules
        # Stage requirements:
        # First Mile: FCI or GSCSCL godown departure/arrival -> needs vehicle & plate.
        # Last Mile:
        #   - Start: needs vehicle & plate
        #   - FPS delivery: FPS owner/person + FPS board/banner
        is_fps_delivery = (
            stage == "last_mile" and
            (not expected_plate or not vehicle_detected)
        )

        decision: str
        explanation: str

        evidence_checks: Dict[str, Any] = {
            "image_quality": {
                "status": quality["label"],
                "blur_score": quality["blur_score"],
                "is_blurry": quality["is_blurry"],
                "is_dark": quality["is_dark"],
                "is_overexposed": quality["is_overexposed"],
                "is_low_res": quality["is_low_res"],
            },
            "plate_detection": {
                "detected": vehicle_detected,
                "confidence": round(best_plate_conf, 4) if best_plate_conf else None,
                "boxes_found": len(detected_boxes),
                "box": best_crop_box,
            },
            "ocr": {
                "detected_text": best_plate_text or None,
                "method": best_method,
                "candidates_count": len(all_candidates),
                "top_candidates": [c["text"] for c in all_candidates[:3]],
            },
            "plate_matching": {
                "expected": normalized_expected or None,
                "detected": normalized_detected or None,
                "exact_match": normalized_expected == normalized_detected if normalized_expected and normalized_detected else False,
                "similarity_ratio": round(similarity, 3),
                "match": plate_match,
            },
            "stage_compliance": {
                "stage": stage or "unspecified",
                "is_fps_delivery": is_fps_delivery,
                "vehicle_classification_supported": False,
                "fps_banner_recognition_supported": False,
            },
        }

        # Step 5: Decision Logic
        if quality["is_low_res"] or quality["is_dark"] or quality["is_overexposed"] or (quality["is_blurry"] and not vehicle_detected):
            decision = "retake"
            reasons = []
            if quality["is_blurry"]:
                reasons.append("photograph is blurry")
            if quality["is_dark"]:
                reasons.append("lighting is too dark")
            if quality["is_overexposed"]:
                reasons.append("image is overexposed")
            if quality["is_low_res"]:
                reasons.append("resolution is too low")
            explanation = f"Please retake photograph: {', '.join(reasons)}."

        elif stage == "last_mile" and not vehicle_detected:
            # Last-mile delivery photograph at FPS requiring person/banner verification
            decision = "manual_review"
            explanation = (
                "Last-mile FPS delivery photograph uploaded. Automated FPS owner and "
                "banner recognition is not configured; routed to officer manual review."
            )

        elif not vehicle_detected:
            # Vehicle/plate required but not detected in a clear image
            decision = "manual_review"
            explanation = "No vehicle license plate could be detected in the photograph. Routed to manual review."

        elif not normalized_expected:
            # Plate detected, but no expected plate provided to compare against
            decision = "manual_review"
            explanation = (
                f"License plate detected ({best_plate_text or 'unreadable'}) but no assigned "
                "vehicle registration was provided for validation. Routed to manual review."
            )

        elif plate_match and best_plate_conf >= 0.70 and quality["label"] == "clear":
            # Confirmed match with high detector confidence and clear image
            decision = "pass"
            explanation = (
                f"License plate verified ({best_plate_text}) matching assigned vehicle "
                f"({normalized_expected}) with {best_plate_conf * 100:.1f}% detector confidence."
            )

        elif normalized_detected and similarity >= 0.75:
            # Close match (e.g. 1-2 characters off or confusion) -> manual review, NEVER auto-pass
            decision = "manual_review"
            explanation = (
                f"Detected plate ({normalized_detected}) is a close but uncertain match "
                f"with assigned vehicle ({normalized_expected}) (similarity: {similarity * 100:.0f}%). "
                "Routed to manual review."
            )

        elif not normalized_detected or len(normalized_detected) < 4:
            # Plate detected by YOLO, but OCR could not read clear characters
            decision = "manual_review"
            explanation = (
                f"Plate bounding box detected with {best_plate_conf * 100:.1f}% confidence, "
                "but plate text was illegible or obscured. Routed to manual review."
            )

        else:
            # Plate detected and read, but does NOT match expected vehicle
            decision = "manual_review"
            explanation = (
                f"Detected plate ({normalized_detected}) does not match assigned vehicle "
                f"({normalized_expected}). Routed to officer manual review."
            )

        return {
            "success": True,
            "imageQuality": quality["label"],
            "vehicleDetected": vehicle_detected,
            "detectedPlate": best_plate_text or None,
            "plateMatch": plate_match,
            "vehicleType": None,  # Unsupported without custom classifier; marked in evidenceChecks
            "confidence": round(best_plate_conf, 4) if best_plate_conf else 0.0,
            "decision": decision,
            "explanation": explanation,
            "processorVersion": self.version,
            "evidenceChecks": evidence_checks,
            "rawOutput": {
                "image": {"width": width, "height": height},
                "detections": detected_boxes,
                "ocr_candidates": all_candidates[:5],
                "stage": stage,
            },
            "error": None,
        }
