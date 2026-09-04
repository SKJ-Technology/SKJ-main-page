// The in-app map.
//
// Keyless throughout, using services that explicitly allow this:
//   tiles   OpenFreeMap — no key, no registration, no view or request limits
//   search  Photon (komoot) — public demo, "reasonable limit" of requests
//   data    OpenStreetMap contributors (attribution is required, see below)
//
// Nothing here loads until you tap. MapLibre alone is ~550 KB and a first map
// view pulls roughly a megabyte of tiles, so it never spends bytes uninvited.

import { budget, formatBytes, REQUEST_OVERHEAD } from './budget.js';

const VERSION = '6.0.0';
const LIB_JS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.mjs`;
const LIB_CSS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;

// positron is the lightest of the OpenFreeMap styles — less ink, fewer labels,
// and it renders legibly on a phone in sunlight.
const STYLES = {
  positron: 'https://tiles.openfreemap.org/styles/positron',
  bright: 'https://tiles.openfreemap.org/styles/bright',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
};

const PHOTON = 'https://photon.komoot.io/api/';

// Rough cost of opening a map cold: library, style, glyphs, sprites and the
// first screenful of vector tiles. Used only to refuse politely up front.
const COLD_ESTIMATE = 1_600_000;

let maplibre = null;
let map = null;
let observing = false;
let estimatedBytes = 0;   // bytes we had to guess at, because of opaque timing

/* ── Byte accounting ──────────────────────────────────── */

// Cross-origin resources only report transferSize when the server sends
// Timing-Allow-Origin. When it does not, the entry reads 0 and we fall back to
// an estimate — which is flagged in the UI rather than passed off as measured.
const ESTIMATES = [
  { re: /tiles\.openfreemap\.org\/.*\.pbf/, bytes: 70_000, label: 'vector tile' },
  { re: /tiles\.openfreemap\.org\/styles\//, bytes: 30_000, label: 'style' },
  { re: /tiles\.openfreemap\.org/, bytes: 40_000, label: 'map asset' },
  { re: /maplibre-gl\.mjs/, bytes: 250_000, label: 'library' },
  { re: /maplibre-gl\.css/, bytes: 12_000, label: 'stylesheet' },
];

function startMetering(onUpdate) {
  if (observing || typeof PerformanceObserver === 'undefined') return;
  observing = true;

  const seen = new Set();
  const obs = new PerformanceObserver((list) => {
    let added = 0;
    for (const e of list.getEntries()) {
      if (!/openfreemap|maplibre|photon\.komoot/.test(e.name)) continue;
      const key = `${e.name}#${Math.round(e.startTime)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let bytes = e.transferSize || 0;
      if (!bytes) {
        const guess = ESTIMATES.find((g) => g.re.test(e.name));
        bytes = guess ? guess.bytes : 20_000;
        estimatedBytes += bytes;
      }
      budget.record(bytes, 'map');
      added += bytes;
    }
    if (added && onUpdate) onUpdate(added, estimatedBytes > 0);
  });

  try {
    obs.observe({ type: 'resource', buffered: true });
  } catch {
    observing = false;
  }
}

export const mapMetering = {
  get anyEstimated() { return estimatedBytes > 0; },
  get estimated() { return estimatedBytes; },
};

/* ── Loading ──────────────────────────────────────────── */

export function mapLoaded() { return !!map; }

export function coldEstimate() { return COLD_ESTIMATE; }

export function canAffordMap() { return budget.canSpend(COLD_ESTIMATE); }

async function loadLib() {
  if (maplibre) return maplibre;

  if (!document.querySelector('link[data-maplibre]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LIB_CSS;
    link.dataset.maplibre = '1';
    document.head.append(link);
  }

  const mod = await import(LIB_JS);
  maplibre = mod.default || mod;
  if (!maplibre || typeof maplibre.Map !== 'function') {
    throw new Error('MapLibre loaded but exposed no Map constructor.');
  }
  return maplibre;
}

/**
 * Create the map inside `container`.
 * @param {HTMLElement} container
 * @param {{lat:number, lon:number}|null} coords
 * @param {string} styleName
 * @param {(added:number, estimated:boolean)=>void} onBytes
 */
export async function createMap(container, coords, styleName, onBytes) {
  const lib = await loadLib();
  startMetering(onBytes);

  const centre = coords ? [coords.lon, coords.lat] : [12.4964, 41.9028]; // Rome

  map = new lib.Map({
    container,
    style: STYLES[styleName] || STYLES.positron,
    center: centre,
    zoom: coords ? 15 : 12,
    attributionControl: false,
    // Fewer tiles fetched while dragging, which matters on a metered connection.
    fadeDuration: 0,
    maxZoom: 18,
  });

  map.addControl(new lib.AttributionControl({
    compact: true,
    customAttribution: '© OpenStreetMap contributors · OpenFreeMap',
  }));
  map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');

  if (coords) addMarker(coords.lat, coords.lon, 'You', true);

  return map;
}

let markers = [];

export function addMarker(lat, lon, label, isSelf = false) {
  if (!map || !maplibre) return null;
  const dot = document.createElement('div');
  dot.className = `mapmark${isSelf ? ' is-self' : ''}`;
  const m = new maplibre.Marker({ element: dot })
    .setLngLat([lon, lat])
    .setPopup(new maplibre.Popup({ offset: 14, closeButton: false }).setText(label))
    .addTo(map);
  markers.push(m);
  return m;
}

export function clearMarkers({ keepSelf = true } = {}) {
  markers = markers.filter((m) => {
    const self = m.getElement().classList.contains('is-self');
    if (self && keepSelf) return true;
    m.remove();
    return false;
  });
}

export function flyTo(lat, lon, zoom = 16) {
  if (map) map.flyTo({ center: [lon, lat], zoom, duration: 800 });
}

export function fitTo(points) {
  if (!map || !maplibre || !points.length) return;
  const b = new maplibre.LngLatBounds();
  for (const p of points) b.extend([p.lon, p.lat]);
  map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 700 });
}

export function destroyMap() {
  if (map) { map.remove(); map = null; }
  markers = [];
}

/* ── Place search ─────────────────────────────────────── */

/**
 * Search places with Photon. One small request; results are JSON, a few KB.
 * @returns {Promise<Array<{name:string, detail:string, lat:number, lon:number}>>}
 */
export async function searchPlaces(query, coords, langCode) {
  // Photon rejects some parameter combinations with a bare 400, so try the
  // richest request first and fall back rather than failing outright.
  // Its `lang` only supports a handful of values; anything else is a 400.
  const PHOTON_LANGS = ['en', 'de', 'fr', 'it'];
  const attempts = [];
  const base = { q: query, limit: '12' };

  if (coords && langCode && PHOTON_LANGS.includes(langCode)) {
    attempts.push({ ...base, lat: coords.lat, lon: coords.lon, lang: langCode });
  }
  if (coords) attempts.push({ ...base, lat: coords.lat, lon: coords.lon });
  attempts.push(base);

  const problems = [];
  for (const params of attempts) {
    const url = `${PHOTON}?${new URLSearchParams(params)}`;
    const projected = url.length + REQUEST_OVERHEAD + 6000;
    if (!budget.canSpend(projected)) {
      throw new Error(`Only ${formatBytes(budget.remainingBytes())} left in the meter.`);
    }

    let res;
    try {
      res = await fetch(url, { cache: 'no-store' });
    } catch {
      budget.record(REQUEST_OVERHEAD, 'map');
      throw new Error('Could not reach the search service.');
    }
    const text = await res.text();
    budget.record(url.length + REQUEST_OVERHEAD + text.length, 'map');

    if (!res.ok) {
      // Keep what the server said — a bare status code is useless to debug.
      const detail = text.slice(0, 120).replace(/\s+/g, ' ').trim();
      problems.push(`${Object.keys(params).join('+')} → ${res.status}${detail ? `: ${detail}` : ''}`);
      continue;
    }

    let data;
    try { data = JSON.parse(text); } catch { problems.push('unparseable reply'); continue; }

    const feats = (data && data.features) || [];
    return feats.map((f) => {
      const p = f.properties || {};
      const parts = [
        p.street && [p.street, p.housenumber].filter(Boolean).join(' '),
        p.city || p.town || p.village,
        p.country,
      ].filter(Boolean);
      return {
        name: p.name || parts[0] || 'Unnamed place',
        detail: [p.osm_value && p.osm_value.replace(/_/g, ' '), ...parts].filter(Boolean).join(' \u00b7 '),
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      };
    }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  }

  throw new Error(`Search failed. ${problems.join(' | ')}`);
}

export const STYLE_NAMES = Object.keys(STYLES);
