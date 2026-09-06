#!/usr/bin/env node
/**
 * Veřejné zakázky z profilu zadavatele MČ Praha 6 (E-ZAK, zakazky.praha6.cz).
 *
 * Nejdřív se projde stránkovaný seznam (vždy se všemi zakázkami včetně
 * archivovaných — bez toho jich profil ukáže sotva třetinu), pak se ke každé
 * zakázce stáhne detail s účastníky, vybraným dodavatelem, smluvní cenou
 * a skutečně uhrazenými částkami.
 *
 * Detail jedné zakázky, u které selže stahování, si PONECHÁ dosavadní data.
 * Jinak by jeden výpadek sítě tiše vymazal půlku profilu.
 */
import { fetchText, mapLimit } from './lib/http.mjs';
import { writeDataset, readItems } from './lib/util.mjs';
import { parseSeznam, parseDetail, urlSeznamu, urlDetailu } from './lib/ezak.mjs';

const PARALEL = Number(process.env.PARALEL ?? 4);
const POJISTKA_STRANEK = 100;
const JEN = Number(process.env.JEN_DBID) || null; // pro ladění jedné zakázky

// --------------------------------------------------------------- seznam ---
console.log('  procházím seznam zakázek…');
const seznam = new Map();
let maxStranka = 1;
for (let stranka = 1; stranka <= Math.min(maxStranka, POJISTKA_STRANEK); stranka++) {
  const { polozky, maxStranka: max } = parseSeznam(await fetchText(urlSeznamu(stranka)));
  if (max > maxStranka) maxStranka = max;
  for (const p of polozky) seznam.set(p.dbid, p);
  if (stranka === 1 && polozky.length === 0) {
    throw new Error('První stránka profilu neobsahuje ani jednu zakázku. '
      + 'To není prázdný profil, to je změněná šablona nebo blokovaný přístup.');
  }
  process.stdout.write(`\r  stránka ${stranka}/${maxStranka} · ${seznam.size} zakázek`);
}
console.log(`\n  seznam hotov: ${seznam.size} zakázek na ${maxStranka} stránkách`);

if (seznam.size < 50) {
  throw new Error(`Seznam vrátil jen ${seznam.size} zakázek. Profil jich má stovky — `
    + 'zřejmě se nepropsal filtr archive=ALL nebo se rozbilo stránkování.');
}

// -------------------------------------------------------------- detaily ---
const drivejsi = new Map((await readItems('zakazky')).map((z) => [z.dbid, z]));
const kestazeni = JEN ? [...seznam.values()].filter((z) => z.dbid === JEN) : [...seznam.values()];

const selhalo = [];
const hotove = new Map();

console.log(`  stahuji ${kestazeni.length} detailů…`);
let hotovo = 0;
await mapLimit(kestazeni, PARALEL, async (polozka) => {
  try {
    const detail = parseDetail(await fetchText(urlDetailu(polozka.dbid)), polozka.dbid);
    if (!detail) throw new Error('stránka bez bloku „Informace o veřejné zakázce"');
    hotove.set(polozka.dbid, {
      ...polozka,
      ...detail,
      // Ze seznamu je režim a fáze spolehlivější (detail je občas nevyplní),
      // ale kód a název z detailu mají přednost — jsou z evidenčního čísla.
      rezim: detail.rezim ?? polozka.rezim,
      faze: detail.faze ?? polozka.faze,
      kod: detail.kod ?? polozka.kod,
      nazev: detail.nazev ?? polozka.nazev,
      zahajeni: detail.zahajeni ?? polozka.zahajeni,
      lhuta: detail.lhuta ?? polozka.lhuta,
    });
  } catch (err) {
    selhalo.push(`DBID ${polozka.dbid} (${polozka.kod ?? polozka.nazev}): ${err.message}`);
  }
  if (++hotovo % 25 === 0) process.stdout.write(`\r  ${hotovo}/${kestazeni.length}`);
});
console.log(`\r  ${hotovo}/${kestazeni.length} detailů staženo`);

// Zakázky, u kterých detail selhal, si ponechají to, co už bylo staženo dřív.
const items = [...seznam.keys()]
  .map((dbid) => hotove.get(dbid) ?? drivejsi.get(dbid) ?? seznam.get(dbid))
  .sort((a, b) => (b.zahajeni ?? '').localeCompare(a.zahajeni ?? '') || b.dbid - a.dbid);

// --------------------------------------------------------------- kontrola ---
// Podíl zakázek s vybraným dodavatelem je jediné číslo, které pozná, že se
// rozbil parser detailu: seznam se stáhne vždy, detail může tiše vracet nic.
const sDodavatelem = items.filter((z) => z.dodavatele?.length).length;
const zadane = items.filter((z) => /zad[áa]no|uzav[řr]eno|ukon[čc]eno|objedn[áa]no/i.test(z.faze ?? '')).length;
if (zadane > 20 && sDodavatelem === 0) {
  throw new Error(`${zadane} zakázek je zadaných, ale ani u jedné se nenačetl dodavatel. `
    + 'To je rozbité čtení detailu — data nepřepisuji.');
}

const sKodem = items.filter((z) => z.kod).length;
const sHodnotou = items.filter((z) => z.predpokladanaHodnota != null).length;
const sUhrazenym = items.filter((z) => z.uhrazeno?.some((u) => (u.bezDph ?? 0) > 0)).length;
const sTabulkouUhrazeno = items.filter((z) => z.uhrazeno?.length).length;

await writeDataset('zakazky', items, {
  zdroj: urlSeznamu(1),
  stranek: maxStranka,
  selhalo,
  pokryti: {
    sKodem, sDodavatelem, zadane, sHodnotou, sTabulkouUhrazeno, sUhrazenym,
  },
  poznamka: 'Profil zadavatele MČ Praha 6 v E-ZAKu. Zakázky zadané přes profil '
    + 'jiného zadavatele (např. SNEO) tu nejsou. Ceny jsou v Kč, u dodavatele '
    + 'smluvní cena při podpisu — ne to, co bylo nakonec zaplaceno.',
});

console.log(`\n  s evidenčním číslem: ${sKodem}/${items.length}`);
console.log(`  se zadaným dodavatelem: ${sDodavatelem} (zadaných zakázek ${zadane})`);
console.log(`  s předpokládanou hodnotou: ${sHodnotou}`);
console.log(`  s tabulkou skutečně uhrazené ceny: ${sTabulkouUhrazeno}, z toho nenulovou: ${sUhrazenym}`);

if (selhalo.length) {
  console.error(`\n  ${selhalo.length} detailů selhalo:`);
  for (const s of selhalo.slice(0, 20)) console.error(`   ✗ ${s}`);
  if (selhalo.length > items.length * 0.1) {
    throw new Error(`Selhalo ${selhalo.length} z ${items.length} detailů — to je moc, běh je neúspěšný.`);
  }
}
