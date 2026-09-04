# SKJ Translator

Translator with camera and voice. Reading pictures, hearing speech and speaking
answers all happen on the device. Only the translated text goes over the network,
to a Cloudflare Worker on your own account, under a hard request cap.

English ⇄ German ⇄ Polish in every direction, plus twelve more languages already
wired up. Built as a static site, so Cloudflare Pages serves it as-is.

---

## What runs where

| Part | Engine | Where | Cost |
|---|---|---|---|
| Text translation | MyMemory (no setup) or your own Worker | over the network | ~1–3 KB per request |
| Camera text | Tesseract 7 | on device | ~4 MB per language, once |
| Voice input | Whisper base (tiny in low data mode) | on device | ~80 MB / ~40 MB, once |
| Voice output | The device's own speech voices | on device | 0 |

The app shell itself is cached by a service worker, so it opens with the network
off even before you download a model.

---

## Deploying to Cloudflare Pages

No build step. Push the folder and point Pages at it.

```
Build command:        (leave empty)
Build output dir:     /
```

Or drag the folder into the Pages dashboard. `_headers` is picked up
automatically and sets the camera and microphone permissions policy.

Two rules that are not optional:

- **HTTPS is required.** Camera, microphone and service workers are all blocked
  on plain HTTP. `localhost` is exempt, so local testing works.
- **Serve it, don't open it.** `file://` breaks module workers. For local testing:
  `python3 -m http.server 8000` then open `http://localhost:8000`.

---

## Setup

Nothing to deploy. Translation goes to MyMemory, which needs no key, no signup
and no account. Host the folder and it works.

### Cloudflare Pages, drag and drop

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets**.
2. Drag the `skj-translator` **folder** in (not the zip).
3. Name it, deploy. You get a `*.pages.dev` URL.

That's it. No build command, no output directory, no Git.

### Or connect a repo

Push the folder to GitHub, then Pages → **Connect to Git** → pick the repo →
leave the build command empty and set the output directory to `/`. After that
every push redeploys.

### Then, on the phone

Open the URL in Safari and add it to the Home Screen from the Share sheet.
Text translation works immediately. Open **Data** and tap
**Get English, German, Polish** to cache the camera reading data (~12 MB, once).
Leave the voice model until you have real Wi-Fi.

### Better translation, without a computer

MyMemory is the default because it needs nothing. Its quality is the weakest
part of the app, and the fix does not actually require a PC.

`functions/api/translate.js` is a **Cloudflare Pages Function**. Deploy to Pages
by dragging the folder in — the same way you deploy the site — and Cloudflare
turns that file into `POST /api/translate` on its own. No wrangler, no pasting
into the dashboard code editor.

One step remains, and it is taps rather than typing:

> Pages project → **Settings** → **Functions** → **Bindings** → **Add** →
> **Workers AI**, with the variable name `AI`. Then redeploy.

Then in the app: **Data** → Translation backend → **Your Cloudflare Worker** →
**Test the endpoint**. A GET reports whether the binding is connected and costs
nothing. The URL defaults to `/api/translate` on the same origin, so there is
nothing to paste and no CORS to configure.

That gets you m2m100 instead of a crowdsourced translation memory, no daily
character cap, and real batching — one request per camera scan instead of one
per paragraph.

**This only works on Cloudflare Pages.** On Netlify the folder deploys fine but
the function is ignored, and the app stays on MyMemory.

### The daily character allowance

MyMemory gives 5,000 characters a day per IP, or 50,000 if you put an email in
the **Data** tab. No signup or verification — it just raises the limit. The app
tracks what you have used and refuses to overrun it.

If you ever outgrow that, `worker/index.js` is still in the folder: deploy it,
set `provider: 'worker'` and `workerUrl` in `js/config.js`, and the cap and the
third party both disappear.

---

## The network meter

The app counts **actual bytes over the wire** against a rolling ceiling —
100 MB per 60 minutes by default, both editable in the **Data** tab. Nothing is
estimated: every entry is written at the moment bytes really move, and the tab
breaks it down into translated text, model downloads, and app code.

Where your budget actually goes:

| | Cost | When |
|---|---|---|
| Translated text | ~1–2 KB per request | every use |
| Camera reading (Tesseract) | **0 bytes** | on device |
| Speech recognition (Whisper) | **0 bytes** | on device |
| Speech output | **0 bytes** | on device |
| App shell + libraries | ~4 MB | once, cached |
| Camera language data | ~12 MB | once, cached |
| Voice model | ~40 MB low data / ~80 MB normal | once, opt-in |

Measured: **200 translations in an hour comes to about 547 KB.** Steady use is
nowhere near the ceiling. The budget exists to stop a model download surprising
you, not to ration ordinary translating.

What counts as one request:

- One tap of **Translate**, however long the text.
- One camera scan, **however many paragraphs it found** — they are batched into
  a single call and split apart at the edge.
- One voice turn, after transcription (which is local and free).

A download larger than the remaining budget is refused before it starts, with
the size shown. A failed connection is charged only the handshake overhead, so a
dead captive portal cannot drain the meter.

---

## First run

1. Deploy the Worker and set the URL, as above.
2. Open the app. Text translation works immediately — nothing to download.
3. For voice, open **Data** on Wi-Fi and download the speech model. Turn on low
   data mode first if you want the 40 MB one.
4. Tap **Get English, German, Polish** to pre-fetch camera reading data (~12 MB).

On iPhone, add it to the Home Screen from the Share sheet to get it full-screen.

## The travel guide

Five sections, 19 countries, all of it baked into the app — no network, no
lookups. Pick where you are at the top and everything below follows.

**Nearby** — one tap opens Apple Maps (or Google Maps elsewhere) searching in the
local language, optionally centred on your location. Searching *farmacia* in
Italy finds far more than *pharmacy* does, and Rome's drinking fountains are only
ever tagged *fontanella*. Ten categories, all zero bytes through this app.

No map is drawn inside the app, deliberately. An embedded map costs roughly
0.5–1.5 MB every time you open it, and the free geocoding services that would
power an in-app place search explicitly forbid this kind of use — Nominatim's
policy rules out generic place search generated by coding tools. Your maps app
does the job better, and it can download areas for genuine offline navigation.

**Emergency** — the local number, large, tappable to dial, plus police / fire /
ambulance separately. Underneath, the phrases you should not be fumbling with a
translator for: *I need a doctor*, *I'm allergic to penicillin*, *I have asthma*.
Tap one and it fills the screen so you can hold it up to somebody.

**Money** — currency conversion against your home currency. Rates come from
keyless sources (Frankfurter, falling back to open.er-api), cost about a
kilobyte, and are cached so the converter keeps working with no signal. The card
shows which source and how old the rate is. Tipping customs sit below.

**Essentials** — plug types with an explanation of what each actually looks like,
voltage, tap water, which side they drive on, and a note on whatever catches
people out locally (cash-only Germany, ZTL fines in Italy, Swiss type J sockets).

**Phrases** — the 120-phrase table, searchable across all three languages with
diacritics folded, so `zgubilem` finds *Zgubiłem się*. Star the ones you need.

**Convert** — temperature, distance, weight, height, volume, and EU/UK/US
clothing and shoe sizing.

**Spending** — log what you spend in local currency, with a daily budget bar and
one-tap presets. Converts to your home currency using whatever rates Money last
fetched, so it works offline and tells you how stale the rate is. Device only.

**Medical** — blood type, allergies, medication, conditions and an emergency
contact. Fill it in once and show it large with the field labels in the local
language, so a paramedic or pharmacist can read it. Linked from the Emergency
section, since that is when you would want it. Never leaves the device and is
never sent with a translation.

**Packing** — checklist with your own additions, offline, with progress.

The phrase table is written in English, German, Polish and Italian. Elsewhere the
app says so plainly rather than captioning English text with the local flag, and
offers to translate the phrase on demand for one request.

Italian was added after a real miss: with no built-in Italian, "Goodbye" fell
through to the translation memory and came back **Addio** — which means farewell,
the one you say when you are not coming back. The everyday word is
**Arrivederci**. That is the failure mode of translating fixed phrases on the
fly, and why the common ones are written out by hand instead.

---

## Voice input

Two engines, switchable in the **Data** tab.

**Device dictation** (default) uses `webkitSpeechRecognition` — the same
recognizer behind iOS dictation. Nothing to download and much better on Polish
than any model small enough to ship. Three caveats, all real:

- iOS **blocks it in installed PWAs**. Use a normal Safari tab, not the Home
  Screen icon. The app detects this and says so rather than failing silently.
- It usually recognises in the cloud, so audio goes to Apple and it needs a
  connection.
- `continuous` is broken on iOS, so it is strictly one utterance per tap.

**Whisper on device** is fully private and works offline, but weaker. Sizes:
tiny (~35 MB), base (~75 MB), small (~200 MB). Each tier carries fallback
variants because ONNX Runtime refuses some quantized weights outright
("TransposeDQWeightsForMatMulNBits") and which ones fail depends on the device.
The first combination that builds a session is remembered.

Recognition gets words wrong whichever engine you use, so the heard text is
editable — fix the one wrong word and tap **Fix the text and translate again**
instead of repeating the whole sentence.

Set **From** to a real language rather than Detect. Both engines get noticeably
worse when guessing, and on short clips they guess badly.

---

## The camera does not re-read on a timer

Google Translate's live overlay re-runs OCR continuously, so the text on screen
keeps changing its mind. This one takes a single shot: the frame freezes, gets
read once, and the translated plates stay exactly where they are until you tap
**Again**. Toggle between **Translation** and **Original** to check what it read,
and tap any line in **Full reading** to send it to the text tab.

If a scan comes back empty, fill more of the frame with the text. Tesseract wants
roughly 30-pixel-tall characters; the capture is already upscaled and
contrast-stretched before it's read, but it can't invent detail that isn't there.

---

## Making it truly self-hosted

By default the libraries come from jsDelivr and the weights from Hugging Face on
first use. To remove both dependencies, edit `js/config.js`:

```js
transformersUrl:    '/vendor/transformers.web.js',
tesseractUrl:       '/vendor/tesseract.esm.min.js',
tesseractWorkerUrl: '/vendor/worker.min.js',
tesseractCorePath:  '/vendor/tesseract-core',
tessdataPath:       '/tessdata',
```

Then place the files:

```
npm pack @huggingface/transformers@4.2.0   # dist/transformers.web.js
npm pack tesseract.js@7.0.0                # dist/tesseract.esm.min.js, dist/worker.min.js
npm pack tesseract.js-core@6.1.2           # all four tesseract-core*.wasm.js files
```

For `/tessdata`, drop in `eng.traineddata.gz`, `deu.traineddata.gz` and
`pol.traineddata.gz` from the `@tesseract.js-data/*` packages.

The Whisper weights can also be self-hosted, but Cloudflare Pages has a 25 MB
per-file limit, so R2 or a plain object store is the better home for those.

---

## Adding a language

One row in `js/langs.js` and it appears in every picker, the camera and the voice
mode:

```js
{ code: 'sk', name: 'Slovak', native: 'Slovenčina',
  nllb: 'slk_Latn', tess: 'slk', whisper: 'slovak', tts: 'sk-SK' },
```

`nllb` codes are FLORES-200 codes. `PRIMARY` in the same file controls which
three sit above the "More languages" divider.

The offline language guesser in `js/detect.js` only knows the languages listed in
its stopword and trigram tables. A new language still works — you just have to
pick it manually instead of relying on **Detect**.

---

## Known limits

- **Translation needs a connection.** That's the trade for not carrying 240 MB of
  weights. The camera and the voice recogniser still work offline; you just won't
  get a translation back until you're online.
- **Quality is m2m100's.** Good on sentences and signs, weaker on idiom and long
  prose than a big online translator.
- **The endpoint is public.** The origin check in `worker/index.js` is the only
  thing standing between your neuron allowance and the internet. Set it.
- **Never loop translation calls.** `translateBatch` exists so one scan is one
  request. Anything that calls `translate` per item in a loop defeats the entire
  point of the budget.
- **No `Cross-Origin-Embedder-Policy`.** It would unlock multi-threaded WASM, but
  it also blocks the model downloads from Hugging Face. The trade is documented
  in `_headers`.
- **Detect is a guess.** It's stopwords, diacritics and letter clusters, not a
  model. Short input with no accented characters is where it's weakest.
- **Speech output depends on the device.** If your phone has no Polish voice
  installed, the app says so rather than reading it in the wrong accent.

---

## Files

```
index.html              app shell
_headers                Cloudflare Pages headers
manifest.webmanifest    PWA manifest
sw.js                   service worker — app shell + library cache
css/style.css
js/config.js            endpoint URL, model choices, limits — all in one place
js/langs.js             language table
js/detect.js            offline language guesser
js/engine.js            promise wrapper around the model workers
js/mt.remote.js         batched translation client
js/budget.js            the request cap
js/asr.worker.js        speech-to-text worker
js/ocr.js               camera reading and frame preprocessing
js/audio.js             microphone capture, silence detection, 16 kHz resample
js/tts.js               speech output
js/store.js             settings, history, saved phrases
js/app.js               UI controller
worker/index.js         the Cloudflare Worker you deploy
worker/wrangler.toml    Workers AI binding
```
