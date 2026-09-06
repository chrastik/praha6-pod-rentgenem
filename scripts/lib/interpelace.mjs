/**
 * Interpelace zastupitelů a občanů z portálu interpelace.praha6.cz.
 *
 * Portál má veřejné API, které vrátí všech 800+ interpelací od roku 2018
 * v jednom volání — včetně doslovného přepisu vystoupení a písemné odpovědi.
 * Veřejná tabulka na webu portálu přitom ukazuje jen aktuální rok; kdo se
 * spolehne na to, co je v HTML, dostane pár desítek záznamů místo osmi set.
 *
 * Tady jsou jen čisté funkce nad odpovědí API, aby se daly testovat bez sítě.
 */

export const BASE = 'https://interpelace.praha6.cz';
export const API = `${BASE}/api/1.0/inter/published/`;
const JEDNANI = 'https://usneseni.praha6.cz:1190/usneseni-pozvanky/jednani';

/**
 * Jména občanů se na webu zkracují na iniciály; jména zastupitelů zůstávají celá.
 *
 * Zastupitel interpeluje ve veřejné funkci, občan ne. Radnice sama jména občanů
 * v přepisech na iniciály zkracuje („Pan J. M."), jen ne důsledně — u 237 ze 433
 * občanských interpelací je v přepisu i celé jméno. Zkrátit jen popisek „Podal"
 * a nechat jméno v textu by byla kosmetika, ne ochrana, takže se nahrazuje obojí.
 *
 * Přepnutím na false se přebírá vše tak, jak to zveřejňuje radnice.
 */
export const ANONYMIZOVAT_OBCANY = true;

/** Tituly, které nejsou součástí jména a do iniciál nepatří. */
const TITULY = /\b(Ing|Mgr|Bc|JUDr|MUDr|MVDr|PhDr|RNDr|PaedDr|MgA|MSc|msc|MBA|LLM|Dr|prof|doc|arch|Ph\.?D|CSc|DrSc|FEng|DiS|Th\.?D)\b\.?/gi;

/**
 * „Jaroslav Minařík" → „J. M.", „JUDr. Ivan Hrůza" → „I. H.",
 * „Nejedlá Kateřina, Ing." → „N. K." (pořadí jména se nemění, jen se zkracuje).
 */
export function inicialy(jmeno) {
  const casti = castiJmena(jmeno);
  if (!casti.length) return null;
  return casti.map((c) => `${[...c][0].toUpperCase()}.`).join(' ');
}

/**
 * Části jména bez titulů a interpunkce.
 * Jednopísmenné zbytky se zahazují — vznikají z titulů psaných bez teček
 * („M.A Mikuláš Roubíček"), ne ze jména.
 */
function castiJmena(jmeno) {
  return (jmeno ?? '')
    .replace(TITULY, ' ')
    .replace(/[.,;()]/g, ' ')
    .split(/\s+/)
    .filter((c) => /^\p{L}/u.test(c) && [...c].length > 1);
}

/**
 * Klíč pro porovnávání jmen bez ohledu na tituly a pořadí.
 * „Mgr. Ondřej Chrást", „Ondřej Chrást" i „Chrást Ondřej" dají totéž.
 */
export const klicJmena = (jmeno) => castiJmena(jmeno)
  .map((c) => c.toLowerCase()).sort().join(' ');

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Vyškrtá jméno z textu přepisu a nahradí ho iniciálami.
 *
 * Postup má dva kroky, protože každý řeší jinou past:
 *   1. celé jméno v obou pořadích — díky tomu se nahradí i křestní jméno,
 *      které samo o sobě nahradit nejde (jmenuje se tak i někdo z radních);
 *   2. samostatně stojící příjmení, včetně českého skloňování („Minaříkovi").
 *      Koncovky se připouštějí až od pěti písmen; u kratších by se do shody
 *      dostala cizí jména se stejným začátkem.
 *
 * `chranit` jsou jména, která se sama o sobě nahrazovat nesmějí — jinak by se
 * z odpovídajícího radního Jana Laciny stalo „J. L.".
 */
export function zanonymizuj(text, jmeno, chranit = []) {
  const casti = castiJmena(jmeno);
  if (!text || !casti.length) return text;
  const zkratka = inicialy(jmeno);
  let out = text;

  if (casti.length > 1) {
    for (const poradi of [casti, [...casti].reverse()]) {
      out = out.replace(
        new RegExp(`(?<!\\p{L})${poradi.map(escRe).join('\\s+')}\\.?(?!\\p{L})`, 'gu'),
        zkratka);
    }
  }

  const zakazane = new Set(chranit.flatMap(castiJmena).map((c) => c.toLowerCase()));
  for (const c of casti) {
    if ([...c].length < 3 || zakazane.has(c.toLowerCase())) continue;
    const koncovka = [...c].length >= 5 ? '\\p{L}{0,3}' : '';
    out = out.replace(
      new RegExp(`(?<!\\p{L})${escRe(c)}${koncovka}\\.?(?!\\p{L})`, 'gu'),
      `${[...c][0].toUpperCase()}.`);
  }
  return out;
}

/** „2024-02-26 00:00:00" i „2024-02-26" → „2024-02-26" */
const den = (s) => (/^\d{4}-\d{2}-\d{2}/.exec(s ?? '')?.[0] ?? null);

const cistyText = (s) => (s ?? '')
  .replace(/\r\n/g, '\n')
  .replace(/[ \t\u00a0]+/g, ' ')
  // Mezery na začátku a konci řádku jsou v přepisech běžné a na webu
  // by z nich byly náhodně odsazené odstavce.
  .replace(/ ?\n ?/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * Text interpelace vs. odpověď.
 * API to rozlišuje jen popiskem `type_name`; identifikátor typu je náhodný
 * hash, který se mezi instalacemi liší, takže se na něj nedá vázat.
 */
const jeOdpoved = (t) => /odpov/i.test(t?.type_name ?? '');

/** Kdo interpelaci podal — bere se z prvního textu, který není odpověď. */
function tazatel(polozka) {
  const t = (polozka.texts ?? []).find((x) => !jeOdpoved(x) && x.questioner_name);
  if (!t) return { jmeno: null, typ: null };
  return {
    jmeno: t.questioner_name?.trim() || null,
    // API píše „obcan" / „zastupitel"; cokoliv jiného raději necháme být.
    typ: t.questioner_type === 'obcan' ? 'obcan'
      : t.questioner_type === 'zastupitel' ? 'zastupitel' : null,
  };
}

/** Odpovídající — bývá jeden, ale pole připouští víc. */
const odpovida = (p) => (Array.isArray(p.responder_names) && p.responder_names.length
  ? p.responder_names.filter(Boolean)
  : [p.responder_name].filter(Boolean));

/**
 * Metadata jedné interpelace pro přehled. Bez textů — ty jsou po letech
 * zvlášť, protože celý dataset má přes deset megabajtů a do prohlížeče
 * nemá co dělat.
 */
export function prehled(p, verejni = new Set()) {
  const kdo = tazatel(p);
  const skryt = jeSkryty(kdo, verejni);
  const texty = p.texts ?? [];
  return {
    gid: p.gid,
    cislo: p.number ?? null,
    nazev: cistyText(p.name) || null,
    datum: den(p.date),
    rok: Number(p.year) || (den(p.date) ? Number(den(p.date).slice(0, 4)) : null),
    oblast: p.topic_name && p.topic_name !== 'undefined' ? p.topic_name.trim() : null,
    tazatel: skryt ? inicialy(kdo.jmeno) : kdo.jmeno,
    typ: kdo.typ,
    odpovida: odpovida(p),
    maOdpoved: texty.some(jeOdpoved),
    priloh: (p.attachments ?? []).filter((a) => a.valid !== '0' && a.deleted !== '1').length,
    termin: den(p.termin),
    zverejneno: den(p.published_when),
    jednaniUrl: p.zmc_id ? `${JEDNANI}/${p.zmc_id}` : null,
    url: p.gid ? `${BASE}/print-detail?type=inter&source=public&gid=${encodeURIComponent(p.gid)}` : null,
  };
}

/**
 * Kdo má na webu zůstat pod celým jménem.
 *
 * Nestačí se ptát „je to zastupitel?" u jedné interpelace. Portál vede třináct
 * lidí jednou jako zastupitele a jednou jako občana — kdo interpeloval před
 * zvolením nebo po skončení mandátu, má u některých záznamů typ „obcan".
 * Kdyby se rozhodovalo záznam po záznamu, měl by tentýž člověk na webu jednou
 * celé jméno a jednou iniciály. Veřejnou osobou je proto ten, kdo je jako
 * zastupitel veden kdekoliv v datech — nebo kdo na interpelace odpovídá.
 */
function jeSkryty(kdo, verejni) {
  if (!ANONYMIZOVAT_OBCANY || kdo.typ !== 'obcan' || !kdo.jmeno) return false;
  return !verejni.has(klicJmena(kdo.jmeno));
}

/** Plné znění jedné interpelace — jde do ročního souboru. */
export function detail(p, verejni = new Set()) {
  const kdo = tazatel(p);
  const skryt = jeSkryty(kdo, verejni) ? kdo.jmeno : null;
  const chranit = odpovida(p);

  return {
    gid: p.gid,
    texty: (p.texts ?? []).map((t) => ({
      druh: jeOdpoved(t) ? 'odpoved' : 'interpelace',
      kdo: skryt && t.questioner_name?.trim() === skryt
        ? inicialy(skryt) : (t.questioner_name?.trim() || null),
      kdy: den(t.questioner_time),
      text: skryt ? zanonymizuj(cistyText(t.text), skryt, chranit) : cistyText(t.text),
    })).filter((t) => t.text),
    prilohy: (p.attachments ?? [])
      .filter((a) => a.valid !== '0' && a.deleted !== '1' && a.download_url)
      .map((a) => ({
        nazev: a.name || a.file_name || 'příloha',
        url: `${BASE}${a.download_url}`,
        mime: a.mime ?? null,
        velikost: Number(a.size) || null,
      })),
  };
}

/** Rozdělí odpověď API na přehled a roční balíky plných textů. */
export function sestav(data) {
  const platne = (data ?? []).filter((p) => p?.gid && p.deleted !== '1' && p.valid !== '0');

  // Nejdřív se zjistí, kdo je veřejná osoba — teprve pak se dá rozhodovat
  // o jménech. Pořadí je podstatné: rozhoduje celý dataset, ne jeden záznam.
  const verejni = new Set();
  for (const p of platne) {
    for (const t of p.texts ?? []) {
      if (t.questioner_type === 'zastupitel' && t.questioner_name) {
        verejni.add(klicJmena(t.questioner_name));
      }
    }
    for (const r of odpovida(p)) verejni.add(klicJmena(r));
  }

  const items = platne.map((p) => prehled(p, verejni)).sort((a, b) =>
    (b.datum ?? '').localeCompare(a.datum ?? '') || (b.cislo ?? '').localeCompare(a.cislo ?? ''));

  const podleRoku = new Map();
  for (const p of platne) {
    const rok = Number(p.year) || Number(den(p.date)?.slice(0, 4));
    if (!rok) continue;
    if (!podleRoku.has(rok)) podleRoku.set(rok, []);
    podleRoku.get(rok).push(detail(p, verejni));
  }

  return { items, podleRoku, souhrn: souhrnInterpelaci(items) };
}

export function souhrnInterpelaci(items) {
  const roky = {};
  const oblasti = {};
  const tazatele = new Map();
  for (const i of items) {
    if (i.rok) {
      roky[i.rok] ??= { rok: i.rok, pocet: 0, zastupitele: 0, obcane: 0, sOdpovedi: 0 };
      roky[i.rok].pocet++;
      if (i.typ === 'zastupitel') roky[i.rok].zastupitele++;
      if (i.typ === 'obcan') roky[i.rok].obcane++;
      if (i.maOdpoved) roky[i.rok].sOdpovedi++;
    }
    if (i.oblast) oblasti[i.oblast] = (oblasti[i.oblast] ?? 0) + 1;
    if (i.tazatel) {
      const t = tazatele.get(i.tazatel) ?? { jmeno: i.tazatel, typ: i.typ, pocet: 0 };
      t.pocet++;
      tazatele.set(i.tazatel, t);
    }
  }
  return {
    celkem: items.length,
    zastupitele: items.filter((i) => i.typ === 'zastupitel').length,
    obcane: items.filter((i) => i.typ === 'obcan').length,
    sOdpovedi: items.filter((i) => i.maOdpoved).length,
    bezOdpovedi: items.filter((i) => !i.maOdpoved).length,
    tazatelu: tazatele.size,
    roky: Object.values(roky).sort((a, b) => b.rok - a.rok),
    oblasti: Object.entries(oblasti).sort((a, b) => b[1] - a[1]).map(([nazev, pocet]) => ({ nazev, pocet })),
    nejaktivnejsi: [...tazatele.values()].sort((a, b) => b.pocet - a.pocet).slice(0, 20),
  };
}

/** Kontroly, které mají spadnout dřív, než se na web dostane rozbitý dataset. */
export function zkontroluj({ items, podleRoku }) {
  const potize = [];
  if (!items.length) return ['Dataset interpelací je prázdný.'];
  const bezCisla = items.filter((i) => !i.cislo).length;
  if (bezCisla > items.length * 0.1) potize.push(`${bezCisla} interpelací bez čísla.`);
  const bezData = items.filter((i) => !i.datum).length;
  if (bezData) potize.push(`${bezData} interpelací bez data.`);
  // Když se rozbije čtení textů, tohle je jediné, co si toho všimne:
  // přehled se naplní, jen budou všechny „bez tazatele".
  if (items.length > 50 && items.every((i) => !i.tazatel)) {
    potize.push('Ani u jedné interpelace není tazatel — rozbité čtení textů.');
  }
  if (items.length > 50 && items.every((i) => !i.maOdpoved)) {
    potize.push('Ani jedna interpelace nemá odpověď — rozbité rozpoznání typu textu.');
  }
  const roky = [...podleRoku.keys()];
  if (roky.length < 2) potize.push(`Texty jen za ${roky.length} rok(ů) — API vrátilo jen aktuální rok?`);
  const duplicity = items.length - new Set(items.map((i) => i.gid)).size;
  if (duplicity) potize.push(`${duplicity} duplicitních gid.`);
  return potize;
}
