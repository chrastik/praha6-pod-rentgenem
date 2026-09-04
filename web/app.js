// Praha 6 pod rentgenem — statický frontend bez frameworku a bez build kroku.
// Data se načítají líně: manifest hned, ročníky usnesení a fulltextový index až
// když jsou potřeba. Cílem je, aby první vykreslení nestahovalo desítky MB.

const DATA = './data';
const app = document.getElementById('app');
const stavDat = document.getElementById('stavDat');

const cache = new Map();
async function nacti(cesta) {
  if (cache.has(cesta)) return cache.get(cesta);
  const p = fetch(`${DATA}/${cesta}`).then((r) => {
    if (!r.ok) throw new Error(`${cesta}: HTTP ${r.status}`);
    return r.json();
  });
  cache.set(cesta, p);
  return p;
}

const fmtDatum = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ') : '—');
const fmtCislo = (n) => (n == null ? '—' : n.toLocaleString('cs-CZ'));
const fmtKc = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('cs-CZ')} Kč`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let manifest = null;

// ---------------------------------------------------------------- router ----
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

// ------------------------------------------------------------------ views ---
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
  const strana = Number(params.get('strana') ?? 1);

  let vysledek = docs;
  if (q.trim()) {
    const slova = norm(q).split(/[^0-9a-z/]+/).filter((s) => s.length >= 3);
    if (slova.length) {
      let mnoziny = slova.map((s) => {
        const presne = tokens[s];
        if (presne) return new Set(presne);
        // prefixové dohledání — uživatel píše "rekonstruk", token je "rekonstrukce"
        const spojene = new Set();
        for (const t in tokens) if (t.startsWith(s)) tokens[t].forEach((i) => spojene.add(i));
        return spojene;
      });
      mnoziny.sort((a, b) => a.size - b.size);
      const [prvni, ...zbytek] = mnoziny;
      vysledek = [...prvni]
        .filter((i) => zbytek.every((m) => m.has(i)))
        .map((i) => docs[i]);
    }
  }
  if (organ) vysledek = vysledek.filter((d) => d.o === organ);
  if (rok) vysledek = vysledek.filter((d) => (d.d ?? '').startsWith(rok));
  if (tema) vysledek = vysledek.filter((d) => d.t?.includes(tema));
  vysledek = vysledek.slice().sort((a, b) => (b.d ?? '').localeCompare(a.d ?? ''));

  const naStranu = 25;
  const stran = Math.max(1, Math.ceil(vysledek.length / naStranu));
  const s = Math.min(Math.max(1, strana), stran);
  const vyrez = vysledek.slice((s - 1) * naStranu, s * naStranu);
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
        ${manifest.usneseni.roky.map((r) => `<option${String(r) === rok ? ' selected' : ''}>${r}</option>`).join('')}
      </select>
      <select name="tema" aria-label="Téma">
        <option value="">Všechna témata</option>
        ${vsechnaTemata.map((t) => `<option${t === tema ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      ${q ? `<button type="button" id="zrusHledani">Zrušit hledání „${esc(q)}“</button>` : ''}
      <span class="pocet">${fmtCislo(vysledek.length)} záznamů</span>
    </form>

    ${vyrez.length ? `<div class="seznam">${vyrez.map(radekUsneseni).join('')}</div>` : '<p class="prazdno">Nic nenalezeno.</p>'}
    ${stran > 1 ? strankovani(s, stran, params) : ''}`;

  document.getElementById('filtry')?.addEventListener('change', (e) => {
    const f = new FormData(e.currentTarget);
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    for (const [k, v] of f) if (v) p.set(k, v);
    location.hash = `#/usneseni?${p}`;
  });
  document.getElementById('zrusHledani')?.addEventListener('click', () => {
    const p = new URLSearchParams(params); p.delete('q'); p.delete('strana');
    document.getElementById('q').value = '';
    location.hash = `#/usneseni?${p}`;
  });
  app.querySelectorAll('[data-strana]').forEach((b) => b.addEventListener('click', () => {
    const p = new URLSearchParams(params); p.set('strana', b.dataset.strana);
    location.hash = `#/usneseni?${p}`;
  }));
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

const strankovani = (s, stran) => `
  <div class="strankovani">
    <button data-strana="${s - 1}"${s <= 1 ? ' disabled' : ''}>← Předchozí</button>
    <span>Strana ${s} z ${stran}</span>
    <button data-strana="${s + 1}"${s >= stran ? ' disabled' : ''}>Další →</button>
  </div>`;

async function finance() {
  const [rozpocet, faktury] = await Promise.all([
    nacti('rozpocet.json').catch(() => null),
    nacti('faktury.json').catch(() => null),
  ]);
  if (!rozpocet && !faktury) {
    app.innerHTML = `<h1>Peníze</h1><p class="prazdno">Finanční data ještě nebyla načtena.
      Spusť <code>npm run sync:finance</code>.</p>`;
    return;
  }
  const posledni = (faktury?.items ?? []).slice(0, 50);
  app.innerHTML = `
    <h1>Peníze</h1>
    <p class="podnadpis">Položkový rozpočet a jednotlivé faktury z CityVizoru — tohle je
    nejsilnější datový zdroj Prahy 6.</p>
    <div class="karty">
      <div><div class="v">${fmtCislo(rozpocet?.roky?.length)}</div><div class="k">ročníků rozpočtu</div></div>
      <div><div class="v">${fmtCislo(faktury?.pocet)}</div><div class="k">faktur</div></div>
    </div>
    <h2>Poslední faktury</h2>
    <div class="seznam">${posledni.map((f) => `
      <div class="polozka">
        <div class="meta">${fmtDatum(f.date ?? f.datum)}</div>
        <div><h3>${esc(f.counterpartyName ?? f.dodavatel ?? 'Neuvedeno')}</h3>
        <div class="radek"><span>${fmtKc(f.amount ?? f.castka)}</span>
        <span>${esc(f.description ?? f.popis ?? '')}</span></div></div>
      </div>`).join('')}</div>`;
}

async function smlouvy() {
  const ds = await nacti('smlouvy.json').catch(() => null);
  if (!ds) { app.innerHTML = '<h1>Smlouvy</h1><p class="prazdno">Zatím nenačteno.</p>'; return; }
  app.innerHTML = `
    <h1>Registr smluv</h1>
    <p class="podnadpis">Smlouvy městské části Praha 6, IČO ${esc(ds.ico ?? '00063703')}.
    Hodnota smlouvy neurčuje směr platby.</p>
    <div class="karty">
      <div><div class="v">${fmtCislo(ds.pocet)}</div><div class="k">smluv</div></div>
      <div><div class="v">${fmtKc(ds.souhrn?.celkovaHodnota)}</div><div class="k">známá hodnota</div></div>
    </div>
    <div class="seznam">${ds.items.slice(0, 100).map((s) => `
      <div class="polozka"><div class="meta">${fmtDatum(s.datum)}</div>
      <div><h3><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.predmet ?? 'Bez předmětu')}</a></h3>
      <div class="radek"><span>${fmtKc(s.castka)}</span>${s.protistrana ? `<span>${esc(s.protistrana)}</span>` : ''}</div>
      </div></div>`).join('')}</div>`;
}

async function deska() {
  const ds = await nacti('deska.json').catch(() => null);
  if (!ds) { app.innerHTML = '<h1>Úřední deska</h1><p class="prazdno">Zatím nenačteno.</p>'; return; }
  app.innerHTML = `
    <h1>Úřední deska</h1>
    <p class="podnadpis">Radnice zveřejňuje jen aktuálně vyvěšené dokumenty. Archiv níže
    vzniká tím, že si zaznamenáváme, co jsme kdy na desce viděli.</p>
    <div class="seznam">${ds.items.slice(0, 200).map((d) => `
      <div class="polozka"><div class="meta">${fmtDatum(d.vyveseno)}</div>
      <div><h3><a href="${esc(d.url ?? '#')}" target="_blank" rel="noopener">${esc(d.nazev)}</a></h3>
      <div class="radek">${d.naDesce ? '<span class="badge RMC">Vyvěšeno</span>' : '<span class="stitek">Sejmuto</span>'}
      ${d.oblast ? `<span>${esc(d.oblast)}</span>` : ''}</div></div></div>`).join('')}</div>`;
}

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
    zařízením a jednací řád (§ 15 odst. 8) ukládá zveřejnit jmenovitá hlasování do tří dnů.
    Portál usnesení má pro ně připravená pole, ale nejsou naplněná. Otevřená data z let
    2014–2018 existovala, jejich soubory dnes vracejí chybu. Dokud radnice publikaci
    nezapne, umí tento web ukázat jen účast a souhrnné výsledky ze zápisů.</p>`;
}

const zdrojRadek = (nazev, url, popis) => `
  <div class="polozka"><div class="meta">●</div><div>
    <h3><a href="${esc(url)}" target="_blank" rel="noopener">${esc(nazev)}</a></h3>
    <div class="radek">${esc(popis)}</div></div></div>`;

// -------------------------------------------------------------------- init --
document.getElementById('formHledat').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  location.hash = q ? `#/usneseni?q=${encodeURIComponent(q)}` : '#/usneseni';
});

window.addEventListener('hashchange', route);

try {
  manifest = await nacti('web/manifest.json');
  stavDat.textContent = `Data aktualizována ${new Date(manifest.aktualizovano).toLocaleString('cs-CZ')}.`;
  await route();
} catch (err) {
  app.innerHTML = `<div class="chyba"><strong>Data zatím nejsou k dispozici.</strong><br>
    Spusť synchronizaci (<code>npm run daily</code>) nebo workflow v GitHub Actions.<br>
    <span class="drobne">${esc(err.message)}</span></div>`;
}
