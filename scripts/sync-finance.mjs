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
/**
 * Stahuje se PO ROCÍCH, ne po měsících, a to ze dvou důvodů:
 *
 * 1) Seznam období (`payments/months`) obsahuje i prázdný záznam
 *    { month: null, year: null }. Když se z něj poskládá datum, vyjde
 *    „[object Object]-01-01“ — a API takový nesmysl NEODMÍTNE. Vrátí HTTP 200
 *    a vysype 10 000 plateb, které se přičetly k platbám staženým po měsících.
 *    Takhle vzniklo 9 877 duplicit a výdaje nafouknuté o 1,1 miliardy.
 *
 * 2) Seznam období navíc nepokrývá všechny měsíce — za rok 2025 v něm chybí dva,
 *    a s nimi nám unikalo 30 plateb.
 *
 * Roční dotaz obojí obchází. Strop 10 000 plateb na dotaz je bezpečně daleko:
 * nejsilnější rok má 4 330.
 *
 * POZOR: uvnitř jedné odpovědi bývají řádky, které jsou ve všech polích shodné
 * (dvě platby vodárnám ve stejný den se stejnou částkou a prázdným popisem).
 * Jsou to dvě skutečné platby, ne chyba — proto se NESMÍ slučovat.
 */
const STROP_API = 10000;
const faktury = [];
for (const rok of dostupneRoky) {
  try {
    const davka = await fetchJson(
      `${API}/profiles/${id}/payments?dateFrom=${rok}-01-01&dateTo=${rok}-12-31&sort=date`,
    );
    if (davka.length >= STROP_API) {
      throw new Error(`rok ${rok} vrátil ${davka.length} plateb — naráží na strop API, `
        + 'stahování je potřeba rozdělit na kratší období');
    }
    faktury.push(...davka);
    console.log(`  faktury ${rok}: ${davka.length}`);
  } catch (err) {
    console.warn(`  ! faktury ${rok}: ${err.message}`);
  }
}
console.log(`  faktury celkem: ${faktury.length}`);

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

// Shodné řádky se jen spočítají, NEODSTRAŇUJÍ se — zdroj je posílá záměrně
// (viz poznámka výše). Číslo je tu proto, aby bylo poznat, kdyby jich najednou
// řádově přibylo, což by znamenalo návrat překryvu období.
const klic = (f) => JSON.stringify([f.datum, f.dodavatel, f.ico, f.popis, f.vydaj, f.prijem, f.paragraf, f.polozka, f.akce]);
const shodnych = fakturyNormalizovane.length - new Set(fakturyNormalizovane.map(klic)).size;
if (shodnych) console.log(`  shodných řádků ze zdroje: ${shodnych} (ponechány)`);

const celkemVydaje = fakturyNormalizovane.reduce((a, f) => a + f.vydaj, 0);
console.log(`  výdaje celkem: ${Math.round(celkemVydaje).toLocaleString('cs-CZ')} Kč`);

await writeDataset('rozpocet', Object.entries(rozpocet).map(([rok, polozky]) => ({
  rok: Number(rok), polozky,
})), { profil: { id, ico: profil.ico ?? null, slug: SLUG }, roky: dostupneRoky });

await writeDataset('faktury', fakturyNormalizovane, {
  profil: { id, slug: SLUG },
  shodnychRadku: shodnych,
  souhrn: {
    celkemVydaje,
    rozsah: {
      od: fakturyNormalizovane.at(-1)?.datum ?? null,
      do: fakturyNormalizovane[0]?.datum ?? null,
    },
  },
});
