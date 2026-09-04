// Flashcards over the phrase table.
//
// Leitner boxes rather than a full SM-2 scheduler: five boxes, doubling
// intervals, promote on a correct answer and drop straight back to box one on a
// miss. It is the simplest thing that actually works, needs no grading scale,
// and survives being used erratically on a trip — which is how this will be used.
//
// Entirely offline. No network, ever.

import { PHRASES, PHRASE_CATS, PHRASE_COL } from './phrases.js';

const KEY = 'skj-translator:learn';

// Days until a card in each box comes back.
const INTERVALS = [0, 1, 2, 4, 8, 16];
const MAX_BOX = 5;

let state = {
  cards: {},        // id -> { box, due (epoch day), seen, right, wrong }
  custom: [],       // { prompt, answer, from, to, at } — added from the camera
  newPerDay: 8,
  lastDay: 0,
  introduced: 0,    // new cards shown today
};

try {
  const raw = localStorage.getItem(KEY);
  if (raw) Object.assign(state, JSON.parse(raw));
} catch { /* private mode */ }

const today = () => Math.floor(Date.now() / 86400000);

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function rollover() {
  const d = today();
  if (state.lastDay !== d) {
    state.lastDay = d;
    state.introduced = 0;
    save();
  }
}

const cardId = (row, from, to) => `${from}>${to}:${row[1]}`;

/** Add a card of your own. Returns false if it is already there. */
export function addCustom(prompt, answer, from, to) {
  const p = String(prompt || '').trim();
  const a = String(answer || '').trim();
  if (!p || !a || p === a) return false;
  if (state.custom.some((c) => c.prompt === p && c.to === to)) return false;
  state.custom.unshift({ prompt: p, answer: a, from, to, at: Date.now() });
  state.custom = state.custom.slice(0, 400);
  save();
  return true;
}

export function customCount() { return state.custom.length; }

export function removeCustom(prompt, to) {
  state.custom = state.custom.filter((c) => !(c.prompt === prompt && c.to === to));
  save();
}

function customDeck(from, to) {
  return state.custom
    .filter((c) => c.from === from && c.to === to)
    .map((c) => ({
      id: `custom:${from}>${to}:${c.prompt}`,
      category: 'mine',
      prompt: c.prompt,
      answer: c.answer,
      english: c.prompt,
      custom: true,
    }));
}

/** Every phrase available for a language pair, as cards. */
export function deck(from, to, category = 'all') {
  const mine = customDeck(from, to);
  if (category === 'mine') return mine;
  if (!PHRASE_COL[from] || !PHRASE_COL[to]) return mine;
  const built = PHRASES
    .filter((r) => category === 'all' || r[0] === category)
    .map((r) => ({
      id: cardId(r, from, to),
      category: r[0],
      prompt: r[PHRASE_COL[from]],
      answer: r[PHRASE_COL[to]],
      english: r[1],
      row: r,
    }))
    // A card whose two sides are identical teaches nothing ("No" / "No").
    .filter((c) => c.prompt && c.answer && c.prompt !== c.answer);

  return category === 'all' ? [...mine, ...built] : built;
}

/** Cards due now, then new ones up to the daily allowance. */
export function due(from, to, category = 'all') {
  rollover();
  const all = deck(from, to, category);
  const d = today();

  const seen = [];
  const fresh = [];
  for (const c of all) {
    const rec = state.cards[c.id];
    if (!rec) fresh.push(c);
    else if (rec.due <= d) seen.push({ ...c, box: rec.box });
  }

  // Weakest first, so the ones you keep missing come round soonest.
  seen.sort((a, b) => a.box - b.box);

  // Left uncapped, the daily review pile grows without limit — testing had it
  // at 44 cards by the second week and still climbing. That is how people stop
  // opening the app. Cap a sitting and let the rest wait; nothing is lost,
  // overdue cards simply come first next time.
  const CAP = 24;
  const room = Math.max(0, state.newPerDay - state.introduced);
  const review = seen.slice(0, CAP);
  const newRoom = Math.max(0, Math.min(room, CAP - review.length));

  return {
    review,
    fresh: fresh.slice(0, newRoom),
    freshTotal: fresh.length,
    heldBack: Math.max(0, seen.length - review.length),
  };
}

/** Record an answer. `right` promotes a box, wrong resets to one. */
export function grade(id, right) {
  rollover();
  const rec = state.cards[id] || { box: 0, due: 0, seen: 0, right: 0, wrong: 0 };
  const isNew = rec.box === 0;

  rec.seen += 1;
  if (right) {
    rec.right += 1;
    rec.box = Math.min(MAX_BOX, rec.box + 1);
  } else {
    rec.wrong += 1;
    rec.box = 1;
  }
  rec.due = today() + INTERVALS[rec.box];

  state.cards[id] = rec;
  if (isNew) state.introduced += 1;
  save();
  return rec;
}

export function stats(from, to) {
  rollover();
  const all = deck(from, to);
  const d = today();
  let started = 0;
  let known = 0;
  let dueNow = 0;
  for (const c of all) {
    const rec = state.cards[c.id];
    if (!rec) continue;
    started += 1;
    if (rec.box >= 4) known += 1;
    if (rec.due <= d) dueNow += 1;
  }
  return {
    total: all.length,
    started,
    known,
    dueNow,
    untouched: all.length - started,
    introducedToday: state.introduced,
    newPerDay: state.newPerDay,
  };
}

export function setNewPerDay(n) {
  state.newPerDay = Math.max(1, Math.min(50, n | 0));
  save();
}

export function resetProgress() {
  state.cards = {};
  // Cards you added yourself are kept — resetting progress is not the same as
  // throwing away the words you collected.
  state.introduced = 0;
  save();
}

export const CATEGORIES = [
  ...PHRASE_CATS.filter((c) => c.id !== 'saved'),
  { id: 'mine', label: 'From the camera' },
];
export const boxLabel = (box) =>
  ['new', 'learning', 'shaky', 'getting there', 'nearly', 'known'][box] || 'new';
