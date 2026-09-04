// Reading translations aloud. Uses the voices already installed on the device,
// so this part works offline on its own.

import { lang } from './langs.js';

let voices = [];
const watchers = new Set();

function refresh() {
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  if (voices.length) for (const fn of watchers) fn(voices.length);
}

refresh();

if (window.speechSynthesis) {
  speechSynthesis.addEventListener('voiceschanged', refresh);
  // Safari does not always fire voiceschanged, and the list is empty on the
  // first synchronous call regardless. Poll briefly rather than trust either.
  let tries = 0;
  const poll = setInterval(() => {
    refresh();
    if (voices.length || ++tries > 20) clearInterval(poll);
  }, 250);
}

/** Called once voices actually appear, so the UI can stop claiming there are none. */
export function onVoicesReady(fn) {
  watchers.add(fn);
  if (voices.length) fn(voices.length);
  return () => watchers.delete(fn);
}

export function voiceCount() { return voices.length; }

export function hasVoiceFor(code) {
  if (!voices.length) refresh();
  const tag = lang(code).tts.toLowerCase();
  const base = tag.split('-')[0];
  return voices.some((v) => v.lang.toLowerCase().startsWith(base));
}

function pickVoice(code) {
  if (!voices.length) refresh();
  const tag = lang(code).tts.toLowerCase();
  const base = tag.split('-')[0];
  return (
    voices.find((v) => v.lang.toLowerCase().replace('_', '-') === tag) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  );
}

export function speak(text, code, { rate = 1 } = {}) {
  if (!window.speechSynthesis || !text) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(code);
  if (v) u.voice = v;
  u.lang = v ? v.lang : lang(code).tts;
  u.rate = rate;
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() {
  if (window.speechSynthesis) speechSynthesis.cancel();
}
