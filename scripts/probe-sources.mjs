#!/usr/bin/env node
/**
 * Rychlý test dostupnosti všech zdrojů. Tohle spusť jako první v GitHub Actions —
 * řekne ti během půl minuty, co je živé a co se od poslední analýzy změnilo.
 */
import { fetchText } from './lib/http.mjs';

const ZDROJE = [
  ['web · usnesení rady',      'https://www.praha6.cz/cs/uredni-deska/zapisy-usneseni/usneseni-rady.html', /data-vsechnadata/],
  ['web · usnesení ZMČ',       'https://www.praha6.cz/cs/uredni-deska/zapisy-usneseni/usneseni-zastupitelstva.html', /data-vsechnadata/],
  ['web · zápisy',             'https://www.praha6.cz/cs/uredni-deska/zapisy-usneseni/zapisy-zasedani.html', /data-vsechnadata/],
  ['web · úřední deska',       'https://www.praha6.cz/cs/uredni-deska/uredni-deska-rozcestnik.html', /data-vsechnadata/],
  ['MARBES · jednání ZMČ',     'https://usneseni.praha6.cz:1190/usneseni/jednani?id_organ=1', /\/usneseni\/jednani\/\d+/],
  ['MARBES · jednání RMČ',     'https://usneseni.praha6.cz:1190/usneseni/jednani?id_organ=2', /\/usneseni\/jednani\/\d+/],
  ['CityVizor · profil',       'https://cityvizor.praha.eu/api/public/profiles/praha6', /"id"/],
  ['Registr smluv · index',    'https://data.smlouvy.gov.cz/index.xml', /dump_\d{4}_\d{2}\.xml/],
  ['Registr smluv · hledání',  'https://smlouvy.gov.cz/vyhledavani?subject_idnum=00063703', /smlouva\/\d+/],
  ['Interpelace',              'https://interpelace.praha6.cz/prehled', /interpelac/i],
  ['Monitor SP · účetní jednotka', 'https://monitor.statnipokladna.gov.cz/api/ucetni-jednotka/00063703', /Praha/],
];

let selhalo = 0;
for (const [nazev, url, ocekavano] of ZDROJE) {
  const t0 = Date.now();
  try {
    const text = await fetchText(url, { retries: 1, timeoutMs: 30_000 });
    const sedi = ocekavano.test(text);
    if (!sedi) selhalo++;
    console.log(
      `${sedi ? '✓' : '✗'} ${nazev.padEnd(32)} ${String(Date.now() - t0).padStart(6)} ms  ` +
      `${(text.length / 1024).toFixed(0).padStart(7)} kB` +
      (sedi ? '' : '  ← obsah neodpovídá očekávání'),
    );
  } catch (err) {
    selhalo++;
    console.log(`✗ ${nazev.padEnd(32)} ${err.message}`);
  }
}
console.log(selhalo ? `\n${selhalo} zdrojů vyžaduje pozornost.` : '\nVšechny zdroje odpovídají.');
