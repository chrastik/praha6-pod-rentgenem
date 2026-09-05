#!/usr/bin/env node
/**
 * Smlouvy organizací a firem zřizovaných MČ Praha 6 (38 samostatných subjektů).
 *
 * Každá organizace je vlastní publikující subjekt registru smluv, takže se
 * neprochází dumpy jako u městské části, ale vyhledávání podle IČO subjekt po
 * subjektu. Ze stránky výsledků se čtou rovnou všechny potřebné údaje —
 * stahovat XML detailu nejde, má i několik MB kvůli přílohám v base64.
 *
 * Běží jako úplná obnova, ne přírůstkově: registr mění i starší záznamy
 * (dodatky, nové verze, stažení smlouvy) a osm tisíc řádků se načte za pár
 * minut. Když ale jeden subjekt selže, jeho dosavadní smlouvy se PONECHAJÍ —
 * jinak by jeden síťový výpadek tiše smazal tři stovky smluv jedné školy.
 */
import { fetchText, mapLimit } from './lib/http.mjs';
import { writeDataset, readItems } from './lib/util.mjs';
import { parseStranku, urlVysledku } from './lib/vysledky.mjs';
import { SUBJEKTY, TYPY, podleIco, zkontrolujSeznam } from './lib/organizace.mjs';

const POJISTKA_STRANEK = 250; // ~25 000 smluv na subjekt; nikdo se k tomu nepřiblíží
const PARALEL = Number(process.env.PARALEL ?? 3);
const JEN = process.env.JEN?.split(',').map((s) => s.trim()).filter(Boolean);

const potizeSeznamu = zkontrolujSeznam();
if (potizeSeznamu.length) {
  for (const p of potizeSeznamu) console.error(`  ✗ ${p}`);
  throw new Error('Seznam zřizovaných organizací je vadný — opravte lib/organizace.mjs.');
}

// Dosavadní data po subjektech, aby šlo při chybě ponechat to staré.
const drivejsi = new Map();
for (const s of await readItems('smlouvy-organizace')) {
  if (!drivejsi.has(s.subjektIco)) drivejsi.set(s.subjektIco, []);
  drivejsi.get(s.subjektIco).push(s);
}

/** Projde stránkované výsledky pro jedno IČO a vrátí smlouvy v poslední verzi. */
async function stahniSubjekt(subjekt) {
  const nalezene = new Map();
  const videnaId = new Set(); // včetně starších verzí — slouží k detekci zacyklení
  let offset = 0;
  let celkem = null;

  for (let stranka = 0; stranka < POJISTKA_STRANEK; stranka++) {
    const html = await fetchText(urlVysledku(subjekt.ico, offset));
    const { celkem: c, radky } = parseStranku(html);
    if (c != null) celkem = c;
    if (radky.length === 0) break;

    let novychId = 0;
    for (const r of radky) {
      if (videnaId.has(r.id)) continue;
      videnaId.add(r.id);
      novychId++;
      if (!r.posledniVerze) continue; // starší verze téže smlouvy nechceme
      nalezene.set(r.id, {
        ...r,
        subjektIco: subjekt.ico,
        subjekt: subjekt.nazev,
        typ: subjekt.typ,
      });
    }

    // Krok se odvozuje od skutečného počtu řádků, ne od požadovaného limitu:
    // server si drží velikost stránky v session a náš parametr může ignorovat.
    offset += radky.length;
    if (celkem != null && offset >= celkem) break;

    // Když stránka nepřinesla jediné nové ID, server nám vrátil tutéž stránku
    // znovu — typicky proto, že přestal respektovat offset. Pokračovat by
    // znamenalo točit se donekonečna.
    if (novychId === 0) break;
  }

  return { smlouvy: [...nalezene.values()], celkem };
}

// ------------------------------------------------------------------- běh ---
const kestazeni = JEN ? SUBJEKTY.filter((s) => JEN.includes(s.ico)) : SUBJEKTY;
console.log(`  ${kestazeni.length} subjektů ke stažení\n`);

const selhalo = [];
const vysledky = new Map();

await mapLimit(kestazeni, PARALEL, async (subjekt) => {
  try {
    const { smlouvy, celkem } = await stahniSubjekt(subjekt);
    vysledky.set(subjekt.ico, smlouvy);
    const chybi = celkem != null && smlouvy.length < celkem * 0.5 && celkem > 10;
    console.log(`  ${subjekt.nazev.padEnd(34)} ${String(smlouvy.length).padStart(5)} smluv`
      + (celkem != null ? ` (registr hlásí ${celkem} vč. starších verzí)` : '')
      + (chybi ? '  ← POZOR, sedí to?' : ''));
  } catch (err) {
    selhalo.push(`${subjekt.nazev} (${subjekt.ico}): ${err.message}`);
    console.warn(`  ! ${subjekt.nazev}: ${err.message} — ponechávám dosavadní data`);
  }
});

// Subjekty, které selhaly, si ponechají to, co už bylo staženo dřív.
const items = [];
for (const s of SUBJEKTY) {
  items.push(...(vysledky.get(s.ico) ?? drivejsi.get(s.ico) ?? []));
}
items.sort((a, b) => (b.publikovano ?? '').localeCompare(a.publikovano ?? ''));

// ------------------------------------------------------------- přehledy ---
const souhrny = SUBJEKTY.map((s) => {
  const sml = items.filter((x) => x.subjektIco === s.ico);
  const sCastkou = sml.filter((x) => x.castka != null && x.mena === 'CZK');
  return {
    ico: s.ico,
    nazev: s.nazev,
    typ: s.typ,
    pocet: sml.length,
    hodnota: sCastkou.reduce((a, x) => a + x.castka, 0),
    sHodnotou: sCastkou.length,
    protistran: new Set(sml.map((x) => x.protistrana).filter(Boolean)).size,
    posledni: sml[0]?.publikovano ?? null,
    stazeno: vysledky.has(s.ico),
  };
}).sort((a, b) => b.pocet - a.pocet);

const prazdne = souhrny.filter((s) => s.pocet === 0).map((s) => `${s.nazev} (${s.ico})`);
if (prazdne.length) {
  console.warn(`\n  Bez jediné smlouvy: ${prazdne.join(', ')}`);
  console.warn('  Buď opravdu nic nepublikují, nebo je špatně IČO v lib/organizace.mjs.');
}

await writeDataset('smlouvy-organizace', items, {
  subjektu: SUBJEKTY.length,
  typy: TYPY,
  souhrny,
  selhalo,
  poznamka: 'Každý subjekt je samostatný publikující subjekt registru smluv. '
    + 'Hodnoty NESČÍTAT s městskou částí — smlouva mezi radnicí a její organizací '
    + 'by se počítala dvakrát. Částky jsou ze seznamu registru, zaokrouhlené na koruny.',
});

const celkovaHodnota = souhrny.reduce((a, s) => a + s.hodnota, 0);
console.log(`\n  celkem ${items.length.toLocaleString('cs-CZ')} smluv`
  + ` za ${souhrny.filter((s) => s.pocet > 0).length} subjektů`
  + ` · známá hodnota ${Math.round(celkovaHodnota).toLocaleString('cs-CZ')} Kč`);

if (selhalo.length) {
  console.error(`\n  ${selhalo.length} subjektů selhalo:`);
  for (const s of selhalo) console.error(`   ✗ ${s}`);
  throw new Error('Část subjektů se nestáhla — data zůstala z minula, běh je neúspěšný.');
}
