/* ============================================================
   PlateVision — app.js
   Pipeline: upload → original → car crop → plate crop → OCR
   Calls Flask backend at POST /api/detect
   ============================================================ */

(function () {
  'use strict';

  /* ── DOM refs ── */
  const uploadZone      = document.getElementById('uploadZone');
  const fileInput       = document.getElementById('fileInput');
  const uploadSection   = document.getElementById('uploadSection');
  const pipelineSection = document.getElementById('pipelineSection');

  const canvasOriginal  = document.getElementById('canvasOriginal');
  const canvasCar       = document.getElementById('canvasCar');
  const canvasPlate     = document.getElementById('canvasPlate');

  const status02        = document.getElementById('status02');
  const status03        = document.getElementById('status03');
  const carBox          = document.getElementById('carBox');
  const plateBox        = document.getElementById('plateBox');
  const carWrap         = document.getElementById('carWrap');
  const plateWrap       = document.getElementById('plateWrap');

  const resultSection   = document.getElementById('resultSection');
  const plateCharsEl    = document.getElementById('plateChars');
  const confidenceText  = document.getElementById('confidenceText');
  const metaFormat      = document.getElementById('metaFormat');
  const metaChars       = document.getElementById('metaChars');
  const metaTime        = document.getElementById('metaTime');
  const resetBtn        = document.getElementById('resetBtn');

  /* ── State ── */
  let startTime   = 0;
  let currentFile = null;

  /* ════════════════════════════════════════
     Upload handling
  ════════════════════════════════════════ */
  uploadZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  });

  /* ════════════════════════════════════════
     Pipeline
  ════════════════════════════════════════ */
  function handleFile(file) {
    currentFile = file;
    startTime   = performance.now();

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => runPipeline(img, file);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function runPipeline(img, file) {
    uploadSection.style.display = 'none';
    pipelineSection.classList.remove('hidden');

    // Step 1 — show original
    await delay(80);
    drawImage(img, canvasOriginal);

    // Step 2 — call backend, show scanning animation while waiting
    await delay(300);
    showStatus(status02, 'processing');
    startScan(carWrap);

    let result;
    try {
      result = await callBackend(file);
    } catch (err) {
      showError(err.message);
      return;
    }

    // Draw car crop from backend bbox
    const carCanvas = cropToCanvas(img, result.car_bbox);
    drawImage(carCanvas, canvasCar, true);
    stopScan(carWrap);
    showStatus(status02, 'done', '✓ DETECTED');
    carBox.classList.remove('hidden');

    // Step 3 — plate crop
    await delay(400);
    showStatus(status03, 'processing');
    startScan(plateWrap);
    await delay(500);

    const plateCanvas = cropToCanvas(img, result.plate_bbox);
    drawImage(plateCanvas, canvasPlate, true);
    stopScan(plateWrap);
    showStatus(status03, 'done', '✓ ISOLATED');
    plateBox.classList.remove('hidden');

    // Step 4 — result
    await delay(400);
    showResult(result);
  }

  /* ════════════════════════════════════════
     Backend call
     Flask should return JSON:
     {
       car_bbox:   [x, y, w, h],
       plate_bbox: [x, y, w, h],
       plate:      "MH02AB1234",
       confidence: 97.4,
       format:     "IND"          (optional)
     }
  ════════════════════════════════════════ */
  async function callBackend(file) {
    const formData = new FormData();
    formData.append('image', file);

    const res = await fetch('/api/detect', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    return res.json();
  }

  /* ════════════════════════════════════════
     Canvas helpers
  ════════════════════════════════════════ */
  function drawImage(source, canvas) {
    const ctx  = canvas.getContext('2d');
    const maxW = canvas.parentElement.clientWidth || 800;
    const maxH = 360;
    const srcW = source.width  || source.naturalWidth;
    const srcH = source.height || source.naturalHeight;
    const scale = Math.min(maxW / srcW, maxH / srcH, 1);

    canvas.width  = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  // Crop [x, y, w, h] from image → new canvas
  function cropToCanvas(img, bbox) {
    const [x, y, w, h] = bbox;
    const oc = document.createElement('canvas');
    oc.width  = w;
    oc.height = h;
    oc.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
    return oc;
  }

  /* ════════════════════════════════════════
     Status helpers
  ════════════════════════════════════════ */
  function showStatus(el, type, text) {
    el.classList.remove('hidden', 'done', 'processing');
    el.classList.add(type);
    if (text) el.textContent = text;
  }

  function startScan(wrap) { wrap.classList.add('scanning'); }
  function stopScan(wrap)  { wrap.classList.remove('scanning'); }

  /* ════════════════════════════════════════
     Result display
  ════════════════════════════════════════ */
  function showResult(result) {
    resultSection.classList.remove('hidden');

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    const plate   = (result.plate || '').toUpperCase();
    const conf    = result.confidence != null ? Number(result.confidence).toFixed(1) : null;

    renderPlateChars(plate);
    confidenceText.textContent = conf ? `CONF: ${conf}%` : '';
    metaFormat.textContent     = result.format || detectFormat(plate);
    metaChars.textContent      = `${plate.replace(/\s|-/g, '').length} CHARS`;
    metaTime.textContent       = `${elapsed}s`;
  }

  function renderPlateChars(plateStr) {
    plateCharsEl.innerHTML = '';
    plateStr.split('').forEach((ch, i) => {
      const span = document.createElement('span');
      span.className = 'plate-char' + (ch === ' ' || ch === '-' ? ' sep' : '');
      span.textContent = ch === ' ' ? '·' : ch;
      span.style.animationDelay = `${i * 55}ms`;
      plateCharsEl.appendChild(span);
    });
  }

  function detectFormat(plate) {
    const c = plate.replace(/\s|-/g, '');
    if (/^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(c)) return 'IND — Standard';
    if (/^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$/.test(c))   return 'IND — BH';
    return 'GENERIC';
  }

  /* ════════════════════════════════════════
     Error state
  ════════════════════════════════════════ */
  function showError(msg) {
    stopScan(carWrap);
    stopScan(plateWrap);
    showStatus(status02, 'done', '✗ ERROR');
    status02.style.color = 'var(--red)';

    const errEl = document.createElement('div');
    errEl.className = 'pipeline-error';
    errEl.textContent = `ERROR: ${msg}`;
    pipelineSection.appendChild(errEl);
  }

  /* ════════════════════════════════════════
     Reset
  ════════════════════════════════════════ */
  resetBtn.addEventListener('click', () => {
    fileInput.value = '';
    currentFile = null;

    [canvasOriginal, canvasCar, canvasPlate].forEach(c => {
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      c.width = 0; c.height = 0;
    });

    [status02, status03].forEach(s => {
      s.className = 'step-status processing hidden';
      s.style.color = '';
    });

    [carBox, plateBox].forEach(b => b.classList.add('hidden'));
    [carWrap, plateWrap].forEach(w => w.classList.remove('scanning'));

    pipelineSection.querySelectorAll('.pipeline-error').forEach(e => e.remove());

    resultSection.classList.add('hidden');
    plateCharsEl.innerHTML = '';

    pipelineSection.classList.add('hidden');
    uploadSection.style.display = '';
  });

  /* ── Utility ── */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

})();
