/**
 * Translation endpoint, as a Cloudflare Pages Function.
 *
 * This exists so the Worker can be deployed WITHOUT a computer. Drag the folder
 * into Cloudflare Pages and this file becomes POST /api/translate automatically
 * — no wrangler, no pasting into the dashboard code editor.
 *
 * One manual step remains, and it is taps rather than typing:
 *   Pages project → Settings → Functions → Bindings → Add → Workers AI
 *   Variable name:  AI
 *
 * Without that binding every request answers 503 with an explanation rather
 * than a bare 500, so it is obvious what is missing.
 *
 * Same-origin, so no CORS headers and no allowlist to maintain.
 */

const MODEL = '@cf/meta/m2m100-1.2b';

const MAX_ITEMS = 40;
const MAX_CHARS_PER_ITEM = 900;
const MAX_TOTAL_CHARS = 12000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

export async function onRequestPost({ request, env }) {
  if (!env.AI) {
    return json({
      error: 'No Workers AI binding. In the Pages project: Settings → Functions → Bindings → Add → Workers AI, with the variable name AI. Then redeploy.',
      needsBinding: true,
    }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const { items, source_lang: src, target_lang: tgt } = payload || {};

  if (!Array.isArray(items) || !items.length) {
    return json({ error: 'items must be a non-empty array of strings.' }, 400);
  }
  if (!src || !tgt) {
    return json({ error: 'source_lang and target_lang are required.' }, 400);
  }
  if (items.length > MAX_ITEMS) {
    return json({ error: `Too many items (max ${MAX_ITEMS}).` }, 413);
  }

  const clean = items.map((s) => String(s == null ? '' : s).slice(0, MAX_CHARS_PER_ITEM));
  const total = clean.reduce((n, s) => n + s.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    return json({ error: `Payload too large (${total} chars, max ${MAX_TOTAL_CHARS}).` }, 413);
  }

  if (src === tgt) {
    return json({ translations: clean, model: MODEL, passthrough: true });
  }

  try {
    // m2m100 takes one string per call, so the batching happens here at the
    // edge rather than over the phone's connection. One request in, one out.
    const translations = await Promise.all(
      clean.map(async (text) => {
        if (!text.trim()) return '';
        const out = await env.AI.run(MODEL, { text, source_lang: src, target_lang: tgt });
        return (out && out.translated_text) || '';
      })
    );
    return json({ translations, model: MODEL, count: translations.length });
  } catch (err) {
    return json({
      error: `Workers AI failed: ${err && err.message ? err.message : err}`,
    }, 502);
  }
}

/** A GET tells you whether the binding is wired up, without spending anything. */
export async function onRequestGet({ env }) {
  return json({
    ok: true,
    endpoint: '/api/translate',
    model: MODEL,
    binding: env.AI ? 'connected' : 'MISSING — add a Workers AI binding named AI in Settings → Functions',
  });
}
