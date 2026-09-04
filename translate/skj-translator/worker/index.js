/**
 * SKJ Translator — translation endpoint.
 *
 * Runs on your own Cloudflare account using Workers AI. No API keys in the
 * client, no third party, nothing to rate-limit you but yourself.
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler deploy
 *
 * Then paste the resulting URL into js/config.js as CONFIG.remote.url.
 */

const MODEL = '@cf/meta/m2m100-1.2b';

// Mirror of the client-side cap. The client is the polite limit; this is the
// one that actually holds, because anyone can call a public URL.
const MAX_ITEMS = 40;
const MAX_CHARS_PER_ITEM = 900;
const MAX_TOTAL_CHARS = 12000;

// Set to your own site to stop other people spending your neurons.
const ALLOWED_ORIGINS = [
  'https://skj-tech.online',
  'https://translate.skj-tech.online',
  'http://localhost:8000',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Body must be JSON' }, 400, origin);
    }

    const { items, source_lang: src, target_lang: tgt } = payload || {};

    if (!Array.isArray(items) || !items.length) {
      return json({ error: 'items must be a non-empty array of strings' }, 400, origin);
    }
    if (!src || !tgt) {
      return json({ error: 'source_lang and target_lang are required' }, 400, origin);
    }
    if (items.length > MAX_ITEMS) {
      return json({ error: `Too many items (max ${MAX_ITEMS})` }, 413, origin);
    }

    const clean = items.map((s) => String(s == null ? '' : s).slice(0, MAX_CHARS_PER_ITEM));
    const total = clean.reduce((n, s) => n + s.length, 0);
    if (total > MAX_TOTAL_CHARS) {
      return json({ error: `Payload too large (${total} chars, max ${MAX_TOTAL_CHARS})` }, 413, origin);
    }

    if (src === tgt) {
      return json({ translations: clean, model: MODEL, passthrough: true }, 200, origin);
    }

    try {
      // m2m100 takes one string per call, so the batching happens here at the
      // edge rather than over the phone's connection. One request in, one out.
      const results = await Promise.all(
        clean.map(async (text) => {
          if (!text.trim()) return '';
          const out = await env.AI.run(MODEL, {
            text,
            source_lang: src,
            target_lang: tgt,
          });
          return (out && out.translated_text) || '';
        })
      );

      return json({ translations: results, model: MODEL, count: results.length }, 200, origin);
    } catch (err) {
      return json({ error: `Workers AI failed: ${err && err.message ? err.message : err}` }, 502, origin);
    }
  },
};
