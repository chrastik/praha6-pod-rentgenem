/**
 * Čtení profilu zadavatele E-ZAK (zakazky.praha6.cz).
 *
 * Jen čisté funkce nad HTML — stahování je v sync-zakazky.mjs, aby se daly
 * testovat na uložených vzorcích bez sítě.
 *
 * Dvě věci, které nejsou na první pohled vidět:
 *   1. Seznam zakázek má KAŽDOU zakázku na DVOU řádcích: první nese odkaz
 *      a název, druhý sloupce (režim, fáze, datum). Kdo čte řádky po jednom,
 *      dostane zakázky bez dat a data bez zakázek.
 *   2. Výchozí filtr archivu je „Aktuální" a schová dvě třetiny zakázek.
 *      Bez `archive=ALL` má profil 13 stránek místo 32.
 */
import { decodeEntities, stripHtml } from './util.mjs';

export const BASE = 'https://zakazky.praha6.cz';

/** URL seznamu — vždy se všemi zakázkami včetně archivovaných. */
export function urlSeznamu(page = 1) {
  const p = new URLSearchParams({
    type: 'all', state: 'all', archive: 'ALL',
    contract_place: '', contract_place_exact_match: '1', page: String(page),
  });
  return `${BASE}/contract_index.html?${p}`;
}

export const urlDetailu = (dbid) => `${BASE}/contract_display_${dbid}.html`;

const cistyText = (html) => decodeEntities(stripHtml(html ?? '')).replace(/\s+/g, ' ').trim();

/** „06.06.2022" i „23.06.2022 10:00" → „2022-06-06" */
export function datum(text) {
  const m = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(text ?? '');
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/**
 * „1 808 053,83" → 1808053.83, „neuvedena" → null.
 * Mezery bývají nezlomitelné, desetinná čárka je čárka.
 */
export function castka(text) {
  const t = (text ?? '').replace(/\u00a0/g, ' ');
  if (!t || /neuveden|nezveřejn|utajen/i.test(t)) return null;
  const m = /(-?[\d\s]+(?:,\d+)?)/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Sjednocení tvaru evidenčního čísla.
 * V registru smluv i v E-ZAKu se totéž číslo píše jako „VŘ/22/2022", „VR/22/2022"
 * i „VŘ 22/2022"; bez sjednocení by se zakázka se smlouvou nikdy nespárovala.
 */
const KOD = /^\s*(V[ŘR]|VZ|PM|P)\s*[\/\-\s]\s*(\d+)\s*[\/\-\s]\s*(\d{4})/iu;

export function normalizujKod(kod) {
  const m = KOD.exec(kod ?? '');
  if (!m) return null;
  const pref = m[1].toUpperCase() === 'VR' ? 'VŘ' : m[1].toUpperCase();
  return `${pref}/${Number(m[2])}/${m[3]}`;
}

/**
 * Rozdělí „VŘ/22/2022 - Oprava brány" na kód a název.
 *
 * Nelze to udělat useknutím prvního slova: kód se píše i jako „VR 26/2022",
 * tedy dvě slova. Odřízne se přesně to, co jako kód rozpoznal `normalizujKod`.
 * Zakázky bez kódu (např. „04/19/JŘBU") si název ponechají celý.
 */
export function oddelKod(text) {
  const cely = (text ?? '').trim();
  const m = KOD.exec(cely);
  if (!m) return { kod: null, nazev: cely || null };
  const zbytek = cely.slice(m[0].length).replace(/^\s*[-–—:]\s*/, '').trim();
  return { kod: normalizujKod(cely), nazev: zbytek || cely };
}

// ------------------------------------------------------------- seznam ---

/**
 * Rozebere jednu stránku seznamu.
 * @returns {{polozky: Array<object>, maxStranka: number}}
 */
export function parseSeznam(html) {
  // V odkazech je „&amp;page=", v onclicku „&page=" — omezovat oddělovač
  // na [?&] znamená přehlédnout pager a stáhnout jen první stránku.
  const maxStranka = Math.max(0, ...[...html.matchAll(/\bpage=(\d+)/g)].map((m) => Number(m[1])));

  const polozky = [];
  const radky = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  for (let i = 0; i < radky.length; i++) {
    const odkaz = /<a[^>]+href="[^"]*contract_display_(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/i.exec(radky[i]);
    if (!odkaz) continue;

    // Druhý řádek dvojice nese sloupce. Když chybí (poslední řádek tabulky,
    // změna šablony), zakázku nezahazujeme — detail se stejně stahuje zvlášť.
    const bunky = radky[i + 1] && !/contract_display_/.test(radky[i + 1])
      ? [...radky[i + 1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cistyText(m[1]))
      : [];

    // Název na profilu je „VŘ/22/2022 - Oprava brány"; prefix je duplicita.
    const { kod, nazev } = oddelKod(cistyText(odkaz[2]));
    polozky.push({
      dbid: Number(odkaz[1]),
      kod,
      nazev,
      rezim: bunky[0] || null,
      faze: bunky[1] || null,
      zahajeni: datum(bunky[2]),
      lhuta: datum(bunky[3]),
    });
  }
  return { polozky, maxStranka };
}

// ------------------------------------------------------------- detail ---

/** Obsah bloku `<div class="block" id="body_XXX">` až po jeho konec. */
function blok(html, id) {
  const zac = html.indexOf(`id="body_${id}"`);
  if (zac < 0) return null;
  // Konec bloku hledáme přes další `id="body_` — vnořené divy dělají
  // z počítání závorek nespolehlivou hru.
  const dalsi = html.indexOf('id="body_', zac + 10);
  return html.slice(zac, dalsi < 0 ? html.length : dalsi);
}

/** Tabulka, která v bloku následuje za daným nadpisem `<h4>`. */
function tabulkaZa(html, nadpis) {
  if (!html) return null;
  const re = new RegExp(`<h4[^>]*>\\s*${nadpis}[\\s\\S]*?<table[^>]*>([\\s\\S]*?)</table>`, 'i');
  return re.exec(html)?.[1] ?? null;
}

/** Řádky tabulky jako pole polí textů; hlavička (bez <td>) se vynechá. */
function radkyTabulky(tab) {
  if (!tab) return [];
  return [...tab.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cistyText(c[1])))
    .filter((r) => r.length > 0);
}

/**
 * Hodnota za popiskem, např. „Evidenční číslo zadavatele: <b>VŘ/22/2022</b>".
 *
 * Dvojtečka je POVINNÁ. Bez ní by popisek „Název" chytil nadpis sekce
 * „Název, druh veřejné zakázky a popis předmětu" a jako název zakázky
 * by se na web dostal kus šablony.
 */
const zaPopiskem = (text, popisek) =>
  new RegExp(`${popisek}\\s*:\\s*([^|]*?)\\s*(?:\\||$)`, 'i').exec(text)?.[1]?.trim() || null;

/**
 * Rozebere detail zakázky.
 * @param {string} html
 * @param {number} dbid
 */
export function parseDetail(html, dbid) {
  const info = blok(html, 'info')?.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  if (!info) return null; // stránka bez bloku informací = chyba stahování, ne prázdná zakázka

  // Text s oddělovači „|" mezi bloky, aby popisek nesebral i následující větu.
  const t = decodeEntities(
    info.replace(/<br\s*\/?>/gi, ' | ').replace(/<\/(li|p|h4|div|fieldset)>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\|\s*/g, ' | ').trim();

  const kodRaw = zaPopiskem(t, 'Evidenční číslo zadavatele');
  // Kód bývá jen v názvu (zakázky bez vyplněného evidenčního čísla) nebo jen
  // v evidenčním čísle (zakázky, jejichž název kód neopakuje). Berou se oba.
  const zNazvu = oddelKod(zaPopiskem(t, 'Název'));
  const kod = normalizujKod(kodRaw) ?? zNazvu.kod;

  const ucastnici = radkyTabulky(tabulkaZa(blok(html, 'performance'), 'Seznam účastníků'))
    .filter((r) => r.length >= 3)
    .map((r) => ({
      nazev: r[0] || null,
      ico: /^\d{6,8}$/.test(r[1] ?? '') ? r[1].padStart(8, '0') : null,
      // Tabulka má buď 4 sloupce (bez nabídkových cen), nebo 6 (s nimi).
      nabidkaBezDph: r.length >= 6 ? castka(r[3]) : null,
      nabidkaSDph: r.length >= 6 ? castka(r[4]) : null,
      vyloucen: /^ano/i.test(r[r.length - 1] ?? ''),
    }));

  const dodavatele = radkyTabulky(tabulkaZa(blok(html, 'performance'), 'Vybran(?:ý|í) dodavatel\\S*'))
    .filter((r) => r.length >= 4)
    .map((r) => ({
      nazev: r[0] || null,
      ico: /^\d{6,8}$/.test(r[1] ?? '') ? r[1].padStart(8, '0') : null,
      cenaBezDph: castka(r[3]),
      cenaSDph: castka(r[4]),
    }));

  const uhrazeno = radkyTabulky(tabulkaZa(blok(html, 'performance'), 'Skutečně uhrazená cena'))
    .filter((r) => /^20\d\d$/.test(r[0] ?? ''))
    .map((r) => ({ rok: Number(r[0]), bezDph: castka(r[1]), sDph: castka(r[2]) }));

  const perf = blok(html, 'performance') ?? '';
  const dokumentu = new Set(
    [...(blok(html, 'doc_pub') ?? '').matchAll(/document_download_(\d+)\.html/g)].map((m) => m[1]),
  ).size;

  const cpvBlok = blok(html, 'subject_items');
  const cpv = /Žádné záznamy/i.test(cpvBlok ?? 'Žádné záznamy')
    ? []
    : [...cpvBlok.matchAll(/(\d{8})-\d/g)].map((m) => m[1]);

  return {
    dbid,
    kod,
    nazev: zNazvu.nazev,
    evidencni: kodRaw,
    systemove: zaPopiskem(t, 'Systémové číslo'),
    url: urlDetailu(dbid),
    faze: /fáze zadávacího řízení\s*\|?\s*([^|]+)/i.exec(t)?.[1]?.trim().replace(/\s*\(v archivu\)/i, '') || null,
    archiv: /\(v archivu\)/i.test(t),
    druh: zaPopiskem(t, 'Druh veřejné zakázky'),
    rezim: zaPopiskem(t, 'Režim veřejné zakázky'),
    // Profil používá obě znění podle typu řízení.
    postup: zaPopiskem(t, 'Postup') ?? zaPopiskem(t, 'Druh řízení'),
    zakon: zaPopiskem(t, 'Dle zákona'),
    popis: /Stručný popis předmětu:\s*\|?\s*([^|]{3,600})/i.exec(t)?.[1]?.trim() || null,
    zahajeni: datum(zaPopiskem(t, 'Datum zahájení')),
    lhuta: datum(zaPopiskem(t, 'Nabídku podat do')),
    predpokladanaHodnota: castka(zaPopiskem(t, 'Předpokládaná hodnota')),
    zadavatel: {
      nazev: zaPopiskem(t, 'Úřední název'),
      ico: /IČO:\s*(\d{6,8})/.exec(t)?.[1]?.padStart(8, '0') ?? null,
    },
    datumSmlouvy: datum(/Datum uzavření smlouvy:\s*([\d.\s]+)/i.exec(cistyText(perf))?.[1]),
    ucastnici,
    dodavatele,
    uhrazeno,
    cpv,
    dokumentu,
  };
}
