/**
 * Čtení stránky výsledků vyhledávání v registru smluv.
 *
 * Proč se nestahuje XML detailu jako u městské části: XML jedné smlouvy má
 * i několik megabajtů, protože v něm jsou přílohy zabalené v base64. U osmi
 * tisíc smluv organizací by to bylo desítky gigabajtů. Tabulka výsledků přitom
 * obsahuje všechno, co potřebujeme — předmět, datum, hodnotu i protistranu.
 *
 * Dvě pasti, na kterých se to dá tiše rozbít:
 *   1. Stránkování NEJDE nastavit jen parametrem `searchResultList-offset`.
 *      Bez signálu `do=searchResultList-setOffset` server parametr ignoruje
 *      a pořád vrací první stránku — což vypadá jako „víc záznamů tam není".
 *   2. Popisek počtu má na webu překlep: „Počet nalezných záznámů“.
 *      Hledat „nalezených“ nebo i „nalezen“ nenajde nic.
 */
import { decodeEntities, stripHtml } from './util.mjs';

const BASE = 'https://smlouvy.gov.cz';

/** Sestaví URL jedné stránky výsledků pro dané IČO publikujícího subjektu. */
export function urlVysledku(ico, offset = 0, limit = 100) {
  const p = new URLSearchParams({
    subject_idnum: ico,
    'searchResultList-limit': String(limit),
    'searchResultList-offset': String(offset),
    do: 'searchResultList-setOffset',
  });
  return `${BASE}/vyhledavani?${p}`;
}

const bunky = (radek) =>
  [...radek.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((m) => decodeEntities(stripHtml(m[1])).replace(/\s+/g, ' ').trim());

/**
 * „198 347 CZK bez DPH“ → { castka: 198347, mena: 'CZK', sDph: false }
 * Mezery bývají nezlomitelné (U+00A0), proto se zahazují všechny bílé znaky.
 * Hodnota v seznamu je zaokrouhlená na celé koruny; u součtů přes tisíce smluv
 * je ta odchylka zanedbatelná, u jedné smlouvy to říkáme v poznámce na webu.
 */
export function parseHodnota(text) {
  if (!text) return { castka: null, mena: null, sDph: null };
  const m = /(-?[\d\s .]+?)(?:,(\d+))?\s*([A-Z]{3})/.exec(text);
  if (!m) return { castka: null, mena: null, sDph: null };
  const cele = m[1].replace(/[\s .]/g, '');
  const castka = Number(cele + (m[2] ? `.${m[2]}` : ''));
  return {
    castka: Number.isFinite(castka) ? castka : null,
    mena: m[3],
    sDph: /v[čc]\.?\s*DPH|s\s*DPH/i.test(text) ? true : /bez\s*DPH/i.test(text) ? false : null,
  };
}

/** „04.09.2026“ → „2026-09-04“ */
export function parseCzDate(text) {
  const m = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(text ?? '');
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * Rozebere celou stránku výsledků.
 * @returns {{celkem: number|null, radky: Array<object>}}
 */
export function parseStranku(html) {
  // \w v JS nepovažuje „ý“ ani „á“ za písmeno, takže /nalez\w*/ na slově
  // „nalezných“ neuspěje. Musí to být \p{L} s příznakem u — a navíc má web
  // v tom popisku překlep, takže se nedá spoléhat na přesné znění.
  const celkemText = /Po[čc]et\s+nalez\p{L}*\s+z\p{L}*\s*:?\s*([\d\s ]+)/iu.exec(html);
  const celkem = celkemText ? Number(celkemText[1].replace(/[\s ]/g, '')) : null;

  const radky = [];
  for (const m of html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const b = bunky(m[1]);
    if (b.length < 6) continue; // hlavička tabulky nemá <td>
    const id = /\/smlouva\/(\d+)/.exec(m[1])?.[1];
    if (!id) continue;

    const { castka, mena, sDph } = parseHodnota(b[4]);
    radky.push({
      id,
      publikujici: b[0] || null,
      predmet: b[1] || null,
      posledniVerze: /^ano$/i.test(b[2]),
      publikovano: parseCzDate(b[3]),
      castka,
      mena,
      sDph,
      protistrana: b[5] || null,
      url: `${BASE}/smlouva/${id}`,
    });
  }
  return { celkem, radky };
}
