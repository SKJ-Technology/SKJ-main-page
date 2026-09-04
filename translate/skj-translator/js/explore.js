// Guide content from Wikimedia. Needs a connection — that is the point of it.
//
//   what's around me   Wikipedia geosearch (Extension:GeoData)
//   city guides        Wikivoyage, which runs the same geosearch module
//
// Both are keyless. `origin=*` is what makes an anonymous browser request get
// the Access-Control-Allow-Origin header back. No images are fetched: thumbnails
// would cost more than every text call in this file put together.

import { budget, formatBytes, REQUEST_OVERHEAD } from './budget.js';
import { cleanWikitext } from './wikitext.js';

const WIKI = (lang) => `https://${lang}.wikipedia.org/w/api.php`;
const VOYAGE = 'https://en.wikivoyage.org/w/api.php';
const VOYAGE_REST = 'https://en.wikivoyage.org/api/rest_v1/page/summary/';

async function getJSON(url, kind = 'map') {
  const projected = url.length + REQUEST_OVERHEAD + 6000;
  if (!budget.canSpend(projected)) {
    throw new Error(`Only ${formatBytes(budget.remainingBytes())} left in the meter.`);
  }

  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    budget.record(REQUEST_OVERHEAD, kind);
    throw new Error('Could not reach Wikimedia.');
  }
  const text = await res.text();
  budget.record(url.length + REQUEST_OVERHEAD + text.length, kind);

  if (!res.ok) throw new Error(`Wikimedia returned ${res.status}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Wikimedia did not return JSON.');
  }
}

/* ── What's around me ─────────────────────────────────── */

/**
 * Wikipedia articles with coordinates near a point.
 * @returns {Promise<Array<{title:string, lat:number, lon:number, metres:number, pageid:number}>>}
 */
export async function around(coords, { radius = 1000, limit = 20, wikiLang = 'en' } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'geosearch',
    gscoord: `${coords.lat}|${coords.lon}`,
    gsradius: String(radius),
    gslimit: String(limit),
    format: 'json',
    formatversion: '2',
    origin: '*',
  });

  const data = await getJSON(`${WIKI(wikiLang)}?${params}`);
  const list = (data && data.query && data.query.geosearch) || [];
  return list.map((p) => ({
    title: p.title,
    lat: p.lat,
    lon: p.lon,
    metres: Math.round(p.dist),
    pageid: p.pageid,
  }));
}

/**
 * A short plain-text extract for one article. Kept to the intro only.
 */
export async function extract(title, wikiLang = 'en') {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    redirects: '1',
    titles: title,
    format: 'json',
    formatversion: '2',
    origin: '*',
  });

  const data = await getJSON(`${WIKI(wikiLang)}?${params}`);
  const page = data && data.query && data.query.pages && data.query.pages[0];
  const text = (page && page.extract) || '';
  // Trim to something readable on a phone rather than dumping a whole lead.
  const trimmed = text.length > 900 ? `${text.slice(0, 900).replace(/\s+\S*$/, '')}…` : text;
  return { title: (page && page.title) || title, text: trimmed };
}

export const articleUrl = (title, wikiLang = 'en') =>
  `https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/* ── City guides from Wikivoyage ──────────────────────── */

/**
 * The nearest Wikivoyage destination articles. Wikivoyage runs the same
 * geosearch module, so "what city am I in" is one request.
 */
export async function nearestDestinations(coords, { radius = 10000, limit = 5 } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'geosearch',
    gscoord: `${coords.lat}|${coords.lon}`,
    gsradius: String(radius),
    gslimit: String(limit),
    format: 'json',
    formatversion: '2',
    origin: '*',
  });

  const data = await getJSON(`${VOYAGE}?${params}`);
  const list = (data && data.query && data.query.geosearch) || [];
  return list.map((p) => ({ title: p.title, metres: Math.round(p.dist), lat: p.lat, lon: p.lon }));
}

/** Wikivoyage's own summary of a destination. */
export async function destinationSummary(title) {
  const url = `${VOYAGE_REST}${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const data = await getJSON(url);
  return {
    title: data.title || title,
    text: data.extract || '',
    url: (data.content_urls && data.content_urls.mobile && data.content_urls.mobile.page)
      || `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
  };
}

/**
 * Named sections of a Wikivoyage page — "See", "Eat", "Get around" and so on,
 * which is where the actually useful travel advice lives.
 */
export async function destinationSection(title, sectionName) {
  // Section indices differ per page, so ask for the table of contents first.
  const toc = await getJSON(`${VOYAGE}?${new URLSearchParams({
    action: 'parse', page: title, prop: 'sections', format: 'json', formatversion: '2', origin: '*',
  })}`);
  const sections = (toc && toc.parse && toc.parse.sections) || [];
  const match = sections.find((s) => s.line.toLowerCase() === sectionName.toLowerCase());
  if (!match) return null;

  const data = await getJSON(`${VOYAGE}?${new URLSearchParams({
    action: 'parse', page: title, prop: 'wikitext', section: match.index,
    format: 'json', formatversion: '2', origin: '*',
  })}`);
  const raw = (data && data.parse && data.parse.wikitext) || '';
  return { name: match.line, text: cleanWikitext(raw) };
}

export const VOYAGE_SECTIONS = ['See', 'Do', 'Eat', 'Drink', 'Get around', 'Sleep', 'Stay safe'];

export const metres = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
