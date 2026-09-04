// Speech-to-text worker running Whisper base through transformers.js.

import { CONFIG } from './config.js';

// Imported lazily rather than at the top level: a top-level await that throws
// kills the worker before it can tell anyone why.
let lib = null;

async function getLib() {
  if (lib) return lib;

  const tried = [];
  for (const url of CONFIG.transformersUrls) {
    try {
      const mod = await import(url);
      if (!mod || typeof mod.pipeline !== 'function') {
        tried.push(`${short(url)}: loaded but no pipeline()`);
        continue;
      }
      mod.env.useWasmCache = true;
      mod.env.allowLocalModels = false;
      lib = mod;
      post({ type: 'libSource', url });
      return lib;
    } catch (err) {
      tried.push(`${short(url)}: ${err && err.message ? err.message : err}`);
    }
  }
  throw new Error(`No Transformers.js build loaded. ${tried.join(' | ')}`);
}

function short(url) {
  try { return new URL(url).hostname.replace('cdn.', ''); } catch { return url; }
}

const M = CONFIG.speech;

const tierOf = (tier) => M.tiers[tier] || M.tiers[M.defaultTier];
const listFor = (tier) => tierOf(tier).candidates;

// Remember the combination that built a session, so later loads go straight to it.
const PICK_KEY = 'skj-translator:asr-pick';
function remembered() {
  try { return JSON.parse(self.localStorage ? self.localStorage.getItem(PICK_KEY) : null); } catch { return null; }
}
function remember(c) {
  try { if (self.localStorage) self.localStorage.setItem(PICK_KEY, JSON.stringify(c)); } catch { /* workers may lack it */ }
}

let pipe = null;
let pipeKey = null;
let loadingPromise = null;
let activeChoice = null;
let queue = Promise.resolve();
const files = new Map();

const post = (msg) => self.postMessage(msg);

function getPipe(tier) {
  const key = tier || M.defaultTier;
  if (pipe && pipeKey === key) return Promise.resolve(pipe);
  if (loadingPromise && pipeKey === key) return loadingPromise;
  pipeKey = key;

  loadingPromise = (async () => {
    const { pipeline } = await getLib();

    // Put a previously working combination first.
    let list = listFor(key).slice();
    const prev = remembered();
    if (prev) {
      const i = list.findIndex((c) => c.model === prev.model && JSON.stringify(c.dtype) === JSON.stringify(prev.dtype));
      if (i > 0) list.unshift(list.splice(i, 1)[0]);
    }

    const failures = [];
    for (const c of list) {
      files.clear();
      post({ type: 'loadStage', stage: `trying ${c.label} (~${c.mb} MB)` });
      try {
        const p = await pipeline(M.task, c.model, {
          device: 'wasm',
          dtype: c.dtype,
          progress_callback: (e) => {
            if (e.status === 'progress' && e.file) {
              files.set(e.file, { loaded: e.loaded || 0, total: e.total || 0 });
              let loaded = 0; let total = 0;
              for (const f of files.values()) { loaded += f.loaded; total += f.total; }
              post({ type: 'loadProgress', pct: total ? (loaded / total) * 100 : 0, loaded, total });
            } else if (e.status === 'initiate' && e.file) {
              post({ type: 'loadStage', stage: `${c.label} · fetching ${e.file}` });
            }
          },
        });
        pipe = p;
        activeChoice = c;
        remember(c);
        post({ type: 'ready', choice: c.label });
        return p;
      } catch (err) {
        const message = String(err && err.message ? err.message : err);
        failures.push(`${c.label}: ${message.slice(0, 120)}`);
        post({ type: 'loadStage', stage: `${c.label} refused, trying next` });
      }
    }

    throw new Error(`No Whisper build would start on this device. ${failures.join(' | ')}`);
  })()
    .catch((err) => {
      loadingPromise = null;
      post({ type: 'loadError', message: String(err && err.message ? err.message : err) });
      throw err;
    });

  return loadingPromise;
}

async function transcribe({ id, audio, language, tier }) {
  const p = await getPipe(tier);
  const res = await p(audio, {
    language,
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    condition_on_previous_text: false,
    no_repeat_ngram_size: 4,
    temperature: 0,
  });
  const text = (Array.isArray(res) ? res[0] : res).text || '';
  post({ type: 'transcript', id, text: text.trim() });
}

async function inspect(tier) {
  const prev = remembered();
  const first = listFor(tier)[0];
  const c = activeChoice || prev || first;
  const id = c.model;
  try {
    const { ModelRegistry } = await getLib();
    const OPTS = { device: 'wasm', dtype: c.dtype };
    const cached = await ModelRegistry.is_pipeline_cached(M.task, id, OPTS);
    let bytes = null;
    try {
      const files = await ModelRegistry.get_pipeline_files(M.task, id, OPTS);
      const meta = await Promise.all(files.map((f) => ModelRegistry.get_file_metadata(id, f)));
      bytes = meta.reduce((sum, m) => sum + (m && m.size ? m.size : 0), 0);
    } catch { /* offline */ }
    post({ type: 'info', cached, bytes: bytes || c.mb * 1048576, loaded: !!pipe, label: c.label });
  } catch (err) {
    post({ type: 'loadError', message: String(err && err.message ? err.message : err) });
  }
}

async function clearCache(tier) {
  const { ModelRegistry } = await getLib();
  try { if (pipe && pipe.dispose) await pipe.dispose(); } catch { /* ignore */ }
  pipe = null;
  pipeKey = null;
  loadingPromise = null;
  activeChoice = null;
  try { if (self.localStorage) self.localStorage.removeItem(PICK_KEY); } catch { /* ignore */ }
  for (const c of listFor(tier)) {
    try { await ModelRegistry.clear_pipeline_cache(M.task, c.model, { device: 'wasm', dtype: c.dtype }); } catch { /* ignore */ }
  }
  post({ type: 'cleared' });
}

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'load':
      queue = queue.then(() => getPipe(msg.tier).catch(() => {}));
      break;
    case 'transcribe':
      queue = queue.then(() =>
        transcribe(msg).catch((err) =>
          post({ type: 'error', id: msg.id, message: String(err && err.message ? err.message : err) })
        )
      );
      break;
    case 'inspect':
      queue = queue.then(() => inspect(msg.tier));
      break;
    case 'clear':
      queue = queue.then(() => clearCache(msg.tier).catch((err) => post({ type: 'error', message: String(err) })));
      break;
    default:
      break;
  }
};
