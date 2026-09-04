import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = path.resolve('data');

/**
 * Bezpečný zápis datasetu. Zásada převzatá z Prahy 8: selhání jednoho zdroje
 * nesmí přepsat poslední funkční dataset prázdným souborem.
 */
export async function writeDataset(name, records, meta = {}) {
  const file = path.join(DATA_DIR, `${name}.json`);
  const prev = await readDataset(name);
  const prevCount = Array.isArray(prev?.items) ? prev.items.length : 0;

  if (records.length === 0 && prevCount > 0) {
    throw new Error(`ODMÍTNUTO: ${name} by přišel o všech ${prevCount} záznamů. Zdroj je nejspíš rozbitý.`);
  }
  const dropRatio = prevCount ? 1 - records.length / prevCount : 0;
  if (dropRatio > 0.2 && !process.env.ALLOW_SHRINK) {
    throw new Error(
      `ODMÍTNUTO: ${name} klesá z ${prevCount} na ${records.length} (-${Math.round(dropRatio * 100)} %). ` +
      `Pokud je to správně, spusť s ALLOW_SHRINK=1.`,
    );
  }

  await mkdir(DATA_DIR, { recursive: true });
  const payload = {
    aktualizovano: new Date().toISOString(),
    pocet: records.length,
    ...meta,
    items: records,
  };
  await writeFile(file, JSON.stringify(payload), 'utf8');
  console.log(`✓ ${name}: ${records.length} záznamů (dříve ${prevCount})`);
  return payload;
}

export async function readDataset(name) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, `${name}.json`), 'utf8'));
  } catch { return null; }
}

export async function readItems(name) {
  return (await readDataset(name))?.items ?? [];
}

export async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/** Normalizace textu pro porovnávání — bez diakritiky, malá písmena, jedna mezera. */
export function norm(s) {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function stripHtml(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeEntities(s) {
  const named = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

/** "20. 4. 2026" | "20.4.2026" | "2026-04-20" → "2026-04-20" */
export function parseDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/.exec(s);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10);
}

/** Automatická témata podle názvu usnesení — stejný princip jako u Prahy 8. */
const TEMATA = [
  ['Majetek', /(?:^|[^\p{L}])(majetk|pronáj|nájem|prodej|koup|pozemk|nemovitost|byt[ůy]?|nebytov)/i],
  ['Smlouvy', /(?:^|[^\p{L}])(smlouv|dodatek|memorandum|dohod)/i],
  ['Finance', /(?:^|[^\p{L}])(rozpoč|dotac|finanč|účetn|závěrečn[ýá] účet|příspěv|úvěr)/i],
  ['Veřejné zakázky', /(?:^|[^\p{L}])(veřejn[áé] zakázk|výběrov[éá] řízen|zadávac)/i],
  ['Výstavba', /(?:^|[^\p{L}])(výstavb|stavebn|rekonstrukc|revitalizac|územní|developer|zástavb)/i],
  ['Doprava', /(?:^|[^\p{L}])(doprav|parkov|komunikac|cyklo|MHD|chodník)/i],
  ['Školství', /(?:^|[^\p{L}])(škol|mateřsk|základní škol|vzdělávac|družin)/i],
  ['Sociální', /(?:^|[^\p{L}])(sociáln|senior|pečovatel|zdravotn|hospic)/i],
  ['Kultura', /(?:^|[^\p{L}])(kultur|knihovn|divadl|galeri|festival)/i],
  ['Sport', /(?:^|[^\p{L}])(sport|hřišt|tělovýchov|bazén|stadion)/i],
  ['Životní prostředí', /(?:^|[^\p{L}])(životní prostřed|zeleň|odpad|park[uy]?\b|strom|ovzduš)/i],
  ['Personální', /(?:^|[^\p{L}])(jmenován|odvolán|tajemn|vedoucí odbor|komis[ei]|výbor)/i],
];

export function detectTemata(text) {
  const t = text ?? '';
  return TEMATA.filter(([, re]) => re.test(t)).map(([name]) => name);
}
