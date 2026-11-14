"""
Patch inference.py: add perspective correction to run_plate_ocr.

Inserts a deskewing step immediately after plate region is extracted from the
YOLO detection box. When the plate is at an angle, perspective distortion
reduces OCR accuracy. This correction uses the bounding contour of the plate
region to compute a rectification transform before running Tesseract.
"""
import sys
from pathlib import Path

file = Path(__file__).parent.parent / "src" / "inference.py"
text = file.read_text(encoding="utf-8")
text_lf = text.replace("\r\n", "\n")

# Insert the perspective_correct helper function BEFORE run_plate_ocr
INSERT_BEFORE = "# ---------------------------------------------------------------------------\n# Stage 3: OCR on plate crop\n# ---------------------------------------------------------------------------\n"

HELPER = """\
def _perspective_correct(crop: "np.ndarray") -> "np.ndarray":
    \"\"\"
    Attempts to deskew a plate crop using perspective correction.

    Finds the largest quadrilateral contour that could be the plate border
    and applies a perspective warp to produce a front-facing rectangular crop.
    Falls back to returning the original crop unchanged if the contour cannot
    be identified reliably, so this function is always safe to call.
    \"\"\"
    if crop is None or crop.size == 0:
        return crop

    h, w = crop.shape[:2]
    # Only attempt correction on images large enough for meaningful contour fitting
    if w < 40 or h < 15:
        return crop

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop.copy()

    # Bilateral filter + Canny to find strong edges
    blurred = cv2.bilateralFilter(gray, 9, 75, 75)
    edges = cv2.Canny(blurred, 30, 150)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 2))
    edges = cv2.dilate(edges, kernel, iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return crop

    # Pick the largest contour by area
    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)

    # Must occupy at least 10% of the image area to be the plate
    if area < 0.10 * w * h:
        return crop

    # Approximate to a quadrilateral
    peri = cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, 0.04 * peri, True)

    if len(approx) != 4:
        return crop

    pts = approx.reshape(4, 2).astype("float32")

    # Order: top-left, top-right, bottom-right, bottom-left
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[s.argmin()]   # top-left (smallest sum)
    rect[2] = pts[s.argmax()]   # bottom-right (largest sum)
    diff = np.diff(pts, axis=1)
    rect[1] = pts[diff.argmin()]  # top-right (smallest diff)
    rect[3] = pts[diff.argmax()]  # bottom-left (largest diff)

    # Compute target rectangle width and height
    width_a = np.linalg.norm(rect[1] - rect[0])
    width_b = np.linalg.norm(rect[2] - rect[3])
    height_a = np.linalg.norm(rect[3] - rect[0])
    height_b = np.linalg.norm(rect[2] - rect[1])

    max_w = max(int(width_a), int(width_b))
    max_h = max(int(height_a), int(height_b))

    if max_w < 20 or max_h < 8:
        return crop

    dst = np.array(
        [[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]],
        dtype="float32",
    )

    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(crop, M, (max_w, max_h))

    # Sanity check: warped must be meaningfully large
    if warped.shape[0] < 8 or warped.shape[1] < 20:
        return crop

    return warped


"""

if "_perspective_correct" in text_lf:
    print("[INFO] _perspective_correct already present — skipping")
else:
    if INSERT_BEFORE not in text_lf:
        print("[ERROR] insertion point not found")
        sys.exit(1)
    text_lf = text_lf.replace(INSERT_BEFORE, HELPER + INSERT_BEFORE)
    print("[OK] _perspective_correct helper inserted")

# Now patch run_plate_ocr to call perspective correction at the top of the function
# Insert after: "    if crop is None or crop.size == 0:\n        return \"\", [], \"none\"\n\n"
# (the first few lines of run_plate_ocr)
OLD_OCR_START = (
    'def run_plate_ocr(crop: np.ndarray) -> Tuple[str, List, str]:\n'
    '    """\n'
    '    Recognizes Indian vehicle registration plates using multiple\n'
    '    preprocessing variants and PSM modes.\n'
    '\n'
    '    Selects candidates using plate-format validation and agreement\n'
    '    across distinct preprocessing methods.\n'
    '\n'
    '    Returns:\n'
    '        (best_text, candidates, method_name)\n'
    '\n'
    '    Tesseract confidence is not used as a decision threshold.\n'
    '    """\n'
    '\n'
    '    if crop is None or crop.size == 0:\n'
    '        return "", [], "none"\n'
    '\n'
    '    # Convert to grayscale\n'
)

NEW_OCR_START = (
    'def run_plate_ocr(crop: np.ndarray) -> Tuple[str, List, str]:\n'
    '    """\n'
    '    Recognizes Indian vehicle registration plates using multiple\n'
    '    preprocessing variants and PSM modes.\n'
    '\n'
    '    Selects candidates using plate-format validation and agreement\n'
    '    across distinct preprocessing methods.\n'
    '\n'
    '    Returns:\n'
    '        (best_text, candidates, method_name)\n'
    '\n'
    '    Tesseract confidence is not used as a decision threshold.\n'
    '    """\n'
    '\n'
    '    if crop is None or crop.size == 0:\n'
    '        return "", [], "none"\n'
    '\n'
    '    # Attempt perspective correction to deskew angled plate photos before OCR.\n'
    '    # Falls back to the original crop silently if the quad cannot be found.\n'
    '    crop = _perspective_correct(crop)\n'
    '\n'
    '    # Convert to grayscale\n'
)

if "_perspective_correct(crop)" in text_lf:
    print("[INFO] run_plate_ocr perspective call already present")
else:
    old_lf = OLD_OCR_START.replace("\r\n", "\n")
    new_lf = NEW_OCR_START.replace("\r\n", "\n")
    if old_lf not in text_lf:
        print("[WARN] run_plate_ocr patch point not found — skipping OCR hook")
    else:
        text_lf = text_lf.replace(old_lf, new_lf)
        print("[OK] run_plate_ocr: perspective correction call added")

final = text_lf.replace("\n", "\r\n")
file.write_bytes(final.encode("utf-8"))
print(f"\n[DONE] {file} written")
