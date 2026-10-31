"""
GrainShield AI — Computer Vision Inference Engine
Two-stage pipeline: vehicle detection -> plate region extraction -> OCR -> decision.
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
    AI_MODEL_DIR / "yolo26n.pt",
    AI_MODEL_DIR / "weights" / "yolov8n_base.pt",
    REPO_ROOT / "ai-model" / "yolo26n.pt",
]

DEFAULT_TESSERACT_PATHS = [
    Path(os.environ.get("TESSERACT_CMD", "")),
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
]

# COCO class IDs in YOLOv8n
VEHICLE_CLASS_IDS = {2, 5, 7, 3}   # car, bus, truck, motorcycle
PERSON_CLASS_ID = 0

CLASS_ID_TO_TYPE = {2: "car", 5: "bus", 7: "truck", 3: "motorcycle"}

VEHICLE_CATEGORY_MAP = {
    "truck": "heavy_vehicle",
    "bus": "heavy_vehicle",
    "car": "light_vehicle",
    "motorcycle": "two_wheeler",
}

OCR_CONFIG_BASE = (
    "--oem 3 "
    "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

CONFUSION_MAP = {"O": "0", "I": "1", "Z": "2", "S": "5", "B": "8"}

# Indian plate: 2-letter state, 2-digit district, 1-3 letter series, 1-4 digit number
# e.g. GJ05AB1234, MH12DE1433
INDIAN_PLATE_PATTERN = re.compile(
    r"^[A-Z]{2}\d{2}[A-Z]{1,3}\d{1,4}$", re.IGNORECASE
)


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------
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
    """Resolves the vehicle detection model path."""
    for candidate in DEFAULT_MODEL_CANDIDATES:
        if candidate and str(candidate) != "." and candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(
        "Vehicle detection model not found. "
        "Checked default paths and MODEL_PATH environment variable."
    )


# ---------------------------------------------------------------------------
# Plate text helpers
# ---------------------------------------------------------------------------
def clean_plate_text(raw: str) -> str:
    """Normalizes license plate string: uppercase, letters and digits only."""
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def normalize_confusion(text: str) -> str:
    """
    Position-aware confusion normalization for Indian plates (GJ05AB1234).
    Structure: [STATE:2][DISTRICT:2][SERIES:1-3][NUMBER:1-4]
    Only replaces in digit-expected positions (district=2-3, number=last 1-4).
    Letter positions (state code, series letters) are left unchanged.
    """
    cleaned = clean_plate_text(text)
    if not cleaned:
        return cleaned

    # Apply confusion mapping only to the district digits (pos 2-3)
    # and the trailing number portion. Letters in alpha positions untouched.
    # Heuristic: if we have >= 6 chars, treat pos 2-3 as district digits.
    result = list(cleaned)
    for i, c in enumerate(result):
        if i in (2, 3):
            # District positions: expect digits; O->0, I->1, Z->2 etc.
            result[i] = CONFUSION_MAP.get(c, c)
        elif i >= 6:
            # Number suffix: expect digits
            result[i] = CONFUSION_MAP.get(c, c)
        # Positions 0-1 (state code) and 4-5 (series letters): leave as-is
    return "".join(result)


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


def validate_indian_plate(plate: str) -> bool:
    """Returns True if the string matches the Indian number plate format."""
    if not plate:
        return False
    return bool(INDIAN_PLATE_PATTERN.match(plate))


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
    elif is_low_res:
        quality_label = "low_resolution"
    else:
        quality_label = "clear"

    return {
        "width": w,
        "height": h,
        "blur_score": round(laplacian_var, 2),
        "mean_brightness": round(mean_brightness, 2),
        "is_blurry": is_blurry,
        "is_dark": is_dark,
        "is_overexposed": is_overexposed,
        "is_low_res": is_low_res,
        "label": quality_label,
    }


# ---------------------------------------------------------------------------
# Stage 2: Plate region extraction from vehicle crop
# ---------------------------------------------------------------------------
def extract_plate_candidates_from_vehicle(vehicle_crop: np.ndarray, max_candidates: int = 3) -> List[np.ndarray]:
    """
    Finds likely number-plate sub-regions within a vehicle bounding box crop.
    Uses edge detection + contour filtering by plate-like aspect ratio.
    Returns a list of cropped plate candidate arrays (may be empty).
    """
    if vehicle_crop is None or vehicle_crop.size == 0:
        return []

    h, w = vehicle_crop.shape[:2]
    if w < 60 or h < 30:
        return []

    gray = cv2.cvtColor(vehicle_crop, cv2.COLOR_BGR2GRAY)
    # Bilateral filter preserves edges while smoothing noise
    blur = cv2.bilateralFilter(gray, 11, 17, 17)
    edges = cv2.Canny(blur, 30, 200)

    # Morphological operations to join broken edges
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 2))
    edges = cv2.dilate(edges, kernel, iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []
    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        if ch < 8 or cw < 30:
            continue
        area = cw * ch
        if area < 300:
            continue
        # Plate aspect ratio: typically 2.5:1 to 7:1
        aspect = cw / max(ch, 1)
        if not (2.0 <= aspect <= 8.0):
            continue
        # Must be in lower half of vehicle (plates are typically at front/rear bottom)
        rel_y = (y + ch / 2) / h
        if rel_y < 0.15:  # skip very top of vehicle
            continue
        # Score = closeness to ideal plate aspect ratio (4.5) + normalized area
        aspect_score = 1.0 / (1.0 + abs(aspect - 4.5))
        area_score = min(area / (w * h * 0.15), 1.0)
        score = aspect_score * 0.6 + area_score * 0.4
        candidates.append((score, x, y, cw, ch))

    # Sort by score descending
    candidates.sort(key=lambda c: c[0], reverse=True)

    crops = []
    for score, x, y, cw, ch in candidates[:max_candidates]:
        # Add padding
        pad_x = max(4, int(cw * 0.05))
        pad_y = max(2, int(ch * 0.05))
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(w, x + cw + pad_x)
        y2 = min(h, y + ch + pad_y)
        crop = vehicle_crop[y1:y2, x1:x2]
        if crop.size > 0:
            crops.append(crop)

    return crops


# ---------------------------------------------------------------------------
# Stage 3: OCR on plate crop
# ---------------------------------------------------------------------------
def run_plate_ocr(crop: np.ndarray) -> Tuple[str, List, str]:
    """
    Runs OCR on a plate crop using multiple PSM modes.
    Returns (best_text, candidates_list, method_name).
    """
    if crop is None or crop.size == 0:
        return "", [], "none"

    h, w = crop.shape[:2]

    # Upscale small crops for better OCR
    scale = 1.0
    if w < 200:
        scale = max(2.0, 200.0 / w)
    elif w < 400:
        scale = 1.5

    if scale > 1.0:
        new_w = int(w * scale)
        new_h = int(h * scale)
        crop = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

    # Convert to grayscale and apply preprocessing
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop

    # Try multiple preprocessing variants
    preprocessed_variants = []

    # Variant 1: Otsu threshold
    _, thresh_otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    preprocessed_variants.append(("otsu", thresh_otsu))

    # Variant 2: Adaptive threshold
    adapt = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    preprocessed_variants.append(("adaptive", adapt))

    # Variant 3: Inverted Otsu (for dark plates with light text)
    preprocessed_variants.append(("otsu_inv", cv2.bitwise_not(thresh_otsu)))

    # PSM modes to try
    psm_modes = [7, 8, 6, 13]  # single line, single word, block, raw

    candidates = []
    for var_name, img_var in preprocessed_variants:
        for psm in psm_modes:
            config = f"--psm {psm} {OCR_CONFIG_BASE}"
            try:
                raw = pytesseract.image_to_string(img_var, config=config).strip()
                text = clean_plate_text(raw)
                if len(text) >= 4:
                    score = len(text) / 10.0
                    if validate_indian_plate(text):
                        score += 0.5
                    candidates.append({
                        "text": text,
                        "score": round(score, 3),
                        "method": f"{var_name}_psm{psm}",
                    })
            except Exception:
                pass

    if not candidates:
        return "", [], "none"

    # Sort by score descending, take best
    candidates.sort(key=lambda c: c["score"], reverse=True)
    best = candidates[0]

    return best["text"], candidates, best["method"]


# ---------------------------------------------------------------------------
# Inference Engine
# ---------------------------------------------------------------------------
class GrainShieldInferenceEngine:
    """
    Two-stage AI pipeline for GrainShield transport verification:
    1. YOLOv8n vehicle detection (COCO classes)
    2. OpenCV contour-based plate region extraction
    3. Multi-PSM Tesseract OCR
    4. Indian plate format validation & matching
    """

    version = "2.1.0"

    def __init__(
        self,
        model_path: Optional[Path] = None,
        device: str = "cpu",
    ):
        self.model_path = model_path or resolve_model_path()
        self.device = device
        self.tesseract_cmd = configure_tesseract()

        print(f"[inference] Loading vehicle detection model: {self.model_path}")
        self.vehicle_model = YOLO(str(self.model_path))
        print(f"[inference] Model loaded. Tesseract: {self.tesseract_cmd}")

    def analyze_image(self, image_bytes, expected_plate=None, stage=None):
        # Step 1: Decode image
        np_arr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if image is None or image.size == 0:
            return self._error_result("Image could not be decoded", "retake")

        quality = assess_image_quality(image)
        height, width = quality["height"], quality["width"]

        # Step 2: YOLO detection
        results = self.vehicle_model.predict(source=image, conf=0.25, device=self.device, verbose=False)[0]

        vehicles = []
        persons = []

        if results.boxes is not None:
            for box in results.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                coords = [int(v) for v in box.xyxy[0].tolist()]
                entry = {"class_id": cls_id, "confidence": round(conf, 4), "box": coords}
                if cls_id in VEHICLE_CLASS_IDS:
                    entry["vehicle_type"] = CLASS_ID_TO_TYPE.get(cls_id, "vehicle")
                    vehicles.append(entry)
                elif cls_id == PERSON_CLASS_ID:
                    persons.append(entry)

        vehicle_detected = len(vehicles) > 0
        person_detected = len(persons) > 0

        # Determine primary vehicle type
        primary_vehicle_type = None
        if vehicles:
            vehicles.sort(key=lambda v: v["confidence"], reverse=True)
            primary_vehicle_type = vehicles[0]["vehicle_type"]

        # Step 3: Two-stage plate extraction
        best_plate_text = ""
        best_plate_conf = 0.0
        best_method = "none"
        best_crop_box = None
        all_candidates = []
        plate_candidates_found = 0

        for v in vehicles:
            vx1, vy1, vx2, vy2 = v["box"]
            vx1 = max(0, vx1); vy1 = max(0, vy1)
            vx2 = min(width, vx2); vy2 = min(height, vy2)
            vehicle_crop = image[vy1:vy2, vx1:vx2]

            if vehicle_crop.size == 0:
                continue

            # Stage 2: find plate sub-regions in vehicle crop
            plate_crops = extract_plate_candidates_from_vehicle(vehicle_crop, max_candidates=3)
            plate_candidates_found += len(plate_crops)

            # Also try the bottom third of the vehicle crop as a fallback
            if not plate_crops:
                vh = vehicle_crop.shape[0]
                bottom_third = vehicle_crop[int(vh * 0.55):, :]
                if bottom_third.size > 0:
                    plate_crops = [bottom_third]

            for plate_crop in plate_crops:
                text, cands, method = run_plate_ocr(plate_crop)
                if cands:
                    all_candidates.extend(cands)
                if text and not best_plate_text:
                    best_plate_text = text
                    best_plate_conf = v["confidence"]
                    best_method = method
                    best_crop_box = v["box"]

        if not best_plate_conf and vehicles:
            best_plate_conf = vehicles[0]["confidence"]
            best_crop_box = vehicles[0]["box"]

        # Step 4: Plate matching
        normalized_expected = clean_plate_text(expected_plate or "")
        normalized_detected = clean_plate_text(best_plate_text)

        plate_match = False
        similarity = 0.0
        plate_valid_format = validate_indian_plate(normalized_detected) if normalized_detected else False

        if normalized_expected and normalized_detected:
            if normalized_expected == normalized_detected:
                plate_match = True
                similarity = 1.0
            else:
                conf_exp = normalize_confusion(normalized_expected)
                conf_det = normalize_confusion(normalized_detected)
                if conf_exp == conf_det:
                    plate_match = True
                    similarity = 0.98
                else:
                    similarity = similarity_ratio(normalized_expected, normalized_detected)

        # Step 5: FPS last-mile checks
        fps_person_detected = person_detected
        is_fps_stage = stage == "last_mile"

        # Step 6: Decision engine
        decision, reason_code, explanation = self._make_decision(
            quality=quality,
            vehicle_detected=vehicle_detected,
            plate_candidates_found=plate_candidates_found,
            normalized_detected=normalized_detected,
            normalized_expected=normalized_expected,
            plate_valid_format=plate_valid_format,
            plate_match=plate_match,
            similarity=similarity,
            best_plate_conf=best_plate_conf,
            stage=stage,
            fps_person_detected=fps_person_detected,
        )

        evidence_checks = {
            "image_quality": {
                "passed": quality["label"] == "clear",
                "status": quality["label"],
                "blur_score": quality["blur_score"],
                "is_blurry": quality["is_blurry"],
                "is_dark": quality["is_dark"],
                "is_overexposed": quality["is_overexposed"],
                "is_low_res": quality["is_low_res"],
            },
            "vehicle_detection": {
                "passed": vehicle_detected,
                "vehicles_found": len(vehicles),
                "vehicle_type": primary_vehicle_type,
                "vehicle_category": VEHICLE_CATEGORY_MAP.get(primary_vehicle_type, "unknown") if primary_vehicle_type else None,
                "confidence": vehicles[0]["confidence"] if vehicles else None,
                "boxes": [v["box"] for v in vehicles[:3]],
            },
            "plate_extraction": {
                "candidates_found": plate_candidates_found,
                "passed": plate_candidates_found > 0,
            },
            "ocr": {
                "passed": bool(normalized_detected and len(normalized_detected) >= 6),
                "detected_text": best_plate_text or None,
                "normalized": normalized_detected or None,
                "valid_indian_format": plate_valid_format,
                "method": best_method,
                "candidates_count": len(all_candidates),
                "top_candidates": [c["text"] for c in sorted(all_candidates, key=lambda x: x["score"], reverse=True)[:3]],
            },
            "plate_matching": {
                "passed": plate_match,
                "expected": normalized_expected or None,
                "detected": normalized_detected or None,
                "exact_match": normalized_expected == normalized_detected if normalized_expected and normalized_detected else False,
                "similarity_ratio": round(similarity, 3),
                "match": plate_match,
            },
            "fps_checks": {
                "is_fps_stage": is_fps_stage,
                "person_detected": fps_person_detected,
                "person_count": len(persons),
                "banner_ocr_supported": False,
            },
            "reason_code": reason_code,
        }

        return {
            "success": True,
            "imageQuality": quality["label"],
            "vehicleDetected": vehicle_detected,
            "detectedPlate": best_plate_text or None,
            "plateMatch": plate_match,
            "vehicleType": primary_vehicle_type,
            "vehicleCategory": VEHICLE_CATEGORY_MAP.get(primary_vehicle_type, None) if primary_vehicle_type else None,
            "confidence": round(best_plate_conf, 4) if best_plate_conf else 0.0,
            "decision": decision,
            "reasonCode": reason_code,
            "explanation": explanation,
            "processorVersion": self.version,
            "modelVersions": {
                "vehicle_detector": f"yolov8n-{self.model_path.name}",
                "plate_extractor": "opencv-contour-v1",
                "ocr_engine": f"tesseract-{self.tesseract_cmd}",
            },
            "evidenceChecks": evidence_checks,
            "rawOutput": {
                "image": {"width": width, "height": height},
                "vehicles": vehicles,
                "persons": persons,
                "plate_candidates": plate_candidates_found,
                "ocr_candidates": sorted(all_candidates, key=lambda x: x["score"], reverse=True)[:5],
                "stage": stage,
            },
            "error": None,
        }

    def _make_decision(self, quality, vehicle_detected, plate_candidates_found,
                       normalized_detected, normalized_expected, plate_valid_format,
                       plate_match, similarity, best_plate_conf, stage, fps_person_detected):
        """
        Structured decision engine with reason codes.

        RETAKE:  Image quality prevents verification (driver can fix by retaking)
        FAIL:    Evidence clearly violates a mandatory requirement
        PASS:    All mandatory checks pass with high confidence
        MANUAL_REVIEW: Evidence is uncertain; human judgment needed
        """
        # --- Quality gates (RETAKE) ---
        if quality["is_low_res"]:
            return "retake", "image_low_resolution", "Please retake: image resolution is too low (minimum 320x240 required)."
        if quality["is_dark"]:
            return "retake", "image_too_dark", f"Please retake: photograph is too dark (brightness {quality['mean_brightness']:.0f}/255). Use better lighting."
        if quality["is_overexposed"]:
            return "retake", "image_overexposed", f"Please retake: photograph is overexposed (brightness {quality['mean_brightness']:.0f}/255). Reduce glare."
        if quality["is_blurry"] and not vehicle_detected:
            return "retake", "image_blurry_no_vehicle", "Please retake: photograph is too blurry. Hold camera steady and ensure good focus."

        # --- Last-mile FPS delivery ---
        if stage == "last_mile" and not normalized_expected:
            # FPS delivery photo - check for person
            if not fps_person_detected and not vehicle_detected:
                return "retake", "fps_no_person_no_vehicle", "Please retake: no person or vehicle detected. Photograph the FPS owner at the delivery point."
            return "manual_review", "fps_delivery_manual", (
                "Last-mile FPS delivery photograph. "
                + ("FPS person detected. " if fps_person_detected else "No FPS person visible. ")
                + "Automated FPS banner recognition pending - routed to officer review."
            )

        # --- Vehicle required but absent ---
        if not vehicle_detected:
            if quality["is_blurry"]:
                return "retake", "vehicle_not_found_blurry", "Please retake: photograph is blurry and no vehicle could be detected."
            return "manual_review", "no_vehicle_detected", "No vehicle detected in photograph. Routed to manual review."

        # --- No expected plate to compare against ---
        if not normalized_expected:
            return "manual_review", "no_expected_plate", (
                f"Vehicle detected ({normalized_detected or 'plate unreadable'}) but no assigned vehicle registration provided for matching. Routed to manual review."
            )

        # --- Plate extracted and matched ---
        if plate_match and best_plate_conf >= 0.50 and quality["label"] in ("clear",):
            return "pass", "plate_verified", (
                f"License plate verified: {normalized_detected} matches assigned vehicle {normalized_expected} "
                f"(detector confidence {best_plate_conf * 100:.1f}%, quality: {quality['label']})."
            )

        # --- Plate format valid but mismatch ---
        if plate_valid_format and normalized_detected and not plate_match and similarity < 0.50:
            return "fail", "plate_mismatch", (
                f"Plate mismatch: detected {normalized_detected} does not match assigned vehicle {normalized_expected} "
                f"(similarity {similarity * 100:.0f}%). This may indicate a wrong vehicle."
            )

        # --- Plate found, close match (1-2 chars off) ---
        if normalized_detected and similarity >= 0.70:
            return "manual_review", "plate_close_match", (
                f"Close but uncertain plate match: detected {normalized_detected}, expected {normalized_expected} "
                f"(similarity {similarity * 100:.0f}%). Routed to officer verification."
            )

        # --- Plate extracted but OCR unclear ---
        if plate_candidates_found > 0 and not normalized_detected:
            return "retake", "plate_found_ocr_failed", "Plate region detected but text could not be read. Please retake closer to the vehicle."

        # --- No plate region found but vehicle present ---
        if vehicle_detected and plate_candidates_found == 0:
            return "retake", "plate_not_visible", "Vehicle detected but registration plate is not clearly visible. Please retake showing the plate."

        # --- Fallback: manual review ---
        return "manual_review", "ocr_uncertain", (
            f"Plate region {'found' if plate_candidates_found > 0 else 'not found'}, "
            f"OCR result {('\"' + normalized_detected + '\"') if normalized_detected else 'unclear'}. "
            "Routed to manual review."
        )

    def _error_result(self, message, decision):
        return {
            "success": False,
            "imageQuality": None,
            "vehicleDetected": False,
            "detectedPlate": None,
            "plateMatch": False,
            "vehicleType": None,
            "vehicleCategory": None,
            "confidence": 0.0,
            "decision": decision,
            "reasonCode": "decode_error",
            "explanation": message,
            "processorVersion": self.version,
            "modelVersions": {},
            "evidenceChecks": {"decode": {"passed": False}},
            "rawOutput": None,
            "error": message,
        }