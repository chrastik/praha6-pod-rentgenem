import { spustMaketu } from './maketa-registru.mjs';
import { parseStranku } from '../scripts/lib/vysledky.mjs';
import { fetchText } from '../scripts/lib/http.mjs';

const PORT = 8899;
const srv = await spustMaketu(PORT);
const BASE = `http://127.0.0.1:${PORT}`;

// Stejná logika jako v sync-smlouvy-organizace.mjs, jen proti maketě.
const url = (ico, { offset = null, limit = null, signal = null } = {}) => {
  const p = new URLSearchParams({ subject_idnum: ico });
  if (limit != null) p.set('searchResultList-limit', String(limit));
  if (offset != null) p.set('searchResultList-offset', String(offset));
  if (signal) p.set('do', signal);
  return `${BASE}/vyhledavani?${p}`;
};

function novaSession() {
  const jar = new Map();
  return async (u) => {
    const h = jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {};
    const { text, hlavicky } = await fetchText(u, { headers: h, vratHlavicky: true, retries: 0 });
    for (const c of hlavicky.getSetCookie?.() ?? []) {
      const [d] = c.split(';'); const i = d.indexOf('=');
      if (i > 0) jar.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    return text;
  };
}

async function stahni(ico, { bezSession = false } = {}) {
  const s = bezSession ? (async (u) => (await fetchText(u, { retries: 0 }))) : novaSession();
  const nalezene = new Map(); const videna = new Set();
  let celkem = null; let dotazu = 0;
  const zpracuj = (html) => {
    const { celkem: c, radky } = parseStranku(html);
    if (c != null) celkem = c;
    let nove = 0;
    for (const r of radky) {
      if (videna.has(r.id)) continue;
      videna.add(r.id); nove++;
      if (r.posledniVerze) nalezene.set(r.id, r);
    }
    return { radku: radky.length, nove };
  };
  dotazu++; zpracuj(await s(url(ico)));
  dotazu++; let { radku } = zpracuj(await s(url(ico, { limit: 500, signal: 'searchResultList-setLimit' })));
  let offset = radku;
  for (let i = 0; i < 250; i++) {
    if (radku === 0) break;
    if (celkem != null && offset >= celkem) break;
    dotazu++;
    const v = zpracuj(await s(url(ico, { offset, signal: 'searchResultList-setOffset' })));
    radku = v.radku; offset += radku;
    if (v.nove === 0) break;
  }
  return { pocet: nalezene.size, celkem, dotazu };
}

let ok = true;
const zkus = (popis, skut, ocek) => {
  const p = JSON.stringify(skut) === JSON.stringify(ocek);
  if (!p) ok = false;
  console.log((p ? '  ✓ ' : '  ✗ ') + popis + (p ? '' : `  (dostal ${JSON.stringify(skut)}, čekal ${JSON.stringify(ocek)})`));
};

// 1500 smluv, každá 17. je starší verze → 1500 - floor(1499/17) - 1 = ...
const ocekavano = (n) => { let k = 0; for (let i = 0; i < n; i++) if (i % 17 !== 0) k++; return k; };

const sneo = await stahni('27114112');
zkus('velký subjekt: všech 1500 řádků prošlo', sneo.celkem, 1500);
zkus('starší verze se nezapočítaly', sneo.pocet, ocekavano(1500));
zkus('stránkovalo se po 500, ne po 10', sneo.dotazu <= 6, true);

const zs = await stahni('48133761');
zkus('střední subjekt', [zs.pocet, zs.celkem], [ocekavano(330), 330]);

const ms = await stahni('70921580');
zkus('malý subjekt se vejde na jednu stránku', [ms.pocet, ms.celkem], [ocekavano(42), 42]);

const prazdny = await stahni('00000000');
zkus('subjekt bez smluv vrátí nulu a nezacyklí se', prazdny.pocet, 0);

// Klíčová regrese: bez session cookie signál neprojde a všechno vyjde na nulu.
const bez = await stahni('27114112', { bezSession: true });
zkus('BEZ session cookie by to spadlo na nulu (proto ji držíme)', bez.pocet < 100, true);

srv.close();
console.log(ok ? '\nVŠECHNY KONTROLY PROŠLY ✓' : '\nNĚCO NESEDÍ ✗');
process.exit(ok ? 0 : 1);
