// Camera text reading. Tesseract runs once per capture — never on a loop — so a
// result stays on screen until you ask for another scan.

import { CONFIG } from './config.js';
import { lang } from './langs.js';

let Tesseract = null;
let worker = null;
let workerLangs = '';
let booting = null;

async function loadLib() {
  if (Tesseract) return Tesseract;
  const mod = await import(CONFIG.tesseractUrl);
  // The ESM build ships `export { tesseract_min as default }` and nothing else,
  // so the namespace object has no createWorker on it. Accept either shape.
  Tesseract = mod && typeof mod.createWorker === 'function' ? mod : mod.default;
  if (!Tesseract || typeof Tesseract.createWorker !== 'function') {
    throw new Error('Tesseract loaded but exposed no createWorker — check tesseractUrl in js/config.js.');
  }
  return Tesseract;
}

/** Spin up (or re-point) the OCR worker for a set of app language codes. */
export async function ensureWorker(codes, onProgress) {
  const langs = codes.map((c) => lang(c).tess).filter(Boolean).join('+');
  if (worker && workerLangs === langs) return worker;
  if (booting) await booting;
  if (worker && workerLangs === langs) return worker;

  const lib = await loadLib();
  const options = {
    workerPath: CONFIG.tesseractWorkerUrl,
    corePath: CONFIG.tesseractCorePath,
    cacheMethod: 'write', // traineddata lands in IndexedDB and stays there
    logger: (m) => {
      if (onProgress && typeof m.progress === 'number') onProgress(m.status, m.progress);
    },
  };
  if (CONFIG.tessdataPath) options.langPath = CONFIG.tessdataPath;

  booting = (async () => {
    if (worker) {
      await worker.reinitialize(langs, 1);
    } else {
      worker = await lib.createWorker(langs, 1, options);
    }
    workerLangs = langs;
  })();

  try { await booting; } finally { booting = null; }
  return worker;
}

/**
 * Copy a video frame into a canvas, upscaled and contrast-stretched.
 * Small, low-contrast frames are the main cause of nonsense OCR output.
 */
export function prepareFrame(source, sw, sh) {
  const short = Math.min(sw, sh);
  const long = Math.max(sw, sh);
  let scale = CONFIG.ocr.minShortEdge / short;
  if (long * scale > CONFIG.ocr.maxLongEdge) scale = CONFIG.ocr.maxLongEdge / long;
  scale = Math.max(1, Math.min(scale, 3));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;

  // Grayscale, then stretch the middle of the histogram.
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = px[i + 1] = px[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const span = Math.max(1, max - min);
  if (span < 235) {
    for (let i = 0; i < px.length; i += 4) {
      const v = ((px[i] - min) * 255) / span;
      const c = v < 0 ? 0 : v > 255 ? 255 : v;
      px[i] = px[i + 1] = px[i + 2] = c;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Read a prepared canvas and return paragraph-level regions.
 * Paragraphs (not words) keep enough context for the translator and give the
 * overlay a stable box to sit in.
 */
export async function readParagraphs(canvas, codes, onProgress) {
  const w = await ensureWorker(codes, onProgress);

  // 3 = automatic, assumes a page of prose. 11 = sparse text, which is what a
  // road sign or a van door actually is. Try prose first, then sparse.
  for (const psm of ['3', '11']) {
    try { await w.setParameters({ tessedit_pageseg_mode: psm }); } catch { /* older builds */ }
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
    const regions = collect(data);
    if (regions.length) return { regions, fullText: (data.text || '').trim(), mode: psm };
  }
  return { regions: [], fullText: '' };
}

/** Paragraph regions, falling back to lines when sparse mode finds no paragraphs. */
function collect(data) {
  const regions = [];
  const push = (text, confidence, bbox, lines) => {
    const clean = (text || '').replace(/\s*\n\s*/g, ' ').trim();
    if (!clean || clean.length < 2) return;
    if (confidence < CONFIG.ocr.minConfidence) return;
    if (!/\p{L}/u.test(clean)) return;
    regions.push({
      text: clean,
      confidence: Math.round(confidence),
      lines: lines || 1,
      box: { x: bbox.x0, y: bbox.y0, w: bbox.x1 - bbox.x0, h: bbox.y1 - bbox.y0 },
    });
  };

  for (const block of data.blocks || []) {
    const paras = block.paragraphs || [];
    if (paras.length) {
      for (const p of paras) push(p.text, p.confidence ?? 0, p.bbox, (p.lines || []).length || 1);
    } else {
      // Sparse mode often yields lines without paragraph grouping.
      for (const l of block.lines || []) push(l.text, l.confidence ?? 0, l.bbox, 1);
    }
  }

  regions.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return regions;
}

export async function terminate() {
  if (worker) { await worker.terminate(); worker = null; workerLangs = ''; }
}
