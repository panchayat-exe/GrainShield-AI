# GrainShield AI -- Validation Dataset

This directory contains the labelled validation dataset for the AI pipeline.

## Purpose
- Regression testing: ensure pipeline improvements don't regress existing capabilities
- Accuracy measurement: compute per-check precision/recall on real images
- Benchmark: compare model versions objectively

## Annotation Format

`annotations.json` contains one entry per test image.

Fields:
- `image`: filename in `../test_images/`
- `vehicle_bbox`: [x1,y1,x2,y2] or null if not annotated
- `plate_bbox`: [x1,y1,x2,y2] or null if not annotated
- `expected_plate`: plate number string or "UNKNOWN"
- `vehicle_category`: "truck" | "car" | "bus" | "motorcycle" | null
- `expected_decision`: "pass" | "fail" | "retake" | "manual_review"
- `annotated`: true when human-verified, false for placeholders
- `annotator`: name/ID of annotator

## Status
Annotations are pending human review of the 15 test images.
Run `python run_validation.py` to evaluate the pipeline against annotated images.