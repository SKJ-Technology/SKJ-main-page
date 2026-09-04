// The network meter.
//
// Counts actual bytes over the wire against a rolling hourly ceiling, broken
// down by what spent them. Nothing here is an estimate of what the app "should"
// use — every entry is recorded at the point bytes are really moved.

const KEY = 'skj-translator:budget';

const DEFAULTS = { limitMB: 100, windowMinutes: 60 };

// Rough per-request overhead: TLS records, headers both ways, TCP setup. Not
// exact, but leaving it out would understate small requests badly.
export const REQUEST_OVERHEAD = 700;

let cfg = { ...DEFAULTS };
let entries = []; // { t: timestamp, b: bytes, k: kind }

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const s = JSON.parse(raw);
    if (Number.isFinite(s.limitMB)) cfg.limitMB = s.limitMB;
    if (Number.isFinite(s.windowMinutes)) cfg.windowMinutes = s.windowMinutes;
    if (Array.isArray(s.entries)) entries = s.entries;
  }
} catch { /* private mode */ }

function flush() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...cfg, entries: entries.slice(-400) }));
  } catch { /* ignore */ }
}

function prune() {
  const cutoff = Date.now() - cfg.windowMinutes * 60000;
  const before = entries.length;
  entries = entries.filter((e) => e.t > cutoff);
  if (entries.length !== before) flush();
}

const KINDS = ['translation', 'model', 'map', 'app'];

export const budget = {
  get limitMB() { return cfg.limitMB; },
  get limitBytes() { return cfg.limitMB * 1048576; },
  get windowMinutes() { return cfg.windowMinutes; },

  spentBytes() { prune(); return entries.reduce((n, e) => n + e.b, 0); },
  remainingBytes() { return Math.max(0, this.limitBytes - this.spentBytes()); },
  requests() { prune(); return entries.filter((e) => e.k === 'translation').length; },

  /** Bytes spent per category inside the window. */
  breakdown() {
    prune();
    const out = {};
    for (const k of KINDS) out[k] = 0;
    for (const e of entries) out[e.k] = (out[e.k] || 0) + e.b;
    return out;
  },

  canSpend(bytes) { return this.remainingBytes() >= bytes; },

  /** Record bytes that actually crossed the network. */
  record(bytes, kind = 'translation') {
    entries.push({ t: Date.now(), b: Math.max(0, Math.round(bytes)), k: kind });
    flush();
  },

  /** Minutes until the oldest entry ages out of the window. */
  renewsIn() {
    prune();
    if (!entries.length) return 0;
    const oldest = Math.min(...entries.map((e) => e.t));
    return Math.max(1, Math.ceil((oldest + cfg.windowMinutes * 60000 - Date.now()) / 60000));
  },

  configure({ limitMB, windowMinutes }) {
    if (Number.isFinite(limitMB)) cfg.limitMB = Math.max(1, Math.min(10000, limitMB));
    if (Number.isFinite(windowMinutes)) cfg.windowMinutes = Math.max(1, windowMinutes);
    flush();
  },

  reset() { entries = []; flush(); },
};

export function formatBytes(n) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}

export class BudgetError extends Error {
  constructor(needBytes) {
    super(
      `That would need ${formatBytes(needBytes)} and only ` +
      `${formatBytes(budget.remainingBytes())} is left of your ${budget.limitMB} MB. ` +
      `Frees up in about ${budget.renewsIn()} min, or raise the ceiling in Data.`
    );
    this.name = 'BudgetError';
    this.isBudget = true;
  }
}
