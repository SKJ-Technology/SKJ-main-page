// The travel guide. Everything here works with no signal except the currency
// rates, which are fetched once and then reused from cache.

import { COUNTRIES, country, PLUG_NOTES, SIZES, NEARBY, nearbyTerm, WATCH, transit, shopsFor, hasShops } from './guide.data.js';
import { PHRASES, PHRASE_CATS, PHRASE_COL, EMERGENCY_PHRASES } from './phrases.js';
import * as Learn from './learn.js';
import { MENU_SECTIONS, MENU_TERM_COUNT, searchMenu } from './menu.data.js';
import { lang } from './langs.js';
import { speak } from './tts.js';
import { settings } from './store.js';
import { budget, formatBytes, REQUEST_OVERHEAD } from './budget.js';
import { translator } from './mt.remote.js';
import * as Maps from './map.js';
import * as Today from './today.js';
import * as Explore from './explore.js';
import * as Over from './overpass.js';

const KEY = 'skj-translator:guide';
const RATE_KEY = 'skj-translator:rates';

// Keyless, CORS-enabled rate sources. Tried in order.
const RATE_SOURCES = [
  { name: 'frankfurter', url: (base) => `https://api.frankfurter.app/latest?from=${base}`, parse: (d) => d && d.rates },
  { name: 'er-api', url: (base) => `https://open.er-api.com/v6/latest/${base}`, parse: (d) => d && d.rates },
];

let state = {
  country: 'IT',
  home: 'PLN',
  section: 'today',
  phraseCat: 'all',
  phraseQuery: '',
  saved: {},
  amount: 10,
  coords: null,
  packed: {},
  extras: [],
  spend: [],          // { amount, cur, note, at }
  dailyBudget: 0,
  address: '',
  learnCat: 'all',
  learnFlip: false,
  menuQuery: '',
  menuOpen: 'structure',
  medical: { blood: '', allergies: '', meds: '', conditions: '', contact: '', contactPhone: '' },
};

let rates = null; // { base, rates, at, source }

try {
  const raw = localStorage.getItem(KEY);
  if (raw) Object.assign(state, JSON.parse(raw));
  const r = localStorage.getItem(RATE_KEY);
  if (r) rates = JSON.parse(r);
} catch { /* private mode */ }

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
};

let host = null;
let toast = () => {};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// The phrase table is written in English, German and Polish only. For anywhere
// else, say so plainly rather than captioning English text with a flag.
function phraseFor(row, code) {
  const col = PHRASE_COL[code];
  if (col) return { text: row[col], exact: true, code };
  return { text: row[PHRASE_COL.en], exact: false, code: 'en' };
}

const SECTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'map', label: 'Map' },
  { id: 'explore', label: 'Explore' },
  { id: 'emergency', label: 'Emergency' },
  { id: 'money', label: 'Money' },
  { id: 'basics', label: 'Essentials' },
  { id: 'transit', label: 'Getting around' },
  { id: 'phrases', label: 'Phrases' },
  { id: 'learn', label: 'Learn' },
  { id: 'menu', label: 'Menu' },
  { id: 'shops', label: 'Shops' },
  { id: 'convert', label: 'Convert' },
  { id: 'spend', label: 'Spending' },
  { id: 'medical', label: 'Medical' },
  { id: 'pack', label: 'Packing' },
];

/* ── Entry point ───────────────────────────────────────── */

export function initGuide(container, { toast: t } = {}) {
  host = container;
  if (t) toast = t;
  render();
}

function render() {
  if (!host) return;
  host.replaceChildren();
  host.append(countryBar(), sectionBar(), body());
}

/* ── Country and section pickers ───────────────────────── */

function countryBar() {
  const wrap = el('div', 'gcountry');
  const sel = el('select', 'gselect');
  for (const c of COUNTRIES) {
    const o = el('option', null, `${c.flag}  ${c.name}`);
    o.value = c.code;
    if (c.code === state.country) o.selected = true;
    sel.append(o);
  }
  sel.setAttribute('aria-label', 'Country you are in');
  sel.addEventListener('change', () => {
    if (state.section === 'map') Maps.destroyMap();
    state.country = sel.value;
    save();
    render();
  });

  const label = el('span', 'gcountry-label', "I'm in");
  wrap.append(label, sel);
  return wrap;
}

function sectionBar() {
  const wrap = el('div', 'chips');
  for (const s of SECTIONS) {
    const b = el('button', `chip${s.id === state.section ? ' is-on' : ''}`, s.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      // MapLibre holds a WebGL context and a lot of memory; iOS will kill the
      // tab rather than let it linger. Tear it down on the way out.
      if (state.section === 'map' && s.id !== 'map') Maps.destroyMap();
      state.section = s.id;
      save();
      render();
    });
    wrap.append(b);
  }
  return wrap;
}

function body() {
  switch (state.section) {
    case 'today': return todaySection();
    case 'nearby': return nearbySection();
    case 'map': return mapSection();
    case 'explore': return exploreSection();
    case 'money': return moneySection();
    case 'basics': return basicsSection();
    case 'transit': return transitSection();
    case 'phrases': return phrasesSection();
    case 'learn': return learnSection();
    case 'menu': return menuSection();
    case 'shops': return shopsSection();
    case 'convert': return convertSection();
    case 'spend': return spendSection();
    case 'medical': return medicalSection();
    case 'pack': return packSection();
    default: return emergencySection();
  }
}

/* ── Today ─────────────────────────────────────────────── */

function todaySection() {
  const c = country(state.country);
  const wrap = el('div');

  // Daylight first: it needs no network, so it is always something.
  const sun = el('article', 'card');
  sun.append(el('h2', 'card-title', 'Daylight'));
  if (state.coords) {
    const now = new Date();
    const { sunrise, sunset, polar } = Today.sunTimes(now, state.coords.lat, state.coords.lon);
    if (polar) {
      sun.append(el('p', 'card-note', polar));
    } else {
      const fmt = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const row = el('div', 'numgrid');
      for (const [k, v] of [['Sunrise', fmt(sunrise)], ['Sunset', fmt(sunset)]]) {
        const cell = el('div', 'numcell');
        cell.append(el('span', 'numcell-l', k), el('span', 'numcell-n', v));
        row.append(cell);
      }
      sun.append(row);
      const left = Today.daylightLeft(now, sunset);
      if (left) sun.append(el('p', 'card-note', left));
    }
    sun.append(el('p', 'fineprint', 'Calculated on the device — no request, works with no signal. Accurate to a few minutes.'));
  } else {
    sun.append(el('p', 'card-note', 'Allow location on the Nearby tab and daylight times appear here, computed offline.'));
  }
  wrap.append(sun);

  // Clock. Pure Intl, no request — useful for working out whether it is a
  // reasonable hour to ring home.
  if (c.tz) {
    const clock = el('article', 'card');
    clock.append(el('h2', 'card-title', 'Time'));
    const homeTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fmt = (tz) => new Date().toLocaleTimeString(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    const grid = el('div', 'numgrid');
    const cells = [[c.name, c.tz]];
    if (homeTz && homeTz !== c.tz) cells.push(['Your phone', homeTz]);
    for (const [label, tz] of cells) {
      const cell = el('div', 'numcell');
      cell.append(el('span', 'numcell-l', label), el('span', 'numcell-n', fmt(tz)));
      grid.append(cell);
    }
    clock.append(grid);
    const offset = (() => {
      try {
        const now = new Date();
        const a = new Date(now.toLocaleString('en-US', { timeZone: c.tz }));
        const b = new Date(now.toLocaleString('en-US', { timeZone: homeTz }));
        const h = Math.round((a - b) / 3600000);
        if (h === 0) return 'Same time as your phone\u2019s home zone.';
        return `${Math.abs(h)} h ${h > 0 ? 'ahead of' : 'behind'} your phone\u2019s home zone.`;
      } catch { return null; }
    })();
    if (offset) clock.append(el('p', 'card-note', offset));
    clock.append(el('p', 'fineprint', 'From the device clock. No request.'));
    wrap.append(clock);
  }

  // Weather.
  const wx = el('article', 'card');
  wx.append(el('h2', 'card-title', 'Weather'));
  const wxBody = el('div');
  const wxNote = el('p', 'card-note');
  wx.append(wxBody, wxNote);

  const paintWeather = (w) => {
    wxBody.replaceChildren();
    if (!w) { wxNote.textContent = state.coords ? 'Not fetched yet — about 2 KB.' : 'Needs your location. Allow it on the Nearby tab.'; return; }
    const [label, glyph] = Today.describeWeather(w.current.weather_code);
    const head = el('div', 'wxnow');
    head.append(el('span', 'wxglyph', glyph));
    const t = el('div');
    t.append(el('span', 'wxtemp', `${Math.round(w.current.temperature_2m)}°`));
    t.append(el('span', 'wxlabel', label));
    head.append(t);
    wxBody.append(head);

    const bits = [
      `Feels like ${Math.round(w.current.apparent_temperature)}°`,
      `Wind ${Math.round(w.current.wind_speed_10m)} km/h`,
      `Humidity ${w.current.relative_humidity_2m}%`,
    ];
    wxBody.append(el('p', 'card-sub', bits.join(' · ')));

    const uv = Today.describeUV(w.current.uv_index ?? w.daily?.uv_index_max?.[0]);
    if (uv && uv.v > 0) {
      const row = el('div', `uvrow uv-${uv.band.toLowerCase().replace(' ', '-')}`);
      row.append(el('span', 'uv-n', `UV ${uv.v}`));
      const t = el('div');
      t.append(el('span', 'uv-band', uv.band));
      t.append(el('span', 'uv-advice', uv.advice));
      row.append(t);
      wxBody.append(row);
    }

    if (w.daily && w.daily.time) {
      const days = el('div', 'wxdays');
      for (let i = 0; i < w.daily.time.length; i++) {
        const d = new Date(`${w.daily.time[i]}T12:00:00`);
        const cell = el('div', 'wxday');
        cell.append(el('span', 'wxday-n', i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })));
        cell.append(el('span', 'wxday-g', Today.describeWeather(w.daily.weather_code[i])[1]));
        cell.append(el('span', 'wxday-t', `${Math.round(w.daily.temperature_2m_max[i])}°`));
        cell.append(el('span', 'wxday-l', `${Math.round(w.daily.temperature_2m_min[i])}°`));
        const pop = w.daily.precipitation_probability_max?.[i];
        cell.append(el('span', 'wxday-p', pop == null ? '' : `${pop}%`));
        days.append(cell);
      }
      wxBody.append(days);
    }
    wxNote.textContent = `${w.ageMinutes < 1 ? 'Just now' : `${w.ageMinutes} min ago`} · Open-Meteo, data CC BY 4.0`;
  };

  paintWeather(Today.cachedWeather(state.coords));

  if (state.coords) {
    const foot = el('div', 'card-foot');
    const b = el('button', 'go compact', Today.cachedWeather(state.coords) ? 'Refresh' : 'Get weather (~2 KB)');
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Fetching…';
      try {
        paintWeather(await Today.fetchWeather(state.coords));
        b.textContent = 'Refresh';
      } catch (err) {
        wxNote.textContent = err && err.message ? err.message : String(err);
        b.textContent = 'Try again';
      }
      b.disabled = false;
    });
    foot.append(b);
    wx.append(foot);
  }
  wrap.append(wx);

  // Air quality and pollen. Worth having because the medical card asks about
  // asthma, and a poor-air day is not visible from the window.
  if (state.coords) {
    const air = el('article', 'card');
    air.append(el('h2', 'card-title', 'Air'));
    const airBody = el('div');
    const airNote = el('p', 'card-note');
    air.append(airBody, airNote);

    const paintAir = (a) => {
      airBody.replaceChildren();
      if (!a) { airNote.textContent = 'Not fetched yet — about 1 KB.'; return; }
      const q = Today.describeAQI(a.current.european_aqi);
      if (q) {
        const row = el('div', `uvrow${q.v > 60 ? ' uv-very-high' : ''}`);
        row.append(el('span', 'uv-n', String(q.v)));
        const t = el('div');
        t.append(el('span', 'uv-band', q.band));
        t.append(el('span', 'uv-advice', q.advice));
        row.append(t);
        airBody.append(row);
      }
      const bits = [];
      if (a.current.pm2_5 != null) bits.push(`PM2.5 ${Math.round(a.current.pm2_5)}`);
      if (a.current.pm10 != null) bits.push(`PM10 ${Math.round(a.current.pm10)}`);
      if (a.current.ozone != null) bits.push(`Ozone ${Math.round(a.current.ozone)}`);
      if (bits.length) airBody.append(el('p', 'card-sub', `${bits.join(' · ')} µg/m³`));

      const pollen = Today.pollenSummary(a.current);
      if (pollen.length) {
        const ul = el('ul', 'strip-list');
        for (const p of pollen) {
          const li = el('li');
          const d = el('div', 'row');
          d.append(el('span', 'row-out', `${p.label} — ${p.level}`));
          d.append(el('span', 'row-in', `${p.value} grains/m³`));
          li.append(d);
          ul.append(li);
        }
        airBody.append(ul);
      }
      airNote.textContent = `${a.ageMinutes < 1 ? 'Just now' : `${a.ageMinutes} min ago`} · European AQI, Open-Meteo`;
    };
    paintAir(Today.cachedAir(state.coords));

    const af = el('div', 'card-foot');
    const ab = el('button', 'go compact', Today.cachedAir(state.coords) ? 'Refresh' : 'Get air quality (~1 KB)');
    ab.addEventListener('click', async () => {
      ab.disabled = true;
      ab.textContent = 'Fetching…';
      try { paintAir(await Today.fetchAir(state.coords)); ab.textContent = 'Refresh'; }
      catch (err) { airNote.textContent = err && err.message ? err.message : String(err); ab.textContent = 'Try again'; }
      ab.disabled = false;
    });
    af.append(ab);
    air.append(af);
    wrap.append(air);
  }

  // Holidays — worth knowing in Italy, where a lot shuts.
  const hol = el('article', 'card');
  hol.append(el('h2', 'card-title', 'Closures'));
  const holBody = el('div');
  const holNote = el('p', 'card-note');
  hol.append(holBody, holNote);

  const year = new Date().getFullYear();
  const paintHolidays = (h) => {
    holBody.replaceChildren();
    const next = Today.upcomingHolidays(h);
    if (!next.length) {
      holNote.textContent = h ? 'No public holidays left this year.' : 'Not fetched yet — a few KB. Public holidays mean shut shops and thinner transport.';
      return;
    }
    const list = el('ul', 'strip-list');
    for (const d of next) {
      const li = el('li');
      const row = el('div', 'row');
      row.append(el('span', 'row-out', `${d.local}${d.local !== d.name ? ` — ${d.name}` : ''}`));
      row.append(el('span', 'row-in', `${d.date} · ${d.when}${d.global ? '' : ' · regional only'}`));
      li.append(row);
      list.append(li);
    }
    holBody.append(list);
    holNote.textContent = `Public holidays in ${c.name}. Expect closed shops and reduced transport.`;
  };
  paintHolidays(Today.cachedHolidays(c.code, year));

  const holFoot = el('div', 'card-foot');
  const hb = el('button', 'go compact', 'Get holidays');
  hb.addEventListener('click', async () => {
    hb.disabled = true;
    hb.textContent = 'Fetching…';
    try {
      paintHolidays(await Today.fetchHolidays(c.code, year));
      hb.remove();
    } catch (err) {
      holNote.textContent = err && err.message ? err.message : String(err);
      hb.disabled = false;
      hb.textContent = 'Try again';
    }
  });
  holFoot.append(hb);
  hol.append(holFoot);
  wrap.append(hol);

  return wrap;
}

/* ── Spending ──────────────────────────────────────────── */

// Entirely offline. Conversion uses whatever rates were last fetched in Money,
// so it keeps working with no signal — it just says how old they are.

function spendSection() {
  const c = country(state.country);
  const cur = c.currency.code;
  const wrap = el('div');

  const today = new Date().toISOString().slice(0, 10);
  const dayOf = (e) => new Date(e.at).toISOString().slice(0, 10);
  const todayTotal = state.spend.filter((e) => dayOf(e) === today).reduce((n, e) => n + e.amount, 0);
  const allTotal = state.spend.reduce((n, e) => n + e.amount, 0);
  const days = new Set(state.spend.map(dayOf)).size || 1;

  const head = el('article', 'card');
  head.append(el('h2', 'card-title', 'Spending'));

  const big = el('p', 'spendtotal', `${todayTotal.toFixed(2)} ${c.currency.symbol}`);
  head.append(big);
  const sub = el('p', 'card-sub', 'today');
  head.append(sub);

  const rate = rateBetween(cur, state.home);
  const homeLine = el('p', 'card-note');
  if (rate != null) {
    const age = rates ? Math.round((Date.now() - rates.at) / 3600000) : null;
    homeLine.textContent = `≈ ${(todayTotal * rate).toFixed(2)} ${state.home}` +
      (age != null ? ` at a rate from ${age < 1 ? 'under an hour' : `${age} h`} ago` : '');
  } else {
    homeLine.textContent = `Fetch rates in Money to see this in ${state.home}.`;
  }
  head.append(homeLine);

  if (state.dailyBudget > 0) {
    const bar = el('div', 'meter');
    const fill = el('span');
    const pct = Math.min(100, (todayTotal / state.dailyBudget) * 100);
    fill.style.width = `${pct}%`;
    if (todayTotal > state.dailyBudget) fill.style.background = 'var(--rail)';
    bar.append(fill);
    head.append(bar);
    head.append(el('p', 'card-note', todayTotal > state.dailyBudget
      ? `${(todayTotal - state.dailyBudget).toFixed(2)} ${c.currency.symbol} over today\u2019s budget.`
      : `${(state.dailyBudget - todayTotal).toFixed(2)} ${c.currency.symbol} left today.`));
  }
  wrap.append(head);

  // Add an entry.
  const add = el('article', 'card');
  add.append(el('p', 'card-sub', 'Add'));
  const row = el('div', 'splitrow');
  const amt = el('input', 'convinput');
  amt.type = 'number';
  amt.inputMode = 'decimal';
  amt.placeholder = `Amount in ${cur}`;
  const note = el('input', 'textfield');
  note.placeholder = 'What for? (optional)';
  note.style.marginTop = '8px';
  row.append(amt, el('span', 'convarrow', cur));
  add.append(row, note);

  const quick = el('div', 'pctrow');
  for (const [label, v] of [['Coffee', 2], ['Lunch', 12], ['Ticket', 8], ['Dinner', 25]]) {
    const b = el('button', 'seg', `${label} ${v}`);
    b.type = 'button';
    b.addEventListener('click', () => { amt.value = v; note.value = label; });
    quick.append(b);
  }
  add.append(quick);

  const save1 = el('button', 'go compact', 'Add');
  save1.style.marginTop = '12px';
  save1.addEventListener('click', () => {
    const v = parseFloat(amt.value);
    if (!Number.isFinite(v) || v <= 0) return;
    state.spend.unshift({ amount: v, cur, note: note.value.trim(), at: Date.now() });
    state.spend = state.spend.slice(0, 300);
    save();
    render();
  });
  add.append(save1);
  wrap.append(add);

  // Budget.
  const bud = el('article', 'card');
  bud.append(el('p', 'card-sub', 'Daily budget'));
  const bIn = el('input', 'convinput wide');
  bIn.type = 'number';
  bIn.inputMode = 'decimal';
  bIn.value = state.dailyBudget || '';
  bIn.placeholder = `Per day in ${cur}`;
  bIn.addEventListener('change', () => {
    state.dailyBudget = parseFloat(bIn.value) || 0;
    save();
    render();
  });
  bud.append(bIn);
  wrap.append(bud);

  // History.
  if (state.spend.length) {
    const hist = el('article', 'card');
    hist.append(el('p', 'card-sub', `All of it — ${allTotal.toFixed(2)} ${c.currency.symbol} over ${days} ${days === 1 ? 'day' : 'days'}, ${(allTotal / days).toFixed(2)} a day`));
    const ul = el('ul', 'strip-list');
    for (const e of state.spend.slice(0, 40)) {
      const li = el('li');
      const line = el('div', 'phraserow');
      const d = el('div', 'row');
      d.append(el('span', 'row-out', `${e.amount.toFixed(2)} ${e.cur}`));
      d.append(el('span', 'row-in', [e.note, new Date(e.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')));
      const del = el('button', 'star', '×');
      del.type = 'button';
      del.setAttribute('aria-label', 'Remove');
      del.addEventListener('click', () => {
        state.spend = state.spend.filter((x) => x.at !== e.at);
        save();
        render();
      });
      line.append(d, del);
      li.append(line);
      ul.append(li);
    }
    hist.append(ul);
    const hf = el('div', 'card-foot');
    const clr = el('button', 'ghost', 'Clear all');
    clr.addEventListener('click', () => { state.spend = []; save(); render(); });
    hf.append(clr);
    hist.append(hf);
    wrap.append(hist);
  }

  wrap.append(el('p', 'fineprint', 'Stored on this device only. Nothing is sent anywhere.'));
  return wrap;
}

/* ── Medical ───────────────────────────────────────────── */

// The card you hope never to need. Filled in once, shown large, and phrased in
// the local language so a paramedic or pharmacist can read it.

const MED_FIELDS = [
  { key: 'blood', label: 'Blood type', hint: 'e.g. A Rh+' },
  { key: 'allergies', label: 'Allergies', hint: 'e.g. penicillin, nuts' },
  { key: 'meds', label: 'Medication taken', hint: 'name and dose' },
  { key: 'conditions', label: 'Conditions', hint: 'e.g. asthma, diabetes' },
  { key: 'contact', label: 'Emergency contact', hint: 'name' },
  { key: 'contactPhone', label: 'Their number', hint: 'with country code' },
];

// Field labels in the languages the phrase table covers, so the card reads
// natively rather than in English with a flag on it.
const MED_LABELS = {
  blood: { en: 'Blood type', de: 'Blutgruppe', pl: 'Grupa krwi', it: 'Gruppo sanguigno', fr: 'Groupe sanguin', es: 'Grupo sanguíneo', cs: 'Krevní grupa', nl: 'Bloedgroep' },
  allergies: { en: 'Allergies', de: 'Allergien', pl: 'Alergie', it: 'Allergie', fr: 'Allergies', es: 'Alergias', cs: 'Alergie', nl: 'Allergieën' },
  meds: { en: 'Medication', de: 'Medikamente', pl: 'Leki', it: 'Farmaci', fr: 'Médicaments', es: 'Medicamentos', cs: 'Léky', nl: 'Medicijnen' },
  conditions: { en: 'Conditions', de: 'Erkrankungen', pl: 'Choroby', it: 'Patologie', fr: 'Maladies', es: 'Enfermedades', cs: 'Nemoci', nl: 'Aandoeningen' },
  contact: { en: 'Emergency contact', de: 'Notfallkontakt', pl: 'Kontakt awaryjny', it: 'Contatto di emergenza', fr: 'Contact d\'urgence', es: 'Contacto de emergencia', cs: 'Kontakt pro případ nouze', nl: 'Noodcontact' },
  contactPhone: { en: 'Phone', de: 'Telefon', pl: 'Telefon', it: 'Telefono', fr: 'Téléphone', es: 'Teléfono', cs: 'Telefon', nl: 'Telefoon' },
};

const medLabel = (key, code) => (MED_LABELS[key] && MED_LABELS[key][code]) || MED_LABELS[key].en;

function medicalSection() {
  const c = country(state.country);
  const target = c.langs[0];
  const wrap = el('div');
  const filled = MED_FIELDS.filter((f) => state.medical[f.key]);

  const show = el('article', 'card');
  show.append(el('h2', 'card-title', 'Medical card'));
  if (!filled.length) {
    show.append(el('p', 'card-note', 'Fill this in once and it can be shown to a paramedic or pharmacist in the local language. Stored only on this device.'));
  } else {
    const f = el('div', 'card-foot');
    const b = el('button', 'go compact', `Show in ${lang(target).native}`);
    b.addEventListener('click', () => showMedical(target));
    f.append(b);
    show.append(el('p', 'card-note', `${filled.length} of ${MED_FIELDS.length} filled in.`), f);
  }
  wrap.append(show);

  const form = el('article', 'card');
  form.append(el('p', 'card-sub', 'Details'));
  for (const fld of MED_FIELDS) {
    const l = el('label', 'medfield');
    l.append(el('span', 'medlabel', fld.label));
    const i = el('input', 'textfield');
    i.value = state.medical[fld.key] || '';
    i.placeholder = fld.hint;
    i.addEventListener('change', () => {
      state.medical[fld.key] = i.value.trim();
      save();
    });
    l.append(i);
    form.append(l);
  }
  const ff = el('div', 'card-foot');
  const clr = el('button', 'ghost', 'Erase everything');
  clr.addEventListener('click', () => {
    for (const k of Object.keys(state.medical)) state.medical[k] = '';
    save();
    render();
  });
  ff.append(clr);
  form.append(ff);
  wrap.append(form);

  wrap.append(el('p', 'fineprint', 'Never leaves the device and is never sent with a translation. Erasing it here erases it for good.'));
  return wrap;
}

function showMedical(targetCode) {
  const scrim = el('div', 'bigcard');
  const panel = el('div', 'bigcard-panel');
  const head = el('div', 'bigcard-head');
  head.append(el('span', 'card-sub', `Medical · ${lang(targetCode).native}`));
  const close = el('button', 'ghost', 'Close');
  close.addEventListener('click', () => scrim.remove());
  head.append(close);

  const plate = el('div', 'plate');
  plate.append(el('span', 'plate-route', lang(targetCode).native));
  const list = el('div', 'medcard');
  for (const fld of MED_FIELDS) {
    const v = state.medical[fld.key];
    if (!v) continue;
    const rowEl = el('div', 'medrow');
    rowEl.append(el('span', 'medrow-k', medLabel(fld.key, targetCode)));
    rowEl.append(el('span', 'medrow-v', v));
    list.append(rowEl);
  }
  plate.append(list);

  panel.append(head, plate);
  scrim.append(panel);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

/* ── Packing ───────────────────────────────────────────── */

const PACK_LIST = {
  Documents: ['Passport or ID', 'EHIC / insurance card', 'Travel insurance details', 'Booking confirmations', 'Photo of passport on phone', 'Some cash in local currency'],
  Electronics: ['Phone charger', 'Power bank', 'Plug adapter', 'Headphones', 'Charging cable spare'],
  Health: ['Painkillers', 'Plasters', 'Sun cream', 'Any prescription medicine', 'Motion sickness tablets'],
  Clothes: ['Comfortable walking shoes', 'Rain jacket', 'Layer for evenings', 'Swimwear', 'Spare socks'],
  Useful: ['Reusable water bottle', 'Tote or day bag', 'Sunglasses', 'Umbrella', 'Snacks for travel days'],
};

function packSection() {
  const wrap = el('div');
  const total = Object.values(PACK_LIST).flat().length + state.extras.length;
  const done = Object.keys(state.packed).filter((k) => state.packed[k]).length;

  const head = el('article', 'card');
  head.append(el('h2', 'card-title', 'Packing'));
  head.append(el('p', 'card-note', `${done} of ${total} ticked. Saved on this device, no network at all.`));
  const bar = el('div', 'meter');
  const fill = el('span');
  fill.style.width = `${total ? (done / total) * 100 : 0}%`;
  bar.append(fill);
  head.append(bar);
  const hf = el('div', 'card-foot');
  const reset = el('button', 'ghost', 'Untick everything');
  reset.addEventListener('click', () => { state.packed = {}; save(); render(); });
  hf.append(reset);
  head.append(hf);
  wrap.append(head);

  const item = (name) => {
    const li = el('li');
    const lbl = el('label', 'packrow');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!state.packed[name];
    box.addEventListener('change', () => {
      if (box.checked) state.packed[name] = 1; else delete state.packed[name];
      save();
      const d = Object.keys(state.packed).filter((k) => state.packed[k]).length;
      fill.style.width = `${total ? (d / total) * 100 : 0}%`;
      lbl.classList.toggle('is-done', box.checked);
    });
    if (box.checked) lbl.classList.add('is-done');
    lbl.append(box, el('span', null, name));
    li.append(lbl);
    return li;
  };

  for (const [group, items] of Object.entries(PACK_LIST)) {
    const card = el('article', 'card');
    card.append(el('p', 'card-sub', group));
    const ul = el('ul', 'strip-list');
    for (const name of items) ul.append(item(name));
    card.append(ul);
    wrap.append(card);
  }

  const mine = el('article', 'card');
  mine.append(el('p', 'card-sub', 'Yours'));
  const ul = el('ul', 'strip-list');
  for (const name of state.extras) ul.append(item(name));
  mine.append(ul);
  const add = el('input', 'textfield');
  add.placeholder = 'Add something and press enter';
  add.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = add.value.trim();
    if (!v || state.extras.includes(v)) return;
    state.extras.push(v);
    save();
    render();
  });
  mine.append(add);
  wrap.append(mine);

  return wrap;
}

/* ── Nearby ────────────────────────────────────────────── */

// Handing off to the phone's own maps app costs this app nothing: no tiles, no
// API key, no rate limits, and it can use maps you already downloaded offline.
// The trick worth having is searching in the local language.

// The target language lives in the app's own settings, not the guide's state.
// Read it at call time so changing it in the header takes effect immediately.
const appTarget = () => settings.get('target') || 'pl';

const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

function mapsUrl(term, coords) {
  const q = encodeURIComponent(term);
  if (isApple()) {
    return coords
      ? `https://maps.apple.com/?q=${q}&sll=${coords.lat},${coords.lon}&z=15`
      : `https://maps.apple.com/?q=${q}`;
  }
  return coords
    ? `https://www.google.com/maps/search/${q}/@${coords.lat},${coords.lon},15z`
    : `https://www.google.com/maps/search/${q}`;
}

function nearbySection() {
  const c = country(state.country);
  const target = c.langs[0];
  const wrap = el('div');

  const card = el('article', 'card');
  card.append(el('h2', 'card-title', 'Find something nearby'));
  card.append(el('p', 'card-note',
    'Tap a category to list what is actually around you, closest first. Then tap a result to open it in ' +
    `${isApple() ? 'Apple Maps' : 'Google Maps'} for directions — that part is free and works offline.`));

  const status = el('p', 'card-sub', state.coords
    ? `Around ${state.coords.lat}, ${state.coords.lon}`
    : 'Needs your location.');
  card.append(status);

  const results = el('ul', 'strip-list');
  const resultHead = el('p', 'resulthead');
  resultHead.hidden = true;
  const grid = el('div', 'nearbygrid');
  let active = null;

  const show = async (item) => {
    if (!state.coords) { status.textContent = 'Allow location first.'; return; }
    active = item.id;
    [...grid.children].forEach((n) => n.classList.toggle('is-on', n.dataset.id === item.id));
    const term = nearbyTerm(item, target);

    const hit = item.osm ? Over.cached(item.osm, state.coords, 1200) : null;
    resultHead.hidden = false;
    resultHead.textContent = `${item.icon}  ${item.en}`;
    results.replaceChildren(el('li', null, hit ? 'Loading…' : `Looking for ${term}…`));

    if (!item.osm) {
      results.replaceChildren();
      window.open(mapsUrl(term, state.coords), '_blank');
      return;
    }

    try {
      const places = await Over.nearby(item.osm, state.coords, {
        onWait: (secs) => {
          results.replaceChildren(el('li', null,
            `Still asking OpenStreetMap… ${secs}s. It is a shared service and can be slow.`));
        },
      });
      if (!places.length) {
        resultHead.textContent = `${item.icon}  ${item.en} — nothing within 900 m`;
        results.replaceChildren(el('li', null,
          `Not everything is tagged in OpenStreetMap. Searching maps for "${term}" may still find one.`));
        return;
      }
      resultHead.hidden = false;
      resultHead.textContent = `${item.icon}  ${item.en} — ${places.length} within 900 m · tap for directions`;
      status.textContent = `Around ${state.coords.lat}, ${state.coords.lon}`;
      results.replaceChildren(...places.slice(0, 25).map((pl) => {
        const li = el('li');
        const a = el('a', 'row');
        // Navigation goes to the maps app: it does turn-by-turn and works offline.
        a.href = isApple()
          ? `https://maps.apple.com/?daddr=${pl.lat},${pl.lon}&dirflg=w`
          : `https://www.google.com/maps/dir/?api=1&destination=${pl.lat},${pl.lon}&travelmode=walking`;
        a.rel = 'noopener';
        a.append(el('span', 'row-out', `${pl.name} — ${Over.metresLabel(pl.metres)}`));
        const detail = Over.describe(pl);
        if (detail) a.append(el('span', 'row-in', detail));
        li.append(a);
        return li;
      }));
    } catch (err) {
      // A dead mirror should not be a dead end — the maps handoff still works.
      const li = el('li');
      const msg = el('div', 'row');
      msg.append(el('span', 'row-out', err && err.message ? err.message : String(err)));
      li.append(msg);

      const li2 = el('li');
      const a = el('a', 'row');
      a.href = mapsUrl(term, state.coords || null);
      a.rel = 'noopener';
      a.append(el('span', 'row-out', `Search maps for "${term}" instead`));
      a.append(el('span', 'row-in', 'Opens your maps app, which is not affected'));
      li2.append(a);

      results.replaceChildren(li, li2);
    }
  };

  for (const item of NEARBY) {
    const b = el('button', 'nearbycell');
    b.type = 'button';
    b.dataset.id = item.id;
    b.append(el('span', 'nearbycell-i', item.icon));
    b.append(el('span', 'nearbycell-n', item.en));
    b.append(el('span', 'nearbycell-t', nearbyTerm(item, target)));
    b.addEventListener('click', () => show(item));
    grid.append(b);
  }
  card.append(grid, resultHead, results);

  const foot = el('div', 'card-foot');
  const locBtn = el('button', 'go compact', state.coords ? 'Update my location' : 'Use my location');
  locBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { status.textContent = 'This browser has no location access.'; return; }
    locBtn.disabled = true;
    locBtn.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.coords = { lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5) };
        save();
        render();
      },
      (err) => {
        locBtn.disabled = false;
        locBtn.textContent = 'Try again';
        status.textContent = err.code === 1
          ? 'Location denied. Category taps will search maps instead.'
          : 'Could not get a location fix.';
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
  foot.append(locBtn);
  card.append(foot);
  wrap.append(card);

  const own = el('article', 'card');
  own.append(el('h2', 'card-title', 'Before you lose signal'));
  own.append(el('p', 'card-note', isApple()
    ? 'Apple Maps can download an area for offline use: Maps, tap your profile picture, then Offline Maps. Do it on Wi-Fi and navigation keeps working with no data.'
    : 'Google Maps can download an offline area from your profile menu.'));
  wrap.append(own);

  wrap.append(el('p', 'fineprint',
    'Places from OpenStreetMap via Overpass, cached for an hour so repeat taps cost nothing. Directions hand off to your maps app, which does them better and offline.'));
  return wrap;
}

/* ── Map ───────────────────────────────────────────────── */

// Kept behind an explicit tap. MapLibre is ~550 KB and a cold map view is about
// a megabyte of tiles on top, which is real money on a metered connection.

function mapSection() {
  const c = country(state.country);
  const wrap = el('div');

  const card = el('article', 'card');
  card.append(el('h2', 'card-title', 'Map'));

  const meta = el('p', 'card-note');
  // The estimate caveat belongs on a byte figure, not on "Looking for…".
  const setMeta = (extra, withBytes = false) => {
    const est = withBytes && Maps.mapMetering.anyEstimated
      ? ' Some sizes are estimated — the tile server does not expose exact transfer sizes.'
      : '';
    meta.textContent = (extra || '') + est;
  };

  const holder = el('div', 'mapholder');
  const search = el('input', 'textfield');
  search.type = 'search';
  search.placeholder = `Search places in ${c.name}`;
  search.autocapitalize = 'none';
  search.spellcheck = false;
  search.disabled = true;

  const results = el('ul', 'strip-list');

  const onBytes = () => { setMeta(`${formatBytes(budget.breakdown().map || 0)} of map traffic so far.`, true); };

  const load = async () => {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading map…';
    try {
      await Maps.createMap(holder, state.coords, 'positron', onBytes);
      loadBtn.remove();
      search.disabled = false;
      [...catRow.children].forEach((n) => { n.disabled = false; });
      holder.classList.add('is-live');
      setMeta('Map loaded. Panning and zooming fetches more tiles.');
    } catch (err) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Try again';
      setMeta(err && err.message ? err.message : String(err));
    }
  };

  const loadBtn = el('button', 'go compact',
    `Load map (~${formatBytes(Maps.coldEstimate())} first time)`);
  loadBtn.addEventListener('click', () => {
    if (!Maps.canAffordMap()) {
      setMeta(`A cold map needs about ${formatBytes(Maps.coldEstimate())} and only ${formatBytes(budget.remainingBytes())} is left. Raise the ceiling in Data or wait.`);
      return;
    }
    load();
  });

  // Category pins, using the same OSM lookups as the Nearby tab.
  const catRow = el('div', 'chips');
  for (const item of NEARBY) {
    if (!item.osm) continue;
    const b = el('button', 'chip', `${item.icon} ${item.en}`);
    b.type = 'button';
    b.disabled = true;
    b.addEventListener('click', async () => {
      if (!state.coords) { setMeta('Allow location on the Nearby tab first.'); return; }
      [...catRow.children].forEach((n) => n.classList.remove('is-on'));
      b.classList.add('is-on');
      setMeta(`Looking for ${item.en.toLowerCase()}…`);
      try {
        const places = await Over.nearby(item.osm, state.coords);
        Maps.clearMarkers();
        for (const pl of places) Maps.addMarker(pl.lat, pl.lon, `${pl.name} — ${Over.metresLabel(pl.metres)}`);
        if (places.length) Maps.fitTo(places);
        results.replaceChildren(...places.slice(0, 25).map((pl) => {
          const li = el('li');
          const bb = el('button', 'row');
          bb.type = 'button';
          bb.append(el('span', 'row-out', `${pl.name} — ${Over.metresLabel(pl.metres)}`));
          const d = Over.describe(pl);
          if (d) bb.append(el('span', 'row-in', d));
          bb.addEventListener('click', () => Maps.flyTo(pl.lat, pl.lon, 17));
          li.append(bb);
          return li;
        }));
        setMeta(`${places.length} found. ${formatBytes(budget.breakdown().map || 0)} of map traffic so far.`, true);
      } catch (err) {
        setMeta(err && err.message ? err.message : String(err));
      }
    });
    catRow.append(b);
  }

  let searchTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = search.value.trim();
    if (q.length < 3) { results.replaceChildren(); return; }
    // Photon asks for reasonable request volumes, so this waits for a pause
    // rather than firing on every keystroke.
    searchTimer = setTimeout(() => runSearch(q), 700);
  });

  const runSearch = async (q) => {
    results.replaceChildren(el('li', null, 'Searching…'));
    try {
      const found = await Maps.searchPlaces(q, state.coords, c.langs[0]);
      onBytes();
      if (!found.length) { results.replaceChildren(el('li', null, 'Nothing found.')); return; }
      Maps.clearMarkers();
      for (const r of found) Maps.addMarker(r.lat, r.lon, r.name);
      Maps.fitTo(found);
      results.replaceChildren(...found.map((r) => {
        const li = el('li');
        const b = el('button', 'row');
        b.type = 'button';
        b.append(el('span', 'row-out', r.name));
        b.append(el('span', 'row-in', r.detail));
        b.addEventListener('click', () => Maps.flyTo(r.lat, r.lon));
        li.append(b);
        return li;
      }));
    } catch (err) {
      results.replaceChildren(el('li', null, err && err.message ? err.message : String(err)));
    }
  };

  card.append(holder, loadBtn, catRow, search, results, meta);
  setMeta(Maps.mapLoaded() ? '' : 'Nothing loads until you tap.');
  wrap.append(card);

  wrap.append(el('p', 'fineprint',
    'Tiles from OpenFreeMap, search from Photon, data © OpenStreetMap contributors. Both services are keyless and free; Photon is a public demo, so searches are deliberately throttled to one per pause in typing. For turn-by-turn navigation use the Nearby tab — your maps app does it better and offline.'));
  return wrap;
}

/* ── Explore ───────────────────────────────────────────── */

// Needs a connection. A few kilobytes a call, no images — thumbnails would cost
// more than every text request here put together.

function exploreSection() {
  const c = country(state.country);
  const wrap = el('div');

  if (!state.coords) {
    const card = el('article', 'card');
    card.append(el('h2', 'card-title', 'Explore'));
    card.append(el('p', 'card-note', 'Needs your location. Allow it on the Nearby tab and this fills in.'));
    wrap.append(card);
    return wrap;
  }

  // What am I looking at?
  const near = el('article', 'card');
  near.append(el('h2', 'card-title', 'What is around me'));
  near.append(el('p', 'card-note', 'Wikipedia articles with coordinates within a kilometre. Useful when you are standing in front of something with no plaque.'));
  const nearList = el('ul', 'strip-list');
  const nearNote = el('p', 'card-sub', '');
  const nearFoot = el('div', 'card-foot');
  const nearBtn = el('button', 'go compact', 'Look around (~4 KB)');

  nearBtn.addEventListener('click', async () => {
    nearBtn.disabled = true;
    nearBtn.textContent = 'Looking…';
    try {
      const found = await Explore.around(state.coords);
      if (!found.length) {
        nearNote.textContent = 'Nothing catalogued within a kilometre.';
      } else {
        nearNote.textContent = `${found.length} nearby, closest first.`;
        nearList.replaceChildren(...found.map((f) => {
          const li = el('li');
          const b = el('button', 'row');
          b.type = 'button';
          b.append(el('span', 'row-out', f.title));
          b.append(el('span', 'row-in', Explore.metres(f.metres)));
          b.addEventListener('click', () => showArticle(f.title, c.langs[0]));
          li.append(b);
          return li;
        }));
      }
      nearBtn.textContent = 'Look again';
    } catch (err) {
      nearNote.textContent = err && err.message ? err.message : String(err);
      nearBtn.textContent = 'Try again';
    }
    nearBtn.disabled = false;
  });

  nearFoot.append(nearBtn);
  near.append(nearNote, nearList, nearFoot);
  wrap.append(near);

  // Where am I, per Wikivoyage.
  const city = el('article', 'card');
  city.append(el('h2', 'card-title', 'City guide'));
  city.append(el('p', 'card-note', 'Wikivoyage writes for travellers rather than encyclopaedists, so this is where the practical advice is.'));
  const cityBody = el('div');
  const cityNote = el('p', 'card-sub', '');
  const cityFoot = el('div', 'card-foot');
  const cityBtn = el('button', 'go compact', 'Find where I am');

  cityBtn.addEventListener('click', async () => {
    cityBtn.disabled = true;
    cityBtn.textContent = 'Looking…';
    try {
      const dests = await Explore.nearestDestinations(state.coords);
      if (!dests.length) {
        cityNote.textContent = 'No Wikivoyage destination within 10 km.';
      } else {
        cityNote.textContent = '';
        cityBody.replaceChildren(...dests.map((d) => {
          const b = el('button', 'row');
          b.type = 'button';
          b.append(el('span', 'row-out', d.title));
          b.append(el('span', 'row-in', Explore.metres(d.metres)));
          b.addEventListener('click', () => showDestination(d.title));
          return b;
        }));
      }
      cityBtn.textContent = 'Look again';
    } catch (err) {
      cityNote.textContent = err && err.message ? err.message : String(err);
      cityBtn.textContent = 'Try again';
    }
    cityBtn.disabled = false;
  });

  cityFoot.append(cityBtn);
  city.append(cityNote, cityBody, cityFoot);
  wrap.append(city);

  wrap.append(el('p', 'fineprint',
    'Wikipedia and Wikivoyage, CC BY-SA. Keyless, no images fetched. Every panel says what it will cost before you tap it.'));
  return wrap;
}

/* Full-screen reader for an article, with a translate button. */
function showArticle(title, targetCode) {
  const scrim = el('div', 'bigcard');
  const panel = el('div', 'bigcard-panel');
  const head = el('div', 'bigcard-head');
  head.append(el('span', 'card-sub', title));
  const close = el('button', 'ghost', 'Close');
  close.addEventListener('click', () => scrim.remove());
  head.append(close);

  const body = el('p', 'readtext', 'Loading…');
  const foot = el('div', 'card-foot');
  panel.append(head, body, foot);
  scrim.append(panel);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);

  Explore.extract(title).then((r) => {
    body.textContent = r.text || 'No summary available.';

    const open = el('a', 'ghost', 'Open on Wikipedia');
    open.href = Explore.articleUrl(title);
    open.target = '_blank';
    open.rel = 'noopener';
    foot.append(open);

    if (r.text) {
      const cost = r.text.length;
      const left = translator.charBudget ? translator.charBudget.remaining() : null;
      const tr = el('button', 'go compact', `Translate (${cost} chars)`);
      if (left != null && cost > left) {
        tr.disabled = true;
        tr.textContent = `Needs ${cost} chars, ${left} left today`;
      }
      tr.addEventListener('click', async () => {
        tr.disabled = true;
        tr.textContent = 'Translating…';
        try {
          const out = await translator.translate(r.text, 'en', appTarget()).promise;
          body.textContent = out;
          tr.remove();
        } catch (err) {
          tr.disabled = false;
          tr.textContent = 'Try again';
          body.append(el('span', 'card-note', err && err.message ? err.message : String(err)));
        }
      });
      foot.append(tr);
    }
  }).catch((err) => { body.textContent = err && err.message ? err.message : String(err); });
}

/* Wikivoyage destination with its practical sections. */
function showDestination(title) {
  const scrim = el('div', 'bigcard');
  const panel = el('div', 'bigcard-panel');
  const head = el('div', 'bigcard-head');
  head.append(el('span', 'card-sub', title));
  const close = el('button', 'ghost', 'Close');
  close.addEventListener('click', () => scrim.remove());
  head.append(close);

  const body = el('p', 'readtext', 'Loading…');
  const chips = el('div', 'chips');
  const sectionBody = el('p', 'readtext');
  const foot = el('div', 'card-foot');
  panel.append(head, body, chips, sectionBody, foot);
  scrim.append(panel);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);

  Explore.destinationSummary(title).then((r) => {
    body.textContent = r.text || 'No summary available.';
    const open = el('a', 'ghost', 'Open on Wikivoyage');
    open.href = r.url;
    open.target = '_blank';
    open.rel = 'noopener';
    foot.append(open);

    for (const name of Explore.VOYAGE_SECTIONS) {
      const b = el('button', 'chip', name);
      b.type = 'button';
      b.addEventListener('click', async () => {
        [...chips.children].forEach((x) => x.classList.remove('is-on'));
        b.classList.add('is-on');
        sectionBody.textContent = 'Loading…';
        try {
          const sec = await Explore.destinationSection(title, name);
          sectionBody.textContent = sec && sec.text ? sec.text : `No "${name}" section on this page.`;
        } catch (err) {
          sectionBody.textContent = err && err.message ? err.message : String(err);
        }
      });
      chips.append(b);
    }
  }).catch((err) => { body.textContent = err && err.message ? err.message : String(err); });
}

/* ── Emergency ─────────────────────────────────────────── */

function emergencySection() {
  const c = country(state.country);
  const wrap = el('div');

  const call = el('article', 'card');
  call.append(el('h2', 'card-title', `Emergency in ${c.name}`));

  const big = el('a', 'bignum');
  big.href = `tel:${c.emergency.general}`;
  big.append(el('span', 'bignum-n', c.emergency.general));
  big.append(el('span', 'bignum-l', 'tap to call'));
  call.append(big);

  const grid = el('div', 'numgrid');
  for (const [k, v] of [['Police', c.emergency.police], ['Fire', c.emergency.fire], ['Ambulance', c.emergency.ambulance]]) {
    const a = el('a', 'numcell');
    a.href = `tel:${v}`;
    a.append(el('span', 'numcell-l', k), el('span', 'numcell-n', v));
    grid.append(a);
  }
  call.append(grid);
  call.append(el('p', 'card-note', '112 reaches emergency services across the EU and works even with no SIM or a locked phone.'));

  const near = el('div', 'card-foot');
  for (const id of ['hospital', 'pharmacy']) {
    const item = NEARBY.find((n) => n.id === id);
    const term = nearbyTerm(item, c.langs[0]);
    const a = el('a', 'go compact', `Nearest ${item.en.toLowerCase()}`);
    a.href = mapsUrl(term, state.coords || null);
    a.rel = 'noopener';
    near.append(a);
  }
  call.append(near);
  wrap.append(call);

  // Phrases you cannot afford to be fumbling with a translator for.
  const target = c.langs[0];
  const say = el('article', 'card');
  say.append(el('h2', 'card-title', 'Show someone'));
  const have = !!PHRASE_COL[target];
  say.append(el('p', 'card-note', have
    ? `Tap to enlarge, in ${lang(target).native}.`
    : `Built-in phrases cover English, German and Polish only. These show in English — tap one and translate it into ${lang(target).native}.`));
  const list = el('ul', 'strip-list');
  for (const en of EMERGENCY_PHRASES) {
    const row = PHRASES.find((p) => p[1] === en);
    if (!row) continue;
    const li = el('li');
    const b = el('button', 'row');
    b.type = 'button';
    const shown = phraseFor(row, target);
    b.append(el('span', 'row-out', shown.text));
    b.append(el('span', 'row-in', en));
    b.addEventListener('click', () => showBig(row, target, en));
    li.append(b);
    list.append(li);
  }
  say.append(list);
  wrap.append(say);

  const filled = MED_FIELDS.filter((f) => state.medical[f.key]);
  const med = el('article', 'card');
  med.append(el('h2', 'card-title', 'Medical card'));
  const mf = el('div', 'card-foot');
  if (filled.length) {
    med.append(el('p', 'card-note', `Allergies, medication and an emergency contact, ready to show in ${lang(target).native}.`));
    const b = el('button', 'go compact', 'Show it');
    b.addEventListener('click', () => showMedical(target));
    mf.append(b);
  } else {
    med.append(el('p', 'card-note', 'Not filled in. Two minutes now could matter a lot later.'));
    const b = el('button', 'go compact', 'Fill it in');
    b.addEventListener('click', () => { state.section = 'medical'; save(); render(); });
    mf.append(b);
  }
  med.append(mf);
  wrap.append(med);

  return wrap;
}

/* ── Money ─────────────────────────────────────────────── */

const HOME_OPTIONS = ['PLN', 'EUR', 'CZK', 'GBP', 'USD', 'CHF', 'SEK', 'HUF'];

function moneySection() {
  const c = country(state.country);
  const wrap = el('div');
  const card = el('article', 'card');
  card.append(el('h2', 'card-title', 'Currency'));

  const row = el('div', 'convrow');
  const amount = el('input', 'convinput');
  amount.type = 'number';
  amount.inputMode = 'decimal';
  amount.value = state.amount;
  amount.setAttribute('aria-label', 'Amount');

  const from = el('select', 'gselect small');
  for (const code of HOME_OPTIONS) {
    const o = el('option', null, code);
    o.value = code;
    if (code === state.home) o.selected = true;
    from.append(o);
  }

  const arrow = el('span', 'convarrow', '→');
  const result = el('div', 'convresult', '—');

  row.append(amount, from, arrow);
  card.append(row, result);

  const meta = el('p', 'card-note');
  card.append(meta);

  const update = () => {
    state.amount = parseFloat(amount.value) || 0;
    state.home = from.value;
    save();
    const target = c.currency.code;
    if (state.home === target) {
      result.textContent = `Same currency — ${c.currency.name} is used here.`;
      meta.textContent = '';
      return;
    }
    const rate = rateBetween(state.home, target);
    if (rate == null) {
      result.textContent = '—';
      meta.textContent = rates
        ? `No rate for ${state.home}→${target} in the cached set.`
        : 'No rates yet. Fetch them below — about 1 KB.';
      return;
    }
    const value = state.amount * rate;
    result.textContent = `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.currency.symbol}`;
    const age = Math.round((Date.now() - rates.at) / 3600000);
    meta.textContent = `1 ${state.home} = ${rate.toFixed(4)} ${target} · ${rates.source}, ${age < 1 ? 'just now' : `${age} h ago`}`;
  };

  amount.addEventListener('input', update);
  from.addEventListener('change', update);

  const foot = el('div', 'card-foot');
  const fetchBtn = el('button', 'go compact', rates ? 'Refresh rates' : 'Get rates (~1 KB)');
  fetchBtn.addEventListener('click', async () => {
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching…';
    try {
      await fetchRates(state.home);
      toast('Rates updated');
      render();
    } catch (err) {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Try again';
      meta.textContent = err.message;
    }
  });
  foot.append(fetchBtn);
  card.append(foot);

  wrap.append(card);

  // A calculator that keeps both currencies on screen, so no mental arithmetic
  // is needed at the till. Sequential evaluation, like a phone calculator.
  const calc = el('article', 'card');
  calc.append(el('h2', 'card-title', 'Work it out'));
  const calcMain = el('div', 'calcdisplay');
  const calcLocal = el('span', 'calc-local', '0');
  const calcHome = el('span', 'calc-home', '');
  const calcExpr = el('span', 'calc-expr', '');
  calcMain.append(calcExpr, calcLocal, calcHome);
  calc.append(calcMain);

  let entry = '0';
  let acc = null;
  let pending = null;

  const toHomeRate = () => rateBetween(c.currency.code, state.home);

  const paintCalc = () => {
    const v = parseFloat(entry) || 0;
    calcLocal.textContent = `${entry} ${c.currency.symbol}`;
    const r = toHomeRate();
    calcHome.textContent = state.home === c.currency.code
      ? ''
      : r != null ? `≈ ${(v * r).toFixed(2)} ${state.home}` : `no ${state.home} rate cached`;
    calcExpr.textContent = pending ? `${acc} ${pending}` : '';
  };

  const apply = () => {
    const v = parseFloat(entry) || 0;
    if (acc == null || !pending) return v;
    if (pending === '+') return acc + v;
    if (pending === '−') return acc - v;
    if (pending === '×') return acc * v;
    if (pending === '÷') return v === 0 ? 0 : acc / v;
    return v;
  };

  const keys = [
    ['7', '8', '9', '÷'],
    ['4', '5', '6', '×'],
    ['1', '2', '3', '−'],
    ['.', '0', 'C', '+'],
  ];
  const pad = el('div', 'calcpad');
  for (const rowKeys of keys) {
    for (const k of rowKeys) {
      const b = el('button', `calckey${'+−×÷'.includes(k) ? ' is-op' : ''}${k === 'C' ? ' is-clear' : ''}`, k);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (k === 'C') { entry = '0'; acc = null; pending = null; }
        else if ('+−×÷'.includes(k)) {
          acc = apply();
          pending = k;
          entry = '0';
        } else if (k === '.') {
          if (!entry.includes('.')) entry += '.';
        } else {
          entry = entry === '0' ? k : entry + k;
        }
        paintCalc();
      });
      pad.append(b);
    }
  }
  const eq = el('button', 'calckey is-eq', '=');
  eq.type = 'button';
  eq.addEventListener('click', () => {
    const r = apply();
    entry = String(Math.round(r * 100) / 100);
    acc = null;
    pending = null;
    paintCalc();
  });
  pad.append(eq);

  const addSpend = el('button', 'calckey is-add', 'Log it');
  addSpend.type = 'button';
  addSpend.addEventListener('click', () => {
    const v = parseFloat(entry);
    if (!Number.isFinite(v) || v <= 0) return;
    state.spend.unshift({ amount: v, cur: c.currency.code, note: 'from calculator', at: Date.now() });
    save();
    toast(`Logged ${v.toFixed(2)} ${c.currency.symbol} to spending`);
  });
  pad.append(addSpend);

  calc.append(pad);
  paintCalc();
  wrap.append(calc);

  // The rate itself, plus the number you actually multiply by in your head.
  const rateCard = el('article', 'card');
  rateCard.append(el('h2', 'card-title', 'Rate'));
  const rateBody = el('div');
  rateCard.append(rateBody);

  const paintRate = () => {
    rateBody.replaceChildren();
    const target = c.currency.code;
    if (state.home === target) {
      rateBody.append(el('p', 'card-note', `${c.currency.name} is your own currency here — nothing to convert.`));
      return;
    }
    const toLocal = rateBetween(state.home, target);   // home -> local
    const toHome = rateBetween(target, state.home);    // local -> home
    if (toLocal == null || toHome == null) {
      rateBody.append(el('p', 'card-note', 'No rates cached yet. Fetch them above.'));
      return;
    }

    // Both directions, exact, straight from whichever source answered.
    const pair = el('div', 'numgrid');
    for (const [label, line] of [
      [`1 ${state.home} buys`, `${toLocal.toFixed(4)} ${target}`],
      [`1 ${target} buys`, `${toHome.toFixed(4)} ${state.home}`],
    ]) {
      const cell = el('div', 'numcell');
      cell.append(el('span', 'numcell-l', label), el('span', 'numcell-n', line));
      pair.append(cell);
    }
    rateBody.append(pair);

    // The mental shortcut. Rounded to something you can hold in your head, with
    // the error stated so you know which way you are wrong.
    const mult = toHome;

    // For a rate like 1 HUF = 0.0108 PLN, rounding the multiplier to 0.01 is 7%
    // out — bad enough to matter at a till. Below about 0.5 it is both more
    // accurate and more natural to divide, which is what people do anyway.
    let shortcutText;
    let shortcutBig;
    let effective;
    if (mult >= 0.5) {
      const r = mult >= 10 ? Math.round(mult) : Math.round(mult * 10) / 10;
      shortcutBig = `× ${r}`;
      shortcutText = `Multiply a ${target} price by ${r} to get ${state.home}.`;
      effective = r;
    } else {
      const d = 1 / mult;
      const r = d >= 100 ? Math.round(d / 5) * 5 : d >= 20 ? Math.round(d) : Math.round(d * 10) / 10;
      shortcutBig = `÷ ${r}`;
      shortcutText = `Divide a ${target} price by ${r} to get ${state.home}.`;
      effective = 1 / r;
    }
    const errPct = Math.abs((effective - mult) / mult) * 100;

    const shortcut = el('div', 'multbox');
    shortcut.append(el('span', 'mult-l', 'In your head'));
    shortcut.append(el('span', 'mult-n', shortcutBig));
    shortcut.append(el('span', 'mult-d', `${shortcutText} ` +
      (errPct < 0.5 ? 'Near exact.'
        : `About ${errPct.toFixed(1)}% ${effective > mult ? 'high' : 'low'} — rounded so you can do it standing up.`)));
    rateBody.append(shortcut);

    // Reference table for the amounts you actually see on price tags.
    const steps = [1, 2, 5, 10, 20, 50, 100];
    const table = el('ul', 'strip-list');
    for (const v of steps) {
      const li = el('li');
      const d = el('div', 'row');
      d.append(el('span', 'row-out', `${(v * toHome).toFixed(2)} ${state.home}`));
      d.append(el('span', 'row-in', `${v} ${target}`));
      li.append(d);
      table.append(li);
    }
    rateBody.append(table);

    const age = rates ? Math.round((Date.now() - rates.at) / 3600000) : null;
    rateBody.append(el('p', 'fineprint',
      `From ${rates ? rates.source : 'cache'}${age != null ? `, ${age < 1 ? 'under an hour' : `${age} h`} old` : ''}. ` +
      'Cards and cash machines apply their own spread, so treat this as the honest midpoint rather than what you will be charged.'));
  };
  paintRate();
  wrap.append(rateCard);

  const tip = el('article', 'card');
  tip.append(el('h2', 'card-title', 'Tipping'));
  tip.append(el('p', 'card-note', c.tipping));

  // Splitting a bill is the arithmetic you least want to do in your head after
  // dinner. No network needed.
  const split = el('div', 'splitrow');
  const bill = el('input', 'convinput');
  bill.type = 'number';
  bill.inputMode = 'decimal';
  bill.placeholder = 'Bill';
  bill.setAttribute('aria-label', 'Bill total');
  const people = el('input', 'convinput narrow');
  people.type = 'number';
  people.inputMode = 'numeric';
  people.min = '1';
  people.value = '2';
  people.setAttribute('aria-label', 'Number of people');
  split.append(bill, el('span', 'convarrow', '÷'), people);

  const pcts = el('div', 'pctrow');
  const outLine = el('p', 'card-sub', '');
  let pct = 10;
  const recalc = () => {
    const total = parseFloat(bill.value) || 0;
    const n = Math.max(1, parseInt(people.value, 10) || 1);
    if (!total) { outLine.textContent = ''; return; }
    const withTip = total * (1 + pct / 100);
    const each = withTip / n;
    const sym = c.currency.symbol;
    outLine.textContent = `${pct}% tip → ${withTip.toFixed(2)} ${sym} total · ${each.toFixed(2)} ${sym} each`;
  };
  for (const p of [0, 5, 10, 15]) {
    const b = el('button', `seg${p === pct ? ' is-on' : ''}`, p === 0 ? 'No tip' : `${p}%`);
    b.type = 'button';
    b.addEventListener('click', () => {
      pct = p;
      [...pcts.children].forEach((x, i) => x.classList.toggle('is-on', [0, 5, 10, 15][i] === p));
      recalc();
    });
    pcts.append(b);
  }
  bill.addEventListener('input', recalc);
  people.addEventListener('input', recalc);

  tip.append(split, pcts, outLine);
  wrap.append(tip);

  update();
  return wrap;
}

function rateBetween(from, to) {
  if (!rates || !rates.rates) return null;
  if (rates.base === from) return rates.rates[to] ?? null;
  // Cross via the cached base.
  const f = rates.base === from ? 1 : rates.rates[from];
  const t = rates.base === to ? 1 : rates.rates[to];
  if (!f || !t) return null;
  return t / f;
}

async function fetchRates(base) {
  const failures = [];
  for (const src of RATE_SOURCES) {
    const url = src.url(base);
    const projected = url.length + REQUEST_OVERHEAD + 3000;
    if (!budget.canSpend(projected)) {
      throw new Error(`Only ${formatBytes(budget.remainingBytes())} left in the meter.`);
    }
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const text = await res.text();
      budget.record(url.length + REQUEST_OVERHEAD + text.length, 'translation');
      if (!res.ok) { failures.push(`${src.name}: HTTP ${res.status}`); continue; }
      const table = src.parse(JSON.parse(text));
      if (!table || !Object.keys(table).length) { failures.push(`${src.name}: no rates in response`); continue; }
      rates = { base, rates: table, at: Date.now(), source: src.name };
      try { localStorage.setItem(RATE_KEY, JSON.stringify(rates)); } catch { /* ignore */ }
      return rates;
    } catch (err) {
      failures.push(`${src.name}: ${err && err.message ? err.message : err}`);
    }
  }
  throw new Error(`No rate source answered. ${failures.join(' | ')}`);
}

/* ── Essentials ────────────────────────────────────────── */

function basicsSection() {
  const c = country(state.country);
  const wrap = el('div');

  const power = el('article', 'card');
  power.append(el('h2', 'card-title', 'Power'));
  const plugs = c.power.plugs.split(', ');
  power.append(el('p', 'card-sub', `${c.power.volts} · ${c.power.hz} · type ${c.power.plugs}`));
  const pl = el('ul', 'strip-list');
  for (const p of plugs) {
    const li = el('li');
    const d = el('div', 'row');
    d.append(el('span', 'row-out', `Type ${p}`));
    d.append(el('span', 'row-in', PLUG_NOTES[p] || ''));
    li.append(d);
    pl.append(li);
  }
  power.append(pl);
  if (plugs.includes('G') || plugs.includes('J')) {
    power.append(el('p', 'card-note', 'This one is not compatible with a standard European plug — you need the right adapter.'));
  }
  wrap.append(power);

  const facts = el('article', 'card');
  facts.append(el('h2', 'card-title', 'Good to know'));
  const fl = el('ul', 'strip-list');
  const items = [
    ['Tap water', c.water],
    ['Driving', c.driving === 'left' ? 'On the left' : 'On the right'],
    ['Currency', `${c.currency.name} (${c.currency.code}, ${c.currency.symbol})`],
    ['Languages', c.langs.map((l) => lang(l).native).join(', ')],
  ];
  for (const [k, v] of items) {
    const li = el('li');
    const d = el('div', 'row');
    d.append(el('span', 'row-out', v));
    d.append(el('span', 'row-in', k));
    li.append(d);
    fl.append(li);
  }
  facts.append(fl);
  facts.append(el('p', 'card-note', c.notes));
  wrap.append(facts);

  const watch = WATCH[c.code] || [];
  if (watch.length) {
    const card = el('article', 'card');
    card.append(el('h2', 'card-title', 'Watch out for'));
    const ul = el('ul', 'watchlist');
    for (const w of watch) ul.append(el('li', null, w));
    card.append(ul);
    wrap.append(card);
  }

  const caveat = el('p', 'fineprint',
    'General guidance, stored offline. Customs vary by region and numbers do change — 112 is the safe default across the EU.');
  wrap.append(caveat);
  return wrap;
}

/* ── Menu ──────────────────────────────────────────────── */

// A glossary, not a translator. Machine translation turns "crudo" into "raw"
// and "coperto" into "covered", which tells you nothing useful at a table.

function menuSection() {
  const c = country(state.country);
  const wrap = el('div');

  if (c.code !== 'IT') {
    const card = el('article', 'card');
    card.append(el('h2', 'card-title', 'Menu decoder'));
    card.append(el('p', 'card-note',
      `Written for Italian menus. Nothing for ${c.name} yet — the Camera tab reads a menu in any language, it just will not explain the jargon.`));
    wrap.append(card);
    return wrap;
  }

  const head = el('article', 'card');
  head.append(el('h2', 'card-title', 'Menu decoder'));
  head.append(el('p', 'card-note',
    `${MENU_TERM_COUNT} Italian menu terms, offline. Search, or open a section below.`));
  const search = el('input', 'textfield');
  search.type = 'search';
  search.placeholder = 'coperto, crudo, vongole…';
  search.value = state.menuQuery;
  search.autocapitalize = 'none';
  search.spellcheck = false;
  head.append(search);
  const hits = el('ul', 'strip-list');
  head.append(hits);
  wrap.append(head);

  const paintHits = () => {
    const found = searchMenu(state.menuQuery);
    if (!state.menuQuery.trim()) { hits.replaceChildren(); return; }
    if (!found.length) {
      hits.replaceChildren(el('li', null, 'Not in the glossary. The Camera tab will translate it literally.'));
      return;
    }
    hits.replaceChildren(...found.slice(0, 20).map((f) => {
      const li = el('li');
      const d = el('div', 'row');
      d.append(el('span', 'row-out', `${f.term} — ${f.meaning}`));
      d.append(el('span', 'row-in', f.section));
      li.append(d);
      return li;
    }));
  };
  search.addEventListener('input', () => { state.menuQuery = search.value; save(); paintHits(); });
  paintHits();

  for (const section of MENU_SECTIONS) {
    const card = el('article', 'card');
    const open = state.menuOpen === section.id;

    const toggle = el('button', 'menuhead');
    toggle.type = 'button';
    toggle.append(el('span', 'menuhead-t', section.label));
    toggle.append(el('span', 'menuhead-c', open ? '−' : `${section.terms.length}`));
    toggle.addEventListener('click', () => {
      state.menuOpen = open ? '' : section.id;
      save();
      render();
    });
    card.append(toggle);

    if (open) {
      if (section.note) card.append(el('p', 'card-note', section.note));
      const ul = el('ul', 'strip-list');
      for (const [term, meaning] of section.terms) {
        const li = el('li');
        const b = el('button', 'row');
        b.type = 'button';
        b.append(el('span', 'row-out', term));
        b.append(el('span', 'row-in', meaning));
        b.addEventListener('click', () => {
          if (!speak(term, 'it')) toast('No Italian voice on this device', true);
        });
        li.append(b);
        ul.append(li);
      }
      card.append(ul);
    }
    wrap.append(card);
  }

  wrap.append(el('p', 'fineprint', 'Entirely offline. Tap a term to hear it said.'));
  return wrap;
}

/* ── Learn ─────────────────────────────────────────────── */

function learnSection() {
  const c = country(state.country);
  const target = c.langs[0];
  const home = 'pl';
  const from = state.learnFlip ? target : home;
  const to = state.learnFlip ? home : target;
  const wrap = el('div');

  if (!PHRASE_COL[target]) {
    const card = el('article', 'card');
    card.append(el('h2', 'card-title', 'Learn'));
    card.append(el('p', 'card-note',
      `The built-in phrases cover ${Object.keys(PHRASE_COL).map((k) => lang(k).native).join(', ')}. ` +
      `There is no written ${lang(target).native} to drill against yet, so flashcards are off for ${c.name}.`));
    wrap.append(card);
    return wrap;
  }

  const st = Learn.stats(from, to);

  const head = el('article', 'card');
  head.append(el('h2', 'card-title', `${lang(from).native} → ${lang(to).native}`));
  const bar = el('div', 'meter');
  const fill = el('span');
  fill.style.width = `${st.total ? (st.known / st.total) * 100 : 0}%`;
  bar.append(fill);
  head.append(bar);
  head.append(el('p', 'card-note',
    `${st.known} of ${st.total} known · ${st.started - st.known} still settling · ${st.untouched} not started.`));

  const dirBtn = el('button', 'ghost', `Swap direction (now ${lang(from).code.toUpperCase()}→${lang(to).code.toUpperCase()})`);
  dirBtn.addEventListener('click', () => { state.learnFlip = !state.learnFlip; save(); render(); });
  const hf = el('div', 'card-foot');
  hf.append(dirBtn);
  head.append(hf);
  wrap.append(head);

  // Category filter.
  const cats = el('div', 'chips');
  for (const cat of Learn.CATEGORIES) {
    const b = el('button', `chip${cat.id === state.learnCat ? ' is-on' : ''}`, cat.label);
    b.type = 'button';
    b.addEventListener('click', () => { state.learnCat = cat.id; save(); render(); });
    cats.append(b);
  }
  wrap.append(cats);

  const queue = Learn.due(from, to, state.learnCat);
  const cards = [...queue.review, ...queue.fresh];

  const card = el('article', 'card cardface');
  wrap.append(card);

  if (!cards.length) {
    card.append(el('p', 'card-title', 'Nothing due'));
    card.append(el('p', 'card-note', queue.freshTotal
      ? `${queue.freshTotal} phrases not started, but today's ${st.newPerDay} new ones are done. Come back tomorrow, or raise the daily limit below.`
      : 'Every phrase in this set is in rotation. Due cards will reappear as their intervals come round.'));
  } else {
    let i = 0;
    let revealed = false;

    const promptEl = el('p', 'flash-prompt');
    const answerEl = el('p', 'flash-answer');
    const metaEl = el('p', 'flash-meta');
    const actions = el('div', 'flash-actions');

    const paint = () => {
      const cur = cards[i];
      if (!cur) {
        card.replaceChildren(
          el('p', 'card-title', 'Done for now'),
          el('p', 'card-note', `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} reviewed. Reopen to pick up whatever is due next.`)
        );
        return;
      }
      metaEl.textContent = `${i + 1} of ${cards.length} · ${Learn.boxLabel(cur.box || 0)}` +
      (queue.heldBack ? ` · ${queue.heldBack} more waiting` : '');
      promptEl.textContent = cur.prompt;
      answerEl.textContent = revealed ? cur.answer : '';
      answerEl.classList.toggle('is-hidden', !revealed);
      actions.replaceChildren();

      if (!revealed) {
        const showBtn = el('button', 'go', 'Show the answer');
        showBtn.addEventListener('click', () => { revealed = true; paint(); });
        actions.append(showBtn);
      } else {
        const again = el('button', 'flash-btn is-again', 'Missed it');
        again.addEventListener('click', () => {
          Learn.grade(cur.id, false);
          i += 1; revealed = false; paint();
        });
        const got = el('button', 'flash-btn is-got', 'Knew it');
        got.addEventListener('click', () => {
          Learn.grade(cur.id, true);
          i += 1; revealed = false; paint();
        });
        const say = el('button', 'flash-btn', 'Hear it');
        say.addEventListener('click', () => {
          if (!speak(cur.answer, to)) toast(`No ${lang(to).native} voice on this device`, true);
        });
        actions.append(again, got, say);
      }
    };

    card.append(metaEl, promptEl, answerEl, actions);
    paint();
  }

  // Daily allowance.
  const opts = el('article', 'card');
  opts.append(el('p', 'card-sub', 'New phrases per day'));
  const row = el('div', 'pctrow');
  for (const n of [4, 8, 15, 25]) {
    const b = el('button', `seg${st.newPerDay === n ? ' is-on' : ''}`, String(n));
    b.type = 'button';
    b.addEventListener('click', () => { Learn.setNewPerDay(n); render(); });
    row.append(b);
  }
  opts.append(row);
  opts.append(el('p', 'card-note',
    `${st.introducedToday} new today. Cards you miss come back tomorrow; ones you know return after 2, 4, 8 then 16 days.`));
  const of2 = el('div', 'card-foot');
  const reset = el('button', 'ghost', 'Reset all progress');
  reset.addEventListener('click', () => {
    if (!state.resetArmed) {
      state.resetArmed = true;
      reset.textContent = 'Tap again to reset';
      return;
    }
    Learn.resetProgress();
    state.resetArmed = false;
    toast('Progress cleared');
    render();
  });
  of2.append(reset);
  opts.append(of2);
  wrap.append(opts);

  wrap.append(el('p', 'fineprint', 'Entirely on the device. No network, no account, no streaks to lose.'));
  return wrap;
}

/* ── Getting around ────────────────────────────────────── */

function transitSection() {
  const c = country(state.country);
  const t = transit(c.code);
  const wrap = el('div');

  if (t) {
    const card = el('article', 'card');
    card.append(el('h2', 'card-title', 'Trains and tickets'));
    const ul = el('ul', 'strip-list');
    for (const [k, v] of [['Rail', t.rail], ['The rule that catches people', t.rule], ['In town', t.city], ['Taxis', t.taxi]]) {
      const li = el('li');
      const d = el('div', 'row');
      d.append(el('span', 'row-out', v));
      d.append(el('span', 'row-in', k));
      li.append(d);
      ul.append(li);
    }
    card.append(ul);
    wrap.append(card);
  }

  // Roaming. Directly relevant when your data allowance is the constraint.
  const roam = el('article', 'card');
  roam.append(el('h2', 'card-title', 'Your phone'));
  roam.append(el('p', 'card-note', c.eea
    ? `${c.name} is in the EEA, so an EU or EEA SIM works here at your normal domestic rates under "roam like at home". Fair-use limits still apply, so a very long stay can be flagged.`
    : `${c.name} is outside the EEA, so EU roaming rules do not apply. Check what your operator charges before using data, or buy a local eSIM.`));
  roam.append(el('p', 'card-sub', 'Ways to stop it costing anything'));
  const rl = el('ul', 'watchlist');
  for (const tipText of [
    'Turn off background app refresh over mobile data.',
    'Download offline maps and anything you want to read while on Wi-Fi.',
    'The Data tab in this app shows exactly what it has spent, and refuses to go over your ceiling.',
    c.eea ? 'Watch for a text about fair use if you are here more than a few weeks.'
          : 'A local eSIM is usually far cheaper than roaming for anything more than a couple of days.',
  ]) rl.append(el('li', null, tipText));
  roam.append(rl);
  wrap.append(roam);

  // Address card — for showing a driver where you want to go.
  const addr = el('article', 'card');
  addr.append(el('h2', 'card-title', 'Show a driver'));
  addr.append(el('p', 'card-note', 'Type or paste an address and show it large, with the request in the local language.'));
  const input = el('textarea', 'addrinput');
  input.rows = 2;
  input.placeholder = 'Via del Corso 12, Roma';
  input.value = state.address || '';
  input.addEventListener('input', () => { state.address = input.value; save(); });
  addr.append(input);
  const af2 = el('div', 'card-foot');
  const show = el('button', 'go compact', 'Show it');
  show.addEventListener('click', () => {
    const v = input.value.trim();
    if (!v) return;
    showAddress(v, c.langs[0]);
  });
  af2.append(show);
  addr.append(af2);
  wrap.append(addr);

  return wrap;
}

// "Please take me to this address" in the local language, above the address in
// large type. The phrase table has no driver-specific line, so it is built here.
const TAKE_ME = {
  en: 'Please take me to this address',
  it: 'Mi porti a questo indirizzo, per favore',
  de: 'Bitte fahren Sie mich zu dieser Adresse',
  pl: 'Proszę zawieźć mnie na ten adres',
  fr: 'Conduisez-moi à cette adresse, s\u2019il vous plaît',
  es: 'Lléveme a esta dirección, por favor',
  cs: 'Vezměte mě prosím na tuto adresu',
  nl: 'Breng me naar dit adres, alstublieft',
  sv: 'Kör mig till den här adressen, tack',
  uk: 'Відвезіть мене на цю адресу, будь ласка',
};

function showAddress(addressText, targetCode) {
  const scrim = el('div', 'bigcard');
  const panel = el('div', 'bigcard-panel');
  const head = el('div', 'bigcard-head');
  head.append(el('span', 'card-sub', `Show a driver · ${lang(targetCode).native}`));
  const close = el('button', 'ghost', 'Close');
  close.addEventListener('click', () => scrim.remove());
  head.append(close);

  const plate = el('div', 'plate');
  plate.append(el('span', 'plate-route', TAKE_ME[targetCode] || TAKE_ME.en));
  plate.append(el('p', 'bigcard-text', addressText));

  const foot = el('div', 'bigcard-foot');
  const say = el('button', 'go compact', 'Read aloud');
  say.addEventListener('click', () => {
    const line = `${TAKE_ME[targetCode] || TAKE_ME.en}. ${addressText}`;
    if (!speak(line, targetCode)) toast('No voice for that language on this device', true);
  });
  const onMap = el('a', 'ghost', 'Open in maps');
  onMap.href = mapsUrl(addressText, state.coords || null);
  onMap.rel = 'noopener';
  foot.append(say, onMap);

  panel.append(head, plate, foot);
  scrim.append(panel);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

/* ── Phrases ───────────────────────────────────────────── */

const fold = (s) => s.toLowerCase()
  .replace(/[ąàâä]/g, 'a').replace(/[ćç]/g, 'c').replace(/[ęèéêë]/g, 'e')
  .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/[óòôö]/g, 'o')
  .replace(/[śş]/g, 's').replace(/[źż]/g, 'z').replace(/[üùû]/g, 'u').replace(/ß/g, 'ss');

function phrasesSection() {
  const c = country(state.country);
  const target = c.langs[0];
  const wrap = el('div');

  const search = el('input', 'textfield');
  search.type = 'search';
  search.placeholder = 'Search in any language';
  search.value = state.phraseQuery;
  search.autocapitalize = 'none';
  search.spellcheck = false;

  const cats = el('div', 'chips');
  const list = el('ul', 'strip-list');

  const paint = () => {
    cats.replaceChildren(...PHRASE_CATS.map((cat) => {
      const b = el('button', `chip${cat.id === state.phraseCat ? ' is-on' : ''}`, cat.label);
      b.type = 'button';
      b.addEventListener('click', () => { state.phraseCat = cat.id; save(); paint(); });
      return b;
    }));

    const q = fold(state.phraseQuery.trim());
    const rows = PHRASES.filter((row) => {
      if (state.phraseCat === 'saved') { if (!state.saved[row[1]]) return false; }
      else if (state.phraseCat !== 'all' && row[0] !== state.phraseCat) return false;
      if (!q) return true;
      return [1, 2, 3].some((i) => fold(row[i]).includes(q));
    });

    if (!rows.length) {
      list.replaceChildren(el('li', null, state.phraseCat === 'saved'
        ? 'Nothing saved yet — tap the star on a phrase.'
        : 'No phrase matches that.'));
      return;
    }

    list.replaceChildren(...rows.map((row) => {
      const li = el('li');
      const line = el('div', 'phraserow');
      const b = el('button', 'row');
      b.type = 'button';
      b.append(el('span', 'row-out', phraseFor(row, target).text));
      b.append(el('span', 'row-in', row[PHRASE_COL.pl]));
      b.addEventListener('click', () => showBig(row, target, row[PHRASE_COL.pl]));

      const star = el('button', `star${state.saved[row[1]] ? ' is-on' : ''}`);
      star.type = 'button';
      star.setAttribute('aria-label', 'Save phrase');
      star.textContent = state.saved[row[1]] ? '★' : '☆';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.saved[row[1]]) delete state.saved[row[1]];
        else state.saved[row[1]] = 1;
        save();
        paint();
      });

      line.append(b, star);
      li.append(line);
      return li;
    }));
  };

  search.addEventListener('input', () => { state.phraseQuery = search.value; save(); paint(); });

  wrap.append(search, cats, list);
  paint();
  return wrap;
}

/* Big, readable, hold-it-up-to-someone card. */
function showBig(row, targetCode, mine) {
  const shown = phraseFor(row, targetCode);
  const scrim = el('div', 'bigcard');
  const panel = el('div', 'bigcard-panel');

  const head = el('div', 'bigcard-head');
  const heading = el('span', 'card-sub', shown.exact
    ? `Show this · ${lang(targetCode).native}`
    : 'Show this · English');
  head.append(heading);
  const close = el('button', 'ghost', 'Close');
  close.addEventListener('click', () => scrim.remove());
  head.append(close);

  const plate = el('div', 'plate');
  const route = el('span', 'plate-route', lang(shown.code).native);
  const text = el('p', 'bigcard-text', shown.text);
  plate.append(route, text);

  const mineBlock = el('div', 'bigcard-mine');
  mineBlock.append(el('span', 'pair-role', 'You said'));
  mineBlock.append(el('p', 'mine-text', mine));

  const foot = el('div', 'bigcard-foot');

  const sayBtn = el('button', 'go compact', 'Read aloud');
  let spokenCode = shown.code;
  let spokenText = shown.text;
  sayBtn.addEventListener('click', () => {
    if (!speak(spokenText, spokenCode)) toast('No voice for that language on this device', true);
  });
  foot.append(sayBtn);

  // No built-in phrase for this language — offer to fetch one.
  if (!shown.exact) {
    const note = el('p', 'card-note',
      `No built-in ${lang(targetCode).native}. Translating costs one request.`);
    panel.append(head, plate, mineBlock, note);

    const tBtn = el('button', 'go compact', `Translate to ${lang(targetCode).native}`);
    tBtn.addEventListener('click', async () => {
      tBtn.disabled = true;
      tBtn.textContent = 'Translating…';
      try {
        const out = await translator.translate(shown.text, 'en', targetCode).promise;
        text.textContent = out;
        route.textContent = lang(targetCode).native;
        // The heading was still saying English; it is the thing someone reads
        // first when you hold the phone up.
        heading.textContent = `Show this · ${lang(targetCode).native}`;
        spokenText = out;
        spokenCode = targetCode;
        note.textContent = 'Translated, not from the built-in table.';
        tBtn.remove();
      } catch (err) {
        tBtn.disabled = false;
        tBtn.textContent = 'Try again';
        note.textContent = err && err.message ? err.message : String(err);
      }
    });
    foot.append(tBtn);
    panel.append(foot);
  } else {
    panel.append(head, plate, mineBlock, foot);
  }

  scrim.append(panel);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

/* ── Shops ─────────────────────────────────────────────── */

function shopsSection() {
  const c = country(state.country);
  const wrap = el('div');

  if (!hasShops(c.code)) {
    const card = el('article', 'card');
    card.append(el('h2', 'card-title', 'Shops'));
    card.append(el('p', 'card-note', `No chain list for ${c.name} yet. The Nearby tab searches in the local language, which is the next best thing.`));
    wrap.append(card);
    return wrap;
  }

  const head = el('article', 'card');
  head.append(el('h2', 'card-title', `What replaces what in ${c.name}`));
  head.append(el('p', 'card-note', 'Starting from the Polish chains, since those are the familiar ones. Tap any row to search for the nearest one.'));
  wrap.append(head);

  for (const s2 of shopsFor(c.code)) {
    if (!s2.local) continue;
    const card = el('article', 'card');
    card.append(el('p', 'card-sub', s2.label));

    const home = el('p', 'shophome');
    home.append(el('span', 'shophome-l', 'At home'));
    home.append(el('span', null, s2.pl));
    card.append(home);

    const here = el('div', 'shophere');
    here.append(el('span', 'shophere-l', `In ${c.name}`));
    here.append(el('span', 'shophere-v', s2.local));
    card.append(here);

    if (s2.search) {
      const foot = el('div', 'card-foot');
      const list = el('ul', 'strip-list');

      if (s2.osm && state.coords) {
        const b = el('button', 'go compact', `Nearest ${s2.search}`);
        b.addEventListener('click', async () => {
          b.disabled = true;
          b.textContent = 'Looking…';
          try {
            const places = await Over.nearby(s2.osm, state.coords, { radius: 2500 });
            // Prefer the chain by name where OpenStreetMap knows it, otherwise
            // any shop of the right kind.
            const wanted = s2.search.toLowerCase();
            const named = places.filter((pl) => pl.name.toLowerCase().includes(wanted.split(' ')[0]));
            const use = named.length ? named : places;
            if (!use.length) {
              list.replaceChildren(el('li', null, 'Nothing within 2.5 km. The maps search below may still find one.'));
            } else {
              list.replaceChildren(...use.slice(0, 8).map((pl) => {
                const li = el('li');
                const a2 = el('a', 'row');
                a2.href = isApple()
                  ? `https://maps.apple.com/?daddr=${pl.lat},${pl.lon}&dirflg=w`
                  : `https://www.google.com/maps/dir/?api=1&destination=${pl.lat},${pl.lon}&travelmode=walking`;
                a2.rel = 'noopener';
                a2.append(el('span', 'row-out', `${pl.name} — ${Over.metresLabel(pl.metres)}`));
                const d = Over.describe(pl);
                if (d) a2.append(el('span', 'row-in', d));
                li.append(a2);
                return li;
              }));
            }
          } catch (err) {
            list.replaceChildren(el('li', null, err && err.message ? err.message : String(err)));
          }
          b.disabled = false;
          b.textContent = `Nearest ${s2.search}`;
        });
        foot.append(b);
      }

      const a = el('a', 'ghost', 'Search maps');
      a.href = mapsUrl(s2.search, state.coords || null);
      a.rel = 'noopener';
      foot.append(a);
      card.append(foot, list);
    }
    wrap.append(card);
  }

  wrap.append(el('p', 'fineprint', 'Offline. Chains open, close and rebrand, so treat this as a starting point rather than gospel.'));
  return wrap;
}

/* ── Converters ────────────────────────────────────────── */

function convertSection() {
  const wrap = el('div');

  const card = el('article', 'card');
  card.append(el('h2', 'card-title', 'Quick conversions'));
  const input = el('input', 'convinput wide');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.value = 20;
  input.setAttribute('aria-label', 'Value to convert');
  const out = el('ul', 'strip-list');

  const paint = () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) { out.replaceChildren(); return; }
    const rows = [
      [`${v} °C`, `${(v * 9 / 5 + 32).toFixed(1)} °F`],
      [`${v} °F`, `${((v - 32) * 5 / 9).toFixed(1)} °C`],
      [`${v} km`, `${(v * 0.621371).toFixed(2)} miles`],
      [`${v} miles`, `${(v * 1.609344).toFixed(2)} km`],
      [`${v} kg`, `${(v * 2.20462).toFixed(2)} lb`],
      [`${v} lb`, `${(v * 0.453592).toFixed(2)} kg`],
      [`${v} cm`, `${Math.floor(v / 30.48)} ft ${((v / 2.54) % 12).toFixed(1)} in`],
      [`${v} litres`, `${(v * 0.264172).toFixed(2)} US gal`],
    ];
    out.replaceChildren(...rows.map(([a, b]) => {
      const li = el('li');
      const d = el('div', 'row');
      d.append(el('span', 'row-out', b));
      d.append(el('span', 'row-in', a));
      li.append(d);
      return li;
    }));
  };
  input.addEventListener('input', paint);
  card.append(input, out);
  wrap.append(card);
  paint();

  const sizes = el('article', 'card');
  sizes.append(el('h2', 'card-title', 'Sizes'));
  sizes.append(el('p', 'card-note', 'EU sizing against UK and US. Approximate — always try it on.'));
  for (const key of Object.keys(SIZES)) {
    const s = SIZES[key];
    sizes.append(el('p', 'card-sub', s.label));
    const table = el('div', 'sizetable');
    const header = ['EU', 'UK', 'US'];
    for (let i = 0; i < s.eu.length; i++) {
      const col = el('div', 'sizecol');
      col.append(el('span', 'sizecell head', s.eu[i]));
      col.append(el('span', 'sizecell', s.uk[i]));
      col.append(el('span', 'sizecell', s.us[i]));
      table.append(col);
    }
    const labels = el('div', 'sizecol labels');
    for (const h of header) labels.append(el('span', 'sizecell', h));
    table.prepend(labels);
    sizes.append(table);
  }
  wrap.append(sizes);

  return wrap;
}
