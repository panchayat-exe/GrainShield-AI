from pathlib import Path
import re

import cv2
import pytesseract
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[1]

MODEL_PATH = (
    ROOT.parent / "runs" / "detect" / "runs"
    / "plate_detection" / "baseline" / "weights" / "best.pt"
)

TEST_IMAGES = (
    ROOT / "datasets"
    / "Indian License Plate Detection.v1i.yolov8"
    / "test" / "images"
)

OUTPUT_DIR = ROOT / "runs" / "plate_ocr_test"

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

OCR_CONFIG_BASE = (
    "--oem 3 "
    "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)


def read_plate(crop):
    if crop is None or crop.size == 0:
        return "", None, "none"

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.copyMakeBorder(
        gray, 12, 12, 12, 12,
        cv2.BORDER_CONSTANT, value=255
    )
    gray = cv2.resize(
        gray, None, fx=3, fy=3,
        interpolation=cv2.INTER_CUBIC
    )

    enhanced = cv2.createCLAHE(
        clipLimit=2.0, tileGridSize=(8, 8)
    ).apply(gray)

    otsu = cv2.threshold(
        enhanced, 0, 255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )[1]

    adaptive = cv2.adaptiveThreshold(
        enhanced, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 31, 11
    )

    variants = [
        ("grayscale", gray),
        ("enhanced", enhanced),
        ("otsu", otsu),
        ("adaptive", adaptive),
    ]

    candidates = []

    for method_name, processed in variants:
        for psm in (7, 8, 13):
            config = f"{OCR_CONFIG_BASE} --psm {psm}"

            try:
                raw = pytesseract.image_to_string(
                    processed, config=config
                )
            except pytesseract.TesseractError:
                continue

            text = re.sub(r"[^A-Z0-9]", "", raw.upper())
            if not text:
                continue

            score = len(text)
            if 8 <= len(text) <= 10:
                score += 3
            if len(text) < 5:
                score -= 2

            candidates.append(
                (score, text, method_name, processed.copy(), psm)
            )

    if not candidates:
        return "", gray, "no-readable-text"

    candidates.sort(key=lambda item: item[0], reverse=True)
    _, text, method, processed, psm = candidates[0]

    return text, processed, f"{method}-psm{psm}"


def main():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")
    if not TEST_IMAGES.exists():
        raise FileNotFoundError(f"Test images not found: {TEST_IMAGES}")

    crops_dir = OUTPUT_DIR / "plate_crops"
    annotated_dir = OUTPUT_DIR / "annotated"
    crops_dir.mkdir(parents=True, exist_ok=True)
    annotated_dir.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(MODEL_PATH))
    images = sorted(
        p for p in TEST_IMAGES.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}
    )

    print(f"Test images: {len(images)}")
    print("Starting detection and OCR...\n")

    detected = 0
    readable = 0
    unreadable = 0
    missed = 0

    for image_path in images:
        image = cv2.imread(str(image_path))
        if image is None:
            print(f"Could not read: {image_path.name}")
            continue

        result = model.predict(
            source=image, imgsz=640, conf=0.25,
            device="cpu", verbose=False
        )[0]

        annotated = image.copy()
        print(f"\n{image_path.name}")

        if result.boxes is None or len(result.boxes) == 0:
            print("  No plate detected")
            missed += 1
        else:
            height, width = image.shape[:2]
            boxes = sorted(
                result.boxes,
                key=lambda b: float(b.xyxy[0][0])
            )

            for index, box in enumerate(boxes, start=1):
                x1, y1, x2, y2 = [
                    int(v) for v in box.xyxy[0].tolist()
                ]
                x1 = max(0, min(x1, width - 1))
                x2 = max(0, min(x2, width))
                y1 = max(0, min(y1, height - 1))
                y2 = max(0, min(y2, height))

                crop = image[y1:y2, x1:x2]
                if crop.size == 0:
                    continue

                text, processed, method = read_plate(crop)
                confidence = float(box.conf[0])
                label = text if text else "UNREADABLE"

                detected += 1
                if text:
                    readable += 1
                else:
                    unreadable += 1

                print(
                    f"  Plate {index}: {label} "
                    f"(detector confidence: {confidence:.2f}, "
                    f"OCR method: {method})"
                )

                if processed is not None:
                    cv2.imwrite(
                        str(crops_dir / f"{image_path.stem}_plate_{index}.png"),
                        processed
                    )

                cv2.rectangle(
                    annotated, (x1, y1), (x2, y2),
                    (0, 255, 0), 2
                )
                cv2.putText(
                    annotated, label, (x1, max(y1 - 8, 20)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (0, 255, 0), 2
                )

        cv2.imwrite(
            str(annotated_dir / f"{image_path.stem}_annotated.jpg"),
            annotated
        )

    print("\n" + "=" * 45)
    print("OCR TEST SUMMARY")
    print("=" * 45)
    print(f"Test images: {len(images)}")
    print(f"Images with no plate detected: {missed}")
    print(f"Plate detections: {detected}")
    print(f"Non-empty OCR results: {readable}")
    print(f"Empty OCR results: {unreadable}")

    if detected:
        print(f"Non-empty OCR output rate: {readable / detected * 100:.1f}%")

    print(f"Results saved to: {OUTPUT_DIR}")
    print("OCR output must still be checked against actual plate text.")


if __name__ == "__main__":
    main()
