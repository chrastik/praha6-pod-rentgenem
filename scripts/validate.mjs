#!/usr/bin/env node
/** Kontrola integrity před commitem dat. Nekonzistentní data se nemají publikovat. */
import { readDataset } from './lib/util.mjs';

const kontroly = [];
const chyba = (msg) => kontroly.push({ ok: false, msg });
const ok = (msg) => kontroly.push({ ok: true, msg });

const usneseni = await readDataset('usneseni');
if (!usneseni) chyba('chybí usneseni.json');
else {
  const items = usneseni.items;
  items.length > 20_000 ? ok(`usnesení: ${items.length}`) : chyba(`usnesení jen ${items.length}, čekáno >20 000`);
  const bezData = items.filter((u) => !u.datum).length;
  bezData === 0 ? ok('všechna usnesení mají datum') : chyba(`${bezData} usnesení bez data`);
  const duplicity = items.length - new Set(items.map((u) => u.id)).size;
  duplicity === 0 ? ok('žádné duplicitní id') : chyba(`${duplicity} duplicitních id`);
  const nejnovejsi = items[0]?.datum;
  const stariDni = (Date.now() - new Date(nejnovejsi)) / 864e5;
  stariDni < 120
    ? ok(`nejnovější usnesení ${nejnovejsi}`)
    : chyba(`nejnovější usnesení je ${Math.round(stariDni)} dní staré (${nejnovejsi}) — sync možná nefunguje`);
}

for (const name of ['smlouvy', 'faktury', 'rozpocet', 'zapisy', 'deska']) {
  const ds = await readDataset(name);
  if (!ds) { kontroly.push({ ok: null, msg: `${name}: zatím nenaplněno` }); continue; }
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
