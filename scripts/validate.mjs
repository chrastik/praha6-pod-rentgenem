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

for (const k of kontroly) {
  console.log(`${k.ok === null ? '·' : k.ok ? '✓' : '✗'} ${k.msg}`);
}

const selhalo = kontroly.filter((k) => k.ok === false);
if (selhalo.length) {
  console.error(`\n${selhalo.length} kontrol selhalo.`);
  process.exit(1);
}
console.log('\nVše v pořádku.');
