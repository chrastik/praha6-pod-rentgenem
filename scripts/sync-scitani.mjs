#!/usr/bin/env node
/**
 * Sčítání lidu, domů a bytů 2021 za MČ Praha 6 — otevřená data ČSÚ.
 *
 * Data jsou z rozhodného okamžiku 26. 3. 2021 a už se nemění, takže se skript
 * pouští ručně, ne na cronu. Soubory ČSÚ jdou až na úroveň základních sídelních
 * jednotek a největší z nich má přes 160 MB — proto se čtou proudově a filtrují
 * za běhu, do paměti se nikdy nenačte celý.
 *
 * Vlastní překlad dat do tvaru pro web je v lib/scitani.mjs, aby šel testovat bez sítě.
 */
import { ctiCsvProudove } from './lib/csv.mjs';
import { writeDataset } from './lib/util.mjs';
import { SADY, UZEMI, naseUzemi, sestav, zkontroluj } from './lib/scitani.mjs';

const syrove = {};
for (const [jmeno, url] of Object.entries(SADY)) {
  const t0 = Date.now();
  const { radky, prohlednuto, mb } = await ctiCsvProudove(url, naseUzemi);
  syrove[jmeno] = radky;
  console.log(`  ${jmeno.padEnd(11)} ${String(radky.length).padStart(3)} řádků za Prahu 6`
    + `  (z ${prohlednuto.toLocaleString('cs-CZ')}, ${mb.toFixed(0)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (radky.length === 0) {
    throw new Error(`${jmeno}: pro území ${UZEMI.cis}/${UZEMI.kod} nepřišel žádný řádek — změnil se formát nebo URL?`);
  }
}

const scitani = sestav(syrove);
const potize = zkontroluj(scitani);
if (potize.length) {
  console.error('\n  Vnitřní součty nesedí:');
  for (const p of potize) console.error(`   ✗ ${p}`);
  throw new Error('Data ze sčítání neprošla kontrolou — nepublikuji je.');
}

// writeDataset pracuje se seznamem záznamů; sčítání je jeden celek, zabalíme ho.
await writeDataset('scitani', [scitani], {
  poznamka: 'Sčítání 2021, MČ Praha 6 (uzemi_cis 44, uzemi_kod 500178). Data jsou konečná.',
});

console.log(`\n  obyvatel ${scitani.obyvatel.toLocaleString('cs-CZ')}`
  + ` · domácností ${scitani.domacnosti.celkem.toLocaleString('cs-CZ')}`
  + ` · domů ${scitani.domy.celkem.toLocaleString('cs-CZ')}`
  + ` · bytů ${scitani.byty.celkem.toLocaleString('cs-CZ')}`
  + '\n  všechny vnitřní součty souhlasí ✓');
