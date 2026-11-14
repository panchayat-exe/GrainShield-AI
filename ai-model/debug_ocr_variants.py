
import cv2
import pytesseract
from pathlib import Path

crop_path = Path("debug_plate_detector/plate_1.png")
image = cv2.imread(str(crop_path))

if image is None:
    raise FileNotFoundError(crop_path)

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

# Add white border and enlarge the plate
bordered = cv2.copyMakeBorder(
    gray, 20, 20, 20, 20,
    cv2.BORDER_CONSTANT, value=255
)

large = cv2.resize(
    bordered, None,
    fx=2.5, fy=2.5,
    interpolation=cv2.INTER_CUBIC
)

clahe = cv2.createCLAHE(
    clipLimit=2.0,
    tileGridSize=(8, 8)
).apply(large)

otsu = cv2.threshold(
    clahe, 0, 255,
    cv2.THRESH_BINARY + cv2.THRESH_OTSU
)[1]

adaptive = cv2.adaptiveThreshold(
    large, 255,
    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv2.THRESH_BINARY, 31, 11
)

variants = {
    "grayscale": large,
    "clahe": clahe,
    "otsu": otsu,
    "adaptive": adaptive,
    "inverted": cv2.bitwise_not(otsu),
}

config_base = (
    "--oem 3 "
    "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

print("ACTUAL PLATE: GJ09KX3567")
print("=" * 55)

for name, processed in variants.items():
    for psm in (6, 7, 8, 13):
        config = f"{config_base} --psm {psm}"

        data = pytesseract.image_to_data(
            processed,
            config=config,
            output_type=pytesseract.Output.DICT,
        )

        tokens = [
            (text.strip(), float(conf))
            for text, conf in zip(data["text"], data["conf"])
            if text.strip() and float(conf) >= 0
        ]

        detected = "".join(text for text, _ in tokens)

        confidence = (
            round(sum(c for _, c in tokens) / len(tokens), 1)
            if tokens else 0
        )

        print(
            f"{name:10} PSM {psm} | "
            f"Text: {detected:15} | Confidence: {confidence}"
        )

print("=" * 55)
print("Expected: GJ09KX3567")
