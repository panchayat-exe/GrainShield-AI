"""
Unit and Adversarial Tests for GrainShield AI Plate Normalisation & Decision Engine.
Run with: pytest ai-model/tests/ -v

Verifies Section 3 of Sprint 4 Final Acceptance Audit:
- Exact normalized registration equality as mandatory PASS requirement
- Fuzzy similarity (even >= 0.85) NEVER independently authorizes PASS
- Zero false-pass guarantee against adversarial one-character differences
- O/0 and I/1 position-aware confusion recovery
- Mismatched state codes, different districts, missing/extra characters
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.normalizer import (
    clean_plate_text,
    evaluate_plate_decision,
    levenshtein_distance,
    normalize_confusion,
    similarity_ratio,
    validate_indian_plate,
)


class TestCleanPlateText:
    def test_strips_spaces(self):
        assert clean_plate_text("GJ 05 AB 1234") == "GJ05AB1234"

    def test_uppercase(self):
        assert clean_plate_text("gj05ab1234") == "GJ05AB1234"

    def test_strips_hyphens(self):
        assert clean_plate_text("GJ-05-AB-1234") == "GJ05AB1234"

    def test_empty(self):
        assert clean_plate_text("") == ""

    def test_none_handled(self):
        assert clean_plate_text(None) == ""  # type: ignore


class TestValidateIndianPlate:
    def test_valid_standard(self):
        assert validate_indian_plate("GJ05AB1234") is True

    def test_valid_short_series(self):
        assert validate_indian_plate("MH12D1234") is True

    def test_valid_long_series(self):
        assert validate_indian_plate("DL4CAF1234") is False  # district must be 2 digits

    def test_invalid_too_short(self):
        assert validate_indian_plate("GJ05") is False

    def test_invalid_starts_with_digit(self):
        assert validate_indian_plate("12GJ5AB1234") is False

    def test_empty(self):
        assert validate_indian_plate("") is False


class TestNormalizeConfusion:
    def test_O_to_0_at_district(self):
        assert normalize_confusion("GJO5AB1234") == "GJ05AB1234"

    def test_I_to_1_at_number(self):
        assert normalize_confusion("GJ05ABI234") == "GJ05AB1234"

    def test_B_in_series_unchanged(self):
        assert normalize_confusion("GJ05AB1234") == "GJ05AB1234"

    def test_digit_positions_only(self):
        result = normalize_confusion("GJ05AB1234")
        assert result == "GJ05AB1234"

    def test_Z_to_2_at_district(self):
        assert normalize_confusion("GJZ5AB1234") == "GJ25AB1234"

    def test_S_to_5_at_number(self):
        assert normalize_confusion("GJ05AB123S") == "GJ05AB1235"


class TestLevenshteinAndSimilarity:
    def test_identical(self):
        assert levenshtein_distance("GJ05AB1234", "GJ05AB1234") == 0
        assert similarity_ratio("GJ05AB1234", "GJ05AB1234") == 1.0

    def test_one_char_off(self):
        assert levenshtein_distance("GJ05AB1234", "GJ05AB1235") == 1
        r = similarity_ratio("GJ05AB1234", "GJ05AB1235")
        assert 0.85 < r < 1.0

    def test_empty_string(self):
        assert levenshtein_distance("", "ABC") == 3

    def test_completely_different(self):
        r = similarity_ratio("GJ05AB1234", "XXXXXXXXXX")
        assert r < 0.5


class TestAdversarialPlateSafety:
    """
    Adversarial security tests proving strict decision safety:
    A fuzzy similarity score of 0.85 MUST NOT independently authorize PASS.
    Exact normalized equality is the sole PASS condition.
    """

    def test_exact_match_passes_with_consensus(self):
        res = evaluate_plate_decision("GJ05AB1234", "GJ05AB1234", best_plate_conf=0.9, ocr_variant_votes=2)
        assert res["decision"] == "pass"
        assert res["reason_code"] == "plate_verified"
        assert res["plate_match"] is True

    def test_exact_match_routes_to_review_if_low_consensus(self):
        res = evaluate_plate_decision("GJ05AB1234", "GJ05AB1234", best_plate_conf=0.9, ocr_variant_votes=1)
        assert res["decision"] == "manual_review"
        assert res["reason_code"] == "plate_ocr_low_consensus"

    def test_exact_match_routes_to_review_if_blurry(self):
        res = evaluate_plate_decision("GJ05AB1234", "GJ05AB1234", quality_label="blurry")
        assert res["decision"] == "manual_review"
        assert res["reason_code"] == "plate_confidence_low"

    def test_adversarial_one_char_difference_never_passes(self):
        # 1-char difference (sim = 0.90 >= 0.85): MUST NOT PASS
        res = evaluate_plate_decision("GJ05AB1234", "GJ05AB1235")
        assert res["decision"] != "pass", "CRITICAL BUG: 1-char difference auto-passed!"
        assert res["decision"] == "manual_review"
        assert res["reason_code"] == "plate_close_match"
        assert res["plate_match"] is False

    def test_adversarial_confusion_recovered_exact_match(self):
        # OCR reads O instead of 0 at district: correctly resolved to PASS
        res = evaluate_plate_decision("GJ05AB1234", "GJO5AB1234", ocr_variant_votes=2)
        assert res["decision"] == "pass"
        assert res["plate_match"] is True

    def test_adversarial_state_code_mismatch_fails(self):
        # Assigned vehicle is Gujarat (GJ), photographed vehicle is Maharashtra (MH)
        res = evaluate_plate_decision("GJ01AB1234", "MH01AB1234")
        assert res["decision"] == "fail"
        assert res["reason_code"] == "state_code_mismatch"
        assert res["plate_match"] is False

    def test_adversarial_different_district_fails_or_reviews(self):
        # Assigned Ahmedabad (GJ01), photographed Surat (GJ05)
        res = evaluate_plate_decision("GJ01AB1234", "GJ05AB1234")
        assert res["decision"] != "pass"
        assert res["plate_match"] is False

    def test_adversarial_missing_characters_never_passes(self):
        # Missing last 2 digits: GJ01AB12
        res = evaluate_plate_decision("GJ01AB1234", "GJ01AB12")
        assert res["decision"] != "pass"
        assert res["plate_match"] is False

    def test_adversarial_extra_characters_never_passes(self):
        # Extra digit: GJ01AB12345
        res = evaluate_plate_decision("GJ01AB1234", "GJ01AB12345")
        assert res["decision"] != "pass"
        assert res["plate_match"] is False

    def test_adversarial_ocr_conflict_routes_to_review(self):
        # OCR produced two contradictory readings
        res = evaluate_plate_decision(
            "GJ05AB1234", "GJ05AB1234",
            ocr_candidates=["GJ05AB1234", "GJ05AB1235"]
        )
        assert res["decision"] == "manual_review"
        assert res["reason_code"] == "ocr_variant_conflict"

    def test_completely_different_vehicle_fails(self):
        # Completely different plate
        res = evaluate_plate_decision("GJ01AB1234", "DL04CD9999")
        assert res["decision"] == "fail"
        assert res["reason_code"] == "state_code_mismatch"
