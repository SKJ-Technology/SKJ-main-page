// Offline language guess. No model, no network — stopword hits plus script and
// diacritic evidence. Accurate enough to set the source language for a sentence
// or a scanned sign; it is a guess and the UI says so.

const STOPWORDS = {
  en: 'the a an and or but is are was were be been to of in on for with that this it you not have has do does from at as by we they he she his her my your there what when where which who how all any can will would should more some other than then now only over also into out up about after our'.split(' '),
  de: 'der die das und oder aber ist sind war waren sein zu von in auf für mit dass dies es nicht haben hat wird werden ich du wir sie ihr ein eine einen einem eines dem den des nach bei aus als auch noch nur schon sehr kein keine mehr wenn weil dann hier dort was wer wie wo warum immer'.split(' '),
  pl: 'i w na z do nie że jest są był była było być się to ten ta te tego tym jak ale lub oraz przez dla od po za przy o u już tylko bardzo jeszcze może można gdzie kiedy dlaczego kto co który która które nasz wasz jego jej ich mnie ciebie nam wam bez pod nad więc także'.split(' '),
  cs: 'a v na se je jsou byl byla bylo být to ten ta to jako ale nebo pro od do za při o už jen velmi ještě může kde kdy proč kdo co který která které náš jeho její jejich mě tebe nám vám bez pod nad tak také není'.split(' '),
  uk: 'і в на з до не що є був була було бути це той та ті як але або для від після за при про вже тільки дуже ще може де коли чому хто який яка які наш його її їх мене тебе нам вам без під над так також'.split(' '),
  es: 'el la los las de y o pero es son era eran ser a en con que esto no tiene hay para por un una como más muy ya cuando donde quien cual todo también sin sobre entre desde hasta porque'.split(' '),
  fr: 'le la les de et ou mais est sont était étaient être à en avec que ce ne pas il elle nous vous ils elles un une des du au aux pour par comme plus très déjà quand où qui que tout aussi sans sur entre depuis parce'.split(' '),
  it: 'il lo la i gli le di e o ma è sono era erano essere a in con che questo non ha per da un una come più molto già quando dove chi quale tutto anche senza sopra tra fino perché'.split(' '),
  nl: 'de het een en of maar is zijn was waren te van in op voor met dat dit niet heeft hebben ik je wij zij hij ze aan bij uit als ook nog maar zeer geen meer wanneer waar wie welke alle ook zonder over tussen omdat'.split(' '),
  pt: 'o a os as de e ou mas é são era eram ser em com que isto não tem há para por um uma como mais muito já quando onde quem qual todo também sem sobre entre desde até porque'.split(' '),
  sv: 'och att det en ett som på är av för med till den här inte har vi du jag han hon de om men eller från vid när var vem vilken alla också utan över mellan eftersom mycket'.split(' '),
  ru: 'и в на с не что это как но или для от по за при о у уже только очень еще может где когда почему кто который которая которые наш его её их меня тебя нам вам без под над так также был была было быть'.split(' '),
  tr: 've veya ama bir bu şu ne değil için ile de da olarak çok daha en gibi kadar sonra önce nasıl nerede kim hangi her bütün olan olur var yok ben sen biz siz onlar'.split(' '),
};

// Characters that only a few of our languages use.
const MARKERS = [
  { code: 'pl', re: /[ąćęłńóśźż]/gi, weight: 3 },
  { code: 'cs', re: /[řůěšťďňý]/gi, weight: 3 },
  { code: 'de', re: /[äöüß]/gi, weight: 2 },
  { code: 'sv', re: /[åäö]/gi, weight: 1.5 },
  { code: 'tr', re: /[ğışçö]/gi, weight: 1.5 },
  { code: 'es', re: /[ñ¿¡]/gi, weight: 2.5 },
  { code: 'fr', re: /[àâçèêëîïôùû]/gi, weight: 1.5 },
  { code: 'pt', re: /[ãõçá]/gi, weight: 1.5 },
  { code: 'nl', re: /\bij\b|ij[a-z]/gi, weight: 0.5 },
];

// Short signage ("Ausfahrt freihalten", "Zakaz palenia") carries no stopwords
// and often no diacritics, so letter-cluster evidence decides those. Weighted
// low: this breaks ties, it does not overturn real stopword hits.
const TRIGRAMS = {
  en: ['the', 'ing', 'and', 'ion', 'tio', 'ere', 'ght', 'ith', 'ave', 'ould'],
  de: ['sch', 'ung', 'ich', 'ein', 'cht', 'ahr', 'eit', 'und', 'aus', 'hal', 'gen', 'ber', 'ver', 'ent', 'ss'],
  pl: ['nia', 'eni', 'cze', 'szy', 'rzy', 'ani', 'wsk', 'czy', 'prz', 'dzi', 'nie', 'kaz', 'ows', 'sza'],
  cs: ['ící', 'ění', 'tvo', 'sky', 'pro', 'ova', 'ost'],
  uk: ['ння', 'ого', 'ать', 'ськ'],
  ru: ['ого', 'ени', 'ать', 'ств', 'ние'],
  es: ['ció', 'ado', 'los', 'que', 'ent', 'ida'],
  fr: ['eux', 'ent', 'tio', 'que', 'oir', 'ais'],
  it: ['zio', 'gli', 'che', 'ere', 'ita'],
  pt: ['ção', 'nho', 'ade', 'ent', 'ame'],
  nl: ['ijk', 'oor', 'aan', 'sch', 'lij', 'gen'],
  sv: ['ing', 'ätt', 'för', 'och', 'ska'],
  tr: ['lar', 'ler', 'dır', 'ınd', 'yor'],
};

const SCRIPTS = [
  { re: /[\u3040-\u30ff]/, code: 'ja' },   // hiragana / katakana
  { re: /[\u4e00-\u9fff]/, code: 'zh' },   // han (falls to ja if kana present)
  { re: /[\u0400-\u04ff]/, code: null },   // cyrillic: decide between ru and uk
];

const UK_ONLY = /[іїєґ]/gi;

/**
 * Guess the language of `text`, restricted to `allowed` (array of app codes).
 * Returns { code, confidence } with confidence 0..1.
 */
export function detectLanguage(text, allowed) {
  const clean = (text || '').trim();
  if (clean.length < 2) return { code: allowed[0], confidence: 0 };

  const pool = new Set(allowed);

  // Script gates first — they are near-certain.
  if (/[\u3040-\u30ff]/.test(clean) && pool.has('ja')) return { code: 'ja', confidence: 0.98 };
  if (/[\u4e00-\u9fff]/.test(clean) && pool.has('zh')) return { code: 'zh', confidence: 0.9 };
  if (/[\u0400-\u04ff]/.test(clean)) {
    const uk = (clean.match(UK_ONLY) || []).length;
    if (uk > 0 && pool.has('uk')) return { code: 'uk', confidence: 0.9 };
    if (pool.has('ru')) return { code: 'ru', confidence: 0.8 };
    if (pool.has('uk')) return { code: 'uk', confidence: 0.7 };
  }

  const words = clean.toLowerCase().match(/[\p{L}']+/gu) || [];
  const scores = new Map([...pool].map((c) => [c, 0]));

  for (const w of words) {
    for (const code of pool) {
      const list = STOPWORDS[code];
      if (list && list.includes(w)) scores.set(code, scores.get(code) + 2);
    }
  }
  for (const m of MARKERS) {
    if (!pool.has(m.code)) continue;
    const hits = (clean.match(m.re) || []).length;
    if (hits) scores.set(m.code, scores.get(m.code) + hits * m.weight);
  }

  const flat = clean.toLowerCase();
  for (const code of pool) {
    const grams = TRIGRAMS[code];
    if (!grams) continue;
    let hits = 0;
    for (const g of grams) {
      let from = 0;
      let at = flat.indexOf(g, from);
      while (at !== -1 && hits < 12) { hits++; from = at + 1; at = flat.indexOf(g, from); }
    }
    if (hits) scores.set(code, scores.get(code) + hits * 0.6);
  }

  let best = allowed[0];
  let bestScore = -1;
  let total = 0;
  for (const [code, s] of scores) {
    total += s;
    if (s > bestScore) { bestScore = s; best = code; }
  }
  const confidence = total > 0 ? Math.min(1, bestScore / total) * Math.min(1, bestScore / 6) : 0;
  return { code: best, confidence };
}
