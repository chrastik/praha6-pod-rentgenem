// Extrakce vestavěného JSONu z webu praha6.cz.
// Web je statický generátor a celý datový obsah stránky ukládá do atributu
// <div id="js-data" data-vsechnadata="{...}">. Stačí GET, dekódovat entity a JSON.parse.
import { fetchText } from './http.mjs';
import { decodeEntities } from './util.mjs';

const ATTR_RE = /<div[^>]*\bid=["']js-data["'][^>]*\bdata-vsechnadata=(?:"([^"]*)"|'([^']*)')/i;
const ATTR_RE_LOOSE = /\bdata-vsechnadata=(?:"([^"]*)"|'([^']*)')/i;

export async function fetchJsData(url, opts = {}) {
  const html = await fetchText(url, opts);
  const m = ATTR_RE.exec(html) ?? ATTR_RE_LOOSE.exec(html);
  if (!m) {
    throw new Error(
      `Na ${url} chybí atribut data-vsechnadata. Web radnice nejspíš změnil šablonu — ` +
      `zkontroluj scripts/lib/jsdata.mjs.`,
    );
  }
  const raw = decodeEntities(m[1] ?? m[2] ?? '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`data-vsechnadata na ${url} není platný JSON: ${err.message}`);
  }
}

/**
 * Struktura obalu se čas od času mění, obsah ne. Projdeme strom a vezmeme
 * největší pole objektů — to je vždy seznam záznamů.
 */
export function largestRecordArray(node, depth = 0) {
  let best = [];
  const visit = (v, d) => {
    if (d > 8 || v == null) return;
    if (Array.isArray(v)) {
      const objs = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (objs.length > best.length) best = objs;
      v.forEach((x) => visit(x, d + 1));
      return;
    }
    if (typeof v === 'object') Object.values(v).forEach((x) => visit(x, d + 1));
  };
  visit(node, depth);
  return best;
}

/** Vrátí první neprázdnou hodnotu z kandidátních klíčů (case-insensitive). */
export function pick(obj, ...keys) {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Soubor může být string, {url}, {url,ext} nebo pole takových. */
export function fileUrl(v, base = 'https://www.praha6.cz') {
  if (!v) return null;
  if (typeof v === 'string') return absolutize(v, base);
  if (Array.isArray(v)) return v.map((x) => fileUrl(x, base)).filter(Boolean);
  if (typeof v === 'object') {
    const u = v.url ?? v.href ?? v.soubor ?? v.path;
    return u ? absolutize(String(u), base) : null;
  }
  return null;
}

export function absolutize(u, base = 'https://www.praha6.cz') {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return base.replace(/\/$/, '') + (u.startsWith('/') ? u : `/${u}`);
}
