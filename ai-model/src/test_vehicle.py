from pathlib import Path
from ultralytics import YOLO

print("Loading YOLO model...", flush=True)
model = YOLO("yolo26n.pt")

print("Running vehicle detection on sample image...", flush=True)

results = model.predict(
    source="https://ultralytics.com/images/bus.jpg",
    conf=0.25,
    save=True,
    project="runs/vehicle_test",
    name="result",
    exist_ok=True,
    device="cpu",
)

print("\nDetected objects:", flush=True)

for result in results:
    for box in result.boxes:
        class_id = int(box.cls[0])
        confidence = float(box.conf[0])
        label = model.names[class_id]
        print(f"{label}: {confidence:.1%} confidence", flush=True)

print("\nCheck ai-model/runs/vehicle_test/result for the annotated image.")
