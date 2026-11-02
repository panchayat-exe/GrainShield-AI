
from pathlib import Path
import shutil

target = Path("src/inference.py")
source = target.read_text(encoding="utf-8")

# Refuse to apply the patch twice.
if "self.plate_model = YOLO(" in source:
    raise RuntimeError("Plate detector integration already exists.")

# Create a backup before changing anything.
backup = Path("src/inference.py.before_plate_detector_integration.bak")
if backup.exists():
    raise FileExistsError(f"Backup already exists: {backup}")

shutil.copy2(target, backup)
print("Backup created:", backup)


# 1. Add plate-model path resolution.
marker = "\n# ---------------------------------------------------------------------------\n# Plate text helpers\n"

plate_resolver = '''
def resolve_plate_model_path() -> Path:
    """Resolve the separately trained number-plate detector."""
    configured = os.environ.get("PLATE_MODEL_PATH", "").strip()

    candidates = []
    if configured:
        candidates.append(Path(configured).expanduser())

    candidates.append(
        AI_MODEL_DIR
        / "runs"
        / "plate_detection"
        / "rtx3050_img512_b2"
        / "weights"
        / "best.pt"
    )

    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()

    checked = "\\\\n".join(str(p) for p in candidates)
    raise FileNotFoundError(
        "Dedicated number-plate model not found. "
        "Set PLATE_MODEL_PATH or place best.pt at the default path. "
        f"Checked:\\\\n{checked}"
    )

'''

if marker not in source:
    raise RuntimeError("Could not find plate text helpers section.")

source = source.replace(
    marker,
    "\n\n" + plate_resolver + marker,
    1,
)


# 2. Update the inference engine constructor.
class_start = source.index("class GrainShieldInferenceEngine:")
init_start = source.index("    def __init__(", class_start)
analyze_start = source.index("    def analyze_image(", init_start)

new_constructor = '''    def __init__(
        self,
        model_path: Optional[Path] = None,
        device: str = "cpu",
        plate_model_path: Optional[Path] = None,
    ):
        self.model_path = model_path or resolve_model_path()
        self.plate_model_path = plate_model_path or resolve_plate_model_path()
        self.device = device
        self.tesseract_cmd = configure_tesseract()

        print(f"[inference] Loading vehicle detection model: {self.model_path}")
        self.vehicle_model = YOLO(str(self.model_path))

        print(f"[inference] Loading plate detection model: {self.plate_model_path}")
        self.plate_model = YOLO(str(self.plate_model_path))

        print(
            f"[inference] Both models loaded. "
            f"Device: {self.device}. Tesseract: {self.tesseract_cmd}"
        )

'''

source = source[:init_start] + new_constructor + source[analyze_start:]


# 3. Replace contour-based extraction with dedicated plate detection.
step3_start = source.index(
    "        # Step 3: Two-stage plate extraction"
)
step4_start = source.index(
    "        # Step 4: Plate matching",
    step3_start,
)

new_step3 = '''        # Step 3: Dedicated number-plate detection
        best_plate_text = ""
        best_plate_conf = 0.0  # Plate detector confidence, NOT OCR confidence
        best_vehicle_conf = vehicles[0]["confidence"] if vehicles else 0.0
        best_method = "none"
        best_crop_box = None
        all_candidates = []
        plate_detections = []
        plate_candidates_found = 0
        best_ocr_variant_votes = 0
        best_ocr_psm_votes = 0
        best_selection_rank = None

        # Detect plates in the full image, then associate each detection
        # with a detected vehicle to reject unrelated background regions.
        if vehicles:
            plate_results = self.plate_model.predict(
                source=image,
                conf=0.25,
                imgsz=512,
                device=self.device,
                verbose=False,
            )[0]

            if plate_results.boxes is not None:
                for box in plate_results.boxes:
                    class_id = int(box.cls[0])
                    if class_id != 0:
                        continue

                    detector_conf = float(box.conf[0])
                    x1, y1, x2, y2 = [
                        int(v) for v in box.xyxy[0].tolist()
                    ]

                    x1 = max(0, min(x1, width - 1))
                    y1 = max(0, min(y1, height - 1))
                    x2 = max(0, min(x2, width))
                    y2 = max(0, min(y2, height))

                    if x2 <= x1 or y2 <= y1:
                        continue

                    center_x = (x1 + x2) / 2
                    center_y = (y1 + y2) / 2

                    # Associate the plate with a vehicle bounding box.
                    associated_vehicle = None

                    for vehicle in vehicles:
                        vx1, vy1, vx2, vy2 = vehicle["box"]
                        pad_x = int((vx2 - vx1) * 0.08)
                        pad_y = int((vy2 - vy1) * 0.08)

                        if (
                            vx1 - pad_x <= center_x <= vx2 + pad_x
                            and vy1 - pad_y <= center_y <= vy2 + pad_y
                        ):
                            associated_vehicle = vehicle
                            break

                    if associated_vehicle is None:
                        continue

                    plate_crop = image[y1:y2, x1:x2]
                    if plate_crop.size == 0:
                        continue

                    plate_box = [x1, y1, x2, y2]
                    plate_candidates_found += 1

                    plate_detections.append({
                        "box": plate_box,
                        "confidence": round(detector_conf, 4),
                        "vehicle_box": associated_vehicle["box"],
                    })

                    text, candidates, method = run_plate_ocr(plate_crop)

                    for candidate in candidates:
                        item = dict(candidate)
                        item["plate_detector_confidence"] = round(
                            detector_conf, 4
                        )
                        item["plate_box"] = plate_box
                        all_candidates.append(item)

                    if not text:
                        continue

                    selected = next(
                        (c for c in candidates if c["text"] == text),
                        candidates[0] if candidates else {},
                    )

                    variant_votes = int(
                        selected.get("variant_votes", 0)
                    )
                    psm_votes = int(selected.get("psm_votes", 0))
                    format_valid = validate_indian_plate(text)

                    # Ranking score only. This is NOT a probability.
                    selection_rank = (
                        int(format_valid),
                        variant_votes,
                        psm_votes,
                        detector_conf,
                    )

                    if (
                        best_selection_rank is None
                        or selection_rank > best_selection_rank
                    ):
                        best_selection_rank = selection_rank
                        best_plate_text = text
                        best_plate_conf = detector_conf
                        best_vehicle_conf = associated_vehicle["confidence"]
                        best_method = method
                        best_crop_box = plate_box
                        best_ocr_variant_votes = variant_votes
                        best_ocr_psm_votes = psm_votes

'''

source = source[:step3_start] + new_step3 + source[step4_start:]


# 4. Use exact plate comparison. Do not auto-correct OCR characters.
old_matching = '''        if normalized_expected and normalized_detected:
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
'''

new_matching = '''        if normalized_expected and normalized_detected:
            similarity = similarity_ratio(
                normalized_expected,
                normalized_detected,
            )
            # Only an exact registration match qualifies as a match.
            # Ambiguous OCR characters must not be auto-corrected into PASS.
            plate_match = normalized_expected == normalized_detected
'''

if old_matching not in source:
    raise RuntimeError("Could not find the existing plate-matching block.")

source = source.replace(old_matching, new_matching, 1)


# 5. Pass OCR agreement information into the decision engine.
old_call = '''            best_plate_conf=best_plate_conf,
            stage=stage,
'''

new_call = '''            best_plate_conf=best_plate_conf,
            best_ocr_variant_votes=best_ocr_variant_votes,
            best_ocr_psm_votes=best_ocr_psm_votes,
            stage=stage,
'''

if old_call not in source:
    raise RuntimeError("Could not find the decision-engine call.")

source = source.replace(old_call, new_call, 1)


# 6. Improve evidence reporting.
old_ocr_passed = '"passed": bool(normalized_detected and len(normalized_detected) >= 6),'
new_ocr_passed = '"passed": bool(normalized_detected and plate_valid_format),'

if old_ocr_passed not in source:
    raise RuntimeError("Could not find the OCR evidence passed field.")

source = source.replace(old_ocr_passed, new_ocr_passed, 1)

old_plate_extract = '''            "plate_extraction": {
                "candidates_found": plate_candidates_found,
                "passed": plate_candidates_found > 0,
            },
'''

new_plate_extract = '''            "plate_extraction": {
                "detector": "dedicated_yolo_plate_detector",
                "candidates_found": plate_candidates_found,
                "passed": plate_candidates_found > 0,
                "best_detection_confidence": (
                    round(best_plate_conf, 4)
                    if plate_candidates_found else None
                ),
                "best_box": best_crop_box,
            },
'''

if old_plate_extract not in source:
    raise RuntimeError("Could not find plate extraction evidence block.")

source = source.replace(old_plate_extract, new_plate_extract, 1)

old_ocr_method = '''                "method": best_method,
                "candidates_count": len(all_candidates),
'''

new_ocr_method = '''                "method": best_method,
                "variant_votes": best_ocr_variant_votes,
                "psm_votes": best_ocr_psm_votes,
                "agreement": (
                    best_ocr_variant_votes >= 2
                    or best_ocr_psm_votes >= 2
                ),
                "candidates_count": len(all_candidates),
'''

if old_ocr_method not in source:
    raise RuntimeError("Could not find OCR method evidence fields.")

source = source.replace(old_ocr_method, new_ocr_method, 1)


# 7. Preserve the old generic confidence field as vehicle confidence,
# and expose plate-detector confidence separately.
old_confidence = '''            "confidence": round(best_plate_conf, 4) if best_plate_conf else 0.0,
            "decision": decision,
'''

new_confidence = '''            "confidence": round(best_vehicle_conf, 4) if best_vehicle_conf else 0.0,
            "vehicleConfidence": round(best_vehicle_conf, 4) if best_vehicle_conf else 0.0,
            "plateDetectionConfidence": (
                round(best_plate_conf, 4) if plate_candidates_found else 0.0
            ),
            "decision": decision,
'''

if old_confidence not in source:
    raise RuntimeError("Could not find top-level confidence field.")

source = source.replace(old_confidence, new_confidence, 1)


# 8. Update model version metadata and raw diagnostic output.
source = source.replace(
    '"plate_extractor": "opencv-contour-v1",',
    '"plate_extractor": "dedicated-yolo-plate-v1",\n'
    '                "plate_detector": self.plate_model_path.name,',
    1,
)

source = source.replace(
    '"plate_candidates": plate_candidates_found,',
    '"plate_candidates": plate_candidates_found,\n'
    '                "plate_detections": plate_detections,\n'
    '                "best_plate_box": best_crop_box,',
    1,
)


# 9. Update decision function signature.
old_signature = '''    def _make_decision(self, quality, vehicle_detected, plate_candidates_found,
                       normalized_detected, normalized_expected, plate_valid_format,
                       plate_match, similarity, best_plate_conf, stage, fps_person_detected):'''

new_signature = '''    def _make_decision(self, quality, vehicle_detected, plate_candidates_found,
                       normalized_detected, normalized_expected, plate_valid_format,
                       plate_match, similarity, best_plate_conf,
                       best_ocr_variant_votes, best_ocr_psm_votes,
                       stage, fps_person_detected):'''

if old_signature not in source:
    raise RuntimeError("Could not find decision function signature.")

source = source.replace(old_signature, new_signature, 1)


# 10. Require exact match, valid format, and repeatable OCR output for PASS.
old_pass = '''        # --- Plate extracted and matched ---
        if plate_match and best_plate_conf >= 0.50 and quality["label"] in ("clear",):
            return "pass", "plate_verified", (
                f"License plate verified: {normalized_detected} matches assigned vehicle {normalized_expected} "
                f"(detector confidence {best_plate_conf * 100:.1f}%, quality: {quality['label']})."
            )
'''

new_pass = '''        # --- Exact plate match without repeatable OCR agreement ---
        ocr_agreement = (
            best_ocr_variant_votes >= 2
            or best_ocr_psm_votes >= 2
        )

        if plate_match and not ocr_agreement:
            return "manual_review", "plate_ocr_low_consensus", (
                f"Plate text {normalized_detected} matches the assigned registration, "
                "but OCR agreement is insufficient for automatic approval."
            )

        # --- Plate extracted and exactly matched ---
        if (
            plate_match
            and plate_valid_format
            and best_plate_conf >= 0.50
            and quality["label"] == "clear"
        ):
            return "pass", "plate_verified", (
                f"License plate {normalized_detected} exactly matches "
                f"assigned vehicle {normalized_expected} "
                f"(plate detector confidence {best_plate_conf * 100:.1f}%, "
                f"quality: {quality['label']})."
            )
'''

if old_pass not in source:
    raise RuntimeError("Could not find existing automatic PASS block.")

source = source.replace(old_pass, new_pass, 1)


# Write only after all expected code sections have been found.
target.write_text(source, encoding="utf-8")

print("\nPlate detector integration patch applied.")
print("Backup:", backup)
print("Updated:", target)
