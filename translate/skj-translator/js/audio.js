// Microphone capture for voice mode. Records on demand, stops on silence, and
// hands Whisper a mono 16 kHz Float32Array.

import { CONFIG } from './config.js';

export class Recorder {
  constructor({ onLevel, onAutoStop } = {}) {
    this.onLevel = onLevel;
    this.onAutoStop = onAutoStop;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.ctx = null;
    this.raf = 0;
    this.startedAt = 0;
    this.quietSince = 0;
  }

  get active() { return !!this.recorder && this.recorder.state === 'recording'; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: CONFIG.audio.echoCancellation,
        noiseSuppression: CONFIG.audio.noiseSuppression,
        autoGainControl: CONFIG.audio.autoGainControl,
      },
    });

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.start();
    this.startedAt = performance.now();
    this.quietSince = 0;
    this.watchLevel();
  }

  watchLevel() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const source = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (!this.active) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (this.onLevel) this.onLevel(Math.min(1, rms * 8));

      const elapsed = performance.now() - this.startedAt;
      if (rms < 0.012) {
        if (!this.quietSince) this.quietSince = performance.now();
        const quietFor = performance.now() - this.quietSince;
        if (elapsed > 1200 && quietFor > CONFIG.audio.silenceMs && this.onAutoStop) this.onAutoStop();
      } else {
        this.quietSince = 0;
      }
      if (elapsed > CONFIG.audio.maxSeconds * 1000 && this.onAutoStop) this.onAutoStop();

      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Stop recording and return mono 16 kHz samples, or null if the clip was too short. */
  async stop() {
    if (!this.recorder) return null;
    const done = new Promise((resolve) => { this.recorder.onstop = resolve; });
    if (this.recorder.state === 'recording') this.recorder.stop();
    await done;

    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) { try { await this.ctx.close(); } catch { /* ignore */ } this.ctx = null; }

    const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' });
    this.recorder = null;
    this.stream = null;
    if (blob.size < 800) return null;

    return decodeTo16k(blob);
  }

  async abort() {
    try {
      cancelAnimationFrame(this.raf);
      if (this.recorder && this.recorder.state === 'recording') this.recorder.stop();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) await this.ctx.close();
    } catch { /* ignore */ }
    this.recorder = null;
    this.stream = null;
  }
}

async function decodeTo16k(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();

  if (decoded.duration < CONFIG.audio.minSeconds) return null;

  const target = 16000;
  const frames = Math.ceil(decoded.duration * target);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, frames, target);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}
