"""
GrainShield AI — Plate normalisation & decision engine (no heavy ML dependencies).

Pure-Python helpers that can be imported in unit tests without torch / cv2 / ultralytics.
Provides position-aware Indian registration normalisation, Levenshtein distance,
adversarial safety checks, and strict decision boundaries.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
# Position-aware confusion maps for Indian number plates
# e.g. GJ05AB1234
DIGIT_CONFUSION_MAP: dict[str, str] = {
    "O": "0",
    "Q": "0",
    "D": "0",
    "I": "1",
    "L": "1",
    "Z": "2",
    "S": "5",
    "B": "8",
    "G": "6",
}
CONFUSION_MAP = DIGIT_CONFUSION_MAP  # Backwards compatibility alias

LETTER_CONFUSION_MAP: dict[str, str] = {
    "0": "O",
    "1": "I",
    "2": "Z",
    "5": "S",
    "8": "B",
}

# Standard Indian registration format:
# 2-letter state code, 2-digit district code, 1-3 letter series, 1-4 digit number
# e.g. GJ05AB1234, MH12DE1433, DL01A1234
INDIAN_PLATE_PATTERN = re.compile(
    r"^[A-Z]{2}\d{2}[A-Z]{1,3}\d{1,4}$", re.IGNORECASE
)

# Standard Indian state and union territory prefixes
INDIAN_STATE_CODES = {
    "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DD", "DL", "DN", "GA", "GJ",
    "HP", "HR", "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP",
    "MZ", "NL", "OD", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK", "UP", "WB"
}


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------
def clean_plate_text(raw: str | None) -> str:
    """Normalises license plate string: uppercase, alphanumeric characters only."""
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def normalize_confusion(text: str) -> str:
    """
    Conservative, position-aware confusion normalisation for Indian plates.
    
    Structure: [STATE: 2][DISTRICT: 2][SERIES: 1-3][NUMBER: 1-4]
    
    Substitutions are strictly confined to:
    - Characters 2-3 (District): Must be digits. Only replaces digit confusions (O->0, I->1, etc.)
    - Trailing characters (Number suffix): Must be digits.
    - State (0-1) and Series: Letters are preserved; no digit conversion is applied.
    """
    cleaned = clean_plate_text(text)
    if not cleaned or len(cleaned) < 5:
        return cleaned

    chars = list(cleaned)
    n = len(chars)

    # 1. District code positions (pos 2 and 3) must be digits
    if n >= 4:
        for idx in (2, 3):
            c = chars[idx]
            if c in DIGIT_CONFUSION_MAP:
                chars[idx] = DIGIT_CONFUSION_MAP[c]

    # 2. Number suffix: find trailing digit/confusion segment (last 1-4 chars)
    # For plates with length 8-10, trailing 4 chars are typically digits
    # (e.g. GJ05AB1234 -> indices 6, 7, 8, 9)
    # If plate has series of 1 letter (e.g. MH12A1234), trailing starts at index 5
    if n >= 7:
        # Determine how many trailing characters should be treated as digits
        # By standard Indian format, number suffix is 1 to 4 digits at the end
        suffix_len = min(4, n - 4)  # leave at least 2 state + 2 district
        for idx in range(n - suffix_len, n):
            c = chars[idx]
            if c in DIGIT_CONFUSION_MAP:
                chars[idx] = DIGIT_CONFUSION_MAP[c]

    return "".join(chars)


def validate_indian_plate(plate: str) -> bool:
    """Returns True if the string matches the Indian number plate format."""
    if not plate:
        return False
    return bool(INDIAN_PLATE_PATTERN.match(plate))


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
    """Computes a normalised similarity score between 0.0 and 1.0."""
    max_len = max(len(s1), len(s2))
    if max_len == 0:
        return 1.0
    dist = levenshtein_distance(s1, s2)
    return max(0.0, 1.0 - (dist / max_len))


# ---------------------------------------------------------------------------
# Strict Decision Policy Engine
# ---------------------------------------------------------------------------
def evaluate_plate_decision(
    expected_plate: str | None,
    detected_plate: str | None,
    best_plate_conf: float = 0.85,
    quality_label: str = "clear",
    ocr_variant_votes: int = 2,
    ocr_candidates: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Evaluates vehicle plate matching under the verified security policy:
    
    1. Exact normalized registration equality is the MANDATORY PASS requirement.
    2. A fuzzy similarity score (even >= 0.85) NEVER independently authorizes PASS.
    3. Conflicting or low-consensus OCR routes to manual_review.
    4. Mismatched registrations (e.g. wrong district, wrong state, different vehicle)
       route to FAIL or manual_review.
    5. Zero false-pass guarantee against adversarial one-character differences.
    """
    norm_expected = normalize_confusion(expected_plate or "")
    norm_detected = normalize_confusion(detected_plate or "")

    clean_exp = clean_plate_text(expected_plate or "")
    clean_det = clean_plate_text(detected_plate or "")

    if not norm_expected:
        return {
            "decision": "manual_review",
            "reason_code": "no_expected_plate",
            "plate_match": False,
            "similarity": 0.0,
            "explanation": "No assigned vehicle registration provided for comparison.",
        }

    if not norm_detected:
        return {
            "decision": "retake",
            "reason_code": "plate_unreadable",
            "plate_match": False,
            "similarity": 0.0,
            "explanation": "License plate text could not be extracted from photograph.",
        }

    exact_match = (norm_expected == norm_detected)
    sim = similarity_ratio(norm_expected, norm_detected)
    dist = levenshtein_distance(norm_expected, norm_detected)
    is_valid_format = validate_indian_plate(norm_detected)

    # State code extraction
    exp_state = norm_expected[:2] if len(norm_expected) >= 2 else ""
    det_state = norm_detected[:2] if len(norm_detected) >= 2 else ""
    state_mismatch = (exp_state != det_state) if (exp_state and det_state) else False

    # Check for multiple conflicting OCR variants
    ocr_conflict = False
    if ocr_candidates and len(ocr_candidates) > 1:
        distinct_candidates = {normalize_confusion(c) for c in ocr_candidates if c}
        if len(distinct_candidates) > 1:
            ocr_conflict = True

    # --- RULE 1: Exact Match Evaluation ---
    if exact_match:
        # Require minimum consensus across preprocessing variants
        if ocr_variant_votes < 2:
            return {
                "decision": "manual_review",
                "reason_code": "plate_ocr_low_consensus",
                "plate_match": True,
                "similarity": sim,
                "explanation": (
                    f"Plate text {norm_detected} matches assigned vehicle, "
                    "but OCR consensus across preprocessing variants is low. Routed to manual review."
                ),
            }

        # Require high detector confidence and clear image quality
        if best_plate_conf < 0.50 or quality_label != "clear":
            return {
                "decision": "manual_review",
                "reason_code": "plate_confidence_low",
                "plate_match": True,
                "similarity": sim,
                "explanation": (
                    f"Plate matches assigned vehicle ({norm_detected}), but image quality "
                    f"({quality_label}) or detector confidence ({best_plate_conf:.2f}) requires human confirmation."
                ),
            }

        # Conflicting OCR variants even with one match
        if ocr_conflict:
            return {
                "decision": "manual_review",
                "reason_code": "ocr_variant_conflict",
                "plate_match": True,
                "similarity": sim,
                "explanation": "Conflicting OCR interpretations detected across filters. Routed to officer review.",
            }

        # Full PASS: Exact normalized match + format valid + high confidence + consensus
        return {
            "decision": "pass",
            "reason_code": "plate_verified",
            "plate_match": True,
            "similarity": 1.0,
            "explanation": f"License plate {norm_detected} exactly matches assigned vehicle {norm_expected}.",
        }

    # --- RULE 2: Non-Exact Matches CAN NEVER PASS ---
    # Case A: Different State Code (e.g. GJ vs MH) -> FAIL
    if state_mismatch and is_valid_format:
        return {
            "decision": "fail",
            "reason_code": "state_code_mismatch",
            "plate_match": False,
            "similarity": sim,
            "explanation": (
                f"State code mismatch: detected {norm_detected} (state {det_state}) "
                f"does not match assigned vehicle {norm_expected} (state {exp_state})."
            ),
        }

    # Case B: Completely different registration (similarity < 0.70 or edit distance > 3) -> FAIL
    if is_valid_format and (sim < 0.70 or dist > 3):
        return {
            "decision": "fail",
            "reason_code": "plate_mismatch",
            "plate_match": False,
            "similarity": sim,
            "explanation": (
                f"Vehicle registration mismatch: detected {norm_detected} does not match "
                f"assigned vehicle {norm_expected} (similarity {sim*100:.0f}%)."
            ),
        }

    # Case C: Close candidate (1-2 characters off, e.g. similarity >= 0.70)
    # Under verified security policy, fuzzy match NEVER passes independently.
    # It is routed to manual review as an inspection suggestion.
    if sim >= 0.70 or dist <= 2:
        return {
            "decision": "manual_review",
            "reason_code": "plate_close_match",
            "plate_match": False,
            "similarity": sim,
            "explanation": (
                f"Close registration candidate detected: {norm_detected} vs assigned {norm_expected} "
                f"(similarity {sim*100:.0f}%, {dist} char difference). "
                "Fuzzy matches cannot auto-authorize. Routed to officer manual review."
            ),
        }

    # Case D: Fallback for unformatted or noisy OCR
    return {
        "decision": "manual_review",
        "reason_code": "ocr_uncertain",
        "plate_match": False,
        "similarity": sim,
        "explanation": f"Plate OCR result '{norm_detected}' is uncertain. Routed to manual review.",
    }
