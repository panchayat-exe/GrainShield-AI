#!/usr/bin/env python3
"""
GrainShield AI -- Model Deployment Script
=========================================
Copies the trained plate-detector weights from the training output directory
into the canonical `weights/` deployment directory.

Run this script once after cloning the repository or after a new training run:

    python scripts/deploy_weights.py

The `ai-model/weights/*.pt` files are excluded from Git (they are large binary
files). This script ensures the deployment directory is populated from the
training artefacts that ARE committed (`runs/`).

If the `runs/` artefacts are also absent (e.g., on a fresh CI container),
set the PLATE_MODEL_PATH environment variable to point to a pre-downloaded
`best.pt` before starting the server.
"""

from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path

AI_MODEL_DIR = Path(__file__).resolve().parents[1]

SOURCE = (
    AI_MODEL_DIR
    / "runs"
    / "plate_detection"
    / "rtx3050_img512_b2"
    / "weights"
    / "best.pt"
)

DEST = AI_MODEL_DIR / "weights" / "best.pt"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    print("=" * 60)
    print("GrainShield AI — Plate Detector Weight Deployment")
    print("=" * 60)

    if not SOURCE.is_file():
        print(f"[ERROR] Source weights not found: {SOURCE}")
        print(
            "        Train the plate detector first:\n"
            "        python src/train_plate.py\n"
            "        Or set PLATE_MODEL_PATH to an existing best.pt"
        )
        return 1

    DEST.parent.mkdir(parents=True, exist_ok=True)

    if DEST.is_file():
        src_hash = sha256(SOURCE)
        dst_hash = sha256(DEST)
        if src_hash == dst_hash:
            print(f"[OK] weights/best.pt is already up-to-date ({DEST})")
            print(f"     SHA-256: {src_hash[:16]}...")
            return 0
        print(f"[UPDATE] Existing weights/best.pt differs — replacing.")

    print(f"[COPY]  {SOURCE}")
    print(f"     -> {DEST}")
    shutil.copy2(SOURCE, DEST)

    src_hash = sha256(SOURCE)
    dst_hash = sha256(DEST)
    if src_hash != dst_hash:
        print("[ERROR] Copy verification failed — SHA-256 mismatch!")
        DEST.unlink(missing_ok=True)
        return 1

    size_mb = DEST.stat().st_size / (1024 * 1024)
    print(f"[OK]   Deployed successfully ({size_mb:.1f} MB)")
    print(f"       SHA-256: {dst_hash[:16]}...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
