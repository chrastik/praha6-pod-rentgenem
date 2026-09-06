#!/usr/bin/env node
/**
 * Připraví data pro web: usnesení rozdělená po letech (aby prohlížeč netahal
 * všechno najednou) a kompaktní invertovaný fulltextový index.
 *
 * Praha 8 hledá prostým includes() nad 8MB JSONem. U 23 000 usnesení s plným
 * textem by to nebylo použitelné, proto vlastní index — pořád bez závislostí.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { readItems, readDataset, writeDataset, norm, DATA_DIR } from './lib/util.mjs';
import { sestav as sestavDotace, zkontroluj as zkontrolujDotace } from './lib/dotace.mjs';
import { sparuj as sparujZakazky, zkontroluj as zkontrolujZakazky } from './lib/zakazky.mjs';

const OUT = path.join(DATA_DIR, 'web');
await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'usneseni'), { recursive: true });
await mkdir(path.join(OUT, 'index'), { recursive: true });

const usneseni = await readItems('usneseni');
if (!usneseni.length) throw new Error('Chybí data/usneseni.json — spusť nejdřív merge.');

// ---- 1) usnesení po letech --------------------------------------------------
const poRocich = new Map();
for (const u of usneseni) {
  if (!poRocich.has(u.rok)) poRocich.set(u.rok, []);
  poRocich.get(u.rok).push(u);
}
for (const [rok, items] of poRocich) {
  await writeFile(path.join(OUT, 'usneseni', `${rok}.json`), JSON.stringify(items), 'utf8');
}
console.log(`  usnesení rozděleno do ${poRocich.size} ročních souborů`);

// ---- 2) fulltextový index ---------------------------------------------------
const STOP = new Set(norm(
  'a i o u v k s z na do od po pro při za se si je jsou byl byla bylo být ' +
  'the and ktery ktera ktere jako tak tim tom ten ta to teto tohoto ' +
  'mestske casti praha usneseni rada zastupitelstvo schvaluje uklada bere vedomi',
).split(' '));

const docs = [];
const index = new Map();

usneseni.forEach((u) => {
  const i = docs.length;
  docs.push({
    i, id: u.id, o: u.organ, d: u.datum, c: u.cislo,
    n: u.nazev?.slice(0, 240) ?? '', t: u.temata ?? [], u: u.zdrojUrl,
  });
  const tokeny = new Set(
    norm(`${u.nazev ?? ''} ${u.cislo ?? ''} ${(u.text ?? '').slice(0, 4000)}`)
      .split(/[^0-9a-z/]+/)
      .filter((t) => t.length >= 3 && t.length <= 28 && !STOP.has(t)),
  );
  for (const t of tokeny) {
    let bucket = index.get(t);
    if (!bucket) index.set(t, (bucket = []));
    bucket.push(i);
  }
});

// tokeny přítomné skoro všude nenesou informaci a jen nafukují index
const limit = Math.floor(docs.length * 0.35);
const orezany = {};
let vyhozeno = 0;
for (const [t, ids] of index) {
  if (ids.length > limit) { vyhozeno++; continue; }
  orezany[t] = ids;
}

await writeFile(path.join(OUT, 'index', 'docs.json'), JSON.stringify(docs), 'utf8');
await writeFile(path.join(OUT, 'index', 'tokens.json'), JSON.stringify(orezany), 'utf8');
console.log(`  index: ${docs.length} dokumentů, ${Object.keys(orezany).length} tokenů (${vyhozeno} příliš častých vyhozeno)`);

// ---- 3) dotace odvozené z registru smluv -----------------------------------
// Není to samostatný zdroj — dotační smlouvy se vytáhnou z už staženého
// registru. Proto se to přepočítá při každém buildu a nepotřebuje to vlastní
// synchronizaci ani workflow.
const smlouvyProDotace = await readItems('smlouvy');
if (smlouvyProDotace.length) {
  const dotace = sestavDotace(smlouvyProDotace);
  const potize = zkontrolujDotace(dotace);
  if (potize.length) {
    console.warn('  ! dotace neprošly kontrolou, dataset nepřepisuji:');
    for (const x of potize) console.warn(`     ✗ ${x}`);
  } else {
    await writeDataset('dotace', dotace.items, {
      prijemci: dotace.prijemci,
      oblasti: dotace.oblasti,
      souhrn: dotace.souhrn,
      poznamka: 'Odvozeno z registru smluv MČ Praha 6. Oblast je odhad z předmětu '
        + 'smlouvy a názvu příjemce, ne údaj z registru. Dotace pod 50 000 Kč se '
        + 'nemusí do registru zveřejňovat, takže seznam nemusí být úplný.',
    });
    const s = dotace.souhrn;
    console.log(`  dotace: ${s.rozdano.pocet} rozdaných za `
      + `${Math.round(s.rozdano.castka).toLocaleString('cs-CZ')} Kč, ${s.prijemcu} příjemců`
      + ` (přijatých ${s.prijato.pocet})`);
  }
} else {
  console.warn('  ! chybí data/smlouvy.json, dotace se nepřepočítaly');
}

// ---- 4) zakázky spárované se smlouvami -------------------------------------
// Profil zadavatele se stahuje zvlášť (sync:zakazky), ale spojení se smlouvami
// se musí přepočítat pokaždé — registr smluv se mění denně a s ním i cenová
// osa každé zakázky.
const zakazkyRaw = await readItems('zakazky');
if (zakazkyRaw.length) {
  const smlouvyProZakazky = await readItems('smlouvy');
  const vysledek = sparujZakazky(zakazkyRaw, smlouvyProZakazky);
  const potize = zkontrolujZakazky(vysledek);
  if (potize.length) {
    console.warn('  ! zakázky neprošly kontrolou, dataset nepřepisuji:');
    for (const x of potize) console.warn(`     ✗ ${x}`);
  } else {
    await writeDataset('zakazky-prehled', vysledek.items, {
      souhrn: vysledek.souhrn,
      poznamka: 'Zakázky z profilu zadavatele MČ Praha 6 spojené se smlouvami '
        + 'v registru smluv podle evidenčního čísla. Konečná cena je odvozená '
        + 'z dodatků a u části zakázek ji nelze určit — registr nerozlišuje, '
        + 'jestli dodatek uvádí novou celkovou cenu, nebo jen přírůstek.',
    });
    const s6 = vysledek.souhrn;
    console.log(`  zakázky: ${s6.celkem} (zadaných ${s6.zadanych}, zrušených ${s6.zrusenych}), `
      + `spárováno se smlouvami ${s6.sparovanych}, smluvní cena `
      + `${s6.smluvniCena.toLocaleString('cs-CZ')} Kč`);
  }
} else {
  console.warn('  ! chybí data/zakazky.json, sekce zakázek se nepřepočítala');
}

// ---- 5) manifest pro frontend ----------------------------------------------
const manifest = {
  aktualizovano: new Date().toISOString(),
  usneseni: {
    pocet: usneseni.length,
    roky: [...poRocich.keys()].sort((a, b) => b - a),
    organy: (await readDataset('usneseni'))?.organy ?? {},
    rozsah: (await readDataset('usneseni'))?.rozsah ?? {},
  },
  datasety: {},
};
for (const name of ['zapisy', 'smlouvy', 'faktury', 'rozpocet', 'deska', 'scitani',
  'smlouvy-organizace', 'dotace', 'zakazky-prehled', 'interpelace']) {
  const ds = await readDataset(name);
  if (ds) manifest.datasety[name] = { pocet: ds.pocet, aktualizovano: ds.aktualizovano };
}
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('  manifest.json hotov');
