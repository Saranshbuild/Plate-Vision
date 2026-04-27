# PlateVision — Frontend

Dark forensic-style ANPR (Automatic Number Plate Recognition) frontend.

## Structure
```
plate-vision/
├── index.html
├── css/
│   └── style.css
└── js/
    └── app.js
```

## How it works (Frontend)
1. User drops/selects a vehicle image
2. Canvas pipeline shows: Original → Car Crop → Plate Crop
3. Animated scan beams simulate detection
4. Plate characters are revealed one-by-one
5. Meta info shown: format, char count, process time

## Flask Integration (later)
In `app.js`, stub functions are clearly labeled. Replace with:
- `POST /api/detect-car`   → returns `{ bbox: [x, y, w, h] }`
- `POST /api/detect-plate` → returns `{ bbox: [x, y, w, h] }`
- `POST /api/ocr`          → returns `{ plate: "MH02AB1234", confidence: 97.4 }`

All stubs are in the bottom comment block of `app.js`.

## Fonts (Google Fonts)
- Bebas Neue — display/titles
- Share Tech Mono — monospace labels
- DM Sans — body
