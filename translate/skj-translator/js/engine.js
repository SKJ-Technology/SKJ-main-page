// Promise-shaped wrapper around the model workers.
//
// Translation no longer runs here — it goes to mt.remote.js, which talks to the
// Cloudflare Worker under a strict request budget. Speech recognition stays
// local, because sending audio anywhere is exactly what we are avoiding.

export { translator } from './mt.remote.js';

function makeWorker(url) {
  return new Worker(new URL(url, import.meta.url), { type: 'module' });
}

class WorkerBridge {
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  boot() {
    if (this.worker) return this.worker;
    this.worker = makeWorker(this.url);
    this.worker.onmessage = (e) => this.route(e.data);
    this.worker.onerror = (e) => {
      const where = e.filename ? ` (${e.filename}:${e.lineno})` : '';
      const message = (e.message || 'Worker failed to start') + where;
      for (const [, p] of this.pending) p.reject(new Error(message));
      this.pending.clear();
      this.emit({ type: 'loadError', message });
    };
    return this.worker;
  }

  emit(msg) { for (const fn of this.listeners) fn(msg); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  send(msg) { this.boot().postMessage(msg); }

  route(msg) {
    const p = msg.id != null ? this.pending.get(msg.id) : null;
    if (p) {
      if (msg.type === 'result' || msg.type === 'transcript') {
        this.pending.delete(msg.id);
        p.resolve(msg.text);
      } else if (msg.type === 'error') {
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
      }
    }
    this.emit(msg);
  }

  request(payload) {
    const id = ++this.seq;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send({ ...payload, id });
    return { id, promise };
  }
}

const asr = new WorkerBridge('./asr.worker.js');

export const speech = {
  on: (fn) => asr.on(fn),
  preload: (tier) => asr.send({ type: 'load', tier }),
  inspect: (tier) => asr.send({ type: 'inspect', tier }),
  clear: (tier) => asr.send({ type: 'clear', tier }),
  transcribe: (audio, language, tier) =>
    asr.request({ type: 'transcribe', audio, language, tier }),
};
