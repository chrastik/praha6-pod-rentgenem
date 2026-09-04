#!/usr/bin/env node
/**
 * Registr smluv pro MČ Praha 6 (IČO 00063703).
 *
 * Dva režimy, stejně jako u Prahy 8:
 *   BACKFILL=1  — projde měsíční open-data dumpy (data.smlouvy.gov.cz). Pomalé,
 *                 spouští se ručně nebo jednou za čas. Dumpy jsou velké, proto
 *                 se čtou proudově a hned filtrují podle IČO.
 *   výchozí     — denní přírůstek z živého vyhledávání s překryvem 7 dní
 *                 (registr může zpětně měnit i starší záznamy).
 */
import { fetchText } from './lib/http.mjs';
import { writeDataset, readItems, readDataset, parseDate, stripHtml } from './lib/util.mjs';

const ICO = process.env.ICO ?? '00063703';
const DUMP_INDEX = 'https://data.smlouvy.gov.cz/index.xml';
const HLEDANI = 'https://smlouvy.gov.cz/vyhledavani';

const stav = (await readDataset('smlouvy'))?.dumpStav ?? {};
const znami = new Map((await readItems('smlouvy')).map((s) => [s.id, s]));

if (process.env.BACKFILL === '1') {
  await backfill();
} else {
  await prirustek();
}

// ---------------------------------------------------------------------------
async function backfill() {
  const index = await fetchText(DUMP_INDEX);
  const dumpy = [...index.matchAll(/dump_(\d{4})_(\d{2})\.xml/g)]
    .map((m) => `dump_${m[1]}_${m[2]}.xml`);
  const unikatni = [...new Set(dumpy)].sort();
  console.log(`  ${unikatni.length} měsíčních dumpů v indexu`);

  for (const soubor of unikatni) {
    const url = `https://data.smlouvy.gov.cz/${soubor}`;
    if (stav[soubor]?.hotovo && !process.env.FORCE) { continue; }
    try {
      const xml = await fetchText(url, { timeoutMs: 300_000 });
      const nalezene = zaznamyProIco(xml);
      for (const s of nalezene) znami.set(s.id, s);
      stav[soubor] = { hotovo: true, nalezeno: nalezene.length, kdy: new Date().toISOString() };
      console.log(`  ${soubor}: ${nalezene.length} smluv`);
    } catch (err) {
      console.warn(`  ! ${soubor}: ${err.message}`);
    }
  }
  await uloz();
}

/** Proudové vytažení <zaznam> bloků, které obsahují naše IČO. */
function zaznamyProIco(xml) {
  const out = [];
  const re = /<zaznam\b[\s\S]*?<\/zaznam>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const blok = m[0];
    if (!blok.includes(ICO)) continue;
    out.push(parseZaznam(blok));
  }
  return out.filter(Boolean);
}

function parseZaznam(blok) {
  const t = (tag) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(blok)?.[1]?.trim();
  const id = t('identifikator') ?? t('idVerze') ?? t('ID');
  if (!id) return null;
  const castka = Number(
    (t('hodnotaBezDph') ?? t('hodnotaVcetneDph') ?? '').replace(/\s/g, '').replace(',', '.'),
  );
  return {
    id: String(id),
    predmet: t('predmet') ?? null,
    datum: parseDate(t('datumUzavreni')),
    castka: Number.isFinite(castka) ? castka : null,
    mena: t('mena') ?? 'CZK',
    protistrana: t('nazev') ?? null,
    protistranaIco: t('ico') ?? null,
    url: `https://smlouvy.gov.cz/smlouva/${id}`,
    zdroj: 'dump',
  };
}

// ---------------------------------------------------------------------------
async function prirustek() {
  const od = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const url = `${HLEDANI}?subject_idnum=${ICO}&publication_date%5Bfrom%5D=${od}&searchResultList-limit=100`;
  const html = await fetchText(url);

  const ids = [...new Set([...html.matchAll(/\/smlouva\/(\d+)/g)].map((m) => m[1]))];
  console.log(`  živé vyhledávání od ${od}: ${ids.length} smluv`);

  let novych = 0;
  for (const id of ids) {
    if (znami.has(id) && !process.env.FORCE) continue;
    try {
      const xml = await fetchText(
        `https://smlouvy.gov.cz/smlouva/${id}/registr_smluv_smlouva_${id}.xml`,
      );
      const s = parseZaznam(xml) ?? { id, url: `https://smlouvy.gov.cz/smlouva/${id}` };
      znami.set(id, { ...s, id, zdroj: 'live' });
      novych++;
    } catch (err) {
      console.warn(`  ! smlouva ${id}: ${err.message}`);
    }
  }
  console.log(`  nových: ${novych}`);
  await uloz();
}

async function uloz() {
  const items = [...znami.values()].sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''));
  const znamaHodnota = items.filter((s) => s.castka != null);
  await writeDataset('smlouvy', items, {
    ico: ICO,
    dumpStav: stav,
    souhrn: {
      sHodnotou: znamaHodnota.length,
      celkovaHodnota: znamaHodnota.reduce((a, s) => a + s.castka, 0),
    },
  });
}
