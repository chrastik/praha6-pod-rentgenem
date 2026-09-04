#!/usr/bin/env node
/**
 * Sloučí archiv z webu (2002–2022) s portálem MARBES (2022+) do jednoho datasetu.
 *
 * Šev je v roce 2022, kde se oba zdroje překrývají. Pravidlo: pro daný orgán
 * a datum vyhrává MARBES (má plný text), z webu se doplní jen to, co v MARBESu není.
 */
import { readItems, writeDataset, norm } from './lib/util.mjs';

const web = await readItems('usneseni-web');
const marbes = await readItems('usneseni-marbes');

const klic = (u) => `${u.organ}|${u.datum ?? ''}|${norm(u.cislo ?? '') || norm(u.nazev).slice(0, 60)}`;

const mapa = new Map();
for (const u of web) mapa.set(klic(u), u);

let prepsano = 0;
for (const u of marbes) {
  const k = klic(u);
  if (mapa.has(k)) prepsano++;
  mapa.set(k, u); // MARBES vyhrává — má plný text
}

const items = [...mapa.values()]
  .filter((u) => u.datum)
  .sort((a, b) => b.datum.localeCompare(a.datum));

const roky = {};
const organy = {};
for (const u of items) {
  roky[u.rok] = (roky[u.rok] ?? 0) + 1;
  organy[u.organ] = (organy[u.organ] ?? 0) + 1;
}

console.log(`  web ${web.length} + MARBES ${marbes.length} → ${items.length} (${prepsano} duplicit na švu)`);
await writeDataset('usneseni', items, {
  roky, organy, duplicityNaSvu: prepsano,
  rozsah: { od: items.at(-1)?.datum, do: items[0]?.datum },
});
