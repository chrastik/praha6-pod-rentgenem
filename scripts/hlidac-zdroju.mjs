#!/usr/bin/env node
/**
 * Hlídač zdrojů. Scraper může měsíce běžet zeleně a přitom nic nepřinášet —
 * zdroj prostě přestane publikovat. Přesně to se stalo faktur: CityVizor dostal
 * z účetnictví poslední dávku v lednu 2025 a další až po roce. Nikomu to
 * nespadlo, nikde se to nerozsvítilo, jen v datech chyběla miliarda a půl.
 *
 * Tenhle skript se dívá na to jediné, co o tom vypovídá: jak starý je nejnovější
 * záznam v každém datasetu. Limity nejsou odhad od stolu, každý má svůj důvod
 * napsaný u sebe.
 *
 *   node scripts/hlidac-zdroju.mjs              # výpis, kód 1 když něco spí
 *   node scripts/hlidac-zdroju.mjs --markdown   # tělo pro issue
 */
import { readDataset } from './lib/util.mjs';
import { stariDni } from './lib/finance.mjs';

const DNES = new Date();

const ZDROJE = [
  {
    name: 'usneseni', popis: 'Usnesení rady a zastupitelstva', pole: 'datum', dni: 60,
    proc: 'Rada zasedá zhruba jednou za dva týdny, přes prázdniny řidčeji.',
  },
  {
    name: 'smlouvy', popis: 'Registr smluv', pole: 'zverejneno', dni: 14,
    proc: 'Registr publikuje průběžně a přírůstek se stahuje denně.',
  },
  {
    name: 'faktury', popis: 'Faktury z CityVizoru', pole: 'datum', dni: 45,
    proc: 'Radnice nahrává dávku po měsících; delší ticho znamená zaseknutý export.',
  },
  {
    name: 'deska', popis: 'Úřední deska', pole: 'vyveseno', dni: 21,
    proc: 'Na desce něco přibývá každý týden.',
  },
  {
    name: 'zakazky-prehled', popis: 'Veřejné zakázky', pole: 'zahajeni', dni: 90,
    proc: 'Zakázky se vypisují nepravidelně, delší pauza je běžná.',
  },
  {
    name: 'dotace', popis: 'Dotace', pole: 'zverejneno', dni: 120,
    proc: 'Dotace se odvozují ze smluv a rozdělují se v několika vlnách za rok.',
  },
  {
    name: 'interpelace', popis: 'Interpelace', pole: 'datum', dni: 200,
    proc: 'Zastupitelstvo zasedá jednou za dva měsíce a přes léto vůbec.',
  },
  {
    name: 'smlouvy-organizace', popis: 'Smlouvy zřizovaných organizací', pole: 'publikovano', dni: 45,
    proc: 'Školy a firmy publikují průběžně, byť řidčeji než městská část.',
  },
];

const nalezy = [];
const radky = [];

for (const z of ZDROJE) {
  const ds = await readDataset(z.name);
  if (!ds) { radky.push(`·  ${z.popis}: dataset zatím není`); continue; }

  const data = (ds.items ?? []).map((i) => (i?.[z.pole] ?? '').slice(0, 10)).filter(Boolean).sort();
  const posledni = data.at(-1) ?? null;
  const stari = stariDni(posledni, DNES);

  if (stari == null) {
    nalezy.push({ z, posledni: null, stari: null, druh: 'bez data' });
    radky.push(`✗  ${z.popis}: ani jeden záznam nemá datum v poli „${z.pole}"`);
  } else if (stari > z.dni) {
    nalezy.push({ z, posledni, stari, druh: 'zastaralé' });
    radky.push(`✗  ${z.popis}: poslední záznam ${posledni}, ${stari} dní (limit ${z.dni})`);
  } else {
    radky.push(`✓  ${z.popis}: poslední záznam ${posledni}, ${stari} dní`);
  }
}

// Díry uvnitř řady jsou zvlášť: dataset může být čerstvý na konci a přesto
// mu uprostřed chybí celý ročník. Přesně případ roku 2025.
const faktury = await readDataset('faktury');
const dery = (faktury?.pokryti?.roky ?? []).filter((r) => r.neuplny);
for (const r of dery) radky.push(`✗  Faktury ${r.rok}: ${r.duvody.join('; ')}`);

const markdown = process.argv.includes('--markdown');

if (markdown) {
  if (!nalezy.length && !dery.length) process.exit(0);
  const dnes = DNES.toISOString().slice(0, 10);
  const casti = [`Kontrola ${dnes}. Scrapery běží, ale některé zdroje nepřinášejí nová data.`, ''];
  for (const n of nalezy) {
    casti.push(`### ${n.z.popis}`);
    casti.push(n.posledni
      ? `Poslední záznam je z **${n.posledni}**, tedy ${n.stari} dní starý (limit ${n.z.dni} dní).`
      : 'V datasetu nemá datum ani jeden záznam.');
    casti.push(`_${n.z.proc}_`, '');
  }
  for (const r of dery) {
    casti.push(`### Faktury — ročník ${r.rok} není celý`);
    casti.push(`${r.duvody.join('; ')}.`);
    if (r.platnostDo) casti.push(`CityVizor u něj uvádí data platná k ${r.platnostDo}.`);
    casti.push('');
  }
  casti.push('---', '', 'Web to u faktur říká návštěvníkovi sám (poznámka v sekci Peníze).',
    'Tohle issue je připomínka, že se má zdroj urgovat u toho, kdo ho plní.',
    '', 'Vygeneroval `scripts/hlidac-zdroju.mjs`.');
  console.log(casti.join('\n'));
  process.exit(0);
}

console.log(radky.join('\n'));
if (nalezy.length || dery.length) {
  const kolik = nalezy.length + dery.length;
  console.error(`\nNálezů: ${kolik}. Zdroj nepřináší nová data, nebo v nich má díru.`);
  process.exit(1);
}
console.log('\nVšechny zdroje jedou.');
