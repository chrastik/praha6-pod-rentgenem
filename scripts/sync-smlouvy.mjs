#!/usr/bin/env node
/**
 * Registr smluv pro MČ Praha 6 (IČO 00063703).
 *
 * Dva režimy:
 *   BACKFILL=1  — projde měsíční open-data dumpy (data.smlouvy.gov.cz). Dumpy mají
 *                 stovky MB, proto se čtou PROUDOVĚ a filtrují za běhu; do paměti
 *                 se nikdy nenačte celý soubor.
 *   výchozí     — denní přírůstek z živého vyhledávání s překryvem 14 dní
 *                 (registr zpětně mění i starší záznamy).
 *
 * Dvě věci, na kterých se dá snadno naletět a které stály jeden tichý nulový běh:
 *   1. Vyhledávání chce datum ve tvaru DD.MM.RRRR. S ISO tvarem nevrátí chybu,
 *      jen skoro nic — což vypadá jako „za posledních 7 dní nic nepřibylo".
 *   2. XML detailu je na /smlouva/{id}/xml/…, ne na /smlouva/{id}/….
 */
import { fetchText, mapLimit } from './lib/http.mjs';
import { writeDataset, readItems, readDataset, parseDate } from './lib/util.mjs';

const ICO = process.env.ICO ?? '00063703';
const BASE = 'https://smlouvy.gov.cz';
const DUMP_BASE = 'https://data.smlouvy.gov.cz';
const PREKRYV_DNI = Number(process.env.PREKRYV_DNI ?? 14);

/** Registr smluv rozumí jen českému formátu data. */
const czDate = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${x.getFullYear()}`;
};

const stav = (await readDataset('smlouvy'))?.dumpStav ?? {};
const znami = new Map((await readItems('smlouvy')).map((s) => [s.id, s]));

// --------------------------------------------------------------- parsování ---
const tag = (xml, name) =>
  new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml)?.[1]?.trim();

const cislo = (v) => {
  if (!v) return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * Zpracuje jeden <zaznam> (z dumpu) i samostatné XML detailu smlouvy.
 * Struktura registru: <zaznam><identifikator><idSmlouvy>…  <smlouva><subjekt>…
 * <smluvniStrana>…  Publikující subjekt je naše MČ, protistrana je ta druhá.
 */
function parseZaznam(xml) {
  const identBlok = tag(xml, 'identifikator') ?? '';
  const id = tag(identBlok, 'idSmlouvy') ?? tag(identBlok, 'idVerze')
    ?? /\/smlouva\/(\d+)/.exec(tag(xml, 'odkaz') ?? '')?.[1]
    ?? (/^\d+$/.test(identBlok) ? identBlok : null);
  if (!id) return null;

  const smlouva = tag(xml, 'smlouva') ?? xml;

  // protistrana = první smluvní strana, která není naše IČO
  const strany = [...smlouva.matchAll(/<(?:\w+:)?smluvniStrana[^>]*>([\s\S]*?)<\/(?:\w+:)?smluvniStrana>/gi)]
    .map((m) => ({ nazev: tag(m[1], 'nazev'), ico: tag(m[1], 'ico') }));
  const protistrana = strany.find((s) => s.ico && s.ico !== ICO) ?? strany[0] ?? {};

  return {
    id: String(id),
    predmet: tag(smlouva, 'predmet') ?? null,
    cisloSmlouvy: tag(smlouva, 'cisloSmlouvy') ?? null,
    datum: parseDate(tag(smlouva, 'datumUzavreni')),
    zverejneno: parseDate(tag(xml, 'casZverejneni')),
    castkaBezDph: cislo(tag(smlouva, 'hodnotaBezDph')),
    castkaSDph: cislo(tag(smlouva, 'hodnotaVcetneDph')),
    mena: tag(smlouva, 'mena') ?? 'CZK',
    protistrana: protistrana.nazev ?? null,
    protistranaIco: protistrana.ico ?? null,
    url: `${BASE}/smlouva/${id}`,
  };
}

// ------------------------------------------------------------- inkrementálně ---
async function prirustek() {
  const od = czDate(new Date(Date.now() - PREKRYV_DNI * 864e5));
  const ids = new Set();

  for (let offset = 0; offset < 1000; offset += 100) {
    const url = `${BASE}/vyhledavani?subject_idnum=${ICO}`
      + `&publication_date%5Bfrom%5D=${encodeURIComponent(od)}`
      + `&searchResultList-limit=100&searchResultList-offset=${offset}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.warn(`  ! vyhledávání offset ${offset}: ${err.message}`); break; }

    const naStrance = [...new Set([...html.matchAll(/\/smlouva\/(\d+)/g)].map((m) => m[1]))];
    const nove = naStrance.filter((id) => !ids.has(id));
    nove.forEach((id) => ids.add(id));
    if (nove.length === 0) break;
  }

  console.log(`  zveřejněno od ${od}: ${ids.size} smluv`);
  if (ids.size === 0) {
    console.warn('  ! nula smluv za posledních ' + PREKRYV_DNI + ' dní — ověř formát data ve vyhledávání');
  }

  const kestazeni = [...ids].filter((id) => !znami.has(id) || process.env.FORCE);
  let novych = 0;
  await mapLimit(kestazeni, 3, async (id) => {
    try {
      const xml = await fetchText(`${BASE}/smlouva/${id}/xml/registr_smluv_smlouva_${id}.xml`);
      const s = parseZaznam(xml);
      znami.set(id, { ...(s ?? {}), id, url: `${BASE}/smlouva/${id}`, zdroj: 'live' });
      novych++;
    } catch (err) {
      console.warn(`  ! smlouva ${id}: ${err.message}`);
      if (!znami.has(id)) znami.set(id, { id, url: `${BASE}/smlouva/${id}`, zdroj: 'live-neuplna' });
    }
  });
  console.log(`  nově stažených detailů: ${novych}`);
  await uloz();
}

// ------------------------------------------------------------------ backfill ---
async function backfill() {
  const index = await fetchText(`${DUMP_BASE}/index.xml`);
  const soubory = [...new Set([...index.matchAll(/dump_(\d{4})_(\d{2})\.xml/g)].map((m) => m[0]))].sort();
  console.log(`  ${soubory.length} měsíčních dumpů v indexu`);

  for (const soubor of soubory) {
    if (stav[soubor]?.hotovo && !process.env.FORCE) continue;
    try {
      const nalezeno = await projdiDumpProudove(`${DUMP_BASE}/${soubor}`);
      for (const s of nalezeno) znami.set(s.id, { ...s, zdroj: 'dump' });
      stav[soubor] = { hotovo: true, nalezeno: nalezeno.length, kdy: new Date().toISOString() };
      console.log(`  ${soubor}: ${nalezeno.length} smluv MČ Praha 6`);
    } catch (err) {
      console.warn(`  ! ${soubor}: ${err.message}`);
      stav[soubor] = { hotovo: false, chyba: err.message, kdy: new Date().toISOString() };
    }
    await uloz(); // průběžně, aby výpadek nezahodil celý běh
  }
}

/**
 * Proudové čtení dumpu: drží v paměti jen rozpracovaný <zaznam>, ne celý soubor.
 * Bez tohohle by se několikasetmegový dump nevešel do jednoho JS řetězce.
 */
async function projdiDumpProudove(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'praha6-pod-rentgenem/0.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const dekoder = new TextDecoder('utf-8');
  const out = [];
  let zbytek = '';
  let mb = 0;

  for await (const chunk of res.body) {
    mb += chunk.length;
    zbytek += dekoder.decode(chunk, { stream: true });

    let konec;
    while ((konec = zbytek.indexOf('</zaznam>')) !== -1) {
      const zacatek = zbytek.lastIndexOf('<zaznam', 0) === 0 ? 0 : zbytek.indexOf('<zaznam');
      if (zacatek === -1 || zacatek > konec) { zbytek = zbytek.slice(konec + 9); continue; }
      const blok = zbytek.slice(zacatek, konec + 9);
      zbytek = zbytek.slice(konec + 9);
      if (blok.includes(ICO)) {
        const s = parseZaznam(blok);
        if (s) out.push(s);
      }
    }
    // nenechávat růst nedokončený zbytek donekonečna
    if (zbytek.length > 5_000_000) zbytek = zbytek.slice(-1_000_000);
  }
  console.log(`    (${(mb / 1048576).toFixed(0)} MB projito)`);
  return out;
}

// ----------------------------------------------------------------- uložení ---
async function uloz() {
  const items = [...znami.values()].sort((a, b) =>
    (b.zverejneno ?? b.datum ?? '').localeCompare(a.zverejneno ?? a.datum ?? ''));
  const sCastkou = items.filter((s) => s.castkaBezDph != null);
  await writeDataset('smlouvy', items, {
    ico: ICO,
    dumpStav: stav,
    souhrn: {
      sHodnotou: sCastkou.length,
      celkovaHodnota: sCastkou.reduce((a, s) => a + s.castkaBezDph, 0),
    },
  });
}

// ------------------------------------------------------------------ spuštění ---
// Až na konci: `const tag`, `cislo` a spol. jsou v dočasné mrtvé zóně, dokud se
// modul nedovyhodnotí. Volání nahoře by spadlo na "Cannot access before initialization".
if (process.env.BACKFILL === '1') await backfill();
else await prirustek();
