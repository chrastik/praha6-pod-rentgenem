#!/usr/bin/env node
/**
 * Interpelace zastupitelů a občanů (interpelace.praha6.cz).
 *
 * Portál má veřejné API, které vrátí celou historii v jednom volání. Veřejná
 * tabulka na portálu ukazuje jen aktuální rok, takže scrapovat HTML by znamenalo
 * přijít o sedm let dozadu.
 *
 * Zapisují se dva druhy souborů:
 *   data/interpelace.json          — přehled bez textů (kolem 200 kB)
 *   data/interpelace-texty/<rok>.json — plné znění a odpovědi, po letech
 * Prohlížeč tak stáhne seznam hned a text až u konkrétní interpelace.
 */
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fetchJson } from './lib/http.mjs';
import { writeDataset, DATA_DIR } from './lib/util.mjs';
import { sestav, zkontroluj, API, BASE } from './lib/interpelace.mjs';

const TEXTY_DIR = path.join(DATA_DIR, 'interpelace-texty');

console.log(`  stahuji ${API}`);
const odpoved = await fetchJson(API);

if (odpoved?.status !== 'ok' || !Array.isArray(odpoved.data)) {
  throw new Error('API interpelací neodpovědělo očekávaným tvarem '
    + `(status ${odpoved?.status ?? '—'}, result ${JSON.stringify(odpoved?.result ?? null)}). `
    + 'Data nepřepisuji.');
}
console.log(`  API vrátilo ${odpoved.data.length} záznamů`);

const vysledek = sestav(odpoved.data);
const potize = zkontroluj(vysledek);
if (potize.length) {
  for (const p of potize) console.error(`  ✗ ${p}`);
  throw new Error('Interpelace neprošly kontrolou — data nepřepisuji.');
}

// ---- roční soubory s plnými texty ------------------------------------------
await mkdir(TEXTY_DIR, { recursive: true });
const chceme = new Set([...vysledek.podleRoku.keys()].map((r) => `${r}.json`));
for (const soubor of await readdir(TEXTY_DIR).catch(() => [])) {
  // Ročníky, které API přestalo vracet, by jinak zůstaly viset navždy.
  if (soubor.endsWith('.json') && !chceme.has(soubor)) {
    await rm(path.join(TEXTY_DIR, soubor));
    console.log(`  odstraněn zastaralý ročník ${soubor}`);
  }
}
for (const [rok, detaily] of [...vysledek.podleRoku].sort((a, b) => b[0] - a[0])) {
  await writeFile(path.join(TEXTY_DIR, `${rok}.json`),
    JSON.stringify({ rok, pocet: detaily.length, items: detaily }), 'utf8');
}
console.log(`  texty rozděleny do ${vysledek.podleRoku.size} ročních souborů`);

// ---- přehled ---------------------------------------------------------------
const s = vysledek.souhrn;
await writeDataset('interpelace', vysledek.items, {
  zdroj: BASE,
  souhrn: s,
  poznamka: 'Interpelace podané na zasedáních zastupitelstva MČ Praha 6. '
    + 'Jména tazatelů i doslovné přepisy vystoupení zveřejňuje sama radnice '
    + 'na interpelace.praha6.cz; tady se jen přebírají. Plné texty jsou '
    + 'v data/interpelace-texty/<rok>.json.',
});

console.log(`\n  ${s.celkem} interpelací · ${s.zastupitele} od zastupitelů, ${s.obcane} od občanů`);
console.log(`  s odpovědí ${s.sOdpovedi}, bez odpovědi ${s.bezOdpovedi} · ${s.tazatelu} různých tazatelů`);
console.log(`  roky: ${s.roky.map((r) => `${r.rok} (${r.pocet})`).join(', ')}`);
