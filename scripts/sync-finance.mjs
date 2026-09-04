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

const faktury = [];
for (const o of obdobi) {
  const rok = o.year ?? o.rok ?? o;
  const mesic = o.month ?? o.mesic;
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

await writeDataset('rozpocet', Object.entries(rozpocet).map(([rok, polozky]) => ({
  rok: Number(rok), polozky,
})), { profil: { id, ico: profil.ico ?? null, slug: SLUG }, roky: dostupneRoky });

await writeDataset('faktury', faktury, { profil: { id, slug: SLUG }, obdobi: obdobi.length });
