


from pathlib import Path
from ultralytics import YOLO
import torch

# Dataset configuration
DATA_YAML = (
    Path(__file__).resolve().parents[1]
    / "datasets"
    / "Indian License Plate Detection.v1i.yolov8"
    / "data.yaml"
)

# Keep the first CPU training run conservative
MODEL_NAME = "yolo26n.pt"
EPOCHS = 30
IMAGE_SIZE = 640
BATCH_SIZE = 4

def main():
    print("GrainShield AI — License Plate Training")
    print("Dataset:", DATA_YAML)
    print("CUDA available:", torch.cuda.is_available())
    print("Training device: CPU")

    if not DATA_YAML.exists():
        raise FileNotFoundError(f"Dataset YAML not found: {DATA_YAML}")

    model = YOLO(MODEL_NAME)

    model.train(
        data=str(DATA_YAML),
        epochs=EPOCHS,
        imgsz=IMAGE_SIZE,
        batch=BATCH_SIZE,
        device="cpu",
        workers=0,
        project="runs/plate_detection",
        name="baseline",
        exist_ok=True,
        patience=8,
        plots=True,
        seed=42,
    )

    print("\nTraining finished.")
    print("Best model: runs/plate_detection/baseline/weights/best.pt")
    print("Last model: runs/plate_detection/baseline/weights/last.pt")

if __name__ == "__main__":
    main()
