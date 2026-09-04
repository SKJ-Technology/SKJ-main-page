// The device's own recognizer — the engine behind iOS dictation, reached through
// webkitSpeechRecognition. Better than any model small enough to download, and
// it costs no storage at all.
//
// Three things to know about it on iOS:
//  - `continuous` is broken there, so this is strictly single-utterance.
//  - It usually recognises in the cloud, so audio leaves the device and it
//    needs a connection. Whisper remains the private, offline option.
//  - It is blocked when the site runs as an installed PWA (Home Screen icon).
//    Use a normal Safari tab.

import { lang } from './langs.js';

const Impl = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export const nativeSpeech = {
  get supported() { return !!Impl; },

  /** True when running as an installed PWA, where iOS blocks recognition. */
  get blockedByStandalone() {
    const standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return standalone && /iPhone|iPad|iPod/.test(navigator.userAgent);
  },

  /**
   * Listen for one utterance.
   * @param {object} opts
   * @param {string} opts.code       app language code, or 'auto'
   * @param {(text:string)=>void} [opts.onPartial]  live text as it is heard
   * @returns {{ promise: Promise<string>, stop: ()=>void, abort: ()=>void }}
   */
  listen({ code, onPartial } = {}) {
    if (!Impl) throw new Error('This browser has no speech recognition.');

    const rec = new Impl();
    rec.continuous = false;          // broken on iOS when true
    rec.interimResults = true;       // gives live text while speaking
    rec.maxAlternatives = 1;
    if (code && code !== 'auto') rec.lang = lang(code).tts;

    // Read this now: inside rec.onerror, `this` is the recognition object, so
    // touching this.blockedByStandalone there throws and the real error is lost.
    const standaloneBlocked = this.blockedByStandalone;

    let settled = false;
    let best = '';
    let lastInterim = '';
    let started = false;

    const finish = (resolve) => {
      if (settled) return;
      settled = true;
      // Prefer confirmed text, but never throw away a good interim result —
      // on iOS a manual stop often arrives before anything is marked final.
      resolve((best || lastInterim).trim());
    };

    const promise = new Promise((resolve, reject) => {
      rec.onresult = (event) => {
        let finalText = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (finalText) best = (best ? `${best} ` : '') + finalText.trim();
        if (interim) lastInterim = (best ? `${best} ` : '') + interim;
        if (onPartial) onPartial(((best ? `${best} ` : '') + interim).trim());
      };

      rec.onerror = (event) => {
        if (settled) return;

        // "aborted" is what Safari reports when recognition is stopped on
        // purpose — including by our own stop button. It is not a failure.
        if (event.error === 'aborted') { finish(resolve); return; }

        // Likewise, silence is only a problem if nothing was heard at all.
        if (event.error === 'no-speech' && (best || lastInterim)) { finish(resolve); return; }

        settled = true;
        const map = {
          'not-allowed': 'Microphone permission denied — allow it in site settings.',
          'service-not-allowed': standaloneBlocked
            ? 'iOS blocks dictation in installed web apps. Open the site in a normal Safari tab.'
            : 'The system refused speech recognition.',
          'no-speech': 'Nothing was heard.',
          network: 'Dictation needs a connection — it recognises on Apple servers.',
          'language-not-supported': 'This device has no dictation for that language.',
          'audio-capture': 'No microphone available.',
        };
        reject(new Error(map[event.error] || `Speech recognition failed (${event.error}).`));
      };

      rec.onstart = () => { started = true; };
      rec.onaudiostart = () => { started = true; };
      rec.onend = () => finish(resolve);

      // If nothing at all happens, say so rather than sitting on "Listening…".
      // iOS can silently drop the session when permission is refused at the
      // system level or the recogniser fails to engage.
      setTimeout(() => {
        if (settled || started) return;
        settled = true;
        try { rec.abort(); } catch { /* ignore */ }
        reject(new Error(
          'Dictation never started. Check Settings > Safari > Microphone, and Settings > General > Keyboard > Enable Dictation.'
        ));
      }, 6000);
    });

    try {
      rec.start();
    } catch (err) {
      return { promise: Promise.reject(err), stop() {}, abort() {} };
    }

    return {
      promise,
      /** Finish normally and keep whatever was heard. */
      stop() { try { rec.stop(); } catch { /* ignore */ } },
      /** Throw the utterance away — used when navigating off the tab. */
      abort() { settled = true; try { rec.abort(); } catch { /* ignore */ } },
    };
  },
};
