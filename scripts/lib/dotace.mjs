/**
 * Dotace rozdané (a přijaté) městskou částí Praha 6.
 *
 * Nejde o nový zdroj dat — všechno se odvozuje z už staženého registru smluv.
 * Proto je tenhle soubor čistá funkce bez sítě: dá se testovat i měnit bez
 * jediného stažení a přepočítá se při každém buildu.
 *
 * Tři věci, které se tu řeší a bez kterých by čísla lhala:
 *
 * 1) SMĚR PENĚZ. V datasetu jsou i smlouvy, kde Praha 6 dotaci dostala
 *    (od hlavního města). Publikoval je někdo jiný, takže v roli protistrany
 *    vychází sama městská část. Kdyby se nerozlišily, vypadala by radnice
 *    jako příjemce vlastních dotací.
 *
 * 2) DVOJITĚ ZAKÓDOVANÉ ENTITY. Registr posílá v předmětu „&amp;quot;“, což je
 *    uvozovka zakódovaná dvakrát. Jedním dekódováním vznikne „&quot;“, což je
 *    pořád nesmysl. Proto se dekóduje opakovaně, dokud se text mění.
 *
 * 3) NÁZEV PROGRAMU je v předmětu jen asi u třetiny smluv a pokaždé jinak.
 *    Nedělám z něj proto hlavní osu — spolehlivější je oblast (odvozená
 *    z klíčových slov) a název projektu, který bývá v uvozovkách.
 */
import { decodeEntities } from './util.mjs';

export const ICO_MC = '00063703';

/** Bez diakritiky a malými písmeny — pro hledání klíčových slov. */
export const bezDiakritiky = (s) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Registr entity občas zakóduje dvakrát („&amp;quot;“). Dekóduje se dokola,
 * dokud se text mění, nanejvýš třikrát — víc už by byl spíš důvod k podezření
 * než k dalšímu kolu.
 */
export function vycisti(text) {
  let s = text ?? '';
  for (let i = 0; i < 3; i++) {
    const dalsi = decodeEntities(s);
    if (dalsi === s) break;
    s = dalsi;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Poznáme dotační smlouvu podle předmětu. */
export const jeDotace = (predmet) => /dotac|grant/.test(bezDiakritiky(predmet));

/**
 * Oblasti podle klíčových slov v předmětu. Pořadí rozhoduje — první shoda
 * vyhrává, proto jdou konkrétnější dřív než obecnější (třeba „hospic“ před
 * „senior“, protože jinak by hospicová péče spadla do sociálních služeb).
 */
export const OBLASTI = [
  ['pamatky', 'Památky', /pamatkov|kostel|kaple|fasad\w*\s+domu|obnova\s+pamatk/],
  ['socialni', 'Sociální a zdravotní', /socialn|hospic|charit|senior|pecovatel|bezdomov|azylov|stacionar|osobni\s+asistenc|rana\s+pece|zdravotne\s+postizen|dusevni\s+zdrav|terenni\s+program|odlehcovac|pracovni\s+terapie|nemocnic|lecebn|paliativ|handicap|krizov\w*\s+pomoc|potravinov|luzek|nasledne\s+pece|\bdomov\b|obeti\s+domaci|hospodarska\s+nouze|pomoc\s+rodinam|ohrozen\w*\s+det/],
  ['sport', 'Sport', /sport|telovychov|fotbal|hokej|cvicen|hrist|umt|olympij|atletik|plavan|tenis|sokol|florbal|volejbal|basketbal|trener/],
  ['kultura', 'Kultura', /kultur|divadl|hudb|festival|koncert|galeri|vystav|knihovn|film|umeleck|orchestr|sbor|literar/],
  ['zivotni-prostredi', 'Životní prostředí', /ekolog|zivotniho\s+prostredi|zelen|drevin|zahrad|vnitroblok|zver|myslivec|kompost|vcel|biodiverz|klima/],
  ['bezpecnost', 'Bezpečnost a prevence', /prevenc|policie|hasic|\bsdh\b|sh\s+cms|bezpecnost|zachran/],
  ['vzdelavani', 'Vzdělávání a mládež', /skol|vzdelav|vyuk|zaku|student|gymnazi|jazyk|mladez|skaut|deti\s+a\s+mladez|volnocasov/],
  ['komunitni', 'Komunitní život', /komunitn|sousedsk|spolkov|obcansk\w*\s+aktivit|sestka\s+komunitni/],
];

/**
 * Oblast se hledá v předmětu i v názvu příjemce. U velké části smluv je totiž
 * předmět jen „Smlouva o poskytnutí dotace“ a jediné, co o obsahu něco říká,
 * je jméno příjemce („Trenéři ve škole, z.s.“, „Domov sv. Karla Boromejského“).
 * Je to odhad, ne údaj z registru — na webu to říkáme nahlas.
 */
export function urciOblast(predmet, prijemce = '') {
  const n = bezDiakritiky(`${predmet} ${prijemce}`);
  for (const [kod, nazev, re] of OBLASTI) if (re.test(n)) return { kod, nazev };
  return { kod: 'ostatni', nazev: 'Nezařazeno' };
}

/**
 * Známé dotační programy městské části. Doplňuje se ručně — název programu
 * v předmětu smlouvy nemá pevný tvar a odhadovat ho automaticky by znamenalo
 * vyrábět programy, které neexistují.
 */
export const PROGRAMY = [
  ['Šestka kulturní', /sestka\s+kulturni/],
  ['Šestka sportovní', /sestka\s+sportovni/],
  ['Šestka komunitní', /sestka\s+komunitni/],
  ['Aktivní šestka', /aktivni\s+sestka/],
  ['Zdravá Šestka', /zdrava\s+sestka/],
  ['Otevřený svět', /otevren\w*\s+svet/],
  ['Kultura I. a II.', /\bkultura\s+(i{1,2})\./],
  ['Sport a volný čas na Šestce', /sport\s+a\s+volny\s+cas\s+na\s+sestce/],
  ['Podpora sportovní identity', /sportovni\s+identit/],
  ['Sociální a návazné služby', /navazn\w*\s+sluzeb|v\s+socialni\s+oblasti|socialnich\s+a\s+navazn/],
  ['Památková dotace', /pamatkov\w*\s+dotac/],
  ['Podpora hospicové péče', /hospic/],
  ['Sublokální periodika', /sublokaln|periodik/],
  ['Podpora SDH', /sh\s+cms|\bsdh\b/],
  ['Ekologické aktivity', /ekologick\w*\s+aktivit/],
];

export function urciProgram(predmet) {
  const n = bezDiakritiky(predmet);
  for (const [nazev, re] of PROGRAMY) if (re.test(n)) return nazev;
  return null;
}

/**
 * Název projektu z předmětu. Nejčastější tvary:
 *   Smlouva o poskytnutí dotace na projekt "Terénní program Prahy 6"
 *   Šestka kulturní II. - 2026 - Dotace - Spolek Povaleč - NOC 6
 *   Dotace SK Aritma - Výměna UMT na fotbalovém hřišti
 * Vrací null, když se nedá nic rozumného vytáhnout — radši nic než smyšlenina.
 */
export function urciProjekt(predmet) {
  const p = vycisti(predmet);

  // 1) cokoli v uvozovkách (rovných i českých)
  const uvozovky = /["„“»]([^"„“«»]{3,120})["“”«]/.exec(p);
  if (uvozovky) return uvozovky[1].trim();

  // 2) „… na projekt NÁZEV“ / „… na realizaci projektu NÁZEV“
  const naProjekt = /na\s+(?:projekt|realizaci\s+projektu)\s+(.{3,120})$/i.exec(p);
  if (naProjekt) return naProjekt[1].replace(/[\s.,-]+$/, '').trim();

  // 3) poslední úsek za pomlčkou, když jich je aspoň tolik, že jde o strukturu
  const casti = p.split(/\s+[-–—]\s+/).map((x) => x.trim()).filter(Boolean);
  if (casti.length >= 3) {
    const posledni = casti[casti.length - 1];
    if (posledni.length >= 4 && posledni.length <= 120 && !/^dotace$/i.test(posledni)) return posledni;
  }
  return null;
}

/** Klíč příjemce: IČO, a když chybí (typicky fyzické osoby), tak jméno. */
export const klicPrijemce = (ico, nazev) => (ico ? `ico:${ico}` : `jmeno:${bezDiakritiky(nazev)}`);

/**
 * Ze seznamu smluv městské části postaví dataset dotací.
 * @param {Array<object>} smlouvy položky z data/smlouvy.json
 */
export function sestav(smlouvy) {
  const items = [];

  for (const s of smlouvy) {
    if (!jeDotace(s.predmet)) continue;

    const predmet = vycisti(s.predmet);
    const prijemce = vycisti(s.protistrana) || null;
    const ico = s.protistranaIco || null;

    // Publikoval-li smlouvu někdo jiný, vyjde v roli protistrany sama městská
    // část — takovou dotaci Praha 6 dostala, ne rozdala.
    //
    // Druhý případ opačného směru: darovací smlouvy, kterými někdo cizí
    // dotační program financuje (Letiště Praha takhle sype do programu
    // Otevřený svět). Slovo „dotační“ v předmětu je, ale peníze tečou DO
    // rozpočtu — bez tohohle by Letiště vyšlo jako jeden z největších
    // příjemců dotací Prahy 6.
    const financujeProgram = /darovac/.test(bezDiakritiky(predmet))
      && /dotacni\w*\s+program|k\s+dotacnimu\s+programu/.test(bezDiakritiky(predmet));
    const smer = (ico === ICO_MC || financujeProgram) ? 'prijata' : 'rozdana';
    const datum = s.zverejneno ?? s.datum ?? null;

    items.push({
      id: s.id,
      smer,
      datum: s.datum ?? null,
      zverejneno: s.zverejneno ?? null,
      rok: datum ? Number(datum.slice(0, 4)) : null,
      predmet,
      projekt: urciProjekt(predmet),
      program: urciProgram(predmet),
      oblast: urciOblast(predmet, prijemce ?? '').kod,
      prijemce,
      prijemceIco: ico,
      castka: s.castkaBezDph ?? null,
      url: s.url,
    });
  }

  // Druhý průchod: dotaci bez zařazení převezmeme oblast od téhož příjemce,
  // ale JEN když má ve všech ostatních dotacích shodnou oblast. „Cesta domů“
  // dělá jenom sociální služby, takže i její projekt „Poradna Cesty domů“ tam
  // patří. U příjemce, který střídá obory, se nehádá a zůstane nezařazeno.
  const oblastiPrijemce = new Map();
  for (const d of items) {
    if (d.smer !== 'rozdana' || d.oblast === 'ostatni' || !d.prijemce) continue;
    const k = klicPrijemce(d.prijemceIco, d.prijemce);
    if (!oblastiPrijemce.has(k)) oblastiPrijemce.set(k, new Set());
    oblastiPrijemce.get(k).add(d.oblast);
  }
  for (const d of items) {
    if (d.smer !== 'rozdana' || d.oblast !== 'ostatni' || !d.prijemce) continue;
    const mozne = oblastiPrijemce.get(klicPrijemce(d.prijemceIco, d.prijemce));
    if (mozne && mozne.size === 1) {
      d.oblast = [...mozne][0];
      d.oblastZPrijemce = true; // ať je poznat, že to není z předmětu smlouvy
    }
  }

  items.sort((a, b) => (b.zverejneno ?? b.datum ?? '').localeCompare(a.zverejneno ?? a.datum ?? ''));

  // --- příjemci (jen u rozdaných; přijaté jsou dotace pro samotnou radnici) ---
  const mapa = new Map();
  for (const d of items) {
    if (d.smer !== 'rozdana' || !d.prijemce) continue;
    const k = klicPrijemce(d.prijemceIco, d.prijemce);
    if (!mapa.has(k)) {
      mapa.set(k, {
        klic: k, ico: d.prijemceIco, nazev: d.prijemce,
        pocet: 0, castka: 0, sCastkou: 0, oblasti: new Set(),
        prvni: null, posledni: null,
      });
    }
    const p = mapa.get(k);
    p.pocet++;
    if (d.castka != null) { p.castka += d.castka; p.sCastkou++; }
    p.oblasti.add(d.oblast);
    const den = d.zverejneno ?? d.datum;
    if (den) {
      if (!p.prvni || den < p.prvni) p.prvni = den;
      if (!p.posledni || den > p.posledni) p.posledni = den;
    }
  }
  const prijemci = [...mapa.values()]
    .map((p) => ({ ...p, oblasti: [...p.oblasti] }))
    .sort((a, b) => b.castka - a.castka || b.pocet - a.pocet);

  const rozdane = items.filter((d) => d.smer === 'rozdana');
  const prijate = items.filter((d) => d.smer === 'prijata');
  const soucet = (xs) => xs.reduce((a, d) => a + (d.castka ?? 0), 0);

  const podleOblasti = {};
  for (const [kod, nazev] of OBLASTI.map(([k, n]) => [k, n]).concat([['ostatni', 'Nezařazeno']])) {
    const v = rozdane.filter((d) => d.oblast === kod);
    if (v.length) podleOblasti[kod] = { nazev, pocet: v.length, castka: soucet(v) };
  }

  return {
    items,
    prijemci,
    oblasti: podleOblasti,
    souhrn: {
      rozdano: { pocet: rozdane.length, castka: soucet(rozdane), sCastkou: rozdane.filter((d) => d.castka != null).length },
      prijato: { pocet: prijate.length, castka: soucet(prijate), sCastkou: prijate.filter((d) => d.castka != null).length },
      prijemcu: prijemci.length,
      roky: [...new Set(rozdane.map((d) => d.rok).filter(Boolean))].sort((a, b) => b - a),
      sProgramem: rozdane.filter((d) => d.program).length,
      sProjektem: rozdane.filter((d) => d.projekt).length,
      oblastZPrijemce: rozdane.filter((d) => d.oblastZPrijemce).length,
      nezarazeno: rozdane.filter((d) => d.oblast === 'ostatni').length,
    },
  };
}

/** Kontroly, které mají chytit tiše rozbité odvození. */
export function zkontroluj(d) {
  const potize = [];
  if (d.items.length === 0) potize.push('nenašla se ani jedna dotační smlouva');
  if (d.souhrn.rozdano.pocet === 0) potize.push('nenašla se ani jedna rozdaná dotace');
  if (d.prijemci.length === 0 && d.souhrn.rozdano.pocet > 0) potize.push('rozdané dotace jsou, ale žádní příjemci');

  const soucetPrijemcu = d.prijemci.reduce((a, p) => a + p.pocet, 0);
  const rozdanychSPrijemcem = d.items.filter((x) => x.smer === 'rozdana' && x.prijemce).length;
  if (soucetPrijemcu !== rozdanychSPrijemcem) {
    potize.push(`součet dotací u příjemců (${soucetPrijemcu}) nesedí s počtem rozdaných (${rozdanychSPrijemcem})`);
  }
  const zbylaEntita = d.items.find((x) => /&(amp|quot|lt|gt|nbsp);/i.test(x.predmet ?? ''));
  if (zbylaEntita) potize.push(`v předmětu zůstala HTML entita: „${zbylaEntita.predmet.slice(0, 60)}“`);
  const mcJakoPrijemce = d.prijemci.find((p) => p.ico === ICO_MC);
  if (mcJakoPrijemce) potize.push('městská část je vedená jako příjemce vlastní dotace — rozpadlo se rozlišení směru');
  return potize;
}
