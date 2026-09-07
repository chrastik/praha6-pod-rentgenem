#!/usr/bin/env node
/**
 * Průchod webem v prohlížeči — filtry, hledání, stránkování, profily.
 *
 * Ostatní testy kontrolují data. Tenhle kontroluje to, co data nikdy
 * nezachytí: že se filtr při hledání neztratí, že výběr ukazuje hodnotu,
 * podle které se opravdu filtruje, a že proklik dá totéž co přímý odkaz.
 * Přesně na tomhle se sekce interpelací rozbila — hledání ve „Vše"
 * vracelo jen poslední ročník, protože prázdná hodnota roku vypadla z adresy.
 *
 * Nejede v CI: potřebuje prohlížeč. Spouští se ručně proti build složce.
 *
 *   npx playwright install chromium      # jednou
 *   npm run build:web && npm run test:web
 *
 * Volitelně: PORT=8901 ADRESA=http://127.0.0.1:8901/
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8901);
const KOREN = process.env.KOREN ?? '_site';

const TYPY = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/** Statický server nad _site — frontend čeká data jako sourozence index.html. */
async function server() {
  const s = createServer(async (req, res) => {
    const cesta = path.join(KOREN, decodeURIComponent(req.url.split('?')[0]));
    const soubor = (await stat(cesta).catch(() => null))?.isDirectory() ? path.join(cesta, 'index.html') : cesta;
    try {
      const data = await readFile(soubor);
      res.writeHead(200, { 'content-type': TYPY[path.extname(soubor)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404).end('nenalezeno'); }
  });
  await new Promise((r) => s.listen(PORT, r));
  return s;
}

const { chromium } = await import('playwright').catch(() => import('playwright-core'));
const srv = await server();
const ADRESA = process.env.ADRESA ?? `http://127.0.0.1:${PORT}/`;

const prohlizec = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const p = await prohlizec.newPage({ viewport: { width: 1280, height: 900 } });
const chybyKonzole = [];
p.on('pageerror', (e) => chybyKonzole.push(String(e)));

const jdi = async (h) => {
  await p.goto(`${ADRESA}#${h}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !/Načítám/.test(document.getElementById('app').innerText),
    { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(400);
};
const hash = () => p.evaluate(() => location.hash);
const parametry = async () => Object.fromEntries(new URLSearchParams((await hash()).split('?')[1] ?? ''));
const pocet = () => p.$eval('.pocet', (e) => e.innerText).catch(() => null);

let ok = true;
const vysledky = [];
const zkus = async (popis, akce) => {
  try {
    const r = await akce();
    if (!r.ok) ok = false;
    vysledky.push(`${r.ok ? '  ✓ ' : '  ✗ '}${popis}${r.info ? `\n      ${r.info}` : ''}`);
  } catch (e) {
    ok = false;
    vysledky.push(`  ✗ ${popis}\n      výjimka: ${e.message.split('\n')[0]}`);
  }
};

const SEKCE = ['/', '/usneseni', '/interpelace', '/finance', '/smlouvy', '/organizace', '/firmy',
  '/dotace', '/dotace-prijemci', '/dotace-prijate', '/zakazky', '/deska', '/scitani', '/zdroje'];
const VYBERY = [
  ['/usneseni', ['organ', 'rok', 'tema']],
  ['/interpelace?rok=', ['typ', 'oblast']],
  ['/finance', ['rok']],
  ['/smlouvy', ['rok']],
  ['/dotace', ['rok', 'oblast']],
  ['/dotace-prijate', ['rok']],
  ['/dotace-prijemci', ['oblast']],
  ['/zakazky', ['rok', 'rezim', 'stav']],
  ['/deska', ['rok', 'oblast']],
];

console.log('Vykreslení sekcí');
await zkus('všech čtrnáct sekcí se vykreslí', async () => {
  const spatne = [];
  for (const s of SEKCE) {
    await jdi(s);
    const t = await p.$eval('#app', (e) => e.innerText);
    if (t.length < 200 || /nepodařilo|Načítám/.test(t)) spatne.push(s);
  }
  return { ok: !spatne.length, info: spatne.length ? `prázdné: ${spatne.join(', ')}` : `${SEKCE.length} sekcí` };
});

console.log('\nFiltry a hledání');
for (const [cesta, pole] of VYBERY) {
  await zkus(`${cesta} — filtry se udrží vedle sebe i vedle hledání`, async () => {
    await jdi(cesta);
    const ocek = {};
    if (cesta.includes('rok=')) ocek.rok = '';
    for (const jm of pole) {
      const h = await p.$$eval(`select[name=${jm}] option`, (o) => o.map((x) => x.value).filter(Boolean));
      if (!h.length) continue;
      await p.selectOption(`select[name=${jm}]`, h[0]);
      await p.waitForTimeout(450);
      ocek[jm] = h[0];
    }
    if (await p.$('input[name=q]')) {
      await p.fill('input[name=q]', 'a');
      await p.press('input[name=q]', 'Enter');
      await p.waitForTimeout(550);
      ocek.q = 'a';
    }
    const par = await parametry();
    const chybi = Object.entries(ocek).filter(([k, v]) => par[k] !== v).map(([k]) => k);
    return { ok: !chybi.length, info: chybi.length ? `ztraceno: ${chibiText(chybi, par, ocek)}` : '' };
  });
}
const chibiText = (chybi, par, ocek) =>
  chybi.map((k) => `${k} („${par[k] ?? '—'}" místo „${ocek[k]}")`).join(', ');

// Tohle byla ta chyba: prázdný rok znamená „Vše" a musí přežít hledání.
await zkus('interpelace — hledání ve „Vše" zůstane ve „Vše"', async () => {
  await jdi('/interpelace?rok=');
  await p.fill('input[name=q]', 'Tichá');
  await p.press('input[name=q]', 'Enter');
  await p.waitForTimeout(700);
  const rok = await p.$eval('.roky a[aria-selected]', (e) => e.innerText.split('\n')[0]);
  const nadpis = await p.$eval('h1', (e) => e.innerText);
  return { ok: rok === 'Vše' && !/v roce/.test(nadpis), info: `„${nadpis}", zvolený rok „${rok}", ${await pocet()}` };
});
await zkus('interpelace — bez parametru se ukáže poslední ročník', async () => {
  await jdi('/interpelace');
  const nadpis = await p.$eval('h1', (e) => e.innerText);
  return { ok: /v roce \d{4}/.test(nadpis), info: `„${nadpis}"` };
});

// A tohle byla druhá: filtr platil, ale výběr ukazoval „Všechny…".
await zkus('výběr ukazuje hodnotu, i když ji nabídka roku neobsahuje', async () => {
  await jdi('/interpelace?rok=&oblast=106%2F99+Sb.');
  await jdi('/interpelace?rok=2026&oblast=106%2F99+Sb.');
  const zvoleno = await p.$eval('select[name=oblast]', (e) => e.value);
  return { ok: zvoleno === '106/99 Sb.', info: `výběr ukazuje „${zvoleno}"` };
});

await zkus('hledání nezáleží na velikosti písmen ani diakritice', async () => {
  const vysl = [];
  for (const d of ['Eva Tichá', 'EVA TICHÁ', 'eva ticha']) {
    await jdi(`/interpelace?rok=&q=${encodeURIComponent(d)}`);
    vysl.push((await pocet() ?? '').split(' ')[0]);
  }
  return { ok: new Set(vysl).size === 1 && vysl[0] !== '0', info: vysl.join(' / ') };
});

console.log('\nStránkování a adresy');
for (const cesta of ['/usneseni', '/interpelace?rok=', '/finance', '/smlouvy', '/dotace', '/deska']) {
  await zkus(`${cesta} — stránkování drží filtr roku`, async () => {
    await jdi(cesta);
    let ocek = null;
    const h = await p.$$eval('select[name=rok] option', (o) => o.map((x) => x.value).filter(Boolean)).catch(() => []);
    if (h.length) { await p.selectOption('select[name=rok]', h[0]); await p.waitForTimeout(550); ocek = h[0]; }
    if (!await p.$('[data-strana="2"]')) return { ok: true, info: 'jen jedna strana' };
    await p.click('[data-strana="2"]');
    await p.waitForTimeout(600);
    const par = await parametry();
    return { ok: par.strana === '2' && (!ocek || par.rok === ocek), info: await hash() };
  });
}
await zkus('výběry přežijí znovunačtení adresy', async () => {
  const spatne = [];
  for (const [cesta, pole] of VYBERY) {
    await jdi(cesta);
    const par = new URLSearchParams(cesta.includes('rok=') ? { rok: '' } : {});
    for (const jm of pole) {
      const h = await p.$$eval(`select[name=${jm}] option`, (o) => o.map((x) => x.value).filter(Boolean));
      if (h.length) par.set(jm, h[Math.min(1, h.length - 1)]);
    }
    await jdi(`${cesta.split('?')[0]}?${par}`);
    for (const [k, val] of par) {
      if (k === 'rok' && val === '') continue;
      const skut = await p.$eval(`select[name=${k}]`, (e) => e.value).catch(() => null);
      if (skut !== val) spatne.push(`${cesta} ${k}: „${skut}" ≠ „${val}"`);
    }
  }
  return { ok: !spatne.length, info: spatne.join('; ') };
});
await zkus('pořadí parametrů v adrese nic nemění', async () => {
  await jdi('/interpelace?rok=2019&typ=obcan');
  const a = await pocet();
  await jdi('/interpelace?typ=obcan&rok=2019');
  return { ok: a === await pocet() && a !== null, info: String(a) };
});
await zkus('strana mimo rozsah se srovná na poslední', async () => {
  await jdi('/smlouvy?strana=99999');
  const t = await p.$eval('.rozsah', (e) => e.innerText).catch(() => '');
  return { ok: /záznamy/.test(t), info: t };
});

console.log('\nProkliky a slepé uličky');
await zkus('profil příjemce dotací', async () => {
  await jdi('/dotace-prijemci');
  await (await p.$('a[href*="prijemce="]')).click();
  await p.waitForTimeout(800);
  const t = await p.$eval('#app', (e) => e.innerText);
  return { ok: /dostal celkem/.test(t), info: await hash() };
});
await zkus('profil zřizované organizace drží IČO při filtrování', async () => {
  await jdi('/organizace');
  await (await p.$('a[href*="ico="]')).click();
  await p.waitForTimeout(800);
  const h = await p.$$eval('select[name=rok] option', (o) => o.map((x) => x.value).filter(Boolean)).catch(() => []);
  if (h.length) { await p.selectOption('select[name=rok]', h[0]); await p.waitForTimeout(650); }
  return { ok: /ico=/.test(await hash()), info: await hash() };
});
await zkus('detail zakázky z přehledu', async () => {
  await jdi('/zakazky');
  await (await p.$('.seznam .polozka h3 a')).click();
  await p.waitForTimeout(800);
  const t = await p.$eval('#app', (e) => e.innerText);
  return { ok: /[?&]z=\d+/.test(await hash()) && /Jak se cena měnila/.test(t), info: await hash() };
});
await zkus('detail interpelace a odkaz zpět na její ročník', async () => {
  await jdi('/interpelace?rok=2019');
  await (await p.$('.seznam .polozka h3 a')).click();
  await p.waitForTimeout(1200);
  const zpet = await p.$eval('.nadsekce a', (e) => e.getAttribute('href'));
  return { ok: zpet.includes('rok=2019'), info: `zpět → ${zpet}` };
});
await zkus('neznámá cesta i neznámý detail končí srozumitelně', async () => {
  await jdi('/neexistuje');
  const a = await p.$eval('#app', (e) => e.innerText);
  await jdi('/interpelace?i=nesmysl');
  const c = await p.$eval('#app', (e) => e.innerText);
  await jdi('/zakazky?z=999999');
  const d = await p.$eval('#app', (e) => e.innerText);
  return { ok: /Veřejná data/.test(a) && /není/.test(c) && /není/.test(d), info: '' };
});

console.log('\nÚplnost dat u faktur');
await zkus('neúplný ročník je označený v roletce a hodnota zůstane čistý rok', async () => {
  await jdi('/finance');
  const volby = await p.$$eval('#filtry select[name=rok] option',
    (o) => o.map((x) => ({ v: x.value, t: x.innerText })));
  const znacene = volby.filter((x) => /neúplný/.test(x.t));
  const cistaHodnota = znacene.every((x) => /^\d{4}$/.test(x.v));
  return {
    ok: znacene.length > 0 && cistaHodnota,
    info: znacene.map((x) => `${x.t} → „${x.v}"`).join(', ') || 'žádný ročník není označený',
  };
});
await zkus('výběr označeného ročníku opravdu filtruje', async () => {
  await jdi('/finance');
  const rok = await p.$eval('#filtry select[name=rok] option:nth-child(3)', (e) => e.value);
  await p.selectOption('#filtry select[name=rok]', rok);
  await p.waitForTimeout(900);
  const par = await parametry();
  const data = await p.$$eval('.seznam .polozka .meta', (e) => e.map((x) => x.innerText));
  return {
    ok: par.rok === rok && data.length > 0 && data.every((d) => d.trim().endsWith(rok)),
    info: `#${await hash()} · ${data.length} položek, všechny z roku ${rok}`,
  };
});
await zkus('poznámka o dírách se ukáže bez filtru', async () => {
  await jdi('/finance');
  const t = await p.$eval('.poznamka.varovani', (e) => e.innerText).catch(() => '');
  return { ok: /nezveřejnil celý|dní stará/.test(t), info: t.split('\n')[0].slice(0, 110) };
});
await zkus('u vyfiltrovaného úplného ročníku poznámka nestraší cizím rokem', async () => {
  await jdi('/finance');
  const volby = await p.$$eval('#filtry select[name=rok] option',
    (o) => o.filter((x) => x.value && !/neúplný/.test(x.innerText)).map((x) => x.value));
  const uplny = volby.find((v) => Number(v) < new Date().getFullYear());
  if (!uplny) return { ok: true, info: 'není s čím porovnat' };
  await jdi(`/finance?rok=${uplny}`);
  const t = await p.$eval('.poznamka.varovani', (e) => e.innerText).catch(() => '');
  return { ok: !/nezveřejnil celý/.test(t), info: `rok ${uplny}: ${t ? t.split('\n')[0].slice(0, 80) : 'bez poznámky'}` };
});
await zkus('u vyfiltrovaného děravého ročníku se poznámka drží jeho', async () => {
  await jdi('/finance');
  const dery = await p.$$eval('#filtry select[name=rok] option',
    (o) => o.filter((x) => /neúplný/.test(x.innerText)).map((x) => x.value));
  if (!dery.length) return { ok: true, info: 'žádný děravý ročník' };
  await jdi(`/finance?rok=${dery[0]}`);
  const t = await p.$eval('.poznamka.varovani', (e) => e.innerText).catch(() => '');
  const cizi = dery.slice(1).some((r) => t.includes(`Rok ${r} `));
  return { ok: t.includes(`Rok ${dery[0]} `) && !cizi, info: t.split('\n')[0].slice(0, 110) };
});

console.log(vysledky.join('\n'));
if (chybyKonzole.length) {
  ok = false;
  console.log(`\n  ✗ chyby v konzoli prohlížeče:\n      ${chybyKonzole.slice(0, 5).join('\n      ')}`);
}
console.log(ok ? '\nVŠECHNY KONTROLY PROŠLY ✓' : '\nNĚCO NESEDÍ ✗');

await prohlizec.close();
srv.close();
process.exit(ok ? 0 : 1);
