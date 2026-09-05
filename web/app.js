// Praha 6 pod rentgenem — statický frontend bez frameworku a bez build kroku.
// Data se načítají líně: manifest hned, ročníky usnesení a fulltextový index až
// když jsou potřeba. Cílem je, aby první vykreslení nestahovalo desítky MB.

const DATA = './data';
const app = document.getElementById('app');
const stavDat = document.getElementById('stavDat');

const cache = new Map();
let verze = '';   // časové razítko dat; přidává se k URL, aby prohlížeč nedržel starý JSON

async function nacti(cesta) {
  if (cache.has(cesta)) return cache.get(cesta);
  const url = `${DATA}/${cesta}${verze ? `?v=${encodeURIComponent(verze)}` : ''}`;
  const p = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${cesta}: HTTP ${r.status}`);
    return r.json();
  });
  cache.set(cesta, p);
  return p;
}

/**
 * Manifest se načítá mimo cache a bez ukládání do prohlížeče. Bez toho se
 * návštěvníkovi po aktualizaci dat ještě dlouho zobrazují stará čísla —
 * statické JSONy se cachují agresivně a manifest je na začátku řetězu.
 */
async function nactiManifest() {
  const r = await fetch(`${DATA}/web/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
  return r.json();
}

const fmtDatum = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ') : '—');
const fmtCislo = (n) => (n == null ? '—' : n.toLocaleString('cs-CZ'));
const fmtKc = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('cs-CZ')} Kč`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let manifest = null;

// ================================================================= seznamy ===
// Všechny čtyři přehledy — usnesení, faktury, smlouvy i úřední deska — sdílejí
// stejné stránkování a stejné chování filtrů. Dřív ho měla jen usnesení a zbytek
// se tiše ořezával na prvních sto položek, takže starší záznamy nešly zobrazit.

const NA_STRANU = 50;

/** Vybere z pole položky patřící na aktuální stranu a spočítá rozsah. */
function vyrez(polozky, params, naStranu = NA_STRANU) {
  const stran = Math.max(1, Math.ceil(polozky.length / naStranu));
  const s = Math.min(Math.max(1, Number(params.get('strana') ?? 1) || 1), stran);
  return { s, stran, kus: polozky.slice((s - 1) * naStranu, s * naStranu) };
}

/**
 * U faktur je přes 500 stran, u smluv skoro 300 — samotné „další / předchozí“
 * by na starší záznamy nestačilo, proto skok na první, poslední a přímé zadání.
 */
function strankovani(s, stran, celkem, naStranu = NA_STRANU) {
  if (stran <= 1) return '';
  const od = (s - 1) * naStranu + 1;
  const doo = Math.min(s * naStranu, celkem);
  return `
    <nav class="strankovani" aria-label="Stránkování">
      <button type="button" data-strana="1" ${s <= 1 ? 'disabled' : ''} title="První strana">«</button>
      <button type="button" data-strana="${s - 1}" ${s <= 1 ? 'disabled' : ''}>← Předchozí</button>
      <span class="stav">
        Strana
        <input class="skok" type="number" min="1" max="${stran}" value="${s}"
               aria-label="Číslo strany" inputmode="numeric">
        z ${fmtCislo(stran)}
      </span>
      <button type="button" data-strana="${s + 1}" ${s >= stran ? 'disabled' : ''}>Další →</button>
      <button type="button" data-strana="${stran}" ${s >= stran ? 'disabled' : ''} title="Poslední strana">»</button>
      <span class="rozsah">záznamy ${fmtCislo(od)}–${fmtCislo(doo)} z ${fmtCislo(celkem)}</span>
    </nav>`;
}

/** Vykreslí seznam nebo hlášku, že nic neodpovídá. */
function seznam(kus, radek, prazdno = 'Nic neodpovídá zadání.') {
  return kus.length
    ? `<div class="seznam">${kus.map(radek).join('')}</div>`
    : `<p class="prazdno">${esc(prazdno)}</p>`;
}

/**
 * Napojí filtry a stránkování na URL. Změna filtru vrací na první stranu —
 * jinak by uživatel po zúžení výběru skončil na prázdné straně 300.
 */
function zapoj(cesta, params, zachovat = []) {
  const naFiltr = (form) => {
    const p = new URLSearchParams();
    for (const k of zachovat) if (params.get(k)) p.set(k, params.get(k));
    for (const [k, v] of new FormData(form)) if (String(v).trim()) p.set(k, String(v).trim());
    p.delete('strana');
    location.hash = `#${cesta}?${p}`;
  };

  const form = document.getElementById('filtry');
  form?.addEventListener('change', (e) => naFiltr(e.currentTarget));
  form?.addEventListener('submit', (e) => { e.preventDefault(); naFiltr(e.currentTarget); });

  const naStranu = (n) => {
    const p = new URLSearchParams(params);
    p.set('strana', String(n));
    location.hash = `#${cesta}?${p}`;
  };
  app.querySelectorAll('[data-strana]').forEach((b) =>
    b.addEventListener('click', () => naStranu(b.dataset.strana)));
  app.querySelectorAll('.skok').forEach((i) => {
    const jdi = () => {
      const n = Number(i.value);
      if (Number.isFinite(n) && n >= 1) naStranu(Math.min(n, Number(i.max)));
    };
    i.addEventListener('change', jdi);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); jdi(); } });
  });
}

/** Roky nalezené v datech, sestupně — pro nabídku filtru. */
const rokyZ = (polozky, klic = 'datum') =>
  [...new Set(polozky.map((p) => (p[klic] ?? '').slice(0, 4)).filter(Boolean))].sort().reverse();

const volby = (hodnoty, vybrano) =>
  hodnoty.map((h) => `<option${String(h) === String(vybrano) ? ' selected' : ''}>${esc(h)}</option>`).join('');

// ================================================================== router ===
const routes = {
  '/': domu,
  '/usneseni': usneseni,
  '/finance': finance,
  '/smlouvy': smlouvy,
  '/deska': deska,
  '/zdroje': zdroje,
};

async function route() {
  const [cesta, dotaz] = location.hash.replace(/^#/, '').split('?');
  const view = routes[cesta || '/'] ?? domu;
  const params = new URLSearchParams(dotaz ?? '');
  document.querySelectorAll('.hlavicka nav a').forEach((a) => {
    a.toggleAttribute('aria-current', a.getAttribute('href') === `#${cesta || '/'}`);
  });
  app.innerHTML = '<p class="nacitani">Načítám…</p>';
  try {
    await view(params);
  } catch (err) {
    app.innerHTML = `<div class="chyba"><strong>Data se nepodařilo načíst.</strong><br>${esc(err.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

// =================================================================== views ===
async function domu() {
  const m = manifest;
  const d = m.datasety ?? {};
  app.innerHTML = `
    <h1>Veřejná data městské části Praha 6</h1>
    <p class="podnadpis">Usnesení rady a zastupitelstva, rozpočet, faktury a smlouvy
    na jednom místě — u každého záznamu odkaz na originální zdroj.</p>
    <div class="karty">
      <div><div class="v">${fmtCislo(m.usneseni.pocet)}</div><div class="k">usnesení ${m.usneseni.rozsah?.od?.slice(0, 4) ?? ''}–${m.usneseni.rozsah?.do?.slice(0, 4) ?? ''}</div></div>
      <div><div class="v">${fmtCislo(d.smlouvy?.pocet)}</div><div class="k">smluv v registru</div></div>
      <div><div class="v">${fmtCislo(d.faktury?.pocet)}</div><div class="k">jednotlivých faktur</div></div>
      <div><div class="v">${fmtCislo(d.zapisy?.pocet)}</div><div class="k">zápisů a programů</div></div>
      <div><div class="v">${fmtCislo(d.deska?.pocet)}</div><div class="k">položek úřední desky</div></div>
    </div>
    <h2>Kde začít</h2>
    <div class="seznam">
      ${odkaz('#/usneseni', 'Usnesení a jednání', 'Rada i zastupitelstvo, filtr podle orgánu, roku a tématu, fulltext v plném znění.')}
      ${odkaz('#/finance', 'Peníze', 'Položkový rozpočet a jednotlivé faktury z CityVizoru.')}
      ${odkaz('#/smlouvy', 'Registr smluv', 'Smlouvy městské části podle IČO 00063703.')}
      ${odkaz('#/deska', 'Úřední deska', 'Aktuálně vyvěšené dokumenty a průběžně budovaný archiv.')}
    </div>`;
}

const odkaz = (href, nadpis, popis) => `
  <div class="polozka"><div class="meta">→</div><div>
    <h3><a href="${href}">${esc(nadpis)}</a></h3>
    <div class="radek">${esc(popis)}</div>
  </div></div>`;

// ---------------------------------------------------------------- usnesení ---
let indexCache = null;
async function nactiIndex() {
  if (!indexCache) {
    const [docs, tokens] = await Promise.all([
      nacti('web/index/docs.json'), nacti('web/index/tokens.json'),
    ]);
    indexCache = { docs, tokens };
  }
  return indexCache;
}

async function usneseni(params) {
  const { docs, tokens } = await nactiIndex();
  const q = params.get('q') ?? '';
  const organ = params.get('organ') ?? '';
  const rok = params.get('rok') ?? '';
  const tema = params.get('tema') ?? '';

  let vysledek = docs;
  if (q.trim()) {
    const slova = norm(q).split(/[^0-9a-z/]+/).filter((s) => s.length >= 3);
    if (slova.length) {
      const mnoziny = slova.map((s) => {
        const presne = tokens[s];
        if (presne) return new Set(presne);
        // prefixové dohledání — uživatel píše "rekonstruk", token je "rekonstrukce"
        const spojene = new Set();
        for (const t in tokens) if (t.startsWith(s)) tokens[t].forEach((i) => spojene.add(i));
        return spojene;
      });
      mnoziny.sort((a, b) => a.size - b.size);
      const [prvni, ...zbytek] = mnoziny;
      vysledek = [...prvni].filter((i) => zbytek.every((m) => m.has(i))).map((i) => docs[i]);
    }
  }
  if (organ) vysledek = vysledek.filter((d) => d.o === organ);
  if (rok) vysledek = vysledek.filter((d) => (d.d ?? '').startsWith(rok));
  if (tema) vysledek = vysledek.filter((d) => d.t?.includes(tema));
  vysledek = vysledek.slice().sort((a, b) => (b.d ?? '').localeCompare(a.d ?? ''));

  const { s, stran, kus } = vyrez(vysledek, params, 25);
  const vsechnaTemata = [...new Set(docs.flatMap((d) => d.t ?? []))].sort();

  app.innerHTML = `
    <h1>Usnesení rady a zastupitelstva</h1>
    <p class="podnadpis">${fmtCislo(manifest.usneseni.pocet)} usnesení od
    ${fmtDatum(manifest.usneseni.rozsah?.od)}. Do roku 2022 z archivu webu radnice,
    od roku 2022 z portálu usnesení, kde je plné znění.</p>

    <form class="filtry" id="filtry">
      <select name="organ" aria-label="Orgán">
        <option value="">Rada i zastupitelstvo</option>
        <option value="RMC"${organ === 'RMC' ? ' selected' : ''}>Rada</option>
        <option value="ZMC"${organ === 'ZMC' ? ' selected' : ''}>Zastupitelstvo</option>
      </select>
      <select name="rok" aria-label="Rok">
        <option value="">Všechny roky</option>
        ${volby(manifest.usneseni.roky, rok)}
      </select>
      <select name="tema" aria-label="Téma">
        <option value="">Všechna témata</option>
        ${volby(vsechnaTemata, tema)}
      </select>
      ${q ? `<button type="button" id="zrusHledani">Zrušit hledání „${esc(q)}“</button>` : ''}
      <span class="pocet">${fmtCislo(vysledek.length)} záznamů</span>
    </form>

    ${seznam(kus, radekUsneseni)}
    ${strankovani(s, stran, vysledek.length, 25)}`;

  zapoj('/usneseni', params, ['q']);
  document.getElementById('zrusHledani')?.addEventListener('click', () => {
    const p = new URLSearchParams(params); p.delete('q'); p.delete('strana');
    const pole = document.getElementById('q'); if (pole) pole.value = '';
    location.hash = `#/usneseni?${p}`;
  });
}

const radekUsneseni = (d) => `
  <div class="polozka">
    <div class="meta">${fmtDatum(d.d)}</div>
    <div>
      <h3><a href="${esc(d.u ?? '#')}" target="_blank" rel="noopener">${esc(d.n || 'Bez názvu')}</a></h3>
      <div class="radek">
        <span class="badge ${d.o}">${d.o === 'ZMC' ? 'Zastupitelstvo' : 'Rada'}</span>
        ${d.c ? `<span>${esc(d.c)}</span>` : ''}
        ${(d.t ?? []).map((t) => `<span class="stitek">${esc(t)}</span>`).join('')}
      </div>
    </div>
  </div>`;

// ------------------------------------------------------------------ peníze ---
async function finance(params) {
  const [rozpocet, faktury] = await Promise.all([
    nacti('rozpocet.json').catch(() => null),
    nacti('faktury.json').catch(() => null),
  ]);
  if (!rozpocet && !faktury) {
    app.innerHTML = '<h1>Peníze</h1><p class="prazdno">Finanční data ještě nebyla načtena.</p>';
    return;
  }

  const vsechny = faktury?.items ?? [];
  const rok = params.get('rok') ?? '';
  const q = params.get('q') ?? '';
  const nq = norm(q);

  let vybrane = vsechny;
  if (rok) vybrane = vybrane.filter((f) => (f.datum ?? '').startsWith(rok));
  if (nq) vybrane = vybrane.filter((f) => norm(`${f.dodavatel ?? ''} ${f.popis ?? ''}`).includes(nq));

  const soucet = vybrane.reduce((a, f) => a + (f.vydaj ?? 0), 0);
  const { s, stran, kus } = vyrez(vybrane, params);
  const rozsah = faktury?.souhrn?.rozsah ?? {};

  app.innerHTML = `
    <h1>Peníze</h1>
    <p class="podnadpis">Položkový rozpočet a jednotlivé faktury z CityVizoru. Faktury
    jsou účetní výdaje městské části, ne platby jejích příspěvkových organizací.</p>
    <div class="karty">
      <div><div class="v">${fmtCislo(faktury?.pocet)}</div><div class="k">faktur ${rozsah.od?.slice(0, 4) ?? ''}–${rozsah.do?.slice(0, 4) ?? ''}</div></div>
      <div><div class="v">${fmtKc(faktury?.souhrn?.celkemVydaje)}</div><div class="k">výdaje celkem</div></div>
      <div><div class="v">${fmtCislo(rozpocet?.roky?.length)}</div><div class="k">ročníků rozpočtu</div></div>
    </div>

    <h2>Největší dodavatelé</h2>
    <p class="pod">Podle objemu ve vybraném období.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Dodavatel</th><th>Faktur</th><th>Celkem</th></tr></thead>
      <tbody>${topDodavatele(vybrane).map((d) => `
        <tr><td>${esc(d.nazev)}</td><td class="c">${fmtCislo(d.pocet)}</td><td class="c">${fmtKc(d.suma)}</td></tr>
      `).join('')}</tbody>
    </table></div>

    <h2>Jednotlivé faktury</h2>
    <form class="filtry" id="filtry">
      <select name="rok" aria-label="Rok">
        <option value="">Všechny roky</option>
        ${volby(rokyZ(vsechny), rok)}
      </select>
      <input type="search" name="q" value="${esc(q)}" placeholder="Dodavatel nebo popis…"
             aria-label="Hledat v fakturách">
      <span class="pocet">${fmtCislo(vybrane.length)} faktur · ${fmtKc(soucet)}</span>
    </form>

    ${seznam(kus, radekFaktura, 'Žádná faktura neodpovídá zadání.')}
    ${strankovani(s, stran, vybrane.length)}`;

  zapoj('/finance', params);
}

const radekFaktura = (f) => `
  <div class="polozka">
    <div class="meta">${fmtDatum(f.datum)}</div>
    <div>
      <h3>${esc(f.dodavatel ?? 'Neuvedeno')}</h3>
      <div class="radek">
        <span>${fmtKc(f.vydaj || f.prijem)}${f.prijem > f.vydaj ? ' příjem' : ''}</span>
        ${f.popis ? `<span>${esc(f.popis)}</span>` : ''}
      </div>
    </div>
  </div>`;

/** Sečte faktury podle dodavatele — nejrychlejší způsob, jak vidět, kam peníze tečou. */
function topDodavatele(polozky, limit = 15) {
  const podle = new Map();
  for (const f of polozky) {
    const k = f.dodavatel ?? 'Neuvedeno';
    const z = podle.get(k) ?? { nazev: k, pocet: 0, suma: 0 };
    z.pocet++; z.suma += f.vydaj ?? 0;
    podle.set(k, z);
  }
  return [...podle.values()].sort((a, b) => b.suma - a.suma).slice(0, limit);
}

// ----------------------------------------------------------------- smlouvy ---
async function smlouvy(params) {
  const ds = await nacti('smlouvy.json').catch(() => null);
  if (!ds) { app.innerHTML = '<h1>Smlouvy</h1><p class="prazdno">Zatím nenačteno.</p>'; return; }

  const rok = params.get('rok') ?? '';
  const q = params.get('q') ?? '';
  const nq = norm(q);

  let vybrane = ds.items;
  if (rok) vybrane = vybrane.filter((s) => (s.zverejneno ?? s.datum ?? '').startsWith(rok));
  if (nq) vybrane = vybrane.filter((s) => norm(`${s.predmet ?? ''} ${s.protistrana ?? ''}`).includes(nq));

  const soucet = vybrane.reduce((a, s) => a + (s.castkaBezDph ?? 0), 0);
  const { s, stran, kus } = vyrez(vybrane, params);

  app.innerHTML = `
    <h1>Registr smluv</h1>
    <p class="podnadpis">Smlouvy městské části Praha 6, IČO ${esc(ds.ico ?? '00063703')}.
    Uvedená hodnota je cena bez DPH tak, jak ji strany do registru zapsaly — neříká,
    kterým směrem peníze tečou, a u části smluv chybí.</p>
    <div class="karty">
      <div><div class="v">${fmtCislo(ds.pocet)}</div><div class="k">smluv celkem</div></div>
      <div><div class="v">${fmtKc(ds.souhrn?.celkovaHodnota)}</div><div class="k">známá hodnota</div></div>
    </div>

    <form class="filtry" id="filtry">
      <select name="rok" aria-label="Rok zveřejnění">
        <option value="">Všechny roky</option>
        ${volby(rokyZ(ds.items, 'zverejneno'), rok)}
      </select>
      <input type="search" name="q" value="${esc(q)}" placeholder="Předmět nebo protistrana…"
             aria-label="Hledat ve smlouvách">
      <span class="pocet">${fmtCislo(vybrane.length)} smluv · ${fmtKc(soucet)}</span>
    </form>

    ${seznam(kus, radekSmlouva, 'Žádná smlouva neodpovídá zadání.')}
    ${strankovani(s, stran, vybrane.length)}`;

  zapoj('/smlouvy', params);
}

const radekSmlouva = (s) => `
  <div class="polozka">
    <div class="meta">${fmtDatum(s.zverejneno ?? s.datum)}</div>
    <div>
      <h3><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.predmet ?? 'Bez uvedeného předmětu')}</a></h3>
      <div class="radek">
        <span>${fmtKc(s.castkaBezDph)}${s.castkaBezDph != null ? ' bez DPH' : ''}</span>
        ${s.protistrana ? `<span>${esc(s.protistrana)}</span>` : ''}
        ${s.datum ? `<span>uzavřeno ${fmtDatum(s.datum)}</span>` : ''}
      </div>
    </div>
  </div>`;

// ------------------------------------------------------------ úřední deska ---
async function deska(params) {
  const ds = await nacti('deska.json').catch(() => null);
  if (!ds) { app.innerHTML = '<h1>Úřední deska</h1><p class="prazdno">Zatím nenačteno.</p>'; return; }

  const rok = params.get('rok') ?? '';
  const oblast = params.get('oblast') ?? '';
  const stav = params.get('stav') ?? '';
  const q = params.get('q') ?? '';
  const nq = norm(q);

  let vybrane = ds.items;
  if (rok) vybrane = vybrane.filter((d) => (d.vyveseno ?? '').startsWith(rok));
  if (oblast) vybrane = vybrane.filter((d) => d.oblast === oblast);
  if (stav === 'vyveseno') vybrane = vybrane.filter((d) => d.naDesce);
  if (stav === 'sejmuto') vybrane = vybrane.filter((d) => !d.naDesce);
  if (nq) vybrane = vybrane.filter((d) => norm(d.nazev ?? '').includes(nq));

  const { s, stran, kus } = vyrez(vybrane, params);
  const oblasti = [...new Set(ds.items.map((d) => d.oblast).filter(Boolean))].sort();

  app.innerHTML = `
    <h1>Úřední deska</h1>
    <p class="podnadpis">Radnice zveřejňuje jen aktuálně vyvěšené dokumenty. Archiv níže
    vzniká tím, že si zaznamenáváme, co jsme kdy na desce viděli — roste tedy ode dne,
    kdy tenhle web začal běžet.</p>
    <div class="karty">
      <div><div class="v">${fmtCislo(ds.naDesce)}</div><div class="k">aktuálně vyvěšeno</div></div>
      <div><div class="v">${fmtCislo(ds.pocet)}</div><div class="k">v archivu celkem</div></div>
    </div>

    <form class="filtry" id="filtry">
      <select name="stav" aria-label="Stav">
        <option value="">Vyvěšené i sejmuté</option>
        <option value="vyveseno"${stav === 'vyveseno' ? ' selected' : ''}>Jen vyvěšené</option>
        <option value="sejmuto"${stav === 'sejmuto' ? ' selected' : ''}>Jen sejmuté</option>
      </select>
      <select name="rok" aria-label="Rok vyvěšení">
        <option value="">Všechny roky</option>
        ${volby(rokyZ(ds.items, 'vyveseno'), rok)}
      </select>
      <select name="oblast" aria-label="Oblast">
        <option value="">Všechny oblasti</option>
        ${volby(oblasti, oblast)}
      </select>
      <input type="search" name="q" value="${esc(q)}" placeholder="Název dokumentu…"
             aria-label="Hledat na úřední desce">
      <span class="pocet">${fmtCislo(vybrane.length)} dokumentů</span>
    </form>

    ${seznam(kus, radekDeska, 'Žádný dokument neodpovídá zadání.')}
    ${strankovani(s, stran, vybrane.length)}`;

  zapoj('/deska', params);
}

const radekDeska = (d) => `
  <div class="polozka">
    <div class="meta">${fmtDatum(d.vyveseno)}</div>
    <div>
      <h3><a href="${esc(d.url ?? '#')}" target="_blank" rel="noopener">${esc(d.nazev)}</a></h3>
      <div class="radek">
        ${d.naDesce ? '<span class="badge RMC">Vyvěšeno</span>' : '<span class="stitek">Sejmuto</span>'}
        ${d.oblast ? `<span>${esc(d.oblast)}</span>` : ''}
        ${d.sveseno ? `<span>sejmutí ${fmtDatum(d.sveseno)}</span>` : ''}
      </div>
    </div>
  </div>`;

// ------------------------------------------------------------------ zdroje ---
async function zdroje() {
  app.innerHTML = `
    <h1>Zdroje a metodika</h1>
    <p class="podnadpis">Všechna data pocházejí z veřejných zdrojů. Nic se nedopočítává
    ani nedomýšlí; u každého záznamu je odkaz na originál.</p>
    <div class="seznam">
      ${zdrojRadek('Web MČ Praha 6', 'https://www.praha6.cz/cs/uredni-deska/zapisy-usneseni/zapisy-usneseni-rozcestnik.html',
        'Archiv usnesení 2002–2022 a zápisy ze zasedání. Týdně.')}
      ${zdrojRadek('Portál usnesení (MARBES)', 'https://usneseni.praha6.cz:1190/usneseni',
        'Usnesení od volebního období 2022 v plném znění. Denně.')}
      ${zdrojRadek('CityVizor', 'https://cityvizor.praha.eu/praha6',
        'Položkový rozpočet a jednotlivé faktury. Veřejné API. Týdně.')}
      ${zdrojRadek('Registr smluv', 'https://smlouvy.gov.cz/vyhledavani?subject_idnum=00063703',
        'Měsíční open-data dumpy plus denní přírůstek. IČO 00063703.')}
      ${zdrojRadek('Monitor státní pokladny', 'https://monitor.statnipokladna.gov.cz/',
        'Účetní výkazy městské části.')}
    </div>
    <h2>Co tu zatím chybí</h2>
    <p><strong>Jmenovité hlasování zastupitelů.</strong> Zastupitelstvo hlasuje elektronickým
    zařízením a jednací řád (§ 15 odst. 8) ukládá zveřejnit jmenovitá hlasování do tří dnů
    po ověření zápisu. Portál usnesení má pro ně připravená pole, ale nejsou naplněná. Otevřená
    data z let 2014–2018 existovala, jejich soubory dnes vracejí chybu. Dokud radnice publikaci
    nezapne, umí tento web ukázat jen účast a souhrnné výsledky ze zápisů.</p>`;
}

const zdrojRadek = (nazev, url, popis) => `
  <div class="polozka"><div class="meta">●</div><div>
    <h3><a href="${esc(url)}" target="_blank" rel="noopener">${esc(nazev)}</a></h3>
    <div class="radek">${esc(popis)}</div></div>
  </div>`;

// ==================================================================== init ===
document.getElementById('formHledat').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  location.hash = q ? `#/usneseni?q=${encodeURIComponent(q)}` : '#/usneseni';
});

window.addEventListener('hashchange', route);

try {
  manifest = await nactiManifest();
  verze = manifest.aktualizovano ?? '';
  stavDat.textContent = `Data aktualizována ${new Date(manifest.aktualizovano).toLocaleString('cs-CZ')}.`;
  await route();
} catch (err) {
  app.innerHTML = `<div class="chyba"><strong>Data zatím nejsou k dispozici.</strong><br>
    Spusť synchronizaci nebo workflow v GitHub Actions.<br>
    <span class="drobne">${esc(err.message)}</span></div>`;
}
