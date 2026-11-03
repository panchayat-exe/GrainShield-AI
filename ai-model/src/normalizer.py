"""
GrainShield AI — Plate normalisation utilities (no heavy ML dependencies).

Pure-Python helpers that can be imported in unit tests without torch / cv2 / ultralytics.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CONFUSION_MAP: dict[str, str] = {
    "O": "0",
    "I": "1",
    "Z": "2",
    "S": "5",
    "B": "8",
}

# Indian plate: 2-letter state, 2-digit district, 1-3 letter series, 1-4 digit number
# e.g. GJ05AB1234, MH12DE1433
INDIAN_PLATE_PATTERN = re.compile(
    r"^[A-Z]{2}\d{2}[A-Z]{1,3}\d{1,4}$", re.IGNORECASE
)


# ---------------------------------------------------------------------------
# String helpers
# ---------------------------------------------------------------------------
def clean_plate_text(raw: str | None) -> str:
    """Normalises license plate string: uppercase, letters and digits only."""
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def normalize_confusion(text: str) -> str:
    """
    Position-aware confusion normalisation for Indian plates (GJ05AB1234).
    Structure: [STATE:2][DISTRICT:2][SERIES:1-3][NUMBER:1-4]
    Only replaces in digit-expected positions (district=2-3, number=last 1-4).
    Letter positions (state code, series letters) are left unchanged.
    """
    cleaned = clean_plate_text(text)
    if not cleaned:
        return cleaned

    result = list(cleaned)
    for i, c in enumerate(result):
        if i in (2, 3):
            # District positions: expect digits; O→0, I→1, Z→2 etc.
            result[i] = CONFUSION_MAP.get(c, c)
        elif i >= 6:
            # Number suffix: expect digits
            result[i] = CONFUSION_MAP.get(c, c)
        # Positions 0-1 (state code) and 4-5 (series letters): leave as-is
    return "".join(result)


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
