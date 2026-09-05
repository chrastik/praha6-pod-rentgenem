/**
 * Maketa vyhledávání registru smluv. Napodobuje tři vlastnosti, na kterých
 * se skutečné stahování už jednou rozbilo:
 *   1) signál `do=` bez session cookie vrátí stránku BEZ tabulky (ne chybu),
 *   2) offset i limit se drží v session, ne v URL,
 *   3) v popisku počtu je překlep „nalezných záznámů“.
 */
import { createServer } from 'node:http';

const SMLUV = { '27114112': 1500, '48133761': 330, '70921580': 42, '00000000': 0 };
const session = new Map();
let poradi = 0;

const radek = (ico, i) => `<tr>
  <td class="1"> Subjekt ${ico} </td>
  <td class="2"> Smlouva &#269;. ${i} </td>
  <td class="3"> ${i % 17 === 0 ? 'ne' : 'ano'} </td>
  <td class="4"> ${String((i % 28) + 1).padStart(2, '0')}.03.2024 </td>
  <td class="number nobr 5"> ${(1000 + i).toLocaleString('cs-CZ').replace(/ /g, '&nbsp;')} CZK bez DPH </td>
  <td class="6"> Dodavatel ${i % 7} </td>
  <td class="btn no-sort"><a href="/smlouva/${ico}${String(i).padStart(5, '0')}?backlink=x">Detail</a></td>
</tr>`;

export function spustMaketu(port) {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ico = u.searchParams.get('subject_idnum') ?? '';
    const signal = u.searchParams.get('do');
    const cookie = /sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const hlavicky = { 'content-type': 'text/html; charset=utf-8' };

    // Bez session se signál odmítne — stránka se vrátí bez tabulky.
    if (signal && !session.has(cookie)) {
      res.writeHead(200, hlavicky);
      return res.end('<html><body><p>Vyhledané smlouvy na základě kritérií</p></body></html>');
    }

    let sid = cookie;
    if (!session.has(sid)) {
      sid = `s${++poradi}`;
      session.set(sid, { offset: 0, limit: 10 });
      hlavicky['set-cookie'] = `sid=${sid}; Path=/; HttpOnly`;
    }
    const st = session.get(sid);
    if (signal === 'searchResultList-setLimit') {
      st.limit = Number(u.searchParams.get('searchResultList-limit')) || st.limit;
      st.offset = 0;
    } else if (signal === 'searchResultList-setOffset') {
      st.offset = Number(u.searchParams.get('searchResultList-offset')) || 0;
    } else {
      st.offset = 0;
    }

    const celkem = SMLUV[ico] ?? 0;
    const radky = [];
    for (let i = st.offset; i < Math.min(st.offset + st.limit, celkem); i++) radky.push(radek(ico, i));

    res.writeHead(200, hlavicky);
    res.end(`<html><body><p>Vyhledané smlouvy na základě kritérií</p>
      <p>Počet nalezných záznámů ${celkem}</p>
      <table class="searchResultList"><thead><tr><th>Publikující</th></tr></thead>
      <tbody>${radky.join('')}</tbody></table></body></html>`);
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}
