// Language table. `nllb` = NLLB-200 FLORES code, `tess` = Tesseract traineddata,
// `whisper` = Whisper language name, `tts` = SpeechSynthesis BCP-47 hint.
// Add a row here and the language appears everywhere in the app.

export const LANGS = [
  { code: 'en', name: 'English',   native: 'English',    nllb: 'eng_Latn', tess: 'eng',     whisper: 'english',    tts: 'en-US' },
  { code: 'de', name: 'German',    native: 'Deutsch',    nllb: 'deu_Latn', tess: 'deu',     whisper: 'german',     tts: 'de-DE' },
  { code: 'pl', name: 'Polish',    native: 'Polski',     nllb: 'pol_Latn', tess: 'pol',     whisper: 'polish',     tts: 'pl-PL' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', nllb: 'ukr_Cyrl', tess: 'ukr',     whisper: 'ukrainian',  tts: 'uk-UA' },
  { code: 'cs', name: 'Czech',     native: 'Čeština',    nllb: 'ces_Latn', tess: 'ces',     whisper: 'czech',      tts: 'cs-CZ' },
  { code: 'es', name: 'Spanish',   native: 'Español',    nllb: 'spa_Latn', tess: 'spa',     whisper: 'spanish',    tts: 'es-ES' },
  { code: 'fr', name: 'French',    native: 'Français',   nllb: 'fra_Latn', tess: 'fra',     whisper: 'french',     tts: 'fr-FR' },
  { code: 'it', name: 'Italian',   native: 'Italiano',   nllb: 'ita_Latn', tess: 'ita',     whisper: 'italian',    tts: 'it-IT' },
  { code: 'nl', name: 'Dutch',     native: 'Nederlands', nllb: 'nld_Latn', tess: 'nld',     whisper: 'dutch',      tts: 'nl-NL' },
  { code: 'pt', name: 'Portuguese',native: 'Português',  nllb: 'por_Latn', tess: 'por',     whisper: 'portuguese', tts: 'pt-PT' },
  { code: 'sv', name: 'Swedish',   native: 'Svenska',    nllb: 'swe_Latn', tess: 'swe',     whisper: 'swedish',    tts: 'sv-SE' },
  { code: 'ru', name: 'Russian',   native: 'Русский',    nllb: 'rus_Cyrl', tess: 'rus',     whisper: 'russian',    tts: 'ru-RU' },
  { code: 'tr', name: 'Turkish',   native: 'Türkçe',     nllb: 'tur_Latn', tess: 'tur',     whisper: 'turkish',    tts: 'tr-TR' },
  { code: 'ja', name: 'Japanese',  native: '日本語',      nllb: 'jpn_Jpan', tess: 'jpn',     whisper: 'japanese',   tts: 'ja-JP' },
  { code: 'zh', name: 'Chinese',   native: '中文',        nllb: 'zho_Hans', tess: 'chi_sim', whisper: 'chinese',    tts: 'zh-CN' },
];

// Shown first in the pickers. Everything else sits under "More languages".
export const PRIMARY = ['en', 'de', 'pl'];

const BY_CODE = new Map(LANGS.map((l) => [l.code, l]));
export const lang = (code) => BY_CODE.get(code) || BY_CODE.get('en');
export const primaryLangs = () => PRIMARY.map(lang);
export const otherLangs = () => LANGS.filter((l) => !PRIMARY.includes(l.code));
