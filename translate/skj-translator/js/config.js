// One place to change where code and weights come from.
// Swap any URL for a local path to make the whole app self-hosted.

export const BUILD = 'build-39';

export const CONFIG = {
  // Library builds. Explicit /dist path matters: the bare package name resolves
  // to the Node build on jsDelivr.
  // The /dist/ build contains a bare `import('onnxruntime-web/webgpu')`, which
  // only a bundler can resolve — a browser cannot, and module workers cannot use
  // import maps. These endpoints rewrite bare specifiers into real URLs.
  // Tried in order; the first that yields a working pipeline() wins.
  transformersUrls: [
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm',
    'https://esm.sh/@huggingface/transformers@4.2.0',
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.web.js',
  ],
  tesseractUrl: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js',
  tesseractWorkerUrl: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
  tesseractCorePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2',

  // null = Tesseract's own jsDelivr default. Set to e.g. '/tessdata' to serve
  // .traineddata.gz yourself (see README).
  tessdataPath: null,

  // Translation backend. 'mymemory' needs no setup whatsoever — leave it.
  // Switch to 'worker' only if you deploy worker/index.js and want no daily
  // character cap plus true batching.
  remote: {
    provider: 'mymemory',

    myMemoryUrl: 'https://api.mymemory.translated.net/get',
    myMemoryMaxBytes: 450,   // their hard limit is 500 bytes per query
    anonCharCap: 5000,       // per day, per IP
    emailCharCap: 50000,     // per day, with an email attached

    // Same-origin Pages Function. Deployed automatically if the functions/
    // folder ships with the site, so there is nothing to paste.
    workerUrl: '/api/translate',

    maxItemsPerRequest: 40,
    // MyMemory cannot batch, so each block is its own call. Cap it or one busy
    // photo swallows the daily character allowance.
    maxBlocksPerScan: 14,
    label: 'MyMemory',
    note: 'No setup, no key. Free daily character allowance.',
  },

  speech: {
    task: 'automatic-speech-recognition',

    // Size tiers. Bigger is markedly better on Polish, which is where the
    // small models fall down hardest.
    // Each tier lists fallbacks because ONNX Runtime refuses some quantized
    // variants outright ("TransposeDQWeightsForMatMulNBits"), and which ones
    // fail depends on the device.
    // Ordered LIGHTEST-IN-MEMORY FIRST, deliberately.
    //
    // A failed session build throws and we move to the next candidate. Running
    // out of memory does not throw — iOS kills the tab, so nothing downstream
    // ever runs. That makes the order of this list the only real protection:
    // the cheapest variant has to be tried first.
    //
    // An fp32 encoder is the usual culprit. It decodes marginally better and
    // costs several times the memory, so it goes last or not at all.
    tiers: {
      tiny: {
        label: 'Whisper tiny',
        blurb: 'Smallest. Struggles with Polish.',
        mb: 25,
        candidates: [
          { model: 'onnx-community/whisper-tiny', dtype: 'q4', label: 'tiny · q4', mb: 25 },
          { model: 'Xenova/whisper-tiny', dtype: 'q8', label: 'tiny · q8', mb: 42 },
          { model: 'onnx-community/whisper-tiny', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, label: 'tiny · fp32 encoder', mb: 35 },
        ],
      },
      base: {
        label: 'Whisper base',
        blurb: 'Noticeably better. A good default.',
        mb: 50,
        candidates: [
          { model: 'onnx-community/whisper-base', dtype: 'q4', label: 'base · q4', mb: 50 },
          { model: 'Xenova/whisper-base', dtype: 'q8', label: 'base · q8', mb: 82 },
          { model: 'onnx-community/whisper-base', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, label: 'base · fp32 encoder', mb: 75 },
        ],
      },
      small: {
        label: 'Whisper small',
        blurb: 'Best on Polish, but heavy. Needs a lot of memory to start up.',
        mb: 150,
        candidates: [
          { model: 'onnx-community/whisper-small', dtype: 'q4', label: 'small · q4', mb: 150 },
          { model: 'onnx-community/whisper-small', dtype: { encoder_model: 'q8', decoder_model_merged: 'q4' }, label: 'small · q8 encoder', mb: 180 },
          // Heaviest of the three, so last — but it is a different conversion and
          // sometimes builds where the others refuse.
          { model: 'Xenova/whisper-small', dtype: 'q8', label: 'small · q8 (Xenova)', mb: 250 },
        ],
      },
    },

    defaultTier: 'base',
    label: 'Whisper',
    note: 'Multilingual speech to text, running on this device.',
  },

  // Recording limits for voice mode.
  audio: {
    maxSeconds: 30,
    // Longer, so a pause mid-sentence does not cut you off.
    silenceMs: 2400,
    minSeconds: 0.6,
    // Phone-call processing is tuned to make speech sound clean to humans and
    // it mangles the spectrum Whisper was trained on. Off is more accurate.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },

  // Camera capture is upscaled to at least this many pixels on its short edge
  // before OCR. Tesseract needs roughly 30px-tall characters to be reliable.
  ocr: { minShortEdge: 1100, maxLongEdge: 2200, minConfidence: 40 },
};
