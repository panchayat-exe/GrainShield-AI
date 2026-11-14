
from pathlib import Path
import cv2
from ultralytics import YOLO

from src.inference import run_plate_ocr, validate_indian_plate

BASE = Path(__file__).resolve().parent
IMAGE = BASE / "test_images" / "1.jpeg"
MODEL = (
    BASE / "runs" / "plate_detection"
    / "rtx3050_img512_b2" / "weights" / "best.pt"
)

OUTPUT = BASE / "debug_plate_detector"
OUTPUT.mkdir(exist_ok=True)

if not IMAGE.is_file():
    raise FileNotFoundError(IMAGE)

if not MODEL.is_file():
    raise FileNotFoundError(MODEL)

image = cv2.imread(str(IMAGE))
if image is None:
    raise ValueError("Could not decode sample image")

print("Loading dedicated plate detector...")
model = YOLO(str(MODEL))

results = model.predict(
    source=image,
    imgsz=512,
    conf=0.25,
    device=0,
    verbose=False,
)

result = results[0]
annotated = image.copy()

boxes = result.boxes
count = 0 if boxes is None else len(boxes)

print("\nExpected plate: GJ05AB1234")
print("Plate detections:", count)

if boxes is not None:
    height, width = image.shape[:2]

    for index, box in enumerate(boxes, start=1):
        x1, y1, x2, y2 = [
            int(v) for v in box.xyxy[0].tolist()
        ]

        x1 = max(0, min(x1, width - 1))
        y1 = max(0, min(y1, height - 1))
        x2 = max(0, min(x2, width))
        y2 = max(0, min(y2, height))

        crop = image[y1:y2, x1:x2]

        if crop.size == 0:
            continue

        confidence = float(box.conf[0])

        crop_path = OUTPUT / f"plate_{index}.png"
        cv2.imwrite(str(crop_path), crop)

        text, candidates, method = run_plate_ocr(crop)

        print(f"\nPlate {index}")
        print("Detector confidence:", round(confidence, 4))
        print("Crop dimensions:", crop.shape[:2])
        print("OCR detected:", repr(text))
        print("Valid Indian format:", validate_indian_plate(text))
        print("OCR method:", method)
        print("OCR candidates:", len(candidates))
        print("Crop saved:", crop_path)

        cv2.rectangle(
            annotated, (x1, y1), (x2, y2), (0, 255, 0), 2
        )
        cv2.putText(
            annotated, text or "UNREADABLE",
            (x1, max(20, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6,
            (0, 255, 0), 2,
        )

annotated_path = OUTPUT / "annotated.jpg"
cv2.imwrite(str(annotated_path), annotated)

print("\nDiagnostic images saved to:", OUTPUT.resolve())
