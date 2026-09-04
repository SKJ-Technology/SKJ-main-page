// Wikitext to readable prose.
//
// This was regex-based and it leaked badly. Two reasons, both structural:
//
//   1. Templates nest. A non-greedy /\{\{[\s\S]*?\}\}/ stops at the FIRST "}}",
//      which is an inner one, so the outer template's tail spills onto the page.
//   2. Splitting fields on /\|(?![^\[]*\]\])/ was meant to protect pipes inside
//      links, but the lookahead reaches to the end of the string: one "]]"
//      anywhere later made every earlier pipe fail to split, so a whole listing
//      came out as "Name | email= | address= | lat=…".
//
// Both need a scanner that tracks depth, not a regex. Hence this file.

const LISTING = /^(see|do|eat|drink|sleep|buy|listing|marker|vcard|go|learn|work)$/i;
const DROP_LINK = /^(file|image|category|media)\s*:/i;

/** Split template fields on top-level pipes only. */
function splitFields(inner) {
  const out = [];
  let buf = '';
  let square = 0;
  let curly = 0;

  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    const n = inner[i + 1];
    if (c === '[' && n === '[') { square++; buf += '[['; i++; continue; }
    if (c === ']' && n === ']') { square--; buf += ']]'; i++; continue; }
    if (c === '{' && n === '{') { curly++; buf += '{{'; i++; continue; }
    if (c === '}' && n === '}') { curly--; buf += '}}'; i++; continue; }
    if (c === '|' && square <= 0 && curly <= 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out;
}

/**
 * Replace every balanced {{…}} using `render`, innermost first so nesting works.
 * Returns the text with templates resolved.
 */
function resolveTemplates(text, render, depth = 0) {
  if (depth > 6) return text;

  let out = '';
  let i = 0;
  let changed = false;

  while (i < text.length) {
    if (text[i] === '{' && text[i + 1] === '{') {
      // Walk forward to the matching close.
      let level = 0;
      let j = i;
      let end = -1;
      while (j < text.length) {
        if (text[j] === '{' && text[j + 1] === '{') { level++; j += 2; continue; }
        if (text[j] === '}' && text[j + 1] === '}') {
          level--;
          j += 2;
          if (level === 0) { end = j; break; }
          continue;
        }
        j++;
      }
      if (end === -1) { out += text.slice(i); break; }  // unbalanced, bail out

      const whole = text.slice(i, end);
      const inner = whole.slice(2, -2);
      // Resolve anything nested inside before rendering this one.
      const resolvedInner = resolveTemplates(inner, render, depth + 1);
      out += render(resolvedInner);
      changed = true;
      i = end;
      continue;
    }
    out += text[i];
    i++;
  }

  return changed ? out : text;
}

/** Turn one template body into text, or drop it. */
function renderTemplate(inner) {
  const parts = splitFields(inner);
  const name = (parts[0] || '').trim().toLowerCase();

  if (!LISTING.test(name)) return '';

  const f = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    if (val) f[key] = val;
  }

  if (!f.name && !f.content && !f.alt) return '';
  const head = [f.name || f.alt, f.address, f.hours, f.price].filter(Boolean).join(' \u00b7 ');
  if (!f.content) return head ? `${head}\n` : '';
  return `${head}\n${f.content}\n`;
}

/** Resolve [[links]], dropping files and keeping the display label. */
function resolveLinks(text) {
  let out = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] === '[' && text[i + 1] === '[') {
      let level = 0;
      let j = i;
      let end = -1;
      while (j < text.length) {
        if (text[j] === '[' && text[j + 1] === '[') { level++; j += 2; continue; }
        if (text[j] === ']' && text[j + 1] === ']') {
          level--;
          j += 2;
          if (level === 0) { end = j; break; }
          continue;
        }
        j++;
      }
      if (end === -1) { out += text.slice(i); break; }

      const inner = text.slice(i + 2, end - 2);
      if (DROP_LINK.test(inner.trim())) {
        // An image. Its caption is the last field, but it is decoration here.
        out += '';
      } else {
        // A wiki link: the label is the LAST pipe-separated field, not the second.
        const fields = splitFields(inner);
        out += (fields[fields.length - 1] || '').trim();
      }
      i = end;
      continue;
    }
    out += text[i];
    i++;
  }

  return out;
}

/**
 * Full clean-up. Order matters: templates, then links, then the plain markup.
 */
export function cleanWikitext(raw, limit = 2600) {
  let t = String(raw || '');

  t = resolveTemplates(t, renderTemplate);
  t = resolveLinks(t);

  t = t
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/^={2,}\s*(.*?)\s*={2,}\s*$/gm, '\n$1\n')
    .replace(/^[*#:;]+\s*/gm, '\u00b7 ')
    .replace(/^(?:\u00b7\s*){2,}/gm, '\u00b7 ')
    .replace(/^\u00b7\s*$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return t.length > limit ? `${t.slice(0, limit).replace(/\s+\S*$/, '')}…` : t;
}
