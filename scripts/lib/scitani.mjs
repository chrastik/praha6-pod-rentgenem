/**
 * Sestavení dat ze Sčítání 2021 (ČSÚ) do tvaru, který používá web.
 * Odděleno od stahování, aby se transformace dala testovat bez sítě.
 *
 * Data ČSÚ mají několik nástrah, kvůli kterým se nedá jet na obecné páry *_kod/*_txt:
 *   – v souboru ekonomické aktivity se textový sloupec jmenuje `ekonaktiv_txt`,
 *     ačkoli kódový je `aktivita_kod`;
 *   – dimenze aktivity a typu domácnosti jsou HIERARCHICKÉ a překrývají se
 *     (Pracovní síla ⊃ Zaměstnaní ⊃ Pracující důchodci …), takže prostý součet
 *     všech kategorií by lidi započítal několikrát;
 *   – kódy jsou řetězce s vedoucími nulami (`001`, `00079999`) — ne čísla;
 *   – „Úplné  střední“ má v datech dvě mezery.
 */

const BASE = 'https://csu.gov.cz/docs/107508';

export const SADY = {
  pohlavi:    `${BASE}/79c509a0-261c-b4dd-d58d-c05955a24a2c/sldb2021_pohlavi.csv`,
  vek:        `${BASE}/4317620c-7502-7dc1-5c96-0cdb9affb540/sldb2021_vek.csv`,
  vek5:       `${BASE}/669330fa-7201-a927-a7c8-16e45db63de0/sldb2021_vek5_pohlavi.csv`,
  vzdelani:   `${BASE}/4c8e648b-043b-98b0-9c42-9096989c1bce/sldb2021_vzdelani.csv`,
  aktivita:   `${BASE}/ce2847c2-5f85-399c-f905-3bd1eff51cc0/sldb2021_aktivita_pohlavi.csv`,
  domacnosti: `${BASE}/05638b19-13ea-2ecf-f097-608a80e053eb/sldb2021_domacnosti_clenu_typ.csv`,
  domy:       `${BASE}/4f3ca3a1-86ab-aaaa-424e-be47bc03729e/sldb2021_domy_obydlen_druh.csv`,
  byty:       `${BASE}/2a0f57cc-df70-e0c9-c4d8-837ed04c7e69/sldb2021_byty_obydlenost.csv`,
  dojizdeni:  `${BASE}/1c4621b8-bf78-532d-47bd-3626dc749681/sldb2021_vyjizdka_vsichni_prostredek_pohlavi.csv`,
};

export const UZEMI = { cis: '44', kod: '500178', nazev: 'Praha 6', typ: 'městská část' };

/** Filtr na městskou část. Bez `uzemi_cis` by prošel i stejnojmenný správní obvod. */
export const naseUzemi = (z) => z.uzemi_cis === UZEMI.cis && z.uzemi_kod === UZEMI.kod;

const cislo = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const mezery = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Hodnota jediného řádku odpovídajícího filtru. */
function hod(radky, filtr) {
  const z = radky.find((r) => Object.entries(filtr).every(([k, v]) => (r[k] ?? '') === v));
  return z ? cislo(z.hodnota) : null;
}

/** Vybere kategorie v zadaném pořadí kódů — u hierarchických dimenzí je to jediná
 *  bezpečná cesta, protože „vyber všechno neprázdné“ by sečetlo nadřazené i dílčí. */
function vyber(radky, kodSloupec, txtSloupec, poradi, dalsiFiltr = {}) {
  return poradi.map(([kod, popis]) => {
    const z = radky.find((r) =>
      (r[kodSloupec] ?? '') === kod &&
      Object.entries(dalsiFiltr).every(([k, v]) => (r[k] ?? '') === v));
    return { kod, popis: popis ?? mezery(z?.[txtSloupec]), hodnota: z ? cislo(z.hodnota) : null };
  }).filter((k) => k.hodnota != null);
}

/** Dolní hranice věku z popisku — „0 - 4 roky“ → 0, „100 a více let“ → 100. */
const vekOd = (txt) => Number(/(\d+)/.exec(txt ?? '')?.[1] ?? 999);

export function sestav(syrove) {
  // --- obyvatelstvo ---
  const obyvatel = hod(syrove.pohlavi, { pohlavi_kod: '' });
  const pohlavi = {
    muzi: hod(syrove.pohlavi, { pohlavi_kod: '1' }),
    zeny: hod(syrove.pohlavi, { pohlavi_kod: '2' }),
  };

  const vekZakladni = syrove.vek
    .filter((z) => z.vek_kod)
    .map((z) => ({ kod: z.vek_kod, popis: mezery(z.vek_txt), hodnota: cislo(z.hodnota) }))
    .sort((a, b) => vekOd(a.popis) - vekOd(b.popis));

  const vekPetilete = syrove.vek5
    .filter((z) => z.vek_kod && !z.pohlavi_kod)
    .map((z) => ({ kod: z.vek_kod, popis: mezery(z.vek_txt), hodnota: cislo(z.hodnota) }))
    .sort((a, b) => vekOd(a.popis) - vekOd(b.popis));

  // --- bydlení ---
  const domy = {
    celkem: hod(syrove.domy, { obydlen_kod: '', druh_kod: '' }),
    obydlene: hod(syrove.domy, { obydlen_kod: '1', druh_kod: '' }),
    neobydlene: hod(syrove.domy, { obydlen_kod: '52', druh_kod: '' }),
    druhyObydlenych: vyber(syrove.domy, 'druh_kod', 'druh_txt', [
      ['51', 'Rodinné domy'],
      ['4', 'Bytové domy'],
      ['55', 'Ostatní budovy'],
    ], { obydlen_kod: '1' }),
  };
  const byty = {
    celkem: hod(syrove.byty, { obydlenost_kod: '' }),
    obydlene: hod(syrove.byty, { obydlenost_kod: '1' }),
    neobydlene: hod(syrove.byty, { obydlenost_kod: '52' }),
  };

  // --- vzdělání (obyvatelé 15+) ---
  const vzdelani = {
    celkem: hod(syrove.vzdelani, { vzdelani_kod: '' }),
    kategorie: vyber(syrove.vzdelani, 'vzdelani_kod', 'vzdelani_txt', [
      ['117', 'Základní vč. neukončeného'],
      ['105', 'Střední bez maturity'],
      ['35450001', 'Střední s maturitou'],
      ['130', 'Vyšší odborné, konzervatoř'],
      ['109', 'Vysokoškolské'],
      ['001', 'Bez vzdělání'],
      ['900', 'Nezjištěno'],
    ]),
  };

  // --- ekonomická aktivita ---
  // Bereme jen listové kategorie, ne nadřazené souhrny — jinak by součet přesáhl
  // počet obyvatel. Pracovní síla a Mimo pracovní sílu se ukládají zvlášť.
  const aktivita = {
    pracovniSila: hod(syrove.aktivita, { aktivita_kod: '53', pohlavi_kod: '' }),
    mimoPracovniSilu: hod(syrove.aktivita, { aktivita_kod: '54', pohlavi_kod: '' }),
    kategorie: vyber(syrove.aktivita, 'aktivita_kod', 'ekonaktiv_txt', [
      ['51', 'Zaměstnaní'],
      ['52', 'Nezaměstnaní'],
      ['6', 'Nepracující důchodci'],
      ['8', 'Žáci a studenti'],
      ['14', 'Na rodičovské dovolené'],
      ['13', 'V domácnosti, děti a závislé osoby'],
      ['7', 'Ostatní s vlastním zdrojem obživy'],
      ['99', 'Nezjištěno'],
    ], { pohlavi_kod: '' }),
  };

  // --- domácnosti ---
  const podleClenu = syrove.domacnosti
    .filter((z) => z.clenu_kod && !z.typ_kod)
    .map((z) => ({ kod: z.clenu_kod, popis: mezery(z.clenu_txt), hodnota: cislo(z.hodnota) }))
    .sort((a, b) => vekOd(a.popis) - vekOd(b.popis));

  const domacnosti = {
    celkem: hod(syrove.domacnosti, { clenu_kod: '', typ_kod: '' }),
    podleClenu,
    rodinne: hod(syrove.domacnosti, { typ_kod: '12' }),
    nerodinne: hod(syrove.domacnosti, { typ_kod: '11' }),
    jednotlivce: hod(syrove.domacnosti, { typ_kod: '1100' }),
    vicecelennaNerodinna: hod(syrove.domacnosti, { typ_kod: '20' }),
  };

  // --- dojíždění ---
  const dojizdeni = {
    celkem: hod(syrove.dojizdeni, { prostredek_kod: '' }),
    kategorie: syrove.dojizdeni
      .filter((z) => z.prostredek_kod)
      .map((z) => ({ kod: z.prostredek_kod, popis: mezery(z.prostredek_txt), hodnota: cislo(z.hodnota) }))
      // sestupně podle četnosti, ale „Nezjištěno“ vždy na konec
      .sort((a, b) => (a.kod === '999') - (b.kod === '999') || b.hodnota - a.hodnota),
  };

  return {
    uzemi: UZEMI,
    rok: 2021,
    rozhodnyOkamzik: '2021-03-26',
    zdroj: 'Český statistický úřad, Sčítání 2021 — otevřená data',
    zdrojUrl: 'https://csu.gov.cz/produkty/vysledky-scitani-2021-otevrena-data',
    obyvatel, pohlavi,
    vek: { zakladni: vekZakladni, petilete: vekPetilete },
    domy, byty, vzdelani, aktivita, domacnosti, dojizdeni,
  };
}

/** Vnitřní kontroly — sčítání je uzavřené, takže rozpor znamená chybu, ne novinku. */
export function zkontroluj(d) {
  const potize = [];
  const soucet = (pole) => pole.reduce((a, k) => a + (k.hodnota ?? 0), 0);
  const zkus = (co, a, b) => { if (a !== b) potize.push(`${co}: ${a} ≠ ${b}`); };

  zkus('muži+ženy vs. obyvatelé', d.pohlavi.muzi + d.pohlavi.zeny, d.obyvatel);
  zkus('základní věkové skupiny', soucet(d.vek.zakladni), d.obyvatel);
  zkus('pětileté věkové skupiny', soucet(d.vek.petilete), d.obyvatel);
  zkus('domy obydlené+neobydlené', d.domy.obydlene + d.domy.neobydlene, d.domy.celkem);
  zkus('druhy obydlených domů', soucet(d.domy.druhyObydlenych), d.domy.obydlene);
  zkus('byty obydlené+neobydlené', d.byty.obydlene + d.byty.neobydlene, d.byty.celkem);
  zkus('vzdělání', soucet(d.vzdelani.kategorie), d.vzdelani.celkem);
  zkus('ekonomická aktivita', soucet(d.aktivita.kategorie), d.obyvatel);
  zkus('domácnosti podle členů', soucet(d.domacnosti.podleClenu), d.domacnosti.celkem);
  zkus('domácnosti rodinné+nerodinné', d.domacnosti.rodinne + d.domacnosti.nerodinne, d.domacnosti.celkem);
  zkus('dojíždění', soucet(d.dojizdeni.kategorie), d.dojizdeni.celkem);

  if (d.obyvatel === 114939) {
    potize.push('staženo území správního obvodu místo městské části — zkontroluj filtr uzemi_cis');
  }
  return potize;
}
