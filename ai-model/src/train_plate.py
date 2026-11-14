
from pathlib import Path

import torch
import yaml
from ultralytics import YOLO


# --------------------------------------------------
# GrainShield AI - Dedicated Number Plate Detector
# RTX 3050 Laptop GPU configuration
# --------------------------------------------------

AI_MODEL_DIR = Path(__file__).resolve().parents[1]

DATA_YAML = AI_MODEL_DIR / "datasets" / "data.yaml"
MODEL_PATH = AI_MODEL_DIR / "yolo26n.pt"

EPOCHS = 50
IMAGE_SIZE = 512
BATCH_SIZE = 2
DEVICE = 0
WORKERS = 0

PROJECT = AI_MODEL_DIR / "runs" / "plate_detection"
RUN_NAME = "rtx3050_img512_b2"


def validate_dataset():
    if not DATA_YAML.is_file():
        raise FileNotFoundError(f"Dataset config missing: {DATA_YAML}")

    if not MODEL_PATH.is_file():
        raise FileNotFoundError(f"Pretrained model missing: {MODEL_PATH}")

    config = yaml.safe_load(DATA_YAML.read_text(encoding="utf-8"))
    dataset_root = Path(config["path"])

    for key in ("train", "val", "test"):
        folder = dataset_root / config[key]
        if not folder.is_dir():
            raise FileNotFoundError(f"{key} images missing: {folder}")
        print(f"[dataset] {key}: {folder}")

    if config.get("nc") != 1:
        raise ValueError("Expected exactly one class: number_plate")

    print("[dataset] Class:", config["names"])


def main():
    print("=" * 55)
    print("GRAINSHIELD AI - PLATE DETECTOR TRAINING")
    print("=" * 55)

    validate_dataset()

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Training stopped.")

    torch.cuda.empty_cache()

    gpu_name = torch.cuda.get_device_name(DEVICE)
    free_memory, total_memory = torch.cuda.mem_get_info(DEVICE)

    print("\n[GPU]", gpu_name)
    print("[GPU] Total VRAM:", round(total_memory / 1024**3, 2), "GB")
    print("[GPU] Free VRAM:", round(free_memory / 1024**3, 2), "GB")

    if free_memory < 3 * 1024**3:
        raise RuntimeError(
            "Less than 3 GB GPU memory available. "
            "Close GPU-heavy applications and retry."
        )

    print("\n[training] Model:", MODEL_PATH)
    print("[training] Image size:", IMAGE_SIZE)
    print("[training] Batch size:", BATCH_SIZE)
    print("[training] Epochs:", EPOCHS)
    print("[training] Device: CUDA")

    model = YOLO(str(MODEL_PATH))

    results = model.train(
        data=str(DATA_YAML),
        epochs=EPOCHS,
        imgsz=IMAGE_SIZE,
        batch=BATCH_SIZE,
        device=DEVICE,
        workers=WORKERS,
        project=str(PROJECT),
        name=RUN_NAME,
        exist_ok=False,
        patience=10,
        plots=True,
        save=True,
        save_period=5,
        amp=True,
        cache=False,
        seed=42,
        close_mosaic=10,
    )

    best_model = PROJECT / RUN_NAME / "weights" / "best.pt"
    last_model = PROJECT / RUN_NAME / "weights" / "last.pt"

    print("\n" + "=" * 55)
    print("TRAINING FINISHED")
    print("=" * 55)
    print("Best model:", best_model)
    print("Best model exists:", best_model.is_file())
    print("Last model exists:", last_model.is_file())

    return results


if __name__ == "__main__":
    main()
