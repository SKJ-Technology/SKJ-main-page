// SKJ Translator — UI controller.

import { CONFIG, BUILD } from './config.js';
import { LANGS, lang, primaryLangs, otherLangs } from './langs.js';
import { detectLanguage } from './detect.js';
import { translator, speech } from './engine.js';
import { charBudget } from './mt.remote.js';
import { prepareFrame, readParagraphs, ensureWorker } from './ocr.js';
import { Recorder } from './audio.js';
import { nativeSpeech } from './asr.native.js';
import { speak, stopSpeaking, hasVoiceFor, onVoicesReady, voiceCount } from './tts.js';
import { settings, history, saved } from './store.js';
import { budget, formatBytes } from './budget.js';
import { initGuide } from './guide.js';
import * as Learn from './learn.js';

const $ = (id) => document.getElementById(id);
const ALL_CODES = LANGS.map((l) => l.code);

const ui = {
  net: $('net'), netLabel: $('netLabel'),
  srcBtn: $('srcBtn'), srcName: $('srcName'), srcCode: $('srcCode'),
  tgtBtn: $('tgtBtn'), tgtName: $('tgtName'), tgtCode: $('tgtCode'),
  swapBtn: $('swapBtn'),
  input: $('input'), counter: $('counter'), goBtn: $('goBtn'),
  plate: $('plate'), plateRoute: $('plateRoute'), output: $('output'), plateNote: $('plateNote'),
  speakBtn: $('speakBtn'), copyBtn: $('copyBtn'), saveBtn: $('saveBtn'),
  savedStrip: $('savedStrip'), savedList: $('savedList'),
  historyStrip: $('historyStrip'), historyList: $('historyList'), historyClear: $('historyClear'),
  cam: $('cam'), video: $('video'), shot: $('shot'), shotImg: $('shotImg'), boxes: $('boxes'),
  camEmpty: $('camEmpty'), camStart: $('camStart'), camStatus: $('camStatus'),
  shutter: $('shutter'), shutterLabel: $('shutterLabel'), rescan: $('rescan'), pickFile: $('pickFile'),
  fileInput: $('fileInput'), showTranslated: $('showTranslated'), showOriginal: $('showOriginal'),
  scanStrip: $('scanStrip'), scanList: $('scanList'),
  micBtn: $('micBtn'), micLevel: $('micLevel'), micHint: $('micHint'),
  heardText: $('heardText'), heardRole: $('heardRole'),
  saidText: $('saidText'), saidRole: $('saidRole'), replayBtn: $('replayBtn'),
  autoSpeak: $('autoSpeak'),
  sheet: $('sheet'), sheetScrim: $('sheetScrim'), sheetClose: $('sheetClose'),
  sheetTitle: $('sheetTitle'), sheetList: $('sheetList'),
  toast: $('toast'),
};

const state = {
  source: settings.get('source'),
  target: settings.get('target'),
  lastResult: null,
  activeJob: null,
  stream: null,
  regions: [],
  captureSize: { w: 0, h: 0 },
  showTranslated: true,
  recorder: null,
  listening: null,
  lastSpoken: null,
};

/* ── Small helpers ─────────────────────────────────────── */

let toastTimer = 0;
function toast(message, bad = false) {
  ui.toast.textContent = message;
  ui.toast.classList.toggle('is-bad', bad);
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, bad ? 4200 : 2200);
}

const mb = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(0)} MB` : '—');

function reveal(el, text) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.textContent = '';
  const words = text.split(/(\s+)/);
  if (reduced || words.length > 90) { el.textContent = text; return; }
  words.forEach((w, i) => {
    if (!w.trim()) { el.append(w); return; }
    const span = document.createElement('span');
    span.className = 'flip';
    span.style.animationDelay = `${Math.min(i * 14, 380)}ms`;
    span.textContent = w;
    el.append(span);
  });
}

function setBusy(on) {
  ui.net.dataset.state = on ? 'busy' : navigator.onLine ? 'online' : 'offline';
  ui.netLabel.textContent = on ? 'Working' : navigator.onLine ? 'Online' : 'Offline';
}

/* ── Language pair ─────────────────────────────────────── */

function paintPair() {
  if (state.source === 'auto') {
    ui.srcName.textContent = 'Detect';
    ui.srcCode.textContent = 'auto';
  } else {
    const l = lang(state.source);
    ui.srcName.textContent = l.native;
    ui.srcCode.textContent = l.code.toUpperCase();
  }
  const t = lang(state.target);
  ui.tgtName.textContent = t.native;
  ui.tgtCode.textContent = t.code.toUpperCase();
}

function openSheet(which) {
  const current = which === 'src' ? state.source : state.target;
  ui.sheetTitle.textContent = which === 'src' ? 'Translate from' : 'Translate into';
  ui.sheetList.innerHTML = '';

  const addOption = (code, label, native, note) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = `opt${code === current ? ' is-on' : ''}`;
    btn.type = 'button';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(code === current));
    btn.innerHTML =
      `<span class="opt-name"></span><span class="opt-native"></span><span class="opt-code"></span>`;
    btn.querySelector('.opt-name').textContent = label;
    btn.querySelector('.opt-native').textContent = native || '';
    btn.querySelector('.opt-code').textContent = note || '';
    btn.addEventListener('click', () => {
      if (which === 'src') {
        state.source = code;
        settings.set('source', code);
        if (code !== 'auto') settings.set('lastSource', code);
      } else {
        state.target = code;
        settings.set('target', code);
      }
      paintPair();
      closeSheet();
      if (ui.input.value.trim()) runTextTranslate();
    });
    li.append(btn);
    ui.sheetList.append(li);
  };

  const addDivider = (text) => {
    const li = document.createElement('li');
    li.className = 'opt-divider';
    li.textContent = text;
    ui.sheetList.append(li);
  };

  if (which === 'src') addOption('auto', 'Detect language', 'Guessed from the text', 'auto');
  primaryLangs().forEach((l) => addOption(l.code, l.name, l.native, l.code.toUpperCase()));
  addDivider('More languages');
  otherLangs().forEach((l) => addOption(l.code, l.name, l.native, l.code.toUpperCase()));

  ui.sheet.hidden = false;
  (which === 'src' ? ui.srcBtn : ui.tgtBtn).setAttribute('aria-expanded', 'true');
}

function closeSheet() {
  ui.sheet.hidden = true;
  ui.srcBtn.setAttribute('aria-expanded', 'false');
  ui.tgtBtn.setAttribute('aria-expanded', 'false');
}

ui.srcBtn.addEventListener('click', () => openSheet('src'));
ui.tgtBtn.addEventListener('click', () => openSheet('tgt'));
ui.sheetScrim.addEventListener('click', closeSheet);
ui.sheetClose.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.sheet.hidden) closeSheet(); });

ui.swapBtn.addEventListener('click', () => {
  const from = state.source === 'auto' ? settings.get('lastSource') : state.source;
  state.source = state.target;
  state.target = from;
  settings.set('source', state.source);
  settings.set('lastSource', state.source);
  settings.set('target', state.target);
  paintPair();
  ui.swapBtn.classList.add('is-turning');
  setTimeout(() => ui.swapBtn.classList.remove('is-turning'), 360);

  // Swapping should move the translation up into the box, like every other
  // translator does — it is the fastest way to reply to someone.
  if (state.lastResult) {
    ui.input.value = state.lastResult.out;
    syncCounter();
    runTextTranslate();
  }
});

/** Decide the real pair for a piece of text, resolving "Detect". */
function resolvePair(text) {
  let src = state.source;
  let note = '';
  if (src === 'auto') {
    const guess = detectLanguage(text, ALL_CODES);
    src = guess.code;
    note = guess.confidence < 0.35
      ? `Guessed ${lang(src).name} — set the language above if that is wrong`
      : `Detected ${lang(src).name}`;
  }
  let tgt = state.target;
  if (src === tgt) {
    const fallback = settings.get('lastSource');
    tgt = fallback && fallback !== src ? fallback : src === 'en' ? 'pl' : 'en';
    note = `${lang(src).name} in, ${lang(tgt).name} out`;
  }
  return { src, tgt, note };
}

/* ── Text view ─────────────────────────────────────────── */

function syncCounter() {
  const n = ui.input.value.length;
  ui.counter.textContent = String(n);
  ui.goBtn.disabled = n === 0;
  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(ui.input.scrollHeight, window.innerHeight * 0.4)}px`;
}

ui.input.addEventListener('input', syncCounter);
ui.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runTextTranslate(); }
});
ui.goBtn.addEventListener('click', () => runTextTranslate());
ui.clearBtn = $('clearBtn');
ui.clearBtn.addEventListener('click', () => {
  ui.input.value = '';
  syncCounter();
  ui.plate.hidden = true;
  ui.input.focus();
});
$('pasteBtn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) { ui.input.value = text; syncCounter(); runTextTranslate(); }
  } catch {
    toast('Your browser blocked clipboard access', true);
  }
});

async function runTextTranslate() {
  const text = ui.input.value.trim();
  if (!text) return;

  if (state.activeJob) translator.cancel(state.activeJob);

  const { src, tgt, note } = resolvePair(text);
  ui.plate.hidden = false;
  ui.plate.classList.add('is-working');
  ui.plateRoute.textContent = `${src.toUpperCase()} → ${tgt.toUpperCase()}  ·  1 request`;
  ui.plateNote.hidden = !note;
  ui.plateNote.textContent = note;
  ui.output.textContent = 'Translating…';
  ui.goBtn.disabled = true;
  setBusy(true);

  const job = translator.translate(text, src, tgt);
  state.activeJob = job.id;

  try {
    const out = await job.promise;
    if (state.activeJob !== job.id) return;
    reveal(ui.output, out);
    state.lastResult = { in: text, out, src, tgt, at: Date.now() };
    history.add(state.lastResult);
    paintLists();
    paintSaveButton();
    if (settings.get('autoSpeak')) speak(out, tgt);
  } catch (err) {
    ui.output.textContent = 'Translation stopped.';
    ui.plateNote.hidden = false;
    ui.plateNote.textContent = friendlyError(err);
  } finally {
    state.activeJob = null;
    ui.plate.classList.remove('is-working');
    ui.goBtn.disabled = false;
    setBusy(false);
  }
}

translator.on((msg) => {
  if (msg.type === 'partial' && state.activeJob === msg.id) {
    ui.output.textContent = msg.text;
    ui.plateNote.hidden = false;
    ui.plateNote.textContent = `sentence ${msg.done} of ${msg.total}`;
  }
});

function friendlyError(err) {
  if (err && (err.isBudget || err.isCharCap)) return err.message;
  const text = String(err && err.message ? err.message : err);
  if (/Failed to fetch|NetworkError|network/i.test(text)) {
    return 'Could not reach the translation endpoint. Check your connection or the Worker URL in Data.';
  }
  if (/not downloaded|Failed to load/i.test(text)) {
    return 'The voice model is not downloaded yet. Open Data on Wi-Fi first.';
  }
  return text;
}

/* ── Plate tools ───────────────────────────────────────── */

ui.speakBtn.addEventListener('click', () => {
  if (!state.lastResult) return;
  if (!hasVoiceFor(state.lastResult.tgt)) {
    toast(`No ${lang(state.lastResult.tgt).name} voice installed on this device`, true);
    return;
  }
  speak(state.lastResult.out, state.lastResult.tgt);
});

ui.copyBtn.addEventListener('click', async () => {
  if (!state.lastResult) return;
  try {
    await navigator.clipboard.writeText(state.lastResult.out);
    toast('Copied');
  } catch {
    toast('Copy blocked by the browser', true);
  }
});

ui.saveBtn.addEventListener('click', () => {
  if (!state.lastResult) return;
  const on = saved.toggle(state.lastResult);
  toast(on ? 'Saved' : 'Removed from saved');
  paintSaveButton();
  paintLists();
});

function paintSaveButton() {
  const on = state.lastResult ? saved.has(state.lastResult) : false;
  ui.saveBtn.setAttribute('aria-pressed', String(on));
}

/* ── Saved and recent lists ────────────────────────────── */

function rowFor(entry) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'row';
  btn.type = 'button';
  btn.innerHTML = `<span class="row-tag"></span><span class="row-out"></span><span class="row-in"></span>`;
  btn.querySelector('.row-tag').textContent = `${entry.src}→${entry.tgt}`;
  btn.querySelector('.row-out').textContent = entry.out;
  btn.querySelector('.row-in').textContent = entry.in;
  btn.addEventListener('click', () => {
    ui.input.value = entry.in;
    state.source = entry.src;
    state.target = entry.tgt;
    settings.set('source', entry.src);
    settings.set('target', entry.tgt);
    paintPair();
    syncCounter();
    runTextTranslate();
    window.scrollTo({ top: 0 });
  });
  li.append(btn);
  return li;
}

function paintLists() {
  const s = saved.all();
  ui.savedStrip.hidden = s.length === 0;
  ui.savedList.replaceChildren(...s.slice(0, 20).map(rowFor));

  const h = history.all().filter((e) => !saved.has(e));
  ui.historyStrip.hidden = h.length === 0;
  ui.historyList.replaceChildren(...h.slice(0, 20).map(rowFor));
}

ui.historyClear.addEventListener('click', () => { history.clear(); paintLists(); toast('Recent cleared'); });

/* ── Tabs ──────────────────────────────────────────────── */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('is-active', v.id === `view-${tab.dataset.view}`);
    });
    if (tab.dataset.view !== 'camera') stopCamera();
    if (tab.dataset.view === 'models') refreshModels();
    if (tab.dataset.view === 'guide' && !state.guideReady) {
      state.guideReady = true;
      initGuide($('view-guide'), { toast });
    }
    $('main').scrollTop = 0;
  });
});

/* ── Camera ────────────────────────────────────────────── */

function showCamError(message) {
  ui.camStatus.hidden = false;
  ui.camStatus.style.whiteSpace = 'pre-wrap';
  ui.camStatus.textContent = message;
}

function camStatus(text) {
  ui.camStatus.style.whiteSpace = '';
  ui.camStatus.hidden = !text;
  ui.camStatus.textContent = text || '';
}

ui.camStart.addEventListener('click', startCamera);

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    });
    ui.video.srcObject = state.stream;
    await ui.video.play();
    ui.cam.dataset.mode = 'live';
    ui.camEmpty.hidden = true;
    ui.shot.hidden = true;
    ui.shutter.disabled = false;
  } catch (err) {
    toast(err && err.name === 'NotAllowedError'
      ? 'Camera permission denied — allow it in site settings'
      : 'No camera available on this device', true);
  }
}

function stopCamera() {
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  if (ui.cam.dataset.mode === 'live') { ui.cam.dataset.mode = 'idle'; ui.camEmpty.hidden = false; ui.shutter.disabled = true; }
}

ui.pickFile.addEventListener('click', () => ui.fileInput.click());
ui.fileInput.addEventListener('change', async () => {
  const file = ui.fileInput.files && ui.fileInput.files[0];
  ui.fileInput.value = '';
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  stopCamera();
  ui.camEmpty.hidden = true;
  await scanFrom(img, img.naturalWidth, img.naturalHeight);
  URL.revokeObjectURL(img.src);
});

ui.shutter.addEventListener('click', () => {
  if (!state.stream) return;
  scanFrom(ui.video, ui.video.videoWidth, ui.video.videoHeight);
});

ui.rescan.addEventListener('click', async () => {
  ui.shot.hidden = true;
  ui.boxes.replaceChildren();
  ui.scanStrip.hidden = true;
  state.regions = [];
  ui.rescan.disabled = true;
  if (!state.stream) await startCamera();
  else { ui.cam.dataset.mode = 'live'; ui.shutter.disabled = false; }
  ui.shutterLabel.textContent = 'Scan';
});

async function scanFrom(source, w, h) {
  if (!w || !h) { toast('Camera is still warming up', true); return; }

  ui.shutter.disabled = true;
  ui.shutterLabel.textContent = '···';
  camStatus('Reading the picture');
  setBusy(true);

  const canvas = prepareFrame(source, w, h);
  state.captureSize = { w: canvas.width, h: canvas.height };
  ui.shotImg.src = canvas.toDataURL('image/jpeg', 0.9);
  ui.shot.hidden = false;
  ui.cam.dataset.mode = 'shot';
  ui.boxes.replaceChildren();
  stopCamera();
  ui.rescan.disabled = false;

  const ocrLangs = state.source === 'auto'
    ? ['en', 'de', 'pl']
    : [state.source, ...(state.source === 'en' ? [] : ['en'])];

  try {
    const { regions } = await readParagraphs(canvas, ocrLangs, (status, p) => {
      if (status === 'recognizing text') camStatus(`Reading ${Math.round(p * 100)}%`);
      else if (status.startsWith('loading') || status.includes('language')) camStatus('Getting language data (first scan only)');
    });

    const blockCap = settings.get('lowData')
      ? 8
      : (CONFIG.remote.provider === 'worker' ? 40 : CONFIG.remote.maxBlocksPerScan);
    if (regions.length > blockCap) {
      camStatus('');
      showCamError(`Found ${regions.length} blocks of text — more than the ${blockCap} this scan allows.\nAim at just the part you need.`);
      ui.shutterLabel.textContent = 'Scan';
      return;
    }

    if (!regions.length) {
      camStatus('');
      toast('No readable text found — try filling more of the frame', true);
      ui.shutterLabel.textContent = 'Scan';
      return;
    }

    state.regions = regions.map((r) => ({ ...r, translated: null }));
    paintBoxes();
    paintScanList();
    ui.scanStrip.hidden = false;

    // The whole scan goes out as ONE request. Looping per paragraph would burn
    // the budget in a single photo. Detecting the language across all the text
    // at once also gives a better guess than any one block would.
    const joined = state.regions.map((r) => r.text).join(' ');
    const { src, tgt } = resolvePair(joined);
    camStatus(`${state.regions.length} blocks`);
    try {
      const outs = await translator
        .translateBatch(state.regions.map((r) => r.text), src, tgt,
          (done, total) => camStatus(`Translating ${done} of ${total}`)).promise;
      state.regions.forEach((r, i) => { r.translated = outs[i] || null; });
    } catch (err) {
      const message = friendlyError(err);
      state.regions.forEach((r) => { r.error = message; });
      toast(message, true);
    }
    paintBoxes();
    paintScanList();
    camStatus('');
  } catch (err) {
    // Keep it on screen. A toast disappears before it can be read.
    camStatus('');
    showCamError(err && err.message ? err.message : String(err));
  } finally {
    setBusy(false);
    ui.shutterLabel.textContent = 'Scan';
  }
}

/** Map capture pixels onto the on-screen frame, accounting for object-fit: cover. */
function paintBoxes() {
  const { w: iw, h: ih } = state.captureSize;
  if (!iw) return;
  const cw = ui.cam.clientWidth;
  const ch = ui.cam.clientHeight;
  const scale = Math.max(cw / iw, ch / ih);
  const ox = (cw - iw * scale) / 2;
  const oy = (ch - ih * scale) / 2;

  const nodes = state.regions.map((r) => {
    const el = document.createElement('div');
    const pending = state.showTranslated && !r.translated;
    el.className = `box${pending ? ' is-pending' : ''}`;
    el.textContent = state.showTranslated ? (r.translated || '…') : r.text;
    el.style.left = `${ox + r.box.x * scale}px`;
    el.style.top = `${oy + r.box.y * scale}px`;
    el.style.width = `${r.box.w * scale}px`;
    el.style.minHeight = `${r.box.h * scale}px`;
    // Match the height of one detected line of the original.
    const lineHeight = (r.box.h * scale) / Math.max(1, r.lines || 1);
    el.style.fontSize = `${Math.max(10, Math.min(22, lineHeight * 0.72))}px`;
    return el;
  });
  ui.boxes.replaceChildren(...nodes);
}

function paintScanList() {
  ui.scanList.replaceChildren(...state.regions.map((r) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'row';
    btn.type = 'button';
    btn.innerHTML = `<span class="row-tag"></span><span class="row-out"></span><span class="row-in"></span>`;
    btn.querySelector('.row-tag').textContent = `${r.confidence}%`;
    btn.querySelector('.row-out').textContent = r.translated || (r.error ? 'Not translated' : 'Translating…');
    btn.querySelector('.row-in').textContent = r.text;
    btn.addEventListener('click', () => {
      ui.input.value = r.text;
      document.querySelector('.tab[data-view="text"]').click();
      syncCounter();
      runTextTranslate();
    });

    // A word you had to look up is exactly the one worth learning.
    const wrapRow = document.createElement('div');
    wrapRow.className = 'phraserow';
    wrapRow.append(btn);
    if (r.translated) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'star';
      add.textContent = '+';
      add.setAttribute('aria-label', 'Add to flashcards');
      add.addEventListener('click', (e) => {
        e.stopPropagation();
        const { src, tgt } = resolvePair(r.text);
        const ok = Learn.addCustom(r.translated, r.text, tgt, src);
        add.textContent = ok ? '✓' : '·';
        add.classList.add('is-on');
        toast(ok ? 'Added to flashcards' : 'Already in your deck');
      });
      wrapRow.append(add);
    }
    li.append(wrapRow);
    return li;
  }));
}

function setOverlayMode(translated) {
  state.showTranslated = translated;
  ui.showTranslated.classList.toggle('is-on', translated);
  ui.showOriginal.classList.toggle('is-on', !translated);
  ui.showTranslated.setAttribute('aria-pressed', String(translated));
  ui.showOriginal.setAttribute('aria-pressed', String(!translated));
  paintBoxes();
}

ui.showTranslated.addEventListener('click', () => setOverlayMode(true));
ui.showOriginal.addEventListener('click', () => setOverlayMode(false));
window.addEventListener('resize', () => { if (state.regions.length) paintBoxes(); });

/* ── Voice ─────────────────────────────────────────────── */

const voiceEngine = () => {
  const pref = settings.get('voiceEngine') || 'device';
  if (pref === 'device' && nativeSpeech.supported && !nativeSpeech.blockedByStandalone) return 'device';
  if (pref === 'device' && nativeSpeech.supported && nativeSpeech.blockedByStandalone) return 'blocked';
  if (pref === 'device' && !nativeSpeech.supported) return 'whisper';
  return 'whisper';
};

ui.micBtn.addEventListener('click', async () => {
  if (state.listening) { stopListening(); return; }
  if (state.recorder && state.recorder.active) { await finishRecording(); return; }

  const engine = voiceEngine();
  if (engine === 'blocked') {
    toast('iOS blocks dictation in Home Screen apps. Open the site in Safari, or switch to Whisper in Data.', true);
    return;
  }
  if (engine === 'device') await listenWithDevice();
  else await beginRecording();
});

/* ── Device dictation ─────────────────────────────────── */

async function listenWithDevice() {
  stopSpeaking();
  ui.micBtn.classList.add('is-live');
  ui.micHint.textContent = 'Tap to stop';
  ui.heardText.textContent = 'Listening…';
  ui.saidText.textContent = '—';
  ui.replayBtn.hidden = true;

  if (state.source === 'auto') {
    ui.micBtn.classList.remove('is-live');
    ui.micHint.textContent = 'Tap to speak';
    ui.heardText.textContent =
      'Set "From" to a real language first — dictation cannot detect. Tap the FROM box above.';
    toast('Dictation needs a specific language, not Detect', true);
    return;
  }

  let session;
  try {
    session = nativeSpeech.listen({
      code: state.source,
      onPartial: (text) => { if (text) ui.heardText.textContent = text; },
    });
  } catch (err) {
    ui.micBtn.classList.remove('is-live');
    ui.micHint.textContent = 'Tap to speak';
    toast(err.message, true);
    return;
  }

  state.listening = session;

  try {
    const heard = await session.promise;
    state.listening = null;
    ui.micBtn.classList.remove('is-live');
    if (!heard) { ui.heardText.textContent = 'Nothing came through clearly.'; ui.micHint.textContent = 'Tap to speak'; return; }
    ui.heardText.textContent = heard;
    allowHeardEditing();
    await translateHeard(heard);
  } catch (err) {
    state.listening = null;
    ui.micBtn.classList.remove('is-live');
    ui.heardText.textContent = 'Tap the microphone and speak a sentence.';
    toast(err.message, true);
  } finally {
    ui.micHint.textContent = 'Tap to speak';
  }
}

function stopListening() {
  if (state.listening) { state.listening.stop(); ui.micHint.textContent = 'Finishing…'; }
}

/* ── Whisper, the offline path ─────────────────────────── */

async function beginRecording() {
  stopSpeaking();
  state.recorder = new Recorder({
    onLevel: (level) => { ui.micLevel.style.transform = `scale(${0.25 + level * 0.9})`; },
    onAutoStop: () => finishRecording(),
  });
  try {
    await state.recorder.start();
  } catch (err) {
    state.recorder = null;
    toast(err && err.name === 'NotAllowedError'
      ? 'Microphone permission denied — allow it in site settings'
      : 'No microphone available', true);
    return;
  }
  ui.micBtn.classList.add('is-live');
  ui.micHint.textContent = 'Tap to stop';
  lockHeardEditing();
  ui.heardText.textContent = 'Listening…';
  ui.saidText.textContent = '—';
  ui.replayBtn.hidden = true;
  if (state.source === 'auto' && !state.warnedAuto) {
    state.warnedAuto = true;
    toast('Set From to a real language — Detect makes it mishear a lot', true);
  }
}

async function finishRecording() {
  const rec = state.recorder;
  if (!rec || !rec.active || state.finishing) return;
  state.finishing = true;
  ui.micBtn.classList.remove('is-live');
  ui.micBtn.disabled = true;
  ui.micLevel.style.transform = 'scale(0)';
  ui.micHint.textContent = 'Transcribing';
  setBusy(true);

  try {
    const audio = await rec.stop();
    state.recorder = null;
    if (!audio) { ui.heardText.textContent = 'That was too short to read. Try a full sentence.'; return; }

    const whisperLang = state.source === 'auto' ? undefined : lang(state.source).whisper;
    const heard = await speech.transcribe(
      audio, whisperLang, settings.get('asrTier') || CONFIG.speech.defaultTier).promise;
    if (!heard) { ui.heardText.textContent = 'Nothing came through clearly.'; return; }
    ui.heardText.textContent = heard;
    allowHeardEditing();
    await translateHeard(heard);
  } catch (err) {
    ui.saidText.textContent = '—';
    toast(friendlyError(err), true);
  } finally {
    state.finishing = false;
    ui.micBtn.disabled = false;
    ui.micHint.textContent = 'Tap to speak';
    setBusy(false);
  }
}

/* ── Correcting a misheard sentence ───────────────────── */

// Recognition gets words wrong. Retyping the whole thing is worse than fixing
// one word, so the heard text becomes editable once there is something to edit.
function allowHeardEditing() {
  ui.heardText.contentEditable = 'true';
  ui.heardText.spellcheck = false;
  ui.heardText.classList.add('is-editable');
  ui.reheardBtn.hidden = false;
}

function lockHeardEditing() {
  ui.heardText.contentEditable = 'false';
  ui.heardText.classList.remove('is-editable');
  ui.reheardBtn.hidden = true;
}

/* ── Shared: translate whatever was heard ─────────────── */

async function translateHeard(heard) {
  const { src, tgt } = resolvePair(heard);
  ui.heardRole.textContent = `Heard · ${lang(src).name}`;
  ui.saidRole.textContent = `Translation · ${lang(tgt).name}`;
  ui.saidText.textContent = 'Translating…';
  setBusy(true);
  try {
    const out = await translator.translate(heard, src, tgt).promise;
    reveal(ui.saidText, out);
    state.lastSpoken = { text: out, code: tgt };
    ui.replayBtn.hidden = false;
    state.lastResult = { in: heard, out, src, tgt, at: Date.now() };
    history.add(state.lastResult);
    paintLists();
    if (settings.get('autoSpeak')) speak(out, tgt);
  } catch (err) {
    ui.saidText.textContent = '—';
    toast(friendlyError(err), true);
  } finally {
    setBusy(false);
  }
}

ui.reheardBtn = $('reheardBtn');
ui.reheardBtn.addEventListener('click', () => {
  const fixed = ui.heardText.textContent.trim();
  if (fixed) translateHeard(fixed);
});

ui.replayBtn.addEventListener('click', () => {
  if (state.lastSpoken) speak(state.lastSpoken.text, state.lastSpoken.code);
});

/* ── Detecting a crash we cannot catch ─────────────────── */

// When iOS kills the tab for using too much memory there is no error to catch:
// the whole renderer dies mid-load. So leave a breadcrumb before starting and
// clear it on success. If it is still there next time the app boots, the last
// attempt took the page down with it.

const LOAD_FLAG = 'skj-translator:loading-model';

function markLoadStart(tier) {
  try { localStorage.setItem(LOAD_FLAG, JSON.stringify({ tier, at: Date.now() })); } catch { /* ignore */ }
}

function clearLoadFlag() {
  try { localStorage.removeItem(LOAD_FLAG); } catch { /* ignore */ }
}

function takeCrashReport() {
  try {
    const raw = localStorage.getItem(LOAD_FLAG);
    if (!raw) return null;
    localStorage.removeItem(LOAD_FLAG);
    const r = JSON.parse(raw);
    // Anything under a couple of seconds is a reload, not a crash.
    if (Date.now() - r.at < 2000) return null;
    return r;
  } catch { return null; }
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/* ── Models ────────────────────────────────────────────── */

function wireModelCard(bridge, cfg, ids) {
  let lastBytes = 0;
  let charged = false;
  const tag = $(ids.tag);
  const meter = $(ids.meter);
  const bar = $(ids.bar);
  const note = $(ids.note);
  $(ids.label).textContent = cfg.label;
  note.textContent = cfg.note;

  bridge.on((msg) => {
    if (msg.type === 'info') {
      if (msg.bytes) lastBytes = msg.bytes;
      if (msg.label) $(ids.label).textContent = msg.label;
      if (msg.cached) charged = true; // already on disk, costs nothing to use
      tag.textContent = msg.loaded ? 'In memory' : msg.cached ? 'Downloaded' : 'Not downloaded';
      tag.className = `tag${msg.cached || msg.loaded ? ' is-ready' : ''}`;
      note.textContent = msg.bytes ? `${cfg.note} About ${mb(msg.bytes)} to download.` : cfg.note;
      if (msg.cached || msg.loaded) meter.hidden = true;
    } else if (msg.type === 'loadStage') {
      meter.hidden = false;
      tag.textContent = '…';
      tag.className = 'tag is-busy';
      note.textContent = msg.stage;
    } else if (msg.type === 'loadProgress') {
      meter.hidden = false;
      bar.style.width = `${Math.min(100, msg.pct)}%`;
      tag.textContent = `${Math.round(msg.pct)}%`;
      tag.className = 'tag is-busy';
      if (msg.total) {
        note.textContent = `${formatBytes(msg.loaded)} of ${formatBytes(msg.total)}`;
      }
    } else if (msg.type === 'ready') {
      clearLoadFlag();
      meter.hidden = true;
      tag.textContent = 'Ready';
      tag.className = 'tag is-ready';
      if (msg.choice) note.textContent = `Using ${msg.choice}`;
      if (!charged && lastBytes) { budget.record(lastBytes, 'model'); charged = true; paintBudget(); }
    } else if (msg.type === 'cleared') {
      charged = false;
      tag.textContent = 'Not downloaded';
      tag.className = 'tag';
      bar.style.width = '0%';
      toast('Removed from this device');
    } else if (msg.type === 'loadError') {
      clearLoadFlag();
      meter.hidden = true;
      tag.textContent = 'Failed';
      tag.className = 'tag is-busy';
      // Put the real reason on the card. A toast disappears before it can be read
      // or screenshotted, which is useless when something is actually broken.
      note.textContent = msg.message || 'Unknown failure';
    }
  });

  $(ids.download).addEventListener('click', () => {
    if (!navigator.onLine) { toast('Connect to Wi-Fi to download this', true); return; }
    if (lastBytes && !budget.canSpend(lastBytes)) {
      toast(`That download is ${formatBytes(lastBytes)} and only ${formatBytes(budget.remainingBytes())} is left. Raise the ceiling or wait.`, true);
      return;
    }
    const tier = settings.get('asrTier') || CONFIG.speech.defaultTier;
    markLoadStart(tier);
    bridge.preload(tier);
    toast(lastBytes ? `Downloading ${formatBytes(lastBytes)} — keep this tab open` : 'Downloading — keep this tab open');
  });

  $(ids.clear).addEventListener('click', () => bridge.clear(settings.get('asrTier') || CONFIG.speech.defaultTier));
}

wireModelCard(speech, CONFIG.speech, {
  tag: 'asrTag', meter: 'asrMeter', bar: 'asrBar', note: 'asrNote',
  label: 'asrLabel', download: 'asrDownload', clear: 'asrClear',
});

/* ── Request budget ────────────────────────────────────── */

function paintBudget() {
  const spent = budget.spentBytes();
  const pct = Math.min(100, (spent / budget.limitBytes) * 100);
  const left = budget.remainingBytes();

  $('budgetTag').textContent = formatBytes(spent);
  $('budgetTag').className = `tag${left > 0 ? ' is-ready' : ' is-busy'}`;
  $('budgetBar').style.width = `${pct}%`;
  $('budgetSub').textContent = `last ${budget.windowMinutes} minutes`;
  $('budgetNote').textContent = left > 0
    ? `${formatBytes(left)} left of ${budget.limitMB} MB · ${budget.requests()} translation ${budget.requests() === 1 ? 'request' : 'requests'}`
    : `Ceiling reached. Frees up in about ${budget.renewsIn()} minutes.`;

  const b = budget.breakdown();
  const rows = [
    ['Translated text', b.translation || 0],
    ['Model downloads', b.model || 0],
    ['Maps, search, guides', b.map || 0],
    ['App and libraries', b.app || 0],
  ];
  $('breakdown').replaceChildren(...rows.map(([label, bytes]) => {
    const li = document.createElement('li');
    li.className = bytes ? '' : 'zero';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('b');
    v.textContent = formatBytes(bytes);
    li.append(l, v);
    return li;
  }));

  $('capInput').value = budget.limitMB;
  $('windowInput').value = budget.windowMinutes;
}

translator.on((msg) => {
  if (msg.type === 'fellBack') {
    toast('Worker did not answer — switched back to MyMemory', true);
    paintProvider();
  }
  if (msg.type === 'request') {
    toast(`Sent ${msg.items} ${msg.items === 1 ? 'string' : 'strings'} · ${formatBytes(msg.bytes)}`);
  }
  if (msg.type === 'done' && msg.total) {
    toast(`${formatBytes(msg.total)} used · ${formatBytes(budget.remainingBytes())} left`);
  }
  paintBudget();
  paintChars();
});

function paintProvider() {
  const wrap = $('providerPicker');
  const current = settings.get('provider') || CONFIG.remote.provider;
  const options = [
    { id: 'mymemory', name: 'MyMemory', size: 'no setup',
      blurb: 'Keyless and free, with a daily character allowance. Cannot batch, so a busy camera scan costs several requests.' },
    { id: 'worker', name: 'Your Cloudflare Worker', size: 'needs deploying',
      blurb: 'm2m100 on your own account. Needs wrangler from a computer — uploading through the Cloudflare dashboard will not compile it. Only worth it if you hit the daily character cap.' },
  ];
  wrap.replaceChildren(...options.map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tier${o.id === current ? ' is-on' : ''}`;
    b.innerHTML = '<span class="tier-name"></span><span class="tier-size"></span><span class="tier-blurb"></span>';
    b.querySelector('.tier-name').textContent = o.name;
    b.querySelector('.tier-size').textContent = o.size;
    b.querySelector('.tier-blurb').textContent = o.blurb;
    b.addEventListener('click', () => {
      settings.set('provider', o.id);
      paintProvider();
      paintChars();
      toast(`Translating via ${o.name}`);
    });
    return b;
  }));

  const urlField = $('workerUrlInput');
  urlField.hidden = current !== 'worker';
  urlField.value = settings.get('workerUrl') || '';
  $('workerTestWrap').hidden = current !== 'worker';
  $('workerTestNote').hidden = current !== 'worker';
  if (current === 'worker' && !$('workerTestNote').textContent) {
    $('workerTestNote').textContent =
      'A GET on the endpoint reports whether the Workers AI binding is connected. Costs nothing.';
  }
  $('preferMTWrap').hidden = current === 'worker';
}

$('workerTest').addEventListener('click', async () => {
  const note = $('workerTestNote');
  const url = settings.get('workerUrl') || CONFIG.remote.workerUrl;
  note.hidden = false;
  note.textContent = `Checking ${url}…`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }

    if (!data) {
      settings.set('workerVerified', false);
      note.textContent = `${url} answered ${res.status} with the page instead of the function. ` +
        'Uploading through the dashboard does not compile Pages Functions — that needs wrangler from a computer. ' +
        'Staying on MyMemory until then.';
      return;
    }
    if (data.binding && data.binding !== 'connected') {
      note.textContent = data.binding;
      return;
    }
    if (data.error) { note.textContent = data.error; return; }
    settings.set('workerVerified', true);
    note.textContent = `Working. ${data.model || 'model'} is reachable and the binding is connected.`;
  } catch (err) {
    note.textContent = `Could not reach ${url}. ${err && err.message ? err.message : err}`;
  }
});

$('workerUrlInput').addEventListener('change', () => {
  const v = $('workerUrlInput').value.trim();
  settings.set('workerUrl', v);
  toast(v ? 'Worker URL saved' : 'Worker URL cleared');
});

$('preferMT').checked = !!settings.get('preferMT');
$('preferMT').addEventListener('change', () => {
  settings.set('preferMT', $('preferMT').checked);
  toast($('preferMT').checked ? 'Favouring machine translation' : 'Favouring memory matches');
});

/* ── Taking your data with you ─────────────────────────── */

function paintExport() {
  const s1 = saved.all().length;
  const h1 = history.all().length;
  $('exportNote').textContent =
    `${s1} saved ${s1 === 1 ? 'phrase' : 'phrases'}, ${h1} in recent history. ` +
    'Nothing here has ever been sent anywhere. Copying gives you plain text you can paste into notes or a message.';
}

$('exportBtn').addEventListener('click', async () => {
  const lines = ['SKJ Translator — saved phrases', ''];
  for (const e of saved.all()) lines.push(`${e.src} → ${e.tgt}`, e.in, e.out, '');
  if (history.all().length) {
    lines.push('', 'Recent', '');
    for (const e of history.all()) lines.push(`${e.src} → ${e.tgt}`, e.in, e.out, '');
  }
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${text.length} characters`);
  } catch {
    toast('Clipboard blocked — long-press the diagnostics box instead', true);
  }
});

$('wipeBtn').addEventListener('click', () => {
  if (!state.wipeArmed) {
    state.wipeArmed = true;
    $('wipeBtn').textContent = 'Tap again to erase';
    toast('This clears saved phrases, history, spending and the medical card. Tap again.', true);
    return;
  }
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('skj-translator')) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
  toast('Erased. Reloading.');
  setTimeout(() => location.reload(), 900);
});

function paintChars() {
  const showing = (settings.get('provider') || CONFIG.remote.provider) !== 'worker';
  $('card-chars').hidden = !showing;
  if (!showing) return;
  const used = charBudget.used;
  const limit = charBudget.limit;
  $('charTag').textContent = `${used} / ${limit}`;
  $('charTag').className = `tag${used < limit ? ' is-ready' : ' is-busy'}`;
  $('charBar').style.width = `${Math.min(100, (used / limit) * 100)}%`;
  $('charNote').textContent = charBudget.email
    ? 'Counted per IP by MyMemory. Resets at midnight.'
    : 'Add an email for ten times the allowance. No signup, no verification.';
  if ($('charEmail').value !== charBudget.email) $('charEmail').value = charBudget.email;
}

$('charEmail').addEventListener('change', () => {
  charBudget.email = $('charEmail').value;
  paintChars();
  toast(charBudget.email ? 'Allowance raised to 50 000' : 'Back to 5 000');
});

$('capInput').addEventListener('change', () => {
  budget.configure({ limitMB: parseInt($('capInput').value, 10) });
  paintBudget();
});
$('windowInput').addEventListener('change', () => {
  budget.configure({ windowMinutes: parseInt($('windowInput').value, 10) });
  paintBudget();
});
$('budgetReset').addEventListener('click', () => { budget.reset(); paintBudget(); toast('Meter reset'); });

function refreshModels() {
  // Only called when the Models tab opens: inspecting starts a worker, which
  // pulls the runtime down, and that should not happen on a cold launch.
  // Only wake the Whisper worker if Whisper is actually the chosen engine —
  // booting it pulls the ONNX runtime down for nothing.
  if ((settings.get('voiceEngine') || 'device') === 'whisper') {
    speech.inspect(settings.get('asrTier') || CONFIG.speech.defaultTier);
  }
  paintTiers();
  paintEngines();
  paintProvider();
  paintExport();
  paintBudget();
  paintChars();
  paintVoiceCard();
}

let libSource = '';
speech.on((msg) => {
  if (msg.type === 'libSource') { libSource = msg.url; paintBuild(); }
});

function paintBuild() {
  $('buildStamp').textContent =
    `Running ${BUILD}${libSource ? ` · runtime from ${new URL(libSource).hostname}` : ''}`;
}

function paintEngines() {
  const wrap = $('enginePicker');
  const pref = settings.get('voiceEngine') || 'device';
  const options = [
    {
      id: 'device',
      name: 'Device dictation',
      size: '0 MB',
      blurb: nativeSpeech.supported
        ? (nativeSpeech.blockedByStandalone
          ? 'Blocked in Home Screen apps — open in a Safari tab to use this.'
          : 'Your phone\u2019s own recognizer. Best accuracy, nothing to download. Audio goes to Apple and needs a connection.')
        : 'Not available in this browser.',
      disabled: !nativeSpeech.supported,
    },
    {
      id: 'whisper',
      name: 'Whisper on device',
      size: 'see below',
      blurb: 'Fully private and works offline, but weaker — especially on Polish.',
      disabled: false,
    },
  ];
  wrap.replaceChildren(...options.map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tier${o.id === pref ? ' is-on' : ''}`;
    b.disabled = o.disabled;
    b.innerHTML = '<span class="tier-name"></span><span class="tier-size"></span><span class="tier-blurb"></span>';
    b.querySelector('.tier-name').textContent = o.name;
    b.querySelector('.tier-size').textContent = o.size;
    b.querySelector('.tier-blurb').textContent = o.blurb;
    b.addEventListener('click', () => {
      settings.set('voiceEngine', o.id);
      paintEngines();
      $('card-asr').hidden = o.id !== 'whisper';
      toast(`Voice input set to ${o.name}`);
    });
    return b;
  }));
  $('card-asr').hidden = pref !== 'whisper';
}

function paintTiers() {
  const wrap = $('tierPicker');
  const current = settings.get('asrTier') || CONFIG.speech.defaultTier;
  wrap.replaceChildren(...Object.entries(CONFIG.speech.tiers).map(([id, t]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tier${id === current ? ' is-on' : ''}`;
    b.innerHTML = '<span class="tier-name"></span><span class="tier-size"></span><span class="tier-blurb"></span>';
    b.querySelector('.tier-name').textContent = t.label.replace('Whisper ', '');
    b.querySelector('.tier-size').textContent = `~${t.mb} MB`;
    b.querySelector('.tier-blurb').textContent = risky
      ? `${t.blurb} Often crashes Safari on iPhone — peak memory is far above the download size.`
      : t.blurb;
    if (state.pendingTier === id) b.querySelector('.tier-name').textContent += ' — tap again';
    const risky = id === 'small' && isIOS();
    if (risky) b.classList.add('is-risky');
    b.addEventListener('click', () => {
      // Whisper small peaks at several times its download size while it is being
      // decompressed and instantiated. iPhones kill the tab rather than swap.
      if (risky && state.pendingTier !== id) {
        state.pendingTier = id;
        paintTiers();
        toast('Small usually crashes Safari on iPhone. Tap again if you want to try it.', true);
        return;
      }
      state.pendingTier = null;
      settings.set('asrTier', id);
      paintTiers();
      refreshModels();
      toast(`Voice model set to ${t.label}`);
    });
    return b;
  }));
}

function paintVoiceCard() {
  if (!voiceCount()) {
    // Do not accuse the device of having no voices before the list has loaded.
    $('ttsTag').textContent = 'Loading';
    $('ttsTag').className = 'tag';
    $('ttsNote').textContent = 'Checking which voices this device has…';
    return;
  }
  const voices = ['en', 'de', 'pl'].filter(hasVoiceFor);
  $('ttsTag').textContent = voices.length ? `${voices.length} of 3` : 'None';
  $('ttsTag').className = `tag${voices.length ? ' is-ready' : ''}`;
  $('ttsNote').textContent = voices.length === 3
    ? 'English, German and Polish voices are all installed.'
    : `Reading aloud uses the voices your device already has. Missing: ${['en', 'de', 'pl'].filter((c) => !voices.includes(c)).map((c) => lang(c).name).join(', ') || 'none'}.`;
}

$('runDiag').addEventListener('click', async () => {
  const out = $('diagOut');
  const lines = [];
  const say = (t) => { lines.push(t); out.textContent = lines.join('\n'); };

  out.hidden = false;
  lines.length = 0;
  say(`${BUILD} · ${new Date().toLocaleTimeString()}`);
  say('');

  // ── Which build is really running ──────────────────────
  say('BUILD');
  try {
    const res = await fetch('./js/config.js', { cache: 'no-store' });
    const text = await res.text();
    const m = text.match(/BUILD = '([^']+)'/);
    say(`  files on server: ${m ? m[1] : 'unknown'}`);
    say(`  code running now: ${BUILD}`);
    if (m && m[1] !== BUILD) {
      say('  MISMATCH — the service worker is serving an old copy.');
      say('  Fix: Settings > Safari > Advanced > Website Data, remove this site.');
    }
  } catch (err) {
    say(`  could not check: ${err && err.message ? err.message : err}`);
  }
  say('');

  // ── Voices ─────────────────────────────────────────────
  say('SPEECH OUTPUT');
  if (!window.speechSynthesis) {
    say('  speechSynthesis missing entirely');
  } else {
    const v = speechSynthesis.getVoices() || [];
    say(`  voices loaded: ${v.length}`);
    if (!v.length) {
      say('  Safari fills this in late — try again in a few seconds.');
    } else {
      const langs = [...new Set(v.map((x) => x.lang))].sort();
      say(`  languages: ${langs.slice(0, 12).join(', ')}${langs.length > 12 ? ` +${langs.length - 12}` : ''}`);
      for (const code of ['en', 'de', 'pl', 'it']) {
        const hit = v.find((x) => x.lang.toLowerCase().replace('_', '-').startsWith(code));
        say(`  ${code}: ${hit ? hit.name : 'none'}`);
      }
    }
  }
  say('');

  // ── Places lookup ──────────────────────────────────────
  say('NEARBY PLACES');
  const here = { lat: 45.8859, lon: 10.8430 };  // Riva del Garda, as a control
  const q = '[out:json][timeout:12];nwr(around:800,45.8859,10.8430)["amenity"="pharmacy"];out center 5;';
  const mirrors = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  for (const m of mirrors) {
    const host = new URL(m).hostname;
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(`${m}?data=${encodeURIComponent(q)}`, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      const text = await res.text();
      const ms = Date.now() - t0;
      if (!res.ok) { say(`  ${host}: HTTP ${res.status} in ${ms}ms`); continue; }
      let n = '?';
      try { n = (JSON.parse(text).elements || []).length; } catch { n = 'bad JSON'; }
      say(`  ${host}: ok, ${n} results in ${ms}ms`);
    } catch (err) {
      const ms = Date.now() - t0;
      const timedOut = err && err.name === 'AbortError';

      // A CORS refusal and a dead host both throw the same opaque error. A
      // no-cors probe still completes if the host is actually reachable, which
      // tells the two apart.
      let reachable = null;
      if (!timedOut) {
        try {
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), 6000);
          await fetch(m, { mode: 'no-cors', signal: c2.signal, cache: 'no-store' });
          clearTimeout(t2);
          reachable = true;
        } catch { reachable = false; }
      }

      const why = timedOut
        ? `no reply in ${Math.round(ms / 1000)}s (server busy or query too slow)`
        : reachable
          ? 'reachable but refuses browser requests (no CORS header)'
          : 'cannot be reached at all';
      say(`  ${host}: ${why}`);
    }
  }
  say('  A slow query and a CORS refusal are different problems:');
  say('  the first is the server being busy, the second is permanent.');
  say('');

  // ── Location ───────────────────────────────────────────
  say('LOCATION');
  say(`  geolocation API: ${navigator.geolocation ? 'present' : 'missing'}`);
  say(`  secure context: ${window.isSecureContext ? 'yes' : 'no'}`);
  say('');

  // ── Camera stack ───────────────────────────────────────
  say('CAMERA TEXT');
  try {
    const mod = await import(CONFIG.tesseractUrl);
    const lib = typeof mod.createWorker === 'function' ? mod : mod.default;
    say(`  createWorker: ${typeof (lib && lib.createWorker)}`);
  } catch (err) {
    say(`  FAILED: ${err && err.message ? err.message : err}`);
  }
  say('');

  // ── Dictation ──────────────────────────────────────────
  say('DICTATION');
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  say(`  API: ${Rec ? 'present' : 'missing'}`);
  const standalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  say(`  installed as app: ${standalone ? 'yes — iOS blocks dictation here' : 'no'}`);
  say('');

  say('done — long-press to copy');
});

$('ocrPrefetch').addEventListener('click', async () => {
  const tag = $('ocrTag');
  tag.textContent = 'Getting';
  tag.className = 'tag is-busy';
  try {
    await ensureWorker(['en', 'de', 'pl']);
    tag.textContent = 'Downloaded';
    tag.className = 'tag is-ready';
    toast('Camera languages ready');
  } catch (err) {
    tag.textContent = 'Failed';
    tag.className = 'tag';
    const note = document.querySelector('#card-ocr .card-note');
    if (note) note.textContent = err && err.message ? err.message : String(err);
    toast('Camera languages failed — see the card for why', true);
  }
});

/* ── Settings toggles ──────────────────────────────────── */

ui.autoSpeak.checked = settings.get('autoSpeak');
ui.autoSpeak.addEventListener('change', () => settings.set('autoSpeak', ui.autoSpeak.checked));

ui.lowDataToggle = $('lowDataToggle');
ui.lowDataToggle.checked = !!settings.get('lowData');
ui.lowDataToggle.addEventListener('change', () => {
  settings.set('lowData', ui.lowDataToggle.checked);
  refreshModels();
  toast(ui.lowDataToggle.checked ? 'Low data mode on' : 'Low data mode off');
});

/* ── Boot ──────────────────────────────────────────────── */

function paintNet() {
  ui.net.dataset.state = navigator.onLine ? 'online' : 'offline';
  ui.netLabel.textContent = navigator.onLine ? 'Online' : 'Offline';
}
window.addEventListener('online', paintNet);
window.addEventListener('offline', paintNet);

paintPair();
paintNet();
syncCounter();
paintLists();
paintVoiceCard();
onVoicesReady(() => { paintVoiceCard(); paintEngines(); });
paintEngines();
paintProvider();
paintExport();
paintBuild();

// The Pages dashboard upload does not compile Functions, so a Worker backend
// cannot be deployed from a phone at all. Put anyone who tried it back on
// MyMemory rather than leaving them with a dead endpoint.
if (settings.get('provider') === 'worker' && !settings.get('workerVerified')) {
  settings.set('provider', 'mymemory');
}

const crashed = takeCrashReport();
if (crashed) {
  const label = (CONFIG.speech.tiers[crashed.tier] || {}).label || crashed.tier;
  const smaller = crashed.tier === 'small' ? 'base' : crashed.tier === 'base' ? 'tiny' : null;
  const note = $('asrNote');
  if (note) {
    note.textContent = `${label} took the page down last time. ` +
      'If it got to the end of the download first, it died while starting the model, not while fetching it — ' +
      'that step needs several times the download size in memory, and iOS kills the tab rather than swap. ' +
      'No error can be reported because the whole page is gone. ' +
      (smaller ? `Switched to ${(CONFIG.speech.tiers[smaller] || {}).label || smaller}. Device dictation downloads nothing at all.`
               : 'Device dictation downloads nothing at all.');
  }
  if (smaller) settings.set('asrTier', smaller);
  // The weights are cached and useless. Offer the storage back.
  const card = $('card-asr');
  if (card) {
    const foot = card.querySelector('.card-foot');
    if (foot) {
      const free = document.createElement('button');
      free.className = 'ghost';
      free.textContent = `Free up the ${label} download`;
      free.addEventListener('click', () => {
        speech.clear(crashed.tier);
        free.remove();
        toast('Removing those weights');
      });
      foot.append(free);
    }
  }
  toast(`${label} crashed the page last time — switched to something smaller`, true);
}
paintBudget();
paintChars();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
