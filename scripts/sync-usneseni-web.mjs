#!/usr/bin/env node
/**
 * Archiv usnesení 2002–2022 z webu praha6.cz (vestavěný JSON).
 *
 * Pozor: od prosince 2023 přenos z nového systému na web nefunguje, takže tenhle
 * zdroj je autoritativní jen do roku 2022. Novější období řeší sync-usneseni-marbes.mjs.
 */
import { fetchJsData, largestRecordArray, pick, fileUrl } from './lib/jsdata.mjs';
import { writeDataset, parseDate, detectTemata } from './lib/util.mjs';

const ZDROJE = [
  {
    organ: 'RMC',
    nazev: 'Rada MČ Praha 6',
    url: 'https://www.praha6.cz/cs/uredni-deska/zapisy-usneseni/usneseni-rady.html',
  },
  {
    organ: 'ZMC',
    nazev: 'Zastupitelstvo MČ Praha 6',
    url: 'https://www.praha6.cz/cs/uredni-deska/zapisy-usneseni/usneseni-zastupitelstva.html',
  },
];

function toUsneseni(rec, organ) {
  const datum = parseDate(pick(rec, 'datum', 'date', 'datumJednani'));
  const cislo = String(pick(rec, 'cislo', 'tag', 'cisloUsneseni', 'number') ?? '').trim();
  const nazev = String(pick(rec, 'nazev', 'title', 'popis', 'name') ?? '').trim();
  if (!datum && !cislo && !nazev) return null;

  const soubor = fileUrl(pick(rec, 'soubor', 'file', 'dokument'));
  const prilohy = [pick(rec, 'prilohy', 'attachments', 'priloha')]
    .flat().map((p) => fileUrl(p)).flat().filter(Boolean);

  return {
    id: `web:${organ}:${cislo || datum}:${hash(nazev)}`,
    organ,
    cislo: cislo || null,
    datum,
    rok: datum ? Number(datum.slice(0, 4)) : null,
    nazev,
    soubor: Array.isArray(soubor) ? soubor[0] : soubor,
    prilohy,
    temata: detectTemata(nazev),
    zdroj: 'web',
    zdrojUrl: ZDROJE.find((z) => z.organ === organ).url,
  };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const zaznamy = [];
const prehled = {};

for (const zdroj of ZDROJE) {
  const data = await fetchJsData(zdroj.url);
  const raw = largestRecordArray(data);
  const items = raw.map((r) => toUsneseni(r, zdroj.organ)).filter(Boolean);
  console.log(`  ${zdroj.nazev}: ${raw.length} surových → ${items.length} usnesení`);
  zaznamy.push(...items);

  const roky = {};
  for (const u of items) if (u.rok) roky[u.rok] = (roky[u.rok] ?? 0) + 1;
  prehled[zdroj.organ] = { pocet: items.length, roky };
}

zaznamy.sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''));
await writeDataset('usneseni-web', zaznamy, { prehled, poznamka: 'Autoritativní do roku 2022 včetně.' });
