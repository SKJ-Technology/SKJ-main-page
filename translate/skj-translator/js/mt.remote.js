// Translation over the wire.
//
// Two providers. MyMemory needs no setup at all and is the default; the
// Cloudflare Worker is there if you ever want no character cap and real
// batching. Everything else in the app runs on the device.

import { CONFIG } from './config.js';
import { lang } from './langs.js';
import { budget, BudgetError, REQUEST_OVERHEAD, formatBytes } from './budget.js';
import { settings } from './store.js';

// Settings win over config.js so the backend can be switched on the device
// instead of by editing source.
const provider = () => settings.get('provider') || CONFIG.remote.provider;
const workerUrl = () => settings.get('workerUrl') || CONFIG.remote.workerUrl;

const enc = new TextEncoder();
const byteLen = (s) => enc.encode(s).length;

const listeners = new Set();
const emit = (msg) => { for (const fn of listeners) fn(msg); };

let seq = 0;
const cancelled = new Set();

/* ── MyMemory's daily character allowance ─────────────── */

const CHAR_KEY = 'skj-translator:chars';
const today = () => new Date().toISOString().slice(0, 10);

let chars = { day: today(), used: 0, email: '' };
try {
  const raw = localStorage.getItem(CHAR_KEY);
  if (raw) {
    const s = JSON.parse(raw);
    chars.email = s.email || '';
    if (s.day === today()) chars.used = s.used || 0;
  }
} catch { /* private mode */ }

const saveChars = () => {
  try { localStorage.setItem(CHAR_KEY, JSON.stringify(chars)); } catch { /* ignore */ }
};

export const charBudget = {
  get used() { if (chars.day !== today()) { chars.day = today(); chars.used = 0; saveChars(); } return chars.used; },
  get limit() { return chars.email ? CONFIG.remote.emailCharCap : CONFIG.remote.anonCharCap; },
  get email() { return chars.email; },
  set email(v) { chars.email = (v || '').trim(); saveChars(); },
  remaining() { return Math.max(0, this.limit - this.used); },
  spend(n) { chars.used = this.used + n; saveChars(); },
};

export class CharCapError extends Error {
  constructor(need) {
    super(
      `That needs ${need} characters and only ${charBudget.remaining()} of today's ` +
      `${charBudget.limit} are left. Resets at midnight, or add an email in Data for ten times more.`
    );
    this.isCharCap = true;
  }
}

/* ── Chunking ─────────────────────────────────────────── */

// MyMemory rejects anything over 500 bytes in one query.
function chunk(text, max) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (byteLen(t) <= max) return [t];

  const parts = t.match(/[^.!?…]+[.!?…]+["'»)\]]*\s*|[^.!?…]+$/g) || [t];
  const out = [];
  for (let piece of parts) {
    let s = piece.trim();
    if (!s) continue;
    while (byteLen(s) > max) {
      // Walk back from a character estimate until the byte length fits.
      let cut = Math.min(s.length, max);
      while (cut > 20 && byteLen(s.slice(0, cut)) > max) cut -= 8;
      const space = s.lastIndexOf(' ', cut);
      if (space > 20) cut = space;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (!s) continue;
    const last = out[out.length - 1];
    if (last && byteLen(`${last} ${s}`) <= max) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out;
}

/* ── Choosing among MyMemory's candidates ─────────────── */

// The default `translatedText` is whatever scored highest in the translation
// memory, which for an unusual sentence can be a loose match from a completely
// different context. The matches array exposes the scores, so weigh them and
// fall back to the machine translation when no memory hit is convincing.
function pickBest(data, source) {
  const fallback = (data && data.responseData && data.responseData.translatedText) || '';
  const matches = Array.isArray(data && data.matches) ? data.matches : [];
  if (!matches.length) return fallback;

  const scored = matches
    .map((m) => {
      const text = String(m.translation || '').trim();
      if (!text) return null;
      // A "translation" identical to the input is memory noise.
      if (text.toLowerCase() === source.toLowerCase()) return null;
      if (/MYMEMORY WARNING|LIMIT EXCEEDED/i.test(text)) return null;

      const match = Number(m.match) || 0;                 // 0..1 similarity
      const quality = Number(String(m.quality).replace('%', '')) || 0; // 0..100
      const isMT = String(m['created-by'] || '').toUpperCase().includes('MT') || m.id === 0 || m.id === '0';

      // A near-exact human memory hit beats MT. A loose one does not.
      let score = match * (quality / 100);
      // With "prefer machine translation" on, MT wins unless a memory hit is
      // near-exact; with it off, a decent memory hit is preferred.
      if (isMT) score = Math.max(score, settings.get('preferMT') ? 0.95 : 0.72);
      return { text, score, isMT };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0].text : fallback;
}

/* ── Providers ────────────────────────────────────────── */

async function viaMyMemory(items, src, tgt, onProgress) {
  const results = [];

  for (let i = 0; i < items.length; i++) {
    const pieces = chunk(items[i], CONFIG.remote.myMemoryMaxBytes);
    const done = [];

    for (const piece of pieces) {
      if (charBudget.remaining() < piece.length) throw new CharCapError(piece.length);

      const url = `${CONFIG.remote.myMemoryUrl}?q=${encodeURIComponent(piece)}` +
        `&langpair=${src}|${tgt}` +
        `&mt=1` +   // allow machine translation, not just memory hits
        (chars.email ? `&de=${encodeURIComponent(chars.email)}` : '');

      const sent = byteLen(url) + REQUEST_OVERHEAD;
      const projected = sent + 2600; // MyMemory returns match lists, not just the string
      if (!budget.canSpend(projected)) throw new BudgetError(projected);

      emit({ type: 'request', items: 1, bytes: sent });

      let res;
      try {
        res = await fetch(url, { cache: 'no-store' });
      } catch (err) {
        budget.record(REQUEST_OVERHEAD, 'translation');
        emit({ type: 'done' });
        throw err;
      }

      const text = await res.text();
      budget.record(sent + byteLen(text), 'translation');
      emit({ type: 'done', sent, received: byteLen(text), total: sent + byteLen(text) });

      if (!res.ok) throw new Error(`MyMemory returned ${res.status}`);

      let data;
      try { data = JSON.parse(text); } catch { throw new Error('MyMemory did not return JSON.'); }

      const out = pickBest(data, piece);
      if (!out) throw new Error('MyMemory returned no translation.');
      // Quota and length complaints arrive inside the translated string.
      if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|LIMIT EXCEEDED|INVALID LANGUAGE/i.test(out)) {
        throw new Error(out.slice(0, 170));
      }

      charBudget.spend(piece.length);
      done.push(out);
    }

    results.push(done.join(' '));
    if (onProgress) onProgress(i + 1, items.length);
  }

  return results;
}

async function viaWorker(items, src, tgt) {
  if (!workerUrl()) {
    throw new Error('No Worker URL set. Add it in Data, or switch back to MyMemory.');
  }
  const body = JSON.stringify({ items, source_lang: lang(src).whisper, target_lang: lang(tgt).whisper });
  const sent = byteLen(body) + REQUEST_OVERHEAD;
  const projected = sent + Math.round(byteLen(body) * 1.3);
  if (!budget.canSpend(projected)) throw new BudgetError(projected);

  emit({ type: 'request', items: items.length, bytes: sent });

  let res;
  try {
    res = await fetch(workerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    });
  } catch (err) {
    budget.record(REQUEST_OVERHEAD, 'translation');
    emit({ type: 'done' });
    throw err;
  }

  const text = await res.text();
  budget.record(sent + byteLen(text), 'translation');
  emit({ type: 'done', sent, received: byteLen(text), total: sent + byteLen(text) });

  if (!res.ok) throw new Error(`Worker returned ${res.status}. ${text.slice(0, 140)}`);
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.translations)) throw new Error('Unexpected response from the Worker.');
  return data.translations.map((t) => String(t == null ? '' : t).trim());
}

async function dispatch(items, src, tgt, onProgress) {
  if (provider() !== 'worker') return viaMyMemory(items, src, tgt, onProgress);
  try {
    return await viaWorker(items, src, tgt);
  } catch (err) {
    // A translator that stops working is worse than a slightly worse one.
    settings.set('provider', 'mymemory');
    emit({ type: 'fellBack', reason: err && err.message ? err.message : String(err) });
    return viaMyMemory(items, src, tgt, onProgress);
  }
}

/* ── Public interface ─────────────────────────────────── */

// Serialised so two taps cannot race the meter.
let chain = Promise.resolve();
const enqueue = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

export const translator = {
  formatBytes,
  get provider() { return provider(); },
  charBudget,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  translate(text, src, tgt) {
    const id = ++seq;
    const promise = enqueue(async () => {
      if (cancelled.has(id)) { cancelled.delete(id); return ''; }
      const out = await dispatch([text], src, tgt);
      return out[0] || '';
    });
    return { id, promise };
  },

  translateBatch(items, src, tgt, onProgress) {
    const id = ++seq;
    const promise = enqueue(async () => {
      if (cancelled.has(id)) { cancelled.delete(id); return items.map(() => ''); }
      if (!items.length) return [];
      const capped = items.slice(0, CONFIG.remote.maxItemsPerRequest);
      const out = await dispatch(capped, src, tgt, onProgress);
      while (out.length < items.length) out.push('');
      return out;
    });
    return { id, promise };
  },

  cancel(id) { cancelled.add(id); },
  budget,
};
