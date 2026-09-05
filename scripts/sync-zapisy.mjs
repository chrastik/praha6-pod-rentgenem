#!/usr/bin/env node
/** Programy a zápisy ze zasedání všech orgánů — stejný vestavěný JSON. */
import { fetchJsData, largestRecordArray, pick, fileUrl } from './lib/jsdata.mjs';
import { writeDataset, parseDate } from './lib/util.mjs';

const URL_ZAPISY = 'https://www.praha6.cz/cs/uredni-deska/zapisy-usneseni/zapisy-zasedani.html';

const data = await fetchJsData(URL_ZAPISY);
const raw = largestRecordArray(data);

/**
 * Týž zápis radnice občas zveřejní dvakrát pod jiným názvem souboru. Klíč
 * z data, orgánu a čísla je pak u obou stejný a v seznamu se objeví duplicitně.
 * Přípona #2 je oddělí — jsou to dva různé dokumenty téhož jednání.
 */
const pouziteId = new Set();
function unikatniId(zaklad) {
  if (!pouziteId.has(zaklad)) { pouziteId.add(zaklad); return zaklad; }
  let n = 2;
  while (pouziteId.has(`${zaklad}#${n}`)) n++;
  const id = `${zaklad}#${n}`;
  pouziteId.add(id);
  return id;
}

const items = raw.map((r) => {
  const datum = parseDate(pick(r, 'datum', 'date'));
  const organ = String(pick(r, 'komise', 'organ', 'orgán', 'nazev') ?? '').trim();
  return {
    id: unikatniId(`zapis:${datum ?? '?'}:${organ}:${pick(r, 'cislo') ?? ''}`),
    datum,
    rok: datum ? Number(datum.slice(0, 4)) : null,
    cislo: pick(r, 'cislo', 'number') ?? null,
    organ: organ || 'Nezařazeno',
    volebniObdobi: pick(r, 'volebniObdobi', 'obdobi') ?? null,
    program: fileUrl(pick(r, 'programSoubor', 'program')),
    zapis: fileUrl(pick(r, 'soubor', 'zapis', 'file')),
    stenozaznam: fileUrl(pick(r, 'stenozaznamSoubor', 'stenozaznam')),
  };
}).filter((x) => x.datum || x.zapis);

items.sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''));

const podleOrganu = {};
for (const z of items) podleOrganu[z.organ] = (podleOrganu[z.organ] ?? 0) + 1;

console.log(`  ${raw.length} surových → ${items.length} zápisů, ${Object.keys(podleOrganu).length} orgánů`);
await writeDataset('zapisy', items, { podleOrganu });
