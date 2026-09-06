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
  '/interpelace': interpelace,
  '/finance': finance,
  '/smlouvy': smlouvy,
  '/organizace': organizace,
  '/firmy': organizace,
  '/dotace': dotace,
  '/dotace-prijemci': dotace,
  '/dotace-prijate': dotace,
  '/zakazky': zakazky,
  '/deska': deska,
  '/scitani': scitani,
  '/zdroje': zdroje,
};

async function route() {
  const [cesta, dotaz] = location.hash.replace(/^#/, '').split('?');
  const view = routes[cesta || '/'] ?? domu;
  const params = new URLSearchParams(dotaz ?? '');
  // Zřizované organizace mají v liště jednu položku, ale dvě stránky
  // (+ profily subjektů) — ať zůstane zvýrazněná na všech.
  const proListu = (cesta === '/firmy') ? '/organizace'
    : cesta.startsWith('/dotace') ? '/dotace'
    : cesta === '/interpelace' ? '/usneseni'
    : (cesta || '/');
  document.querySelectorAll('.hlavicka nav a').forEach((a) => {
    a.toggleAttribute('aria-current', a.getAttribute('href') === `#${proListu}`);
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
    <div class="hero">
      <h1>Veřejná data městské části Praha 6<span class="hero-nazev">Praha 6 pod rentgenem</span></h1>
      <p class="podnadpis">Usnesení rady a zastupitelstva, rozpočet, faktury a smlouvy
      na jednom místě — u každého záznamu odkaz na originální zdroj.</p>
    </div>
    <div class="karty">
      <div><div class="v">${fmtCislo(m.usneseni.pocet)}</div><div class="k">usnesení ${m.usneseni.rozsah?.od?.slice(0, 4) ?? ''}–${m.usneseni.rozsah?.do?.slice(0, 4) ?? ''}</div></div>
      <div><div class="v">${fmtCislo(d.smlouvy?.pocet)}</div><div class="k">smluv v registru</div></div>
      <div><div class="v">${fmtCislo(d.faktury?.pocet)}</div><div class="k">jednotlivých faktur</div></div>
      <div><div class="v">${fmtCislo(d.zapisy?.pocet)}</div><div class="k">zápisů a programů</div></div>
      <div><div class="v">${fmtCislo(d['smlouvy-organizace']?.pocet)}</div><div class="k">smluv zřizovaných organizací</div></div>
      <div><div class="v">${fmtCislo(d.dotace?.pocet)}</div><div class="k">dotačních smluv</div></div>
      <div><div class="v">${fmtCislo(d['zakazky-prehled']?.pocet)}</div><div class="k">veřejných zakázek</div></div>
      <div><div class="v">${fmtCislo(d.interpelace?.pocet)}</div><div class="k">interpelací od roku 2018</div></div>
      <div><div class="v">${fmtCislo(d.deska?.pocet)}</div><div class="k">položek úřední desky</div></div>
    </div>
    <h2>Kde začít</h2>
    <div class="seznam">
      ${odkaz('#/usneseni', 'Usnesení a jednání', 'Rada i zastupitelstvo, filtr podle orgánu, roku a tématu, fulltext v plném znění.')}
      ${odkaz('#/interpelace', 'Interpelace', 'Na co se zastupitelé a občané ptali na zasedání — plný přepis, odpověď i přílohy, rok po roce.')}
      ${odkaz('#/finance', 'Peníze', 'Položkový rozpočet a jednotlivé faktury z CityVizoru.')}
      ${odkaz('#/smlouvy', 'Registr smluv', 'Smlouvy městské části podle IČO 00063703.')}
      ${odkaz('#/zakazky', 'Veřejné zakázky', 'Co se soutěžilo, kdo vyhrál, za kolik se to podepsalo a jak cenu změnily dodatky.')}
      ${odkaz('#/deska', 'Úřední deska', 'Aktuálně vyvěšené dokumenty a průběžně budovaný archiv.')}
      ${odkaz('#/dotace', 'Dotace', 'Kdo dostal od radnice dotaci, kdy, na co a kolik — i souhrn za jednotlivé příjemce.')}
      ${odkaz('#/organizace', 'Zřizované organizace', 'Smlouvy škol, školek, Léčebny, Pečovatelské služby, KITT6 a SNEO — každý subjekt zvlášť.')}
      ${odkaz('#/scitani', 'Sčítání 2021', 'Kolik nás je, jak bydlíme, co jsme vystudovali a čím jezdíme do práce.')}
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

    ${usnPrepinac('/usneseni', manifest.datasety?.interpelace?.pocet)}

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

  // Součet jen z korunových smluv — pár jich je v dolarech a eurech.
  const soucet = vybrane.reduce((a, s) => a + ((s.mena ?? 'CZK') === 'CZK' ? (s.castkaBezDph ?? 0) : 0), 0);
  const { s, stran, kus } = vyrez(vybrane, params);

  app.innerHTML = `
    <h1>Registr smluv</h1>
    <p class="podnadpis">Smlouvy městské části Praha 6, IČO ${esc(ds.ico ?? '00063703')}.
    Uvedená hodnota je cena bez DPH tak, jak ji strany do registru zapsaly — neříká,
    kterým směrem peníze tečou, a u části smluv chybí.</p>

    <p class="poznamka"><strong>Známá hodnota není „kolik radnice utratila“.</strong>
    Je to součet cen uvedených ve smlouvách, tedy včetně dodatků, které často jen mění
    smlouvu původní, a včetně smluv, kde je Praha 6 jen jednou ze stran a zveřejnil je
    někdo jiný (banka, hlavní město, developer). U části smluv částka chybí úplně.
    Kolik se opravdu zaplatilo, ukazují <a href="#/finance">faktury</a>.</p>
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

// ------------------------------------------- zřizované organizace a firmy ---
/**
 * Každý subjekt je samostatný publikující subjekt registru smluv. Jeho čísla
 * se schválně nikde nesčítají s čísly městské části — smlouva mezi radnicí
 * a její školou by se počítala dvakrát.
 */
const ORG_STRANKY = {
  '/organizace': {
    skupina: 'prispevkove',
    nadpis: 'Zřizované organizace',
    popis: 'Příspěvkové organizace městské části Praha 6 — školy, školky, '
      + 'Léčebna dlouhodobě nemocných, Pečovatelská služba a KITT6. '
      + 'Každá z nich je samostatný publikující subjekt registru smluv.',
  },
  '/firmy': {
    skupina: 'firmy',
    nadpis: 'Městské firmy',
    popis: 'Obchodní společnosti, ve kterých má městská část Praha 6 podíl. '
      + 'Publikují do registru smluv samy za sebe.',
  },
};

const orgPrepinac = (aktivni, poctu) => `
  <div class="prepinac" role="tablist">
    <a href="#/organizace" role="tab"${aktivni === '/organizace' ? ' aria-selected="true"' : ''}>
      Příspěvkové organizace <span class="cislo">${fmtCislo(poctu.prispevkove)}</span></a>
    <a href="#/firmy" role="tab"${aktivni === '/firmy' ? ' aria-selected="true"' : ''}>
      Městské firmy <span class="cislo">${fmtCislo(poctu.firmy)}</span></a>
  </div>`;

const RADIT = {
  smluv: { popis: 'Nejvíc smluv', fn: (a, b) => b.pocet - a.pocet },
  hodnota: { popis: 'Nejvyšší známá hodnota', fn: (a, b) => b.hodnota - a.hodnota },
  abecedne: { popis: 'Abecedně', fn: (a, b) => a.nazev.localeCompare(b.nazev, 'cs') },
};

async function nactiOrganizace() {
  const ds = await nacti('smlouvy-organizace.json').catch(() => null);
  if (!ds) return null;
  const souhrny = ds.souhrny ?? [];
  return {
    ds,
    souhrny,
    poctu: {
      prispevkove: souhrny.filter((s) => s.typ !== 'firma').length,
      firmy: souhrny.filter((s) => s.typ === 'firma').length,
    },
  };
}

async function organizace(params) {
  const cesta = location.hash.replace(/^#/, '').split('?')[0] || '/organizace';
  const nacteno = await nactiOrganizace();
  if (!nacteno) {
    app.innerHTML = `<h1>${esc(ORG_STRANKY[cesta].nadpis)}</h1>
      <p class="prazdno">Smlouvy zřizovaných organizací ještě nebyly načteny.</p>`;
    return;
  }
  const { ds, souhrny, poctu } = nacteno;

  // Profil jednoho subjektu má vlastní pohled, ale sdílí URL — router je prostý.
  if (params.get('ico')) return organizaceDetail(params, ds, cesta);

  const strana = ORG_STRANKY[cesta];
  const vFirmach = strana.skupina === 'firmy';
  let vybrane = souhrny.filter((s) => (s.typ === 'firma') === vFirmach);

  const typ = params.get('typ') ?? '';
  if (typ) vybrane = vybrane.filter((s) => s.typ === typ);

  const radit = RADIT[params.get('radit')] ? params.get('radit') : 'smluv';
  vybrane = [...vybrane].sort(RADIT[radit].fn);

  const smluv = vybrane.reduce((a, s) => a + s.pocet, 0);
  const hodnota = vybrane.reduce((a, s) => a + s.hodnota, 0);
  const typyKFiltru = [...new Set(souhrny.filter((s) => (s.typ === 'firma') === vFirmach).map((s) => s.typ))];

  app.innerHTML = `
    <p class="nadsekce">Registr smluv</p>
    <h1>${esc(strana.nadpis)}</h1>
    <p class="podnadsekce">${esc(strana.popis)}</p>

    ${orgPrepinac(cesta, poctu)}

    <div class="karty">
      <div><div class="v">${fmtCislo(vybrane.length)}</div><div class="k">subjektů s ověřeným IČO</div></div>
      <div><div class="v">${fmtCislo(smluv)}</div><div class="k">smluv v databázi</div></div>
      <div><div class="v">${fmtKc(hodnota)}</div><div class="k">známá hodnota</div></div>
    </div>

    <p class="poznamka"><strong>Samostatné datasety.</strong> Čísla výše nepřičítáme
    k městské části do jednoho „celkového“ čísla — smlouva mezi radnicí a její
    organizací by se počítala dvakrát. Hodnota neříká, kterým směrem peníze tečou,
    a u části smluv chybí úplně.</p>

    <form class="filtry" id="filtry">
      ${typyKFiltru.length > 1 ? `
      <select name="typ" aria-label="Typ organizace">
        <option value="">Všechny typy</option>
        ${typyKFiltru.map((t) => `<option value="${esc(t)}"${t === typ ? ' selected' : ''}>${esc(ds.typy?.[t]?.nazev ?? t)}</option>`).join('')}
      </select>` : ''}
      <select name="radit" aria-label="Řazení">
        ${Object.entries(RADIT).map(([k, v]) => `<option value="${k}"${k === radit ? ' selected' : ''}>${esc(v.popis)}</option>`).join('')}
      </select>
      <span class="pocet">${fmtCislo(vybrane.length)} subjektů</span>
    </form>

    ${vybrane.length === 0 ? '<p class="prazdno">Žádný subjekt neodpovídá zadání.</p>'
      : `<div class="subjekty">${vybrane.map(kartaSubjektu).join('')}</div>`}`;

  zapoj(cesta, params);
}

const kartaSubjektu = (s) => `
  <a class="subjekt" href="#/organizace?ico=${esc(s.ico)}">
    <div class="subjekt-hlava">
      <h3>${esc(s.nazev)}</h3>
      <span class="sipka" aria-hidden="true">→</span>
    </div>
    <div class="subjekt-ico">IČO ${esc(s.ico)}</div>
    <div class="subjekt-cisla">
      <span><strong>${fmtCislo(s.pocet)}</strong> smluv</span>
      <span><strong>${fmtCislo(s.protistran)}</strong> protistran</span>
      <span><strong>${fmtKc(s.hodnota)}</strong> známá hodnota</span>
    </div>
    ${s.posledni ? `<div class="subjekt-posledni">Poslední smlouva ${fmtDatum(s.posledni)}</div>` : ''}
  </a>`;

async function organizaceDetail(params, ds, cesta) {
  const ico = params.get('ico');
  const souhrn = (ds.souhrny ?? []).find((s) => s.ico === ico);
  if (!souhrn) {
    app.innerHTML = `<h1>Neznámý subjekt</h1>
      <p class="prazdno">IČO ${esc(ico)} mezi zřizovanými organizacemi není.
      <a href="#/organizace">Zpět na přehled</a>.</p>`;
    return;
  }

  const zpet = souhrn.typ === 'firma' ? '#/firmy' : '#/organizace';
  const rok = params.get('rok') ?? '';
  const q = params.get('q') ?? '';
  const nq = norm(q);

  let vybrane = ds.items.filter((x) => x.subjektIco === ico);
  if (rok) vybrane = vybrane.filter((x) => (x.publikovano ?? '').startsWith(rok));
  if (nq) vybrane = vybrane.filter((x) => norm(`${x.predmet ?? ''} ${x.protistrana ?? ''}`).includes(nq));

  const soucet = vybrane.reduce((a, x) => a + ((x.mena ?? 'CZK') === 'CZK' ? (x.castka ?? 0) : 0), 0);
  const { s, stran, kus } = vyrez(vybrane, params);
  const vsechny = ds.items.filter((x) => x.subjektIco === ico);

  app.innerHTML = `
    <p class="nadsekce"><a href="${zpet}">← ${esc(ds.typy?.[souhrn.typ]?.nazev ?? 'Zřizované organizace')}</a></p>
    <h1>${esc(souhrn.nazev)}</h1>
    <p class="podnadsekce">IČO ${esc(ico)} · samostatný publikující subjekt registru smluv.
    Údaje pocházejí ze seznamu registru, částky jsou zaokrouhlené na celé koruny.
    <a href="https://smlouvy.gov.cz/vyhledavani?subject_idnum=${esc(ico)}" target="_blank" rel="noopener">Ověřit v registru →</a></p>

    <div class="karty">
      <div><div class="v">${fmtCislo(souhrn.pocet)}</div><div class="k">smluv celkem</div></div>
      <div><div class="v">${fmtCislo(souhrn.protistran)}</div><div class="k">různých protistran</div></div>
      <div><div class="v">${fmtKc(souhrn.hodnota)}</div><div class="k">známá hodnota</div></div>
      <div><div class="v">${souhrn.posledni ? fmtDatum(souhrn.posledni) : '—'}</div><div class="k">poslední smlouva</div></div>
    </div>

    <form class="filtry" id="filtry">
      <select name="rok" aria-label="Rok zveřejnění">
        <option value="">Všechny roky</option>
        ${volby(rokyZ(vsechny, 'publikovano'), rok)}
      </select>
      <input type="search" name="q" value="${esc(q)}" placeholder="Předmět nebo protistrana…"
             aria-label="Hledat ve smlouvách této organizace">
      <span class="pocet">${fmtCislo(vybrane.length)} smluv · ${fmtKc(soucet)}</span>
    </form>

    ${seznam(kus, radekSmlouvaOrg, 'Žádná smlouva neodpovídá zadání.')}
    ${strankovani(s, stran, vybrane.length)}`;

  zapoj(cesta, params, ['ico']);
}

const radekSmlouvaOrg = (x) => `
  <div class="polozka">
    <div class="meta">${fmtDatum(x.publikovano)}</div>
    <div>
      <h3><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.predmet ?? 'Bez uvedeného předmětu')}</a></h3>
      <div class="radek">
        <span>${x.castka != null ? `${fmtKc(x.castka)}${x.sDph === true ? ' vč. DPH' : x.sDph === false ? ' bez DPH' : ''}` : 'hodnota neuvedena'}</span>
        ${x.protistrana ? `<span>${esc(x.protistrana)}</span>` : ''}
      </div>
    </div>
  </div>`;

// ------------------------------------------------------------------ dotace ---
/**
 * Dotace se neberou z vlastního zdroje — odvozují se z registru smluv. Proto
 * tu na dvou místech otevřeně říkáme, co je údaj z registru (příjemce, částka,
 * datum) a co je náš odhad (oblast), a že seznam nemusí být úplný.
 */
const DOT_STRANKY = {
  '/dotace': { pohled: 'dotace', nadpis: 'Dotace' },
  '/dotace-prijemci': { pohled: 'prijemci', nadpis: 'Příjemci dotací' },
  '/dotace-prijate': { pohled: 'prijate', nadpis: 'Co dostala Praha 6' },
};

const dotPrepinac = (aktivni, s) => `
  <div class="prepinac" role="tablist">
    <a href="#/dotace" role="tab"${aktivni === '/dotace' ? ' aria-selected="true"' : ''}>
      Přidělené dotace <span class="cislo">${fmtCislo(s.rozdano.pocet)}</span></a>
    <a href="#/dotace-prijemci" role="tab"${aktivni === '/dotace-prijemci' ? ' aria-selected="true"' : ''}>
      Příjemci <span class="cislo">${fmtCislo(s.prijemcu)}</span></a>
    <a href="#/dotace-prijate" role="tab"${aktivni === '/dotace-prijate' ? ' aria-selected="true"' : ''}>
      Co Praha 6 dostala <span class="cislo">${fmtCislo(s.prijato.pocet)}</span></a>
  </div>`;

const POZNAMKA_DOTACE = `
  <p class="poznamka"><strong>Odvozeno z registru smluv.</strong> Příjemce, částka
  a datum jsou údaje z registru. <em>Oblast</em> je náš odhad podle předmětu smlouvy
  a názvu příjemce — u části dotací ji nelze určit vůbec. Dotace pod 50 000 Kč se
  do registru zveřejňovat nemusí, takže seznam nemusí být úplný, a registr sahá
  jen do poloviny roku 2016.</p>`;

async function nactiDotace() {
  const ds = await nacti('dotace.json').catch(() => null);
  return ds && ds.souhrn ? ds : null;
}

async function dotace(params) {
  const cesta = location.hash.replace(/^#/, '').split('?')[0] || '/dotace';
  const ds = await nactiDotace();
  if (!ds) {
    app.innerHTML = `<h1>${esc(DOT_STRANKY[cesta].nadpis)}</h1>
      <p class="prazdno">Dotace ještě nebyly odvozeny z registru smluv.</p>`;
    return;
  }
  if (params.get('prijemce')) return dotacePrijemce(params, ds, cesta);

  const pohled = DOT_STRANKY[cesta].pohled;
  if (pohled === 'prijemci') return dotacePrijemci(params, ds, cesta);
  return dotaceSeznam(params, ds, cesta, pohled === 'prijate');
}

const oblastNazev = (ds, kod) => ds.oblasti?.[kod]?.nazev ?? 'Nezařazeno';

function dotaceSeznam(params, ds, cesta, prijate) {
  const s = ds.souhrn;
  const rok = params.get('rok') ?? '';
  const oblast = params.get('oblast') ?? '';
  const q = params.get('q') ?? '';
  const nq = norm(q);

  let vybrane = ds.items.filter((d) => (d.smer === 'prijata') === prijate);
  if (rok) vybrane = vybrane.filter((d) => String(d.rok) === rok);
  if (oblast) vybrane = vybrane.filter((d) => d.oblast === oblast);
  if (nq) {
    vybrane = vybrane.filter((d) =>
      norm(`${d.prijemce ?? ''} ${d.projekt ?? ''} ${d.predmet ?? ''}`).includes(nq));
  }

  const soucet = vybrane.reduce((a, d) => a + ((d.mena ?? 'CZK') === 'CZK' ? (d.castka ?? 0) : 0), 0);
  const { s: strana, stran, kus } = vyrez(vybrane, params);
  const roky = [...new Set(ds.items.filter((d) => (d.smer === 'prijata') === prijate)
    .map((d) => d.rok).filter(Boolean))].sort((a, b) => b - a);

  app.innerHTML = `
    <p class="nadsekce">Registr smluv</p>
    <h1>${prijate ? 'Dotace, které Praha 6 dostala' : 'Dotace přidělené Prahou 6'}</h1>
    <p class="podnadsekce">${prijate
      ? 'Peníze, které do rozpočtu městské části přitekly odjinud — dotace od hlavního '
        + 'města i dary, kterými soukromý dárce financuje některý z dotačních programů.'
      : 'Kdo dostal od městské části dotaci, kdy, na co a kolik. Vytaženo ze smluv '
        + 'uveřejněných v registru smluv od roku 2016.'}</p>

    ${dotPrepinac(cesta, s)}

    <div class="karty">
      <div><div class="v">${fmtCislo(prijate ? s.prijato.pocet : s.rozdano.pocet)}</div><div class="k">dotačních smluv</div></div>
      <div><div class="v">${fmtKc(prijate ? s.prijato.castka : s.rozdano.castka)}</div><div class="k">v součtu</div></div>
      ${prijate ? '' : `<div><div class="v">${fmtCislo(s.prijemcu)}</div><div class="k">různých příjemců</div></div>`}
      <div><div class="v">${s.roky.length ? `${Math.min(...s.roky)}–${Math.max(...s.roky)}` : '—'}</div><div class="k">rozsah let</div></div>
    </div>

    ${POZNAMKA_DOTACE}

    <form class="filtry" id="filtry">
      <select name="rok" aria-label="Rok">
        <option value="">Všechny roky</option>
        ${volby(roky, rok)}
      </select>
      ${prijate ? '' : `
      <select name="oblast" aria-label="Oblast">
        <option value="">Všechny oblasti</option>
        ${Object.entries(ds.oblasti ?? {}).map(([k, o]) =>
          `<option value="${esc(k)}"${k === oblast ? ' selected' : ''}>${esc(o.nazev)} (${o.pocet})</option>`).join('')}
      </select>`}
      <input type="search" name="q" value="${esc(q)}" placeholder="Příjemce nebo projekt…"
             aria-label="Hledat v dotacích">
      <span class="pocet">${fmtCislo(vybrane.length)} dotací · ${fmtKc(soucet)}</span>
    </form>

    ${seznam(kus, (d) => radekDotace(d, ds, { odkaz: !prijate }), 'Žádná dotace neodpovídá zadání.')}
    ${strankovani(strana, stran, vybrane.length)}`;

  zapoj(cesta, params);
}

const radekDotace = (d, ds, { odkaz = true, sPrijemcem = true } = {}) => `
  <div class="polozka">
    <div class="meta">${fmtDatum(d.zverejneno ?? d.datum)}</div>
    <div>
      <h3><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.projekt ?? d.predmet)}</a></h3>
      <div class="radek">
        <span class="castka">${d.castka != null ? fmtKc(d.castka) : 'částka neuvedena'}</span>
        ${d.prijemce && sPrijemcem ? (odkaz
          ? `<a class="stitek-odkaz" href="#/dotace?prijemce=${encodeURIComponent(d.prijemceIco || d.prijemce)}">${esc(d.prijemce)}</a>`
          : `<span>${esc(d.prijemce)}</span>`) : ''}
        ${d.oblast && d.oblast !== 'ostatni'
          ? `<span class="stitek${d.oblastZPrijemce ? ' odhad' : ''}"
               title="${d.oblastZPrijemce ? 'Oblast odvozena z ostatních dotací téhož příjemce' : 'Oblast odvozena z předmětu smlouvy'}">${esc(oblastNazev(ds, d.oblast))}</span>`
          : ''}
        ${d.program ? `<span class="stitek program">${esc(d.program)}</span>` : ''}
      </div>
      ${d.projekt && d.projekt !== d.predmet ? `<div class="radek tlumene">${esc(d.predmet)}</div>` : ''}
    </div>
  </div>`;

function dotacePrijemci(params, ds, cesta) {
  const s = ds.souhrn;
  const oblast = params.get('oblast') ?? '';
  const q = params.get('q') ?? '';
  const nq = norm(q);

  let vybrani = ds.prijemci ?? [];
  if (oblast) vybrani = vybrani.filter((p) => (p.oblasti ?? []).includes(oblast));
  if (nq) vybrani = vybrani.filter((p) => norm(p.nazev).includes(nq));

  const soucet = vybrani.reduce((a, p) => a + p.castka, 0);
  const { s: strana, stran, kus } = vyrez(vybrani, params);

  app.innerHTML = `
    <p class="nadsekce">Registr smluv</p>
    <h1>Příjemci dotací</h1>
    <p class="podnadsekce">Spolky, obecně prospěšné společnosti, školy i firmy, které
    od Prahy 6 dostaly dotaci. Seřazeno podle celkové částky za všechny roky.</p>

    ${dotPrepinac(cesta, s)}

    <div class="karty">
      <div><div class="v">${fmtCislo(vybrani.length)}</div><div class="k">příjemců</div></div>
      <div><div class="v">${fmtKc(soucet)}</div><div class="k">v součtu</div></div>
      <div><div class="v">${fmtCislo(vybrani.reduce((a, p) => a + p.pocet, 0))}</div><div class="k">dotačních smluv</div></div>
    </div>

    ${POZNAMKA_DOTACE}

    <form class="filtry" id="filtry">
      <select name="oblast" aria-label="Oblast">
        <option value="">Všechny oblasti</option>
        ${Object.entries(ds.oblasti ?? {}).map(([k, o]) =>
          `<option value="${esc(k)}"${k === oblast ? ' selected' : ''}>${esc(o.nazev)}</option>`).join('')}
      </select>
      <input type="search" name="q" value="${esc(q)}" placeholder="Jméno příjemce…" aria-label="Hledat příjemce">
      <span class="pocet">${fmtCislo(vybrani.length)} příjemců</span>
    </form>

    ${kus.length === 0 ? '<p class="prazdno">Žádný příjemce neodpovídá zadání.</p>'
      : `<div class="subjekty">${kus.map((p) => kartaPrijemce(p, ds)).join('')}</div>`}
    ${strankovani(strana, stran, vybrani.length)}`;

  zapoj(cesta, params);
}

const kartaPrijemce = (p, ds) => `
  <a class="subjekt" href="#/dotace?prijemce=${encodeURIComponent(p.ico || p.nazev)}">
    <div class="subjekt-hlava">
      <h3>${esc(p.nazev)}</h3>
      <span class="sipka" aria-hidden="true">→</span>
    </div>
    <div class="subjekt-ico">${p.ico ? `IČO ${esc(p.ico)}` : 'bez IČO (fyzická osoba)'}</div>
    <div class="subjekt-cisla">
      <span><strong>${fmtKc(p.castka)}</strong> celkem</span>
      <span><strong>${fmtCislo(p.pocet)}</strong> dotací</span>
    </div>
    <div class="subjekt-posledni">${(p.oblasti ?? []).filter((o) => o !== 'ostatni')
      .map((o) => esc(oblastNazev(ds, o))).join(' · ') || 'oblast neurčena'}</div>
  </a>`;

function dotacePrijemce(params, ds, cesta) {
  const klic = params.get('prijemce');
  const p = (ds.prijemci ?? []).find((x) => x.ico === klic || x.nazev === klic);
  if (!p) {
    app.innerHTML = `<h1>Neznámý příjemce</h1>
      <p class="prazdno">Takový příjemce mezi dotacemi není.
      <a href="#/dotace-prijemci">Zpět na příjemce</a>.</p>`;
    return;
  }

  const jeho = ds.items.filter((d) => d.smer === 'rozdana'
    && (p.ico ? d.prijemceIco === p.ico : d.prijemce === p.nazev));
  const poRocich = new Map();
  for (const d of jeho) {
    if (!d.rok) continue;
    poRocich.set(d.rok, (poRocich.get(d.rok) ?? 0) + (d.castka ?? 0));
  }
  const roky = [...poRocich.entries()].sort((a, b) => a[0] - b[0]);
  const max = Math.max(1, ...roky.map(([, v]) => v));

  app.innerHTML = `
    <p class="nadsekce"><a href="#/dotace-prijemci">← Příjemci dotací</a></p>
    <h1>${esc(p.nazev)}</h1>
    <p class="podnadsekce">${p.ico
      ? `IČO ${esc(p.ico)} · <a href="https://ares.gov.cz/ekonomicke-subjekty?ico=${esc(p.ico)}" target="_blank" rel="noopener">Ověřit v ARES →</a>`
      : 'Fyzická osoba — registr smluv u ní neuvádí IČO.'}</p>

    <div class="karty">
      <div><div class="v">${fmtKc(p.castka)}</div><div class="k">dostal celkem</div></div>
      <div><div class="v">${fmtCislo(p.pocet)}</div><div class="k">dotací</div></div>
      <div><div class="v">${fmtDatum(p.prvni)}</div><div class="k">první dotace</div></div>
      <div><div class="v">${fmtDatum(p.posledni)}</div><div class="k">poslední dotace</div></div>
    </div>

    ${p.sCastkou < p.pocet
      ? `<p class="poznamka">U ${fmtCislo(p.pocet - p.sCastkou)} z ${fmtCislo(p.pocet)} smluv
         není v registru uvedená částka, takže součet je spodní hranicí.</p>` : ''}

    ${roky.length > 1 ? `
    <h2>Podle roku</h2>
    <div class="grafy">
      ${roky.map(([r, v]) => pruhKc(String(r), v, max, p.castka)).join('')}
    </div>` : ''}

    <h2>Jednotlivé dotace</h2>
    ${seznam(jeho, (d) => radekDotace(d, ds, { sPrijemcem: false }), 'Žádné dotace.')}`;
}

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

// ----------------------------------------------------------------- sčítání ---
/**
 * Pruhový řádek. Délka nese velikost, číslo i podíl jsou vypsané textem — barva
 * tedy nikdy nenese informaci sama o sobě. „Nezjištěno“ má šrafu, aby na první
 * pohled nevypadalo jako naměřená kategorie.
 */
function pruh(popis, hodnota, zaklad, { neurcite = false } = {}) {
  const podil = zaklad ? hodnota / zaklad : 0;
  const procenta = podil === 0 ? '0 %'
    : podil < 0.005 ? '< 1 %'
    : `${Math.round(podil * 100)} %`;
  const nazev = `${popis}: ${fmtCislo(hodnota)} z ${fmtCislo(zaklad)}`;
  return `
    <div class="graf-radek" title="${esc(nazev)}">
      <div class="graf-popis">${esc(popis)}</div>
      <div class="graf-drah"><span class="graf-pruh${neurcite ? ' neurcite' : ''}"
           style="width:${(podil * 100).toFixed(2)}%"></span></div>
      <div class="graf-hodnota"><strong>${fmtCislo(hodnota)}</strong><span>${procenta}</span></div>
    </div>`;
}

const neurcitaKategorie = (popis) => /nezjištěno/i.test(popis ?? '');

/**
 * Proužek pro peníze. Šířka se měří k nejvyššímu roku (aby byl graf čitelný),
 * ale procento se počítá z celku — podíl na maximu by nic neříkal.
 */
function pruhKc(popis, hodnota, max, celkem) {
  const sirka = max ? (hodnota / max) * 100 : 0;
  const podil = celkem ? hodnota / celkem : 0;
  const procenta = podil === 0 ? '0 %' : podil < 0.005 ? '< 1 %' : `${Math.round(podil * 100)} %`;
  return `
    <div class="graf-radek" title="${esc(`${popis}: ${fmtKc(hodnota)}`)}">
      <div class="graf-popis">${esc(popis)}</div>
      <div class="graf-drah"><span class="graf-pruh" style="width:${sirka.toFixed(2)}%"></span></div>
      <div class="graf-hodnota"><strong>${fmtKc(hodnota)}</strong><span>${procenta}</span></div>
    </div>`;
}

const pruhy = (polozky, zaklad) =>
  `<div class="grafy">${polozky.map((p) =>
    pruh(p.popis, p.hodnota, zaklad, { neurcite: neurcitaKategorie(p.popis) })).join('')}</div>`;

async function scitani() {
  const ds = await nacti('scitani.json').catch(() => null);
  const d = ds?.items?.[0];
  if (!d) {
    app.innerHTML = `<h1>Sčítání 2021</h1><p class="prazdno">Data ze sčítání ještě nebyla načtena.</p>`;
    return;
  }

  const o = d.obyvatel;
  app.innerHTML = `
    <p class="nadsekce">ČSÚ · Sčítání 2021</p>
    <h1>Praha 6 podle Sčítání 2021</h1>
    <p class="podnadsekce">Vybrané údaje o obyvatelích, bydlení, vzdělání, ekonomické
    aktivitě, domácnostech a dojíždění. Vše jen za městskou část, ne za správní obvod.</p>

    <div class="karty">
      <div><div class="v">${fmtCislo(o)}</div><div class="k">obyvatel s obvyklým pobytem</div></div>
      <div><div class="v">${fmtCislo(d.domacnosti.celkem)}</div><div class="k">domácností · ${fmtCislo(d.domacnosti.jednotlivce)} jednočlenných</div></div>
      <div><div class="v">${fmtCislo(d.domy.celkem)}</div><div class="k">domů · ${fmtCislo(d.domy.obydlene)} obydlených</div></div>
      <div><div class="v">${fmtCislo(d.byty.celkem)}</div><div class="k">bytů · ${fmtCislo(d.byty.obydlene)} obydlených</div></div>
    </div>
    <p class="metodika">Počet obyvatel vychází z <strong>obvyklého pobytu</strong>, nikoli
    z trvalého bydliště — proto se liší od čísel, která uvádí radnice. Rozhodný okamžik
    ${fmtDatum(d.rozhodnyOkamzik)}. Zdroj: ${esc(d.zdroj)}.</p>

    <h2>Věk a pohlaví</h2>
    <p class="pod">V Praze 6 žilo ${fmtCislo(d.pohlavi.muzi)} mužů a ${fmtCislo(d.pohlavi.zeny)} žen.
    Podíly jsou počítané ze všech ${fmtCislo(o)} obyvatel.</p>
    <h3 class="podnadpis-graf">Základní věkové skupiny</h3>
    ${pruhy(d.vek.zakladni, o)}
    <h3 class="podnadpis-graf">Pětileté věkové skupiny</h3>
    ${pruhy(d.vek.petilete, o)}

    <h2>Domy a byty</h2>
    <p class="pod">Struktura domovního a bytového fondu.</p>
    <h3 class="podnadpis-graf">Obydlené domy podle druhu</h3>
    ${pruhy(d.domy.druhyObydlenych, d.domy.obydlene)}
    <h3 class="podnadpis-graf">Byty</h3>
    ${pruhy([
      { popis: 'Obvykle obydlené', hodnota: d.byty.obydlene },
      { popis: 'Obvykle neobydlené', hodnota: d.byty.neobydlene },
    ], d.byty.celkem)}

    <h2>Nejvyšší dosažené vzdělání</h2>
    <p class="pod">Obyvatelé ve věku 15 a více let, celkem ${fmtCislo(d.vzdelani.celkem)}.
    U části obyvatel nebylo vzdělání zjištěno.</p>
    ${pruhy(d.vzdelani.kategorie, d.vzdelani.celkem)}

    <h2>Práce a studium</h2>
    <p class="pod">${fmtCislo(d.aktivita.pracovniSila)} lidí tvořilo pracovní sílu,
    ${fmtCislo(d.aktivita.mimoPracovniSilu)} bylo mimo ni. Podíly ze všech obyvatel.</p>
    ${pruhy(d.aktivita.kategorie, o)}

    <h2>Jak velké jsou domácnosti?</h2>
    <p class="pod">Celkem ${fmtCislo(d.domacnosti.celkem)} hospodařících domácností;
    ${fmtCislo(d.domacnosti.rodinne)} z nich rodinných a ${fmtCislo(d.domacnosti.nerodinne)} nerodinných.</p>
    ${pruhy(d.domacnosti.podleClenu.map((k) => ({
      ...k, popis: k.popis === '1' ? '1 člen' : /^[2-4]$/.test(k.popis) ? `${k.popis} členové` : `${k.popis} členů`,
    })), d.domacnosti.celkem)}

    <h2>Čím lidé jezdí do práce a do školy?</h2>
    <p class="pod">Hlavní dopravní prostředek u ${fmtCislo(d.dojizdeni.celkem)} vyjíždějících
    zaměstnaných, žáků a studentů.</p>
    ${pruhy(d.dojizdeni.kategorie, d.dojizdeni.celkem)}

    <p class="metodika">Všechna čísla pocházejí z otevřených dat ČSÚ za území
    <code>${esc(d.uzemi.cis)}/${esc(d.uzemi.kod)}</code> — městská část Praha 6.
    <a href="${esc(d.zdrojUrl)}" target="_blank" rel="noopener">Zdrojové datové sady</a>.</p>`;
}

// ================================================================ zakázky ===
// Profil zadavatele ukáže, za kolik se zakázka vysoutěžila; registr smluv ukáže,
// co se s cenou dělo dál. Teprve dohromady je z toho odpověď na otázku, jestli
// to nakonec stálo tolik, kolik se slibovalo.

const VYKLAD_POPIS = {
  'bez-dodatku': 'Beze změny — k zakázce zatím není dodatek s cenou.',
  celkova: 'Dodatky uvádějí novou celkovou cenu; platí ta z posledního dodatku.',
  prirustkova: 'Dodatky uvádějí přírůstky; konečná cena je jejich součet se smlouvou.',
  nejiste: 'Dodatky si odporují — část vypadá jako nová celková cena, část jako '
    + 'přírůstek. Konečnou cenu z registru poctivě určit nelze.',
  neznama: 'Ve smlouvách k této zakázce není uvedena cena.',
};

const POZNAMKA_ZAKAZKY = `
  <p class="poznamka"><strong>Dva zdroje, dvě různé věci.</strong> Z profilu zadavatele
  je předpokládaná hodnota, vybraný dodavatel a smluvní cena při podpisu.
  Z registru smluv je to, co s cenou udělaly dodatky. Registr ale nerozlišuje, jestli
  dodatek uvádí novou <em>celkovou</em> cenu, nebo jen <em>přírůstek</em> — u části zakázek
  to poznat nejde a ty pak konečnou cenu nemají. Kolik se nakonec opravdu zaplatilo,
  má profil vlastní pole — radnice ho vyplňuje jen u malé části zakázek.</p>`;

/** Odznak se změnou ceny po dodatcích. */
function odznakZmeny(z) {
  if (z.vyklad === 'nejiste') return '<span class="stitek odhad" title="Dodatky si odporují">cena nejistá</span>';
  if (z.zmena == null || Math.abs(z.zmena) < 0.005) return '';
  const p = Math.round(z.zmena * 100);
  return `<span class="stitek ${p > 0 ? 'rust' : 'pokles'}"
    title="Cena při podpisu ${fmtKc(z.zaklad)} → po dodatcích ${fmtKc(z.konecna)}">${p > 0 ? '+' : ''}${p} % po dodatcích</span>`;
}

const fazeTrida = (f) => (/zru[šs]eno/i.test(f ?? '') ? ' zrusena'
  : /zad[áa]no|uzav[řr]eno|ukon[čc]eno|objedn[áa]no/i.test(f ?? '') ? ' zadana' : '');

async function zakazky(params) {
  const ds = await nacti('zakazky-prehled.json').catch(() => null);
  if (!ds?.souhrn) {
    app.innerHTML = `<h1>Veřejné zakázky</h1>
      <p class="prazdno">Profil zadavatele ještě nebyl načten.</p>`;
    return;
  }
  if (params.get('z')) return zakazkaDetail(params, ds);
  return zakazkySeznam(params, ds);
}

function zakazkySeznam(params, ds) {
  const s = ds.souhrn;
  const rok = params.get('rok') ?? '';
  const rezim = params.get('rezim') ?? '';
  const stav = params.get('stav') ?? '';
  const q = params.get('q') ?? '';
  const nq = norm(q);

  let vybrane = [...ds.items].sort((a, b) => (b.zahajeni ?? '').localeCompare(a.zahajeni ?? ''));
  if (rok) vybrane = vybrane.filter((z) => z.zahajeni?.slice(0, 4) === rok);
  if (rezim) vybrane = vybrane.filter((z) => z.rezim === rezim);
  if (stav === 'zadane') vybrane = vybrane.filter((z) => fazeTrida(z.faze) === ' zadana');
  if (stav === 'zrusene') vybrane = vybrane.filter((z) => fazeTrida(z.faze) === ' zrusena');
  if (stav === 'zdrazene') vybrane = vybrane.filter((z) => z.zmena > 0.005);
  if (stav === 'nadodhad') vybrane = vybrane.filter((z) => z.zmenaProtiPredpokladu > 0.005);
  if (stav === 'nesparovane') vybrane = vybrane.filter((z) => z.smluv === 0);
  if (nq) {
    vybrane = vybrane.filter((z) =>
      norm(`${z.nazev ?? ''} ${z.kod ?? ''} ${z.dodavatelNazev ?? ''} ${z.popis ?? ''}`).includes(nq));
  }

  const soucet = vybrane.reduce((a, z) => a + (z.cenaProfil ?? 0), 0);
  const { s: strana, stran, kus } = vyrez(vybrane, params);
  const roky = [...new Set(ds.items.map((z) => z.zahajeni?.slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const rezimy = [...new Set(ds.items.map((z) => z.rezim).filter(Boolean))].sort();
  const d = s.dodatky;
  const o = s.odhad ?? { zakazek: 0 };

  app.innerHTML = `
    <p class="nadsekce">Profil zadavatele · registr smluv</p>
    <h1>Veřejné zakázky</h1>
    <p class="podnadsekce">Co městská část soutěžila, kdo vyhrál, za kolik se to podepsalo
    a jak se cena změnila dodatky. Spojené z profilu zadavatele v E-ZAKu a z registru smluv
    podle evidenčního čísla zakázky.</p>

    <div class="karty">
      <div><div class="v">${fmtCislo(s.celkem)}</div><div class="k">zakázek na profilu</div></div>
      <div><div class="v">${fmtCislo(s.zadanych)}</div><div class="k">zadaných</div></div>
      <div><div class="v dlouha">${fmtKc(s.smluvniCena)}</div><div class="k">smluvní cena ${fmtCislo(s.sCenou)} zakázek</div></div>
      ${o.zakazek ? `<div><div class="v">${o.zmena > 0 ? '+' : ''}${Math.round(o.zmena * 100)} %</div>
        <div class="k">proti předpokládané hodnotě u ${fmtCislo(o.zakazek)} zakázek</div></div>` : ''}
      ${d.zakazek ? `<div><div class="v">${d.zmena > 0 ? '+' : ''}${Math.round(d.zmena * 100)} %</div>
        <div class="k">změna ceny u ${fmtCislo(d.zakazek)} zakázek s dodatky</div></div>` : ''}
    </div>

    <p class="pod">Z ${fmtCislo(s.celkem)} zakázek na profilu je ${fmtCislo(s.zadanych)} zadaných
    a ${fmtCislo(s.zrusenych)} zrušených; ${fmtCislo(s.sparovanych)} se podařilo spojit se smlouvou
    v registru${s.bezKodu ? ` (${fmtCislo(s.bezKodu)} zakázek nemá evidenční číslo ve tvaru,
    podle kterého by to šlo)` : ''}. Předpokládanou hodnotu radnice vyplnila
    u ${fmtCislo(s.sPredpokladem)} z nich, nabídkové ceny neúspěšných uchazečů
    u ${fmtCislo(s.sNabidkami)} a skutečně uhrazenou cenu u ${fmtCislo(s.uhrazenoVyplneno)}
    z ${fmtCislo(s.uhrazenoTabulka)}, které pro ni mají na profilu připravenou tabulku.</p>

    ${o.zakazek ? `<p class="pod">U ${fmtCislo(o.zakazek)} zakázek radnice uvedla předpokládanou
      hodnotu i výslednou smluvní cenu: čekala ${fmtKc(o.predpoklad)}, podepsala
      ${fmtKc(o.vysoutezeno)}. Soutěž srazila cenu u ${fmtCislo(o.levneji)} z nich,
      u ${fmtCislo(o.drazeji)} vyšla dráž, než se čekalo.</p>` : ''}

    ${d.zakazek ? `<p class="pod">Zakázky, u kterých jde cenu porovnat, se podepsaly za
      <strong>${fmtKc(d.zaklad)}</strong> a po dodatcích stojí <strong>${fmtKc(d.konecna)}</strong>
      — o ${fmtKc(d.konecna - d.zaklad)} víc. Podražilo jich ${fmtCislo(d.podrazilo)},
      zlevnilo ${fmtCislo(d.zlevnilo)}${s.nejistych ? `; u ${fmtCislo(s.nejistych)} dalších
      nejde konečnou cenu z registru určit` : ''}.</p>` : ''}

    ${POZNAMKA_ZAKAZKY}

    <form class="filtry" id="filtry">
      <select name="rok" aria-label="Rok zahájení">
        <option value="">Všechny roky</option>
        ${volby(roky, rok)}
      </select>
      <select name="rezim" aria-label="Režim zakázky">
        <option value="">Všechny režimy</option>
        ${volby(rezimy, rezim)}
      </select>
      <select name="stav" aria-label="Výběr">
        <option value="">Všechny zakázky</option>
        <option value="zadane"${stav === 'zadane' ? ' selected' : ''}>Jen zadané</option>
        <option value="zrusene"${stav === 'zrusene' ? ' selected' : ''}>Jen zrušené</option>
        <option value="zdrazene"${stav === 'zdrazene' ? ' selected' : ''}>Jen ty, které podražily dodatky</option>
        <option value="nadodhad"${stav === 'nadodhad' ? ' selected' : ''}>Jen ty dražší, než se čekalo</option>
        <option value="nesparovane"${stav === 'nesparovane' ? ' selected' : ''}>Bez smlouvy v registru</option>
      </select>
      <input type="search" name="q" value="${esc(q)}" placeholder="Název, číslo nebo dodavatel…"
             aria-label="Hledat v zakázkách">
      <span class="pocet">${fmtCislo(vybrane.length)} zakázek · ${fmtKc(soucet)}</span>
    </form>

    ${seznam(kus, radekZakazky, 'Žádná zakázka neodpovídá zadání.')}
    ${strankovani(strana, stran, vybrane.length)}`;

  zapoj('/zakazky', params);
}

const radekZakazky = (z) => `
  <div class="polozka">
    <div class="meta">${z.zahajeni ? fmtDatum(z.zahajeni) : '—'}</div>
    <div>
      <h3><a href="#/zakazky?z=${z.dbid}">${esc(z.nazev ?? z.kod ?? 'Bez názvu')}</a></h3>
      <div class="radek">
        ${z.kod ? `<span class="stitek kod">${esc(z.kod)}</span>` : ''}
        <span class="stitek faze${fazeTrida(z.faze)}">${esc(z.faze ?? 'neuvedeno')}</span>
        ${z.rezim ? `<span class="stitek">${esc(z.rezim)}</span>` : ''}
        ${z.cenaProfil != null ? `<span class="castka">${fmtKc(z.cenaProfil)}</span>` : ''}
        ${odznakZmeny(z)}
      </div>
      ${z.dodavatelNazev ? `<div class="radek tlumene">Vybraný dodavatel: ${esc(z.dodavatelNazev)}${
        z.ucastniku > 1 ? ` · ${z.ucastniku} účastníků` : ''}</div>` : ''}
    </div>
  </div>`;

function zakazkaDetail(params, ds) {
  const z = ds.items.find((x) => String(x.dbid) === params.get('z'));
  if (!z) {
    app.innerHTML = `<p class="prazdno">Taková zakázka tu není.</p>
      <p><a href="#/zakazky">← Zpět na zakázky</a></p>`;
    return;
  }

  const kroky = z.smlouvy ?? [];
  const maxCena = Math.max(1, ...kroky.map((k) => Math.abs(k.castka ?? 0)));

  app.innerHTML = `
    <p class="nadsekce"><a href="#/zakazky">Veřejné zakázky</a></p>
    <h1>${esc(z.nazev ?? z.kod ?? 'Zakázka')}</h1>
    <div class="radek">
      ${z.kod ? `<span class="stitek kod">${esc(z.kod)}</span>` : ''}
      <span class="stitek faze${fazeTrida(z.faze)}">${esc(z.faze ?? 'neuvedeno')}</span>
      ${z.rezim ? `<span class="stitek">${esc(z.rezim)}</span>` : ''}
      ${z.druh ? `<span class="stitek">${esc(z.druh)}</span>` : ''}
      ${z.archiv ? '<span class="stitek">v archivu</span>' : ''}
      ${z.zmenaProtiPredpokladu != null && Math.abs(z.zmenaProtiPredpokladu) >= 0.005
        ? `<span class="stitek ${z.zmenaProtiPredpokladu > 0 ? 'rust' : 'pokles'}"
             title="Předpokládaná hodnota ${fmtKc(z.predpokladPouzitelny)} → smluvní cena ${fmtKc(z.cenaProfil)}">${
             z.zmenaProtiPredpokladu > 0 ? '+' : ''}${Math.round(z.zmenaProtiPredpokladu * 100)} % proti předpokladu</span>` : ''}
    </div>
    ${z.popis ? `<p class="podnadsekce">${esc(z.popis)}</p>` : ''}

    <div class="karty">
      <div><div class="v dlouha">${z.predpokladanaHodnota != null ? fmtKc(z.predpokladanaHodnota) : '—'}</div>
        <div class="k">předpokládaná hodnota${z.predpokladanaHodnota != null && !z.predpokladPouzitelny
          ? ' <span title="Zjevně nejde o odhad ceny; do žádného srovnání se nepočítá">(zjevně nesmysl)</span>' : ''}</div></div>
      <div><div class="v dlouha">${z.cenaProfil != null ? fmtKc(z.cenaProfil) : '—'}</div>
        <div class="k">smluvní cena při podpisu</div></div>
      <div><div class="v dlouha">${z.konecna != null ? fmtKc(z.konecna) : '—'}</div>
        <div class="k">cena po ${fmtCislo(z.dodatku)} dodatcích</div></div>
      <div><div class="v dlouha">${z.uhrazenoVyplneno ? fmtKc(z.uhrazenoCelkem) : '—'}</div>
        <div class="k">skutečně uhrazeno${z.uhrazeno?.length && !z.uhrazenoVyplneno ? ' (nevyplněno)' : ''}</div></div>
    </div>

    <h2>Jak se cena měnila</h2>
    ${kroky.length ? `
      <p class="pod">${esc(VYKLAD_POPIS[z.vyklad] ?? '')}</p>
      <div class="osa">
        ${kroky.map((k) => `
          <div class="osa-krok${k.typ === 'dodatek' ? ' dodatek' : ''}${k.duplikat ? ' duplikat' : ''}">
            <div class="osa-datum">${fmtDatum(k.datum)}</div>
            <div class="osa-telo">
              <div class="osa-nazev">${k.url
                ? `<a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.predmet ?? '—')}</a>`
                : esc(k.predmet ?? '—')}${k.duplikat
                ? ' <span class="stitek odhad" title="Tentýž dokument je v registru uveřejněný podruhé; do ceny se počítá jednou">druhé uveřejnění</span>' : ''}</div>
              <div class="osa-drah"><span class="osa-pruh" style="width:${
                ((Math.abs(k.castka ?? 0) / maxCena) * 100).toFixed(1)}%"></span></div>
            </div>
            <div class="osa-castka">${k.castka != null ? fmtKc(k.castka) : 'bez ceny'}</div>
          </div>`).join('')}
      </div>
      ${z.duplicit ? `<p class="drobne">Pozor: ${fmtCislo(z.duplicit)} ${
        z.duplicit === 1 ? 'záznam je v registru' : 'záznamy jsou v registru'} uveřejněn${
        z.duplicit === 1 ? '' : 'y'} dvakrát. Do ceny se počítá jen jednou.</p>` : ''}
      ${z.vyklad === 'prirustkova'
        ? '<p class="drobne">Částky u dodatků jsou přírůstky, ne celková cena zakázky.</p>'
        : z.vyklad === 'celkova'
          ? '<p class="drobne">Částky u dodatků jsou nové celkové ceny, nesčítají se.</p>' : ''}`
    : '<p class="prazdno">K této zakázce se v registru smluv nenašla žádná smlouva. '
      + 'Buď ještě není uveřejněná, nebo v jejím předmětu není číslo zakázky.</p>'}

    ${z.rozporSProfilem ? `<p class="poznamka"><strong>Ceny se rozcházejí.</strong>
      Profil uvádí smluvní cenu ${fmtKc(z.cenaProfil)}, smlouva v registru
      ${fmtKc(z.zaklad)}. Rozdíl může být DPH, jiný rozsah plnění, nebo chyba v jednom
      ze zdrojů — stojí za ověření v dokumentech.</p>` : ''}

    <h2>Kdo se o zakázku ucházel</h2>
    ${z.ucastnici?.length ? `
      <div class="seznam">
        ${z.ucastnici.map((u) => `
          <div class="polozka">
            <div class="meta">${u.vyloucen ? '✗' : '●'}</div>
            <div>
              <h3>${esc(u.nazev ?? '—')}</h3>
              <div class="radek">
                ${u.ico ? `<span class="stitek">IČO ${esc(u.ico)}</span>` : ''}
                ${u.nabidkaBezDph != null ? `<span class="castka">${fmtKc(u.nabidkaBezDph)}</span>` : ''}
                ${u.vyloucen ? '<span class="stitek odhad">nevybrán</span>' : ''}
                ${z.dodavatelIco && u.ico === z.dodavatelIco ? '<span class="stitek zadana">vybraný dodavatel</span>' : ''}
              </div>
            </div>
          </div>`).join('')}
      </div>
      ${z.nabidek === 0 ? '<p class="drobne">Nabídkové ceny účastníků radnice u této zakázky nezveřejnila.</p>' : ''}`
    : '<p class="prazdno">Seznam účastníků není na profilu vyplněn.</p>'}

    ${z.uhrazeno?.length ? `
      <h2>Skutečně uhrazeno po letech</h2>
      ${z.uhrazenoVyplneno
        ? `<div class="grafy">${z.uhrazeno.map((u) => pruhKc(String(u.rok), u.bezDph ?? 0,
            Math.max(1, ...z.uhrazeno.map((x) => x.bezDph ?? 0)), z.uhrazenoCelkem)).join('')}</div>`
        : `<p class="prazdno">Tabulka na profilu existuje (roky ${z.uhrazeno.map((u) => u.rok).join(', ')}),
           ale je vyplněná nulami. Kolik se opravdu zaplatilo, se z profilu nedozvíme.</p>`}` : ''}

    <p class="metodika">
      <a href="${esc(z.url)}" target="_blank" rel="noopener">Detail zakázky na profilu zadavatele</a>
      ${z.systemove ? ` · systémové číslo ${esc(z.systemove)}` : ''}
      ${z.evidencni ? ` · evidenční číslo ${esc(z.evidencni)}` : ''}
      ${z.dokumentu ? ` · ${fmtCislo(z.dokumentu)} veřejných dokumentů` : ''}
      ${z.postup ? `<br>Postup zadání: ${esc(z.postup)}` : ''}
      ${z.zakon ? ` · ${esc(z.zakon)}` : ''}
    </p>`;
}

// ============================================================= interpelace ===
// Podsekce usnesení: co se zastupitelé a občané ptali na zasedání a co jim
// radnice odpověděla. Přehled je jeden lehký soubor, plné znění se dotahuje
// po ročnících — celý dataset má přes deset megabajtů.

const USN_STRANKY = {
  '/usneseni': 'Usnesení',
  '/interpelace': 'Interpelace',
};

const usnPrepinac = (aktivni, pocetInterpelaci) => `
  <div class="prepinac" role="tablist">
    <a href="#/usneseni" role="tab"${aktivni === '/usneseni' ? ' aria-selected="true"' : ''}>
      Usnesení <span class="cislo">${fmtCislo(manifest.usneseni.pocet)}</span></a>
    <a href="#/interpelace" role="tab"${aktivni === '/interpelace' ? ' aria-selected="true"' : ''}>
      Interpelace${pocetInterpelaci != null ? ` <span class="cislo">${fmtCislo(pocetInterpelaci)}</span>` : ''}</a>
  </div>`;

const POZNAMKA_INTERPELACE = `
  <p class="poznamka"><strong>Přebráno z portálu radnice.</strong> Jména tazatelů,
  doslovné přepisy vystoupení i písemné odpovědi zveřejňuje sama radnice na
  <a href="https://interpelace.praha6.cz/prehled" target="_blank" rel="noopener">interpelace.praha6.cz</a>
  — tady se jen dají dohromady přes všechny roky, protože portál ukazuje vždy
  jen jeden. Interpelace bez odpovědi nemusí znamenat, že radnice neodpověděla:
  odpověď mohla zaznít na místě a do portálu se nedostat.</p>`;

/**
 * Typ přílohy pro čtenáře. MIME z portálu je u dokumentů Office nesnesitelný
 * („vnd.openxmlformats-officedocument.wordprocessingml.document"), takže se
 * bere přípona z názvu souboru a MIME slouží jen jako záloha.
 */
const typPrilohy = (nazev, mime) => {
  const pripona = /\.([a-z0-9]{1,5})$/i.exec(nazev ?? '')?.[1];
  if (pripona) return pripona.toUpperCase();
  const konec = (mime ?? '').split('/').pop() ?? '';
  return /wordprocessing/.test(konec) ? 'DOCX'
    : /spreadsheet/.test(konec) ? 'XLSX'
    : /presentation/.test(konec) ? 'PPTX'
    : konec ? konec.slice(0, 8).toUpperCase() : '';
};

// Tituly za jménem („Ph.D.") už tečku mají; bez tohohle vznikne „Ph.D..".
const tecka = (s) => (/\.$/.test((s ?? '').trim()) ? '' : '.');

const typStitek = (typ) => typ === 'obcan'
  ? '<span class="stitek obcan">občan</span>'
  : typ === 'zastupitel' ? '<span class="stitek zastupitel">zastupitel</span>' : '';

async function nactiInterpelace() {
  const ds = await nacti('interpelace.json').catch(() => null);
  return ds?.souhrn ? ds : null;
}

async function interpelace(params) {
  const ds = await nactiInterpelace();
  if (!ds) {
    app.innerHTML = `<h1>Interpelace</h1>
      ${usnPrepinac('/interpelace', null)}
      <p class="prazdno">Interpelace ještě nebyly načteny.</p>`;
    return;
  }
  if (params.get('i')) return interpelaceDetail(params, ds);
  return interpelaceSeznam(params, ds);
}

function interpelaceSeznam(params, ds) {
  const s = ds.souhrn;
  const roky = s.roky.map((r) => String(r.rok));
  // Rok je hlavní osa sekce: bez volby se ukazuje ten nejnovější, ne všechno
  // najednou — osm set záznamů přes devět let nikdo neprochází vcelku.
  const rok = params.has('rok') ? params.get('rok') : (roky[0] ?? '');
  const typ = params.get('typ') ?? '';
  const oblast = params.get('oblast') ?? '';
  const q = params.get('q') ?? '';
  const nq = norm(q);

  let vybrane = ds.items;
  if (rok) vybrane = vybrane.filter((i) => String(i.rok) === rok);
  if (typ) vybrane = vybrane.filter((i) => i.typ === typ);
  if (oblast) vybrane = vybrane.filter((i) => i.oblast === oblast);
  if (nq) {
    vybrane = vybrane.filter((i) => norm(
      `${i.nazev ?? ''} ${i.cislo ?? ''} ${i.tazatel ?? ''} ${(i.odpovida ?? []).join(' ')}`).includes(nq));
  }

  const r = s.roky.find((x) => String(x.rok) === rok);
  const { s: strana, stran, kus } = vyrez(vybrane, params);
  const oblastiVRoce = [...new Set(ds.items
    .filter((i) => !rok || String(i.rok) === rok).map((i) => i.oblast).filter(Boolean))].sort();

  app.innerHTML = `
    <p class="nadsekce">Zastupitelstvo MČ Praha 6</p>
    <h1>Interpelace${rok ? ` v roce ${esc(rok)}` : ''}</h1>
    <p class="podnadsekce">Na co se zastupitelé a občané ptali na zasedání zastupitelstva
    a co jim radnice odpověděla. U každé je plný přepis vystoupení, písemná odpověď
    a přílohy tak, jak je zveřejňuje radnice.</p>

    ${usnPrepinac('/interpelace', s.celkem)}

    <div class="roky" role="tablist" aria-label="Rok">
      <a href="#/interpelace?rok=" role="tab"${!rok ? ' aria-selected="true"' : ''}>Vše
        <span class="cislo">${fmtCislo(s.celkem)}</span></a>
      ${s.roky.map((x) => `
        <a href="#/interpelace?rok=${x.rok}" role="tab"${String(x.rok) === rok ? ' aria-selected="true"' : ''}>${x.rok}
          <span class="cislo">${fmtCislo(x.pocet)}</span></a>`).join('')}
    </div>

    <div class="karty">
      <div><div class="v">${fmtCislo(r ? r.pocet : s.celkem)}</div><div class="k">interpelací</div></div>
      <div><div class="v">${fmtCislo(r ? r.zastupitele : s.zastupitele)}</div><div class="k">od zastupitelů</div></div>
      <div><div class="v">${fmtCislo(r ? r.obcane : s.obcane)}</div><div class="k">od občanů</div></div>
      <div><div class="v">${fmtCislo(r ? r.sOdpovedi : s.sOdpovedi)}</div><div class="k">má v portálu odpověď</div></div>
    </div>

    ${POZNAMKA_INTERPELACE}

    <form class="filtry" id="filtry">
      <select name="typ" aria-label="Kdo interpeloval">
        <option value="">Zastupitelé i občané</option>
        <option value="zastupitel"${typ === 'zastupitel' ? ' selected' : ''}>Jen zastupitelé</option>
        <option value="obcan"${typ === 'obcan' ? ' selected' : ''}>Jen občané</option>
      </select>
      <select name="oblast" aria-label="Oblast">
        <option value="">Všechny oblasti</option>
        ${volby(oblastiVRoce, oblast)}
      </select>
      <input type="search" name="q" value="${esc(q)}" placeholder="Téma, tazatel nebo číslo…"
             aria-label="Hledat v interpelacích">
      <span class="pocet">${fmtCislo(vybrane.length)} interpelací</span>
    </form>

    ${seznam(kus, radekInterpelace, 'Žádná interpelace neodpovídá zadání.')}
    ${strankovani(strana, stran, vybrane.length)}`;

  // Rok se drží i při změně ostatních filtrů — jinak by se přehled po každém
  // sáhnutí na filtr přepnul zpátky na „vše".
  zapoj('/interpelace', params, ['rok']);
  const form = document.getElementById('filtry');
  if (form && rok) {
    const skryte = document.createElement('input');
    skryte.type = 'hidden'; skryte.name = 'rok'; skryte.value = rok;
    form.appendChild(skryte);
  }
}

const radekInterpelace = (i) => `
  <div class="polozka">
    <div class="meta">${fmtDatum(i.datum)}</div>
    <div>
      <h3><a href="#/interpelace?i=${encodeURIComponent(i.gid)}">${esc(i.nazev ?? i.cislo ?? 'Bez názvu')}</a></h3>
      <div class="radek">
        ${i.cislo ? `<span class="stitek kod">${esc(i.cislo)}</span>` : ''}
        ${i.tazatel ? `<span>${esc(i.tazatel)}</span>` : ''}
        ${typStitek(i.typ)}
        ${i.oblast ? `<span class="stitek">${esc(i.oblast)}</span>` : ''}
        ${i.maOdpoved ? '' : '<span class="stitek odhad">bez odpovědi v portálu</span>'}
      </div>
      ${i.odpovida?.length
        ? `<div class="radek tlumene">Odpovídá: ${esc(i.odpovida.join(', '))}</div>` : ''}
    </div>
  </div>`;

async function interpelaceDetail(params, ds) {
  const gid = params.get('i');
  const i = ds.items.find((x) => x.gid === gid);
  if (!i) {
    app.innerHTML = `<p class="prazdno">Taková interpelace tu není.</p>
      <p><a href="#/interpelace">← Zpět na interpelace</a></p>`;
    return;
  }

  const zpet = `#/interpelace?rok=${i.rok ?? ''}`;
  const rocnik = await nacti(`interpelace-texty/${i.rok}.json`).catch(() => null);
  const d = rocnik?.items?.find((x) => x.gid === gid) ?? null;

  const odstavce = (text) => text.split(/\n{2,}/)
    .map((o) => `<p>${esc(o).replace(/\n/g, '<br>')}</p>`).join('');

  app.innerHTML = `
    <p class="nadsekce"><a href="${zpet}">Interpelace ${i.rok ?? ''}</a></p>
    <h1>${esc(i.nazev ?? i.cislo ?? 'Interpelace')}</h1>
    <div class="radek">
      ${i.cislo ? `<span class="stitek kod">${esc(i.cislo)}</span>` : ''}
      ${typStitek(i.typ)}
      ${i.oblast ? `<span class="stitek">${esc(i.oblast)}</span>` : ''}
      <span>${fmtDatum(i.datum)}</span>
    </div>
    <p class="podnadsekce">
      ${i.tazatel ? `Podal${i.typ === 'obcan' ? ' občan' : i.typ === 'zastupitel' ? ' zastupitel' : ''}
        <strong>${esc(i.tazatel)}</strong>${tecka(i.tazatel)}` : ''}
      ${i.odpovida?.length ? ` Odpovídá <strong>${esc(i.odpovida.join(', '))}</strong>${tecka(i.odpovida.join(', '))}` : ''}
      ${i.termin ? ` Termín pro odpověď ${fmtDatum(i.termin)}.` : ''}
    </p>

    ${d?.texty?.length ? d.texty.map((t) => `
      <div class="rozprava${t.druh === 'odpoved' ? ' odpoved' : ''}">
        <h2>${t.druh === 'odpoved' ? 'Odpověď' : 'Interpelace'}</h2>
        <div class="rozprava-meta">${[t.kdo ? esc(t.kdo) : null, t.kdy ? fmtDatum(t.kdy) : null]
          .filter(Boolean).join(' · ') || '—'}</div>
        ${odstavce(t.text)}
      </div>`).join('')
      : '<p class="prazdno">Plné znění se nepodařilo načíst.</p>'}

    ${!i.maOdpoved ? `<p class="poznamka">V portálu radnice u této interpelace není písemná
      odpověď. Mohla zaznít ústně na zasedání — pak je součástí přepisu výše.</p>` : ''}

    ${d?.prilohy?.length ? `
      <h2>Přílohy</h2>
      <div class="seznam">
        ${d.prilohy.map((p) => `
          <div class="polozka"><div class="meta">📎</div><div>
            <h3><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.nazev)}</a></h3>
            <div class="radek tlumene">${[
              typPrilohy(p.nazev, p.mime),
              p.velikost ? `${fmtCislo(Math.round(p.velikost / 1024))} kB` : null,
            ].filter(Boolean).map(esc).join(' · ')}</div>
          </div></div>`).join('')}
      </div>` : ''}

    <p class="metodika">
      ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">Interpelace na portálu radnice</a>` : ''}
      ${i.jednaniUrl ? ` · <a href="${esc(i.jednaniUrl)}" target="_blank" rel="noopener">Jednání zastupitelstva</a>` : ''}
      ${i.zverejneno ? ` · zveřejněno ${fmtDatum(i.zverejneno)}` : ''}
    </p>`;
}

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
