// Settings, history and saved phrases. Plain localStorage — small, synchronous,
// and available before the first paint.

const KEY = 'skj-translator:v1';

const DEFAULTS = {
  source: 'auto',
  target: 'pl',
  lastSource: 'en',
  lowData: false,
  asrTier: 'base',
  voiceEngine: 'device',
  provider: '',        // '' = whatever config.js says
  workerUrl: '',
  workerVerified: false,
  preferMT: false,     // MyMemory: favour machine translation over memory hits
  autoSpeak: false,
  history: [],   // { src, tgt, in, out, at }
  saved: [],     // same shape, kept until removed
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function flush() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export const settings = {
  get: (k) => state[k],
  set(k, v) { state[k] = v; flush(); },
};

export const history = {
  all: () => state.history,
  add(entry) {
    const key = (e) => `${e.src}>${e.tgt}:${e.in}`;
    state.history = [entry, ...state.history.filter((e) => key(e) !== key(entry))].slice(0, 80);
    flush();
  },
  clear() { state.history = []; flush(); },
};

export const saved = {
  all: () => state.saved,
  has(entry) { return state.saved.some((e) => e.in === entry.in && e.tgt === entry.tgt); },
  toggle(entry) {
    if (this.has(entry)) {
      state.saved = state.saved.filter((e) => !(e.in === entry.in && e.tgt === entry.tgt));
    } else {
      state.saved = [entry, ...state.saved].slice(0, 300);
    }
    flush();
    return this.has(entry);
  },
};
