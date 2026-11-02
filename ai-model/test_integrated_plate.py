
from pathlib import Path
from src.inference import GrainShieldInferenceEngine

image_path = Path("test_images/1.jpeg")

if not image_path.is_file():
    raise FileNotFoundError(image_path)

engine = GrainShieldInferenceEngine(device="cpu")
image_bytes = image_path.read_bytes()

tests = [
    ("Correct registration", "GJ09KX3567"),
    ("Incorrect registration", "MH12DE1433"),
    ("No expected registration", None),
]

print("\n===== INTEGRATED PLATE VERIFICATION TESTS =====")

for name, expected in tests:
    result = engine.analyze_image(
        image_bytes,
        expected_plate=expected,
        stage="first_mile",
    )

    evidence = result.get("evidenceChecks", {})
    ocr = evidence.get("ocr", {})
    matching = evidence.get("plate_matching", {})

    print(f"\n{name}")
    print("Expected:", expected)
    print("Detected:", result.get("detectedPlate"))
    print("Plate match:", result.get("plateMatch"))
    print("Decision:", result.get("decision"))
    print("Reason:", result.get("reasonCode"))
    print("Format valid:", ocr.get("valid_indian_format"))
    print("Variant votes:", ocr.get("variant_votes"))
    print("PSM votes:", ocr.get("psm_votes"))
    print("OCR agreement:", ocr.get("agreement"))
    print("Similarity:", matching.get("similarity_ratio"))

print("\n===== TESTS FINISHED =====")
