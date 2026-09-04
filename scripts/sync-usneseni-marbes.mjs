#!/usr/bin/env node
/**
 * Usnesení od volebního období 2022 z portálu MARBES (usneseni.praha6.cz:1190).
 *
 * Proč zvlášť: web radnice od prosince 2023 publikuje jen zlomek usnesení
 * (ZMČ 171 v roce 2022 → jednotky dnes). Autoritativní zdroj je tenhle portál,
 * kde je navíc plný text usnesení přímo v HTML — nemusíme parsovat .doc.
 *
 * Běh je inkrementální: co už je v datasetu, se znovu nestahuje. Plný přeběh
 * vynutíš proměnnou FULL=1.
 */
import { fetchText, mapLimit } from './lib/http.mjs';
import { writeDataset, readItems, parseDate, stripHtml, detectTemata, decodeEntities } from './lib/util.mjs';

const BASE = 'https://usneseni.praha6.cz:1190';
const ORGANY = [
  { id: 1, kod: 'ZMC', nazev: 'Zastupitelstvo MČ Praha 6' },
  { id: 2, kod: 'RMC', nazev: 'Rada MČ Praha 6' },
];
const ROKY = rangeYears(2022);
const FULL = process.env.FULL === '1';
const PARALEL = Number(process.env.PARALEL ?? 3);

function rangeYears(from) {
  const to = new Date().getFullYear();
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const drive = await readItems('usneseni-marbes');
const znameUsneseni = new Map(drive.map((u) => [u.marbesId, u]));

// ---- 1) seznamy jednání -----------------------------------------------------
const jednani = [];
for (const organ of ORGANY) {
  for (const rok of ROKY) {
    const url = `${BASE}/usneseni/jednani?id_organ=${organ.id}&rok=${rok}&display=past`;
    let html;
    try { html = await fetchText(url); }
    catch (err) { console.warn(`  ! ${organ.kod} ${rok}: ${err.message}`); continue; }

    const ids = new Set([...html.matchAll(/\/usneseni\/jednani\/(\d+)/g)].map((m) => m[1]));
    for (const id of ids) jednani.push({ id, organ: organ.kod, organNazev: organ.nazev, rok });
    console.log(`  ${organ.kod} ${rok}: ${ids.size} jednání`);
  }
}
if (jednani.length === 0) {
  throw new Error(
    'MARBES nevrátil žádná jednání. Portál běží na nestandardním portu 1190 — ' +
    'ověř dostupnost a případně změnu URL schématu.',
  );
}

// ---- 2) usnesení v jednáních ------------------------------------------------
const odkazy = [];
await mapLimit(jednani, PARALEL, async (j) => {
  let html;
  try { html = await fetchText(`${BASE}/usneseni/jednani/${j.id}`); }
  catch (err) { console.warn(`  ! jednání ${j.id}: ${err.message}`); return; }

  const datum = parseDate(/(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/.exec(stripHtml(html))?.[1]);
  const ids = new Set([...html.matchAll(/\/usneseni\/usneseni\/(\d+)/g)].map((m) => m[1]));
  for (const id of ids) odkazy.push({ ...j, marbesId: id, jednaniDatum: datum });
});

const nove = FULL ? odkazy : odkazy.filter((o) => !znameUsneseni.has(o.marbesId));
console.log(`  celkem ${odkazy.length} usnesení, ke stažení ${nove.length}`);

// ---- 3) detaily -------------------------------------------------------------
const stazeno = [];
await mapLimit(nove, PARALEL, async (o) => {
  let html;
  try { html = await fetchText(`${BASE}/usneseni/usneseni/${o.marbesId}`); }
  catch (err) { console.warn(`  ! usnesení ${o.marbesId}: ${err.message}`); return; }
  stazeno.push(parseUsneseni(html, o));
});

function parseUsneseni(html, o) {
  const text = stripHtml(html);
  const cislo =
    /\b((?:ZMČ|RMČ|USN|Usn)[-\s]?\d{3,4}\/\d{2,4})/.exec(text)?.[1] ??
    /\b(\d{3,4}\/\d{2,4})\b/.exec(text)?.[1] ?? null;
  const datum = o.jednaniDatum ?? parseDate(/(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/.exec(text)?.[1]);
  const nazev = decodeEntities(
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ??
    /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '',
  ).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  const prilohy = [...html.matchAll(/href="(\/usneseni\/[^"]*priloha[^"]*)"/gi)]
    .map((m) => BASE + decodeEntities(m[1]));

  return {
    id: `marbes:${o.marbesId}`,
    marbesId: o.marbesId,
    organ: o.organ,
    organNazev: o.organNazev,
    cislo,
    datum,
    rok: datum ? Number(datum.slice(0, 4)) : o.rok,
    nazev,
    text,                                  // plný text usnesení — jádro fulltextu
    prilohy,
    temata: detectTemata(`${nazev} ${text}`),
    jednaniId: o.id,
    zdroj: 'marbes',
    zdrojUrl: `${BASE}/usneseni/usneseni/${o.marbesId}`,
  };
}

const vysledek = [...znameUsneseni.values()];
const mapa = new Map(vysledek.map((u) => [u.marbesId, u]));
for (const u of stazeno) mapa.set(u.marbesId, u);

const items = [...mapa.values()].sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''));
await writeDataset('usneseni-marbes', items, {
  jednani: jednani.length,
  novaUsneseni: stazeno.length,
  poznamka: 'Autoritativní zdroj pro volební období od 2022.',
});
