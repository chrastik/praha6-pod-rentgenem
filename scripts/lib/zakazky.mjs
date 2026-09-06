/**
 * Spojení veřejných zakázek z profilu zadavatele se smlouvami v registru smluv.
 *
 * Smysl: profil ukáže, za kolik se zakázka vysoutěžila, registr ukáže, co se
 * pak dělo s cenou. Teprve dohromady je z toho odpověď na otázku „stálo to
 * nakonec tolik, kolik se slibovalo?".
 *
 * Nejtěžší místo celého souboru je výklad dodatků. Registr smluv NEMÁ pole
 * „o kolik se cena zvýšila" — má jen „hodnota". Radnice do něj u jedné zakázky
 * píše novou CELKOVOU cenu (VZ/8/2018: 92,2 → 92,9 → 93,8 → … → 108,4 mil.),
 * u druhé jen PŘÍRŮSTEK (VZ/17/2023: 144 mil. a k tomu dodatky za 530 tis.,
 * 501 tis. a −1,96 mil.). Kdo to sečte bez rozlišení, dostane nesmysl:
 * u VZ/17/2023 by naivní součet dodatků dal „+533 %".
 *
 * Rozlišuje se podle velikosti vůči původní ceně — a když si zakázka odporuje,
 * neodhaduje se nic a označí se za nejistou. Radši méně čísel než čísla vymyšlená.
 */

/** Dodatek pod tímto podílem původní ceny je čten jako přírůstek, ne jako nová celková cena. */
export const PRAH_PRIRUSTKU = 0.5;

/**
 * Předpokládaná hodnota pod touto hranicí se nebere jako odhad ceny.
 * Zakázka P/4/2020 má na profilu vyplněno „1 Kč bez DPH" a vysoutěžila se
 * za 467 500 Kč; poměr obou čísel by dal „+46 749 900 %" a zničil by každý
 * souhrn, do kterého by se dostal. Není to naše chyba ve čtení — na profilu
 * to tak opravdu je.
 */
export const PRAH_PREDPOKLADU = 10000;

const bezDiakritiky = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Kódy zakázek, které lze poznat v předmětu smlouvy.
 *
 * Profil používá čtyři prefixy — VŘ, VZ, PM a P. „P/2/2022" vypadá obecně, ale
 * plané shody nevadí: smlouvy se indexují podle kódu a pak se hledá kód
 * konkrétní zakázky, takže kód, ke kterému žádná zakázka není, nikam nevstoupí.
 * Zbylých 105 zakázek na profilu nemá číslo v tomhle tvaru vůbec (třeba
 * „01/25/JŘBU") a spárovat je nejde.
 */
const KOD_VE_SMLOUVE = /\b(V[ŘR]|VZ|PM|P)\s*[\/\-]\s*(\d+)\s*[\/\-]\s*(\d{4})\b/giu;

/** Všechny kódy zakázek zmíněné v jednom textu, sjednocené do tvaru „VŘ/22/2022". */
export function kodyVTextu(text) {
  const out = new Set();
  for (const m of (text ?? '').matchAll(KOD_VE_SMLOUVE)) {
    const pref = m[1].toUpperCase() === 'VR' ? 'VŘ' : m[1].toUpperCase();
    out.add(`${pref}/${Number(m[2])}/${m[3]}`);
  }
  return [...out];
}

export const jeDodatek = (predmet) => /dodatek/i.test(predmet ?? '');

const castkaSmlouvy = (s) => ((s.mena ?? 'CZK') !== 'CZK' ? null : (s.castkaBezDph ?? null));
const denSmlouvy = (s) => s.datum || s.zverejneno || '';

/**
 * Sestaví cenovou osu jedné zakázky z jejích smluv.
 *
 * @returns {{
 *   zaklad: number|null, konecna: number|null, zmena: number|null,
 *   vyklad: 'bez-dodatku'|'celkova'|'prirustkova'|'nejiste'|'neznama',
 *   kroky: Array<{typ, predmet, datum, castka, url}>,
 *   dodatku: number, dodatkuSCastkou: number
 * }}
 */
export function cenovaOsa(smlouvy) {
  const serazene = [...smlouvy].sort((a, b) => denSmlouvy(a).localeCompare(denSmlouvy(b)));

  // Radnice některé dodatky uveřejní v registru dvakrát — dvě samostatné
  // smlouvy se stejným předmětem, datem i částkou (např. „Dodatek č. 1"
  // k VZ/1/2024, 1 854 489,43 Kč, obojí 3. 2. 2026). Právně existuje jeden;
  // kdyby se sečetly oba, zakázka by na webu podražila o částku, která nikdy
  // nevznikla. Druhý výskyt se proto z výpočtu vynechá, ale na časové ose
  // zůstane viditelný a označený — smlčet to by bylo horší než to ukázat.
  const videne = new Set();
  const kroky = serazene.map((s) => {
    const otisk = `${(s.predmet ?? '').trim().toLowerCase()}|${denSmlouvy(s)}|${castkaSmlouvy(s)}`;
    const duplikat = videne.has(otisk);
    videne.add(otisk);
    return {
      typ: jeDodatek(s.predmet) ? 'dodatek' : 'smlouva',
      predmet: s.predmet ?? null,
      datum: s.datum ?? s.zverejneno ?? null,
      castka: castkaSmlouvy(s),
      url: s.url ?? null,
      duplikat,
    };
  });

  const zakladni = kroky.filter((k) => k.typ === 'smlouva' && k.castka > 0 && !k.duplikat);
  const dodatky = kroky.filter((k) => k.typ === 'dodatek' && !k.duplikat);
  const dodatkySCastkou = dodatky.filter((k) => k.castka != null);
  const zaklad = zakladni.length ? zakladni[0].castka : null;

  const prazdna = {
    zaklad, konecna: zaklad, zmena: null, kroky,
    dodatku: dodatky.length, dodatkuSCastkou: dodatkySCastkou.length,
    duplicit: kroky.filter((k) => k.duplikat).length,
  };
  if (zaklad == null) return { ...prazdna, konecna: null, vyklad: 'neznama' };
  if (dodatkySCastkou.length === 0) return { ...prazdna, vyklad: 'bez-dodatku' };

  const jakoCelek = dodatkySCastkou.filter((k) => k.castka >= zaklad * PRAH_PRIRUSTKU);
  const jakoPrirustek = dodatkySCastkou.filter((k) => k.castka < zaklad * PRAH_PRIRUSTKU);

  if (jakoCelek.length && jakoPrirustek.length) {
    // Zakázka si odporuje — část dodatků vypadá jako nová celková cena,
    // část jako přírůstek. Konečnou cenu tady nikdo poctivě spočítat neumí.
    return { ...prazdna, konecna: null, vyklad: 'nejiste' };
  }

  const konecna = jakoCelek.length
    ? jakoCelek[jakoCelek.length - 1].castka
    : zaklad + jakoPrirustek.reduce((a, k) => a + k.castka, 0);

  return {
    ...prazdna,
    konecna,
    zmena: konecna / zaklad - 1,
    vyklad: jakoCelek.length ? 'celkova' : 'prirustkova',
  };
}

/**
 * Přiřadí ke každé zakázce její smlouvy a spočítá cenovou osu.
 * @param {Array} zakazky data/zakazky.json
 * @param {Array} smlouvy data/smlouvy.json
 */
export function sparuj(zakazky, smlouvy) {
  const podleKodu = new Map();
  for (const s of smlouvy) {
    for (const kod of kodyVTextu(s.predmet)) {
      if (!podleKodu.has(kod)) podleKodu.set(kod, []);
      podleKodu.get(kod).push(s);
    }
  }

  const items = zakazky.map((z) => {
    const sml = z.kod ? (podleKodu.get(z.kod) ?? []) : [];
    const osa = cenovaOsa(sml);
    const dodavatel = z.dodavatele?.[0] ?? null;
    const uhrazenoCelkem = z.uhrazeno?.length
      ? z.uhrazeno.reduce((a, u) => a + (u.bezDph ?? 0), 0)
      : null;

    const predpoklad = z.predpokladanaHodnota >= PRAH_PREDPOKLADU ? z.predpokladanaHodnota : null;

    return {
      ...z,
      // Vyplněná, ale nesmyslně nízká hodnota se schová, aby nešla do součtů;
      // původní údaj zůstává v `predpokladanaHodnota`, ať je vidět, co profil uvádí.
      predpokladPouzitelny: predpoklad,
      zmenaProtiPredpokladu: predpoklad && dodavatel?.cenaBezDph > 0
        ? dodavatel.cenaBezDph / predpoklad - 1 : null,
      smluv: sml.length,
      smlouvy: osa.kroky,
      zaklad: osa.zaklad,
      konecna: osa.konecna,
      zmena: osa.zmena,
      vyklad: osa.vyklad,
      dodatku: osa.dodatku,
      duplicit: osa.duplicit,
      // Smluvní cena z profilu je nezávislý údaj na tom, co je v registru.
      // Když se liší o víc než o desetinu, stojí to za pohled.
      cenaProfil: dodavatel?.cenaBezDph ?? null,
      rozporSProfilem: dodavatel?.cenaBezDph != null && osa.zaklad != null
        && Math.abs(dodavatel.cenaBezDph - osa.zaklad) > Math.max(1000, osa.zaklad * 0.1),
      uhrazenoCelkem,
      // Tabulka „skutečně uhrazená cena" existuje, ale bývá vyplněná nulami.
      uhrazenoVyplneno: uhrazenoCelkem != null && uhrazenoCelkem > 0,
      ucastniku: z.ucastnici?.length ?? 0,
      // Nabídky ostatních jsou uvedené jen výjimečně; kde jsou, jde vidět soutěž.
      nabidek: z.ucastnici?.filter((u) => u.nabidkaBezDph != null).length ?? 0,
      dodavatelNazev: dodavatel?.nazev ?? null,
      dodavatelIco: dodavatel?.ico ?? null,
    };
  });

  return { items, souhrn: souhrnZakazek(items) };
}

/** Souhrnná čísla pro úvod sekce. Sčítá se jen to, co je poctivě sečitatelné. */
export function souhrnZakazek(items) {
  const zadane = items.filter((z) => /zad[áa]no|uzav[řr]eno|ukon[čc]eno|objedn[áa]no/i.test(z.faze ?? ''));
  const zrusene = items.filter((z) => /zru[šs]eno/i.test(z.faze ?? ''));
  const sCenou = items.filter((z) => z.cenaProfil != null);
  const porovnatelne = items.filter((z) => z.zaklad != null && z.konecna != null && z.dodatku > 0
    && z.vyklad !== 'nejiste');

  const zaklad = porovnatelne.reduce((a, z) => a + z.zaklad, 0);
  const konecna = porovnatelne.reduce((a, z) => a + z.konecna, 0);

  const sPredpokladem = items.filter((z) => z.predpokladPouzitelny && z.cenaProfil > 0);
  const predpoklad = sPredpokladem.reduce((a, z) => a + z.predpokladPouzitelny, 0);
  const vysoutezeno = sPredpokladem.reduce((a, z) => a + z.cenaProfil, 0);

  const roky = {};
  for (const z of items) {
    const r = z.zahajeni?.slice(0, 4);
    if (!r) continue;
    roky[r] ??= { rok: r, pocet: 0, hodnota: 0 };
    roky[r].pocet++;
    roky[r].hodnota += z.cenaProfil ?? 0;
  }

  return {
    celkem: items.length,
    zadanych: zadane.length,
    zrusenych: zrusene.length,
    sparovanych: items.filter((z) => z.smluv > 0).length,
    bezKodu: items.filter((z) => !z.kod).length,
    smluvniCena: Math.round(sCenou.reduce((a, z) => a + z.cenaProfil, 0)),
    sCenou: sCenou.length,
    sPredpokladem: items.filter((z) => z.predpokladanaHodnota != null).length,
    sNabidkami: items.filter((z) => z.nabidek > 0).length,
    uhrazenoVyplneno: items.filter((z) => z.uhrazenoVyplneno).length,
    uhrazenoTabulka: items.filter((z) => z.uhrazeno?.length).length,
    nejistych: items.filter((z) => z.vyklad === 'nejiste').length,
    sDuplicitou: items.filter((z) => z.duplicit > 0).length,
    dodatky: {
      zakazek: porovnatelne.length,
      zaklad: Math.round(zaklad),
      konecna: Math.round(konecna),
      zmena: zaklad ? konecna / zaklad - 1 : null,
      podrazilo: porovnatelne.filter((z) => z.konecna > z.zaklad).length,
      zlevnilo: porovnatelne.filter((z) => z.konecna < z.zaklad).length,
    },
    // Kolik se ušetřilo (nebo přeplatilo) proti tomu, co radnice čekala.
    odhad: {
      zakazek: sPredpokladem.length,
      predpoklad: Math.round(predpoklad),
      vysoutezeno: Math.round(vysoutezeno),
      zmena: predpoklad ? vysoutezeno / predpoklad - 1 : null,
      levneji: sPredpokladem.filter((z) => z.cenaProfil < z.predpokladPouzitelny).length,
      drazeji: sPredpokladem.filter((z) => z.cenaProfil > z.predpokladPouzitelny).length,
    },
    roky: Object.values(roky).sort((a, b) => b.rok.localeCompare(a.rok)),
  };
}

/** Kontroly, které mají spadnout dřív, než se rozbitá data dostanou na web. */
export function zkontroluj({ items, souhrn }) {
  const potize = [];
  if (!items.length) potize.push('Dataset zakázek je prázdný.');
  if (items.length > 50 && souhrn.sparovanych === 0) {
    potize.push('Ani jedna zakázka se nespárovala se smlouvou — rozbité čtení kódů.');
  }
  if (items.length > 50 && souhrn.sCenou === 0) {
    potize.push('Ani u jedné zakázky není smluvní cena — rozbité čtení detailu.');
  }
  const zaporne = items.filter((z) => z.cenaProfil != null && z.cenaProfil < 0);
  if (zaporne.length) potize.push(`${zaporne.length} zakázek má zápornou smluvní cenu.`);
  const bezUrl = items.filter((z) => !z.url);
  if (bezUrl.length) potize.push(`${bezUrl.length} zakázek nemá odkaz na profil.`);
  return potize;
}
