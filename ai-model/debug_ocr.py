
from pathlib import Path
import cv2

from src.inference import (
    GrainShieldInferenceEngine,
    VEHICLE_CLASS_IDS,
    extract_plate_candidates_from_vehicle,
)

image_path = Path("test_images/1.jpeg")
image = cv2.imread(str(image_path))

if image is None:
    raise FileNotFoundError(f"Cannot read {image_path}")

engine = GrainShieldInferenceEngine(device="cpu")

result = engine.vehicle_model.predict(
    source=image,
    conf=0.25,
    device=engine.device,
    verbose=False,
)[0]

output = Path("debug_ocr")
output.mkdir(exist_ok=True)

cv2.imwrite(str(output / "original.jpg"), image)
annotated = image.copy()

if result.boxes is None:
    boxes = []
else:
    boxes = [
        box for box in result.boxes
        if int(box.cls[0]) in VEHICLE_CLASS_IDS
    ]

print("Vehicles detected:", len(boxes))

for i, box in enumerate(boxes, start=1):
    x1, y1, x2, y2 = [
        int(v) for v in box.xyxy[0].tolist()
    ]

    h, w = image.shape[:2]
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(w, x2)
    y2 = min(h, y2)

    vehicle_crop = image[y1:y2, x1:x2]

    if vehicle_crop.size == 0:
        continue

    vehicle_file = output / f"vehicle_{i}.jpg"
    cv2.imwrite(str(vehicle_file), vehicle_crop)

    candidates = extract_plate_candidates_from_vehicle(
        vehicle_crop,
        max_candidates=3,
    )

    print(f"\nVehicle {i}")
    print("Vehicle crop:", vehicle_crop.shape)
    print("Plate candidates:", len(candidates))

    if candidates:
        for j, crop in enumerate(candidates, start=1):
            filename = output / f"vehicle_{i}_candidate_{j}.png"
            cv2.imwrite(str(filename), crop)
            print("Saved:", filename)
    else:
        bottom = vehicle_crop[
            int(vehicle_crop.shape[0] * 0.55):,
            :
        ]

        filename = output / f"vehicle_{i}_fallback.png"
        cv2.imwrite(str(filename), bottom)
        print("No contour candidates; saved fallback:", filename)

    cv2.rectangle(
        annotated,
        (x1, y1),
        (x2, y2),
        (0, 255, 0),
        2,
    )

cv2.imwrite(str(output / "annotated.jpg"), annotated)

print("\nDiagnostic images saved in:", output.resolve())
