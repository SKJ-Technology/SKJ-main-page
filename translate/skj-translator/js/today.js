// Today: weather, daylight, and whether anything is going to be shut.
//
//   weather   Open-Meteo — keyless, CORS, free for non-commercial use,
//             data CC BY 4.0 (attribution shown in the UI).
//   holidays  Nager.Date — keyless. Sources disagree on whether it sends CORS
//             headers, so a failure here is reported plainly, not swallowed.
//   sun       computed locally. No request, works with no signal at all.

import { budget, formatBytes, REQUEST_OVERHEAD } from './budget.js';

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const HOLIDAY_URL = 'https://date.nager.at/api/v3/PublicHolidays';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const CACHE_KEY = 'skj-translator:today';

let cache = { weather: null, holidays: null, air: null };
try {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) cache = { ...cache, ...JSON.parse(raw) };
} catch { /* private mode */ }

const persist = () => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
};

/* ── Sun times, computed offline ──────────────────────── */

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/**
 * Sunrise and sunset for a date and place, with no network.
 * NOAA's low-precision algorithm — good to about a minute, which is far more
 * than enough for "how long until it goes dark".
 * @returns {{sunrise: Date|null, sunset: Date|null, polar: string|null}}
 */
export function sunTimes(date, lat, lon) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);

  // Fractional year, then the equation of time and solar declination.
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  // Zenith 90.833° accounts for refraction and the sun's apparent radius.
  const cosH = (Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)))
    - Math.tan(rad(lat)) * Math.tan(decl);

  if (cosH > 1) return { sunrise: null, sunset: null, polar: 'The sun does not rise here today.' };
  if (cosH < -1) return { sunrise: null, sunset: null, polar: 'The sun does not set here today.' };

  const ha = deg(Math.acos(cosH));
  const noonMinutes = 720 - 4 * lon - eqTime;          // UTC minutes of solar noon
  const toDate = (mins) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCMinutes(d.getUTCMinutes() + mins);
    return d;
  };

  return { sunrise: toDate(noonMinutes - 4 * ha), sunset: toDate(noonMinutes + 4 * ha), polar: null };
}

/** Human phrasing for how much daylight is left. */
export function daylightLeft(now, sunset) {
  if (!sunset) return null;
  const ms = sunset - now;
  if (ms <= 0) return 'The sun has set.';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min of daylight left.`;
  return `${h} h ${m} min of daylight left.`;
}

/* ── Weather ──────────────────────────────────────────── */

// Open-Meteo's WMO weather codes, condensed to something readable.
const WMO = {
  0: ['Clear', '○'], 1: ['Mostly clear', '○'], 2: ['Partly cloudy', '◐'], 3: ['Overcast', '●'],
  45: ['Fog', '▤'], 48: ['Freezing fog', '▤'],
  51: ['Light drizzle', '⋮'], 53: ['Drizzle', '⋮'], 55: ['Heavy drizzle', '⋮'],
  56: ['Freezing drizzle', '⋮'], 57: ['Freezing drizzle', '⋮'],
  61: ['Light rain', '☂'], 63: ['Rain', '☂'], 65: ['Heavy rain', '☂'],
  66: ['Freezing rain', '☂'], 67: ['Freezing rain', '☂'],
  71: ['Light snow', '❄'], 73: ['Snow', '❄'], 75: ['Heavy snow', '❄'], 77: ['Snow grains', '❄'],
  80: ['Showers', '☂'], 81: ['Showers', '☂'], 82: ['Violent showers', '☂'],
  85: ['Snow showers', '❄'], 86: ['Snow showers', '❄'],
  95: ['Thunderstorm', '⚡'], 96: ['Thunderstorm with hail', '⚡'], 99: ['Thunderstorm with hail', '⚡'],
};

export const describeWeather = (code) => WMO[code] || ['—', '·'];

export function cachedWeather(coords) {
  const w = cache.weather;
  if (!w || !coords) return null;
  // Anything more than ~25 km away or 3 hours old is not this place, now.
  const far = Math.abs(w.lat - coords.lat) > 0.25 || Math.abs(w.lon - coords.lon) > 0.25;
  if (far) return null;
  return { ...w, ageMinutes: Math.round((Date.now() - w.at) / 60000) };
}

export async function fetchWeather(coords) {
  const params = new URLSearchParams({
    latitude: coords.lat,
    longitude: coords.lon,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,uv_index,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max',
    forecast_days: '5',
    timezone: 'auto',
  });
  const url = `${WEATHER_URL}?${params}`;

  const projected = url.length + REQUEST_OVERHEAD + 2500;
  if (!budget.canSpend(projected)) {
    throw new Error(`Only ${formatBytes(budget.remainingBytes())} left in the meter.`);
  }

  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    budget.record(REQUEST_OVERHEAD, 'translation');
    throw new Error('Could not reach the weather service.');
  }
  const text = await res.text();
  budget.record(url.length + REQUEST_OVERHEAD + text.length, 'translation');

  if (!res.ok) throw new Error(`Weather service returned ${res.status}.`);
  const data = JSON.parse(text);
  if (!data || !data.current) throw new Error('Unexpected weather response.');

  cache.weather = {
    lat: coords.lat, lon: coords.lon, at: Date.now(),
    current: data.current, daily: data.daily, units: data.current_units, tz: data.timezone,
  };
  persist();
  return { ...cache.weather, ageMinutes: 0 };
}

/* ── Public holidays ──────────────────────────────────── */

export function cachedHolidays(countryCode, year) {
  const h = cache.holidays;
  if (!h || h.country !== countryCode || h.year !== year) return null;
  return h;
}

export async function fetchHolidays(countryCode, year) {
  const url = `${HOLIDAY_URL}/${year}/${countryCode}`;
  const projected = url.length + REQUEST_OVERHEAD + 4000;
  if (!budget.canSpend(projected)) {
    throw new Error(`Only ${formatBytes(budget.remainingBytes())} left in the meter.`);
  }

  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    budget.record(REQUEST_OVERHEAD, 'translation');
    // The likeliest cause, and worth naming precisely so it is not mistaken
    // for a dead connection.
    throw new Error('The holiday service refused the request from a browser — probably no CORS headers. Nothing else is affected.');
  }
  const text = await res.text();
  budget.record(url.length + REQUEST_OVERHEAD + text.length, 'translation');

  if (!res.ok) throw new Error(`Holiday service returned ${res.status}.`);
  const list = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error('Unexpected holiday response.');

  cache.holidays = {
    country: countryCode,
    year,
    at: Date.now(),
    days: list.map((h) => ({ date: h.date, local: h.localName, name: h.name, global: h.global !== false })),
  };
  persist();
  return cache.holidays;
}

/** The next few holidays from today, with a day count. */
export function upcomingHolidays(holidays, limit = 4) {
  if (!holidays || !holidays.days) return [];
  const today = new Date().toISOString().slice(0, 10);
  return holidays.days
    .filter((h) => h.date >= today)
    .slice(0, limit)
    .map((h) => {
      const days = Math.round((new Date(`${h.date}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000);
      return { ...h, days, when: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days` };
    });
}

/* ── UV ───────────────────────────────────────────────── */

// WHO bands. Worth surfacing in an Italian summer, where the difference between
// "fine" and "burnt in twenty minutes" is not visible from the temperature.
export function describeUV(uv) {
  if (uv == null) return null;
  const v = Math.round(uv);
  if (v <= 2) return { v, band: 'Low', advice: 'No protection needed.' };
  if (v <= 5) return { v, band: 'Moderate', advice: 'Shade around midday, sun cream if you are out a while.' };
  if (v <= 7) return { v, band: 'High', advice: 'Sun cream, hat, shade between 11:00 and 15:00.' };
  if (v <= 10) return { v, band: 'Very high', advice: 'Burns fast. Cover up and avoid midday sun.' };
  return { v, band: 'Extreme', advice: 'Unprotected skin burns within minutes. Stay out of the midday sun.' };
}

/* ── Air quality ──────────────────────────────────────── */

export function cachedAir(coords) {
  const a = cache.air;
  if (!a || !coords) return null;
  if (Math.abs(a.lat - coords.lat) > 0.25 || Math.abs(a.lon - coords.lon) > 0.25) return null;
  return { ...a, ageMinutes: Math.round((Date.now() - a.at) / 60000) };
}

export async function fetchAir(coords) {
  const params = new URLSearchParams({
    latitude: coords.lat,
    longitude: coords.lon,
    current: 'european_aqi,pm2_5,pm10,ozone,alder_pollen,birch_pollen,grass_pollen,ragweed_pollen',
    timezone: 'auto',
  });
  const url = `${AIR_URL}?${params}`;

  const projected = url.length + REQUEST_OVERHEAD + 1500;
  if (!budget.canSpend(projected)) {
    throw new Error(`Only ${formatBytes(budget.remainingBytes())} left in the meter.`);
  }

  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    budget.record(REQUEST_OVERHEAD, 'translation');
    throw new Error('Could not reach the air quality service.');
  }
  const text = await res.text();
  budget.record(url.length + REQUEST_OVERHEAD + text.length, 'translation');
  if (!res.ok) throw new Error(`Air quality service returned ${res.status}.`);

  const data = JSON.parse(text);
  if (!data || !data.current) throw new Error('Unexpected air quality response.');
  cache.air = { lat: coords.lat, lon: coords.lon, at: Date.now(), current: data.current };
  persist();
  return { ...cache.air, ageMinutes: 0 };
}

// European AQI bands, as published by the EEA.
export function describeAQI(aqi) {
  if (aqi == null) return null;
  const v = Math.round(aqi);
  if (v <= 20) return { v, band: 'Good', advice: 'Nothing to think about.' };
  if (v <= 40) return { v, band: 'Fair', advice: 'Fine for almost everyone.' };
  if (v <= 60) return { v, band: 'Moderate', advice: 'Sensitive lungs may notice it on a long walk.' };
  if (v <= 80) return { v, band: 'Poor', advice: 'Asthma sufferers should keep an inhaler handy.' };
  if (v <= 100) return { v, band: 'Very poor', advice: 'Cut down hard exertion outdoors.' };
  return { v, band: 'Extremely poor', advice: 'Stay indoors if you can. Bad for anyone with a chest condition.' };
}

// Pollen counts come in grains/m3. These thresholds are the commonly used ones.
export function pollenSummary(current) {
  if (!current) return [];
  const kinds = [
    ['alder_pollen', 'Alder'], ['birch_pollen', 'Birch'],
    ['grass_pollen', 'Grass'], ['ragweed_pollen', 'Ragweed'],
  ];
  return kinds.map(([key, label]) => {
    const v = current[key];
    if (v == null) return null;
    const level = v < 1 ? null : v < 20 ? 'Low' : v < 50 ? 'Moderate' : v < 200 ? 'High' : 'Very high';
    return level ? { label, level, value: Math.round(v) } : null;
  }).filter(Boolean);
}
