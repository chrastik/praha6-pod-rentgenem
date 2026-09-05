#!/usr/bin/env node
/**
 * Rozpočet a faktury z CityVizoru. Praha 6 má na rozdíl od většiny městských částí
 * plné veřejné REST API bez autentizace — tohle je nejkvalitnější zdroj celého projektu.
 */
import { fetchJson } from './lib/http.mjs';
import { writeDataset } from './lib/util.mjs';

const API = 'https://cityvizor.praha.eu/api/public';
const SLUG = 'praha6';

const profil = await fetchJson(`${API}/profiles/${SLUG}`);
const id = profil.id ?? profil.profileId;
if (!id) throw new Error('CityVizor nevrátil id profilu — zkontroluj tvar odpovědi.');
console.log(`  profil ${SLUG} → id ${id}, IČO ${profil.ico ?? '?'}`);

// ---- roky (rozpočet vs. skutečnost) ----------------------------------------
const roky = await fetchJson(`${API}/profiles/${id}/years`);
const dostupneRoky = roky.map((r) => r.year ?? r).filter(Boolean).sort();
console.log(`  roky: ${dostupneRoky.join(', ')}`);

// ---- položkový rozpočet -----------------------------------------------------
const rozpocet = {};
for (const rok of dostupneRoky) {
  try {
    rozpocet[rok] = await fetchJson(`${API}/profiles/${id}/accounting/${rok}`);
    console.log(`  rozpočet ${rok}: ${rozpocet[rok].length ?? '?'} položek`);
  } catch (err) {
    console.warn(`  ! rozpočet ${rok}: ${err.message}`);
  }
}

// ---- faktury ----------------------------------------------------------------
let obdobi = [];
try { obdobi = await fetchJson(`${API}/profiles/${id}/payments/months`); }
catch (err) { console.warn(`  ! seznam období faktur: ${err.message}`); }

/**
 * CityVizor vrací mezi obdobími i prázdný záznam { month: null, year: null }.
 * Když se z něj poskládá datum, vyjde „[object Object]-01-01“ — a API takový
 * nesmysl NEODMÍTNE. Vrátí HTTP 200 a vysype 10 000 plateb, které se pak
 * přičtou k platbám staženým po měsících. Přesně tak vzniklo 9 877 duplicit
 * a výdaje nafouknuté o 1,1 miliardy. Proto se období bez roku přeskakují.
 */
const platneObdobi = obdobi.filter((o) => {
  const rok = Number(o?.year ?? o?.rok);
  return Number.isInteger(rok) && rok >= 2000 && rok <= 2100;
});
if (platneObdobi.length !== obdobi.length) {
  console.log(`  přeskočeno ${obdobi.length - platneObdobi.length} období bez roku`);
}

const faktury = [];
for (const o of platneObdobi) {
  const rok = Number(o.year ?? o.rok);
  const mesic = Number(o.month ?? o.mesic) || null;
  const od = mesic ? `${rok}-${String(mesic).padStart(2, '0')}-01` : `${rok}-01-01`;
  const doDate = mesic
    ? new Date(Date.UTC(rok, mesic, 0)).toISOString().slice(0, 10)
    : `${rok}-12-31`;
  try {
    const davka = await fetchJson(
      `${API}/profiles/${id}/payments?dateFrom=${od}&dateTo=${doDate}&sort=date`,
    );
    faktury.push(...davka);
  } catch (err) {
    console.warn(`  ! faktury ${od}: ${err.message}`);
  }
}
console.log(`  faktury: ${faktury.length}`);

// CityVizor vrací platby v pořadí období, ne chronologicky, a částku dělí na
// příjem/výdaj. Normalizujeme to tady, ať s tím frontend nemusí zápasit.
const fakturyNormalizovane = faktury
  .map((f) => ({
    datum: (f.date ?? '').slice(0, 10) || null,
    rok: f.year ?? null,
    dodavatel: f.counterpartyName ?? null,
    ico: f.counterpartyId ?? null,
    popis: f.description ?? null,
    vydaj: Number(f.expenditureAmount ?? 0) || 0,
    prijem: Number(f.incomeAmount ?? 0) || 0,
    paragraf: f.paragraph ?? null,
    polozka: f.item ?? null,
    akce: f.event ?? null,
  }))
  .sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''));

// Druhá pojistka: kdyby se období někdy začala překrývat jinak, ať se to
// neprojeví na součtech. Klíčem je celý obsah řádku — dvě opravdu totožné
// platby ve stejný den se stejným popisem i částkou jsou v praxi tentýž doklad.
const klic = (f) => JSON.stringify([f.datum, f.dodavatel, f.ico, f.popis, f.vydaj, f.prijem, f.paragraf, f.polozka, f.akce]);
const bezDuplicit = [...new Map(fakturyNormalizovane.map((f) => [klic(f), f])).values()];
if (bezDuplicit.length !== fakturyNormalizovane.length) {
  console.log(`  odstraněno ${fakturyNormalizovane.length - bezDuplicit.length} duplicitních řádků`);
}

const celkemVydaje = bezDuplicit.reduce((a, f) => a + f.vydaj, 0);
console.log(`  výdaje celkem: ${Math.round(celkemVydaje).toLocaleString('cs-CZ')} Kč`);

await writeDataset('rozpocet', Object.entries(rozpocet).map(([rok, polozky]) => ({
  rok: Number(rok), polozky,
})), { profil: { id, ico: profil.ico ?? null, slug: SLUG }, roky: dostupneRoky });

await writeDataset('faktury', bezDuplicit, {
  profil: { id, slug: SLUG },
  obdobi: obdobi.length,
  souhrn: {
    celkemVydaje,
    rozsah: {
      od: bezDuplicit.at(-1)?.datum ?? null,
      do: bezDuplicit[0]?.datum ?? null,
    },
  },
});
