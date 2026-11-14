# Tesseract OCR Installation Guide
# Run this ONCE to enable real plate-text extraction in the AI server.

## Windows (Development)
1. Download: https://github.com/UB-Mannheim/tesseract/releases/latest
   - File: `tesseract-ocr-w64-setup-*.exe`
2. Install to: `C:\Program Files\Tesseract-OCR\`
3. **No extra config needed** — inference.py already checks this path.
4. Restart the AI server: `py -3.12 src/server.py`

## Linux / Ubuntu (Production Deployment)
```bash
apt-get update && apt-get install -y tesseract-ocr tesseract-ocr-eng
# Optionally install Hindi/Gujarati data:
# apt-get install -y tesseract-ocr-hin tesseract-ocr-guj
```

## Verification
After installation, the /health endpoint will confirm Tesseract is found:
```json
{"status":"healthy","tesseract":"C:\\Program Files\\Tesseract-OCR\\tesseract.exe"}
```
Without Tesseract: plates are detected (YOLO) but text cannot be read → all decisions = manual_review.
With Tesseract: full OCR pipeline runs → real PASS/FAIL/RETAKE decisions based on plate text match.
