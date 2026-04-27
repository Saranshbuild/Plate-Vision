"""
PlateVision — Flask Backend
POST /api/detect → JSON { car_bbox, plate_bbox, plate, confidence, format }
"""

import io
import re
import time
import numpy as np
import cv2
import easyocr
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from PIL import Image
from ultralytics import YOLO

# ── Init ────────────────────────────────────────────────────────────────
# static_folder='.' means Flask looks for static files in the same folder
# as app.py — so index.html, css/, js/ all resolve correctly.
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

print("[PlateVision] Loading model …")
model = YOLO("best.pt")

print("[PlateVision] Loading EasyOCR …")
reader = easyocr.Reader(['en'], gpu=False)  # set gpu=True if you have CUDA

print("[PlateVision] Ready ✓")


# ── Helpers ─────────────────────────────────────────────────────────────

def clean_plate(text: str) -> str:
    """Remove noise characters, uppercase."""
    text = text.upper()
    text = re.sub(r'[^A-Z0-9\- ]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def detect_format(plate: str) -> str:
    c = plate.replace(' ', '').replace('-', '')
    if re.match(r'^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$', c):
        return 'IND — Standard'
    if re.match(r'^\d{2}BH\d{4}[A-Z]{1,2}$', c):
        return 'IND — BH Series'
    return 'GENERIC'


def bbox_with_padding(x1, y1, x2, y2, img_w, img_h, pad=0.05):
    """Add % padding around a box and clamp to image bounds → [x, y, w, h]"""
    dx = int((x2 - x1) * pad)
    dy = int((y2 - y1) * pad)
    x1 = max(0, x1 - dx)
    y1 = max(0, y1 - dy)
    x2 = min(img_w, x2 + dx)
    y2 = min(img_h, y2 + dy)
    return [x1, y1, x2 - x1, y2 - y1]


# ── Main Route ───────────────────────────────────────────────────────────

@app.route('/api/detect', methods=['POST'])
def detect():

    # 1. Read uploaded image
    if 'image' not in request.files:
        return jsonify({'error': 'No image file in request'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400

    try:
        pil_img = Image.open(io.BytesIO(file.read())).convert('RGB')
    except Exception:
        return jsonify({'error': 'Cannot open image — unsupported format'}), 400

    # Convert to OpenCV BGR (what YOLO & cv2 expect)
    img_np  = np.array(pil_img)                  # RGB numpy
    img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
    img_h, img_w = img_bgr.shape[:2]

    # 2. Run YOLOv8 — same approach as your working script
    results = model.predict(img_bgr, conf=0.5, verbose=False)

    if not results or len(results[0].boxes) == 0:
        return jsonify({'error': 'No license plate detected in image'}), 422

    # 3. Pick the highest-confidence detection
    best_box  = None
    best_conf = 0.0

    for result in results:
        for box in result.boxes:
            conf = float(box.conf[0])
            if conf > best_conf:
                best_conf = conf
                best_box  = box

    x1, y1, x2, y2 = map(int, best_box.xyxy[0])

    # plate_bbox for the frontend (the raw plate region)
    plate_bbox = bbox_with_padding(x1, y1, x2, y2, img_w, img_h, pad=0.06)

    # car_bbox  — we use a generous crop around the plate as the "vehicle region"
    # (expand more aggressively so the car panel is visible in step 02)
    car_bbox = bbox_with_padding(x1, y1, x2, y2, img_w, img_h, pad=0.55)

    # 4. Crop plate and run EasyOCR — same as your working script
    plate_crop = img_bgr[y1:y2, x1:x2]
    ocr_result = reader.readtext(plate_crop)

    if not ocr_result:
        plate_text = ''
        ocr_conf   = 0.0
    else:
        # Sort left-to-right so multi-word plates read correctly
        ocr_result.sort(key=lambda r: r[0][0][0])
        plate_text = clean_plate(' '.join(text for _, text, _ in ocr_result))
        ocr_conf   = round(
            float(np.mean([conf for _, _, conf in ocr_result])) * 100, 1
        )

    # 5. Return JSON expected by app.js
    return jsonify({
        'car_bbox':   car_bbox,        # [x, y, w, h]
        'plate_bbox': plate_bbox,      # [x, y, w, h]
        'plate':      plate_text,      # e.g. "MH02AB1234"
        'confidence': ocr_conf,        # 0–100 float
        'format':     detect_format(plate_text),
    })


# ── Serve frontend ───────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204   # no favicon — return empty 204 to silence 404 logs


# ── Health check ─────────────────────────────────────────────────────────

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'model': 'best.pt'})


# ── Run ──────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)