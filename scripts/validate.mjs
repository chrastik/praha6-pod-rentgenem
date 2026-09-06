#!/usr/bin/env node
/** Kontrola integrity před commitem dat. Nekonzistentní data se nemají publikovat. */
import { readDataset } from './lib/util.mjs';

const kontroly = [];
const chyba = (msg) => kontroly.push({ ok: false, msg });
const ok = (msg) => kontroly.push({ ok: true, msg });
const info = (msg) => kontroly.push({ ok: null, msg });

const usneseni = await readDataset('usneseni');
if (!usneseni) {
  chyba('chybí usneseni.json');
} else {
  const items = usneseni.items;

  // Očekávaný objem závisí na tom, které zdroje jsou načtené: archiv z webu
  // (2002–2022) nese ~23 000 usnesení, MARBES (2022+) řádově tisíce.
  const zWebu = (await readDataset('usneseni-web'))?.items?.length ?? 0;
  const zMarbesu = (await readDataset('usneseni-marbes'))?.items?.length ?? 0;
  const ocekavano = (zWebu > 0 ? 20_000 : 0) + (zMarbesu > 0 ? 1_000 : 0);

  if (ocekavano === 0) {
    chyba('není načtený ani jeden zdroj usnesení');
  } else if (items.length >= ocekavano) {
    ok(`usnesení: ${items.length} (web ${zWebu}, MARBES ${zMarbesu})`);
  } else {
    chyba(`usnesení jen ${items.length}, čekáno >${ocekavano} (web ${zWebu}, MARBES ${zMarbesu})`);
  }

  const bezData = items.filter((u) => !u.datum).length;
  bezData === 0 ? ok('všechna usnesení mají datum') : chyba(`${bezData} usnesení bez data`);

  const duplicity = items.length - new Set(items.map((u) => u.id)).size;
  duplicity === 0 ? ok('žádné duplicitní id') : chyba(`${duplicity} duplicitních id`);

  // Web radnice od prosince 2023 publikuje jen zlomek usnesení. Dokud není
  // načtený MARBES, je stará poslední položka očekávaný stav, ne porucha.
  const nejnovejsi = items[0]?.datum;
  const stariDni = (Date.now() - new Date(nejnovejsi)) / 864e5;
  const marbes = await readDataset('usneseni-marbes');

  if ((marbes?.items?.length ?? 0) === 0) {
    info(`nejnovější usnesení ${nejnovejsi} — MARBES zatím nenačten, kontrola čerstvosti se přeskakuje`);
  } else if (stariDni < 120) {
    ok(`nejnovější usnesení ${nejnovejsi}`);
  } else {
    chyba(`nejnovější usnesení je ${Math.round(stariDni)} dní staré (${nejnovejsi}) — sync možná nefunguje`);
  }
}

for (const name of ['smlouvy', 'faktury', 'rozpocet', 'zapisy', 'deska']) {
  const ds = await readDataset(name);
  if (!ds) { info(`${name}: zatím nenaplněno`); continue; }
  ok(`${name}: ${ds.pocet}`);
}

// Zakázky: hlídá se, že se profil pořád čte celý a že párování se smlouvami
// nezmizelo. Obojí se umí rozbít tiše — scraper doběhne, jen vrátí prázdno.
const zakazky = await readDataset('zakazky');
if (!zakazky) {
  info('zakazky: zatím nenaplněno');
} else {
  zakazky.pocet >= 400
    ? ok(`zakázky: ${zakazky.pocet}`)
    : chyba(`zakázek jen ${zakazky.pocet}, profil jich má přes 400 — asi se nepropsal filtr archivu`);

  const p = zakazky.pokryti ?? {};
  p.sDodavatelem > 0
    ? ok(`zakázky s vybraným dodavatelem: ${p.sDodavatelem} z ${p.zadane} zadaných`)
    : chyba('ani jedna zakázka nemá vybraného dodavatele — rozbité čtení detailu');

  const prehled = await readDataset('zakazky-prehled');
  if (!prehled) {
    chyba('zakazky.json existuje, ale zakazky-prehled.json ne — neproběhl build-index');
  } else if ((prehled.souhrn?.sparovanych ?? 0) === 0) {
    chyba('žádná zakázka se nespárovala se smlouvou v registru');
  } else {
    ok(`zakázek spárovaných se smlouvami: ${prehled.souhrn.sparovanych}`);
  }
}

// Interpelace: portál ukazuje jen aktuální rok, takže dataset za jediný rok
// je typický příznak toho, že se čte HTML místo API.
const interpelace = await readDataset('interpelace');
if (!interpelace) {
  info('interpelace: zatím nenaplněno');
} else {
  const s = interpelace.souhrn ?? {};
  interpelace.pocet >= 500
    ? ok(`interpelace: ${interpelace.pocet} za ${s.roky?.length ?? 0} let`)
    : chyba(`interpelací jen ${interpelace.pocet} — portál jich má přes osm set`);
  (s.roky?.length ?? 0) >= 5
    ? ok(`ročníků interpelací: ${s.roky.length}`)
    : chyba(`interpelace jen za ${s.roky?.length ?? 0} rok(ů) — čte se jen aktuální ročník?`);
  s.tazatelu > 0
    ? ok(`různých tazatelů: ${s.tazatelu}`)
    : chyba('u žádné interpelace není tazatel');
}

for (const k of kontroly) {
  console.log(`${k.ok === null ? '·' : k.ok ? '✓' : '✗'} ${k.msg}`);
}

const selhalo = kontroly.filter((k) => k.ok === false);
if (selhalo.length) {
  console.error(`\n${selhalo.length} kontrol selhalo.`);
  process.exit(1);
}
console.log('\nVše v pořádku.');
