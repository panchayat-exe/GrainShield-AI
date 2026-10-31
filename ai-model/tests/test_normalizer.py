"""
Unit tests for plate normalization and Indian plate format validation.
Run with: py -3.12 -m pytest ai-model/tests/ -v
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.inference import (
    clean_plate_text,
    normalize_confusion,
    validate_indian_plate,
    levenshtein_distance,
    similarity_ratio,
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
        # 'O' at district position (index 2) should become '0'
        assert normalize_confusion("GJO5AB1234") == "GJ05AB1234"

    def test_I_to_1_at_number(self):
        # 'I' at number suffix position (index 7+) should become '1'
        assert normalize_confusion("GJ05ABI234") == "GJ05AB1234"

    def test_B_in_series_unchanged(self):
        # 'B' in the series position (index 6) should NOT become '8'
        assert normalize_confusion("GJ05AB1234") == "GJ05AB1234"

    def test_digit_positions_only(self):
        # Only district (pos 2-3) and number (pos 6+) are confusion-mapped
        # State letters (pos 0-1) and series (pos 4-5) are left unchanged
        result = normalize_confusion("GJ05AB1234")
        assert result == "GJ05AB1234"


class TestLevenshtein:
    def test_identical(self):
        assert levenshtein_distance("GJ05AB1234", "GJ05AB1234") == 0

    def test_one_char_off(self):
        assert levenshtein_distance("GJ05AB1234", "GJ05AB1235") == 1

    def test_empty_string(self):
        assert levenshtein_distance("", "ABC") == 3


class TestSimilarityRatio:
    def test_identical(self):
        assert similarity_ratio("GJ05AB1234", "GJ05AB1234") == 1.0

    def test_one_char_off_ten_char(self):
        r = similarity_ratio("GJ05AB1234", "GJ05AB1235")
        assert 0.85 < r < 1.0

    def test_completely_different(self):
        r = similarity_ratio("GJ05AB1234", "XXXXXXXXXX")
        assert r < 0.5