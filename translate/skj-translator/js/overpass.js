// Finding actual nearby places, rather than handing off to a maps app.
//
// Overpass is the OpenStreetMap query service. Keyless, CORS-enabled, and unlike
// Nominatim it is built for exactly this kind of lookup. It is still donated
// infrastructure, so: one request per tap, a hard result cap, a short radius,
// and results cached per tag and location so panning around costs nothing.

import { budget, formatBytes, REQUEST_OVERHEAD } from './budget.js';

// Mirrors, tried in order — the main instance rate-limits under load.
// Measured on a real device, August 2026:
//   maps.mail.ru        answered in ~7s
//   kumi.systems        no reply in 12s
//   private.coffee      no reply in 12s
//   overpass-api.de     reachable but sends no CORS header, so a browser can
//                       never read the response — dropped entirely.
//
// These are donated servers and their health changes, so rather than trusting
// this order forever the mirrors are raced and the winner is remembered.
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const FASTEST_KEY = 'skj-translator:overpass-fastest';

const CACHE_KEY = 'skj-translator:overpass';
const MAX_RESULTS = 25;
const CACHE_MINUTES = 60;

let cache = {};
try {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) cache = JSON.parse(raw) || {};
} catch { /* private mode */ }

function persist() {
  try {
    // Keep only the most recent handful; this can get big.
    const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at).slice(0, 12);
    const trimmed = {};
    for (const k of keys) trimmed[k] = cache[k];
    cache = trimmed;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

/** Metres between two coordinates. */
export function distance(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const keyFor = (tag, coords, radius) =>
  `${tag}@${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}r${radius}`;

export function cached(tag, coords, radius) {
  const hit = cache[keyFor(tag, coords, radius)];
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MINUTES * 60000) return null;
  return { places: hit.places, ageMinutes: Math.round((Date.now() - hit.at) / 60000) };
}

/**
 * Places matching an OSM tag filter near a point.
 * @param {string} tag  an Overpass tag filter, e.g. '["amenity"="pharmacy"]'
 * @returns {Promise<Array<{name:string, kind:string, lat:number, lon:number, metres:number, tags:object}>>}
 */
export async function nearby(tag, coords, { radius = 900, timeoutMs = 14000, onWait } = {}) {
  const hit = cached(tag, coords, radius);
  if (hit) return hit.places;

  // `node` alone is far cheaper than `nwr`: it skips ways and relations, which
  // are what make these queries slow. Most shops and amenities are nodes anyway.
  const query = `[out:json][timeout:10];node(around:${radius},${coords.lat},${coords.lon})${tag};out ${MAX_RESULTS};`;

  const projected = query.length + REQUEST_OVERHEAD + 20000;
  if (!budget.canSpend(projected)) {
    throw new Error(`Only ${formatBytes(budget.remainingBytes())} left in the meter.`);
  }

  // Put whichever mirror answered last time first.
  let order = ENDPOINTS.slice();
  try {
    const fastest = localStorage.getItem(FASTEST_KEY);
    if (fastest && order.includes(fastest)) {
      order = [fastest, ...order.filter((u) => u !== fastest)];
    }
  } catch { /* ignore */ }

  const started = Date.now();
  const ticker = onWait
    ? setInterval(() => onWait(Math.round((Date.now() - started) / 1000)), 2000)
    : 0;

  const controllers = [];
  const problems = [];

  // Race them rather than queueing. Trying in sequence meant a busy mirror cost
  // its full timeout before a working one got a turn — which is why this looked
  // broken when one server was answering fine all along.
  const attempt = (endpoint) => {
    const host = new URL(endpoint).hostname;
    const controller = new AbortController();
    controllers.push(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timer);
        const text = await res.text();
        budget.record(query.length + REQUEST_OVERHEAD + text.length, 'map');
        if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
        const data = JSON.parse(text);
        try { localStorage.setItem(FASTEST_KEY, endpoint); } catch { /* ignore */ }
        return data;
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err && err.name === 'AbortError') problems.push(`${host}: no reply in ${timeoutMs / 1000}s`);
        else problems.push(`${host}: ${err && err.message ? err.message : 'refused'}`);
        throw err;
      });
  };

  let data;
  try {
    data = await Promise.any(order.map(attempt));
  } catch {
    if (ticker) clearInterval(ticker);
    budget.record(REQUEST_OVERHEAD, 'map');
    throw new Error(
      `No OpenStreetMap mirror answered. ${problems.join(' | ')}. ` +
      'These are donated servers and go down; the categories still open your maps app.'
    );
  } finally {
    if (ticker) clearInterval(ticker);
    // Stop the losers so they are not left downloading in the background.
    for (const c of controllers) { try { c.abort(); } catch { /* ignore */ } }
  }

  const places = (data.elements || []).map((e) => {
    const lat = e.lat ?? (e.center && e.center.lat);
    const lon = e.lon ?? (e.center && e.center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const t = e.tags || {};
    return {
      name: t.name || t.brand || t.operator || '(unnamed)',
      kind: (t.amenity || t.shop || t.railway || t.tourism || '').replace(/_/g, ' '),
      lat,
      lon,
      metres: distance(coords, { lat, lon }),
      tags: t,
    };
  }).filter(Boolean);

  places.sort((a, b) => a.metres - b.metres);

  cache[keyFor(tag, coords, radius)] = { at: Date.now(), places };
  persist();
  return places;
}

/** Opening hours and a few other useful tags, phrased for a human. */
export function describe(place) {
  const t = place.tags || {};
  const bits = [];
  if (place.kind) bits.push(place.kind);
  if (t.opening_hours) bits.push(t.opening_hours.length > 40 ? 'hours listed' : t.opening_hours);
  if (t['addr:street']) {
    bits.push([t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '));
  }
  if (t.wheelchair === 'yes') bits.push('step-free');
  if (t.drinking_water === 'yes' || t.amenity === 'drinking_water') bits.push('drinkable');
  return bits.join(' · ');
}

export const metresLabel = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
