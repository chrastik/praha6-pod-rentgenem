/**
 * Testy čtení profilu zadavatele a párování se smlouvami.
 *
 * Případy nejsou vymyšlené: každý je zjednodušený otisk něčeho, co je
 * v opravdových datech a co by bez ošetření dalo na webu špatné číslo.
 */
import { readFile } from 'node:fs/promises';
import { parseSeznam, parseDetail, normalizujKod, oddelKod, castka, datum } from '../scripts/lib/ezak.mjs';
import { cenovaOsa, kodyVTextu, sparuj, zkontroluj } from '../scripts/lib/zakazky.mjs';

let ok = true;
const zkus = (popis, skut, ocek) => {
  const p = JSON.stringify(skut) === JSON.stringify(ocek);
  if (!p) ok = false;
  console.log((p ? '  ✓ ' : '  ✗ ') + popis
    + (p ? '' : `\n      dostal jsem ${JSON.stringify(skut)}, čekal ${JSON.stringify(ocek)}`));
};

const seznamHtml = await readFile(new URL('./fixtures/ezak-seznam.html', import.meta.url), 'utf8');
const detailHtml = await readFile(new URL('./fixtures/ezak-detail-2.html', import.meta.url), 'utf8');

console.log('Drobnosti');
zkus('částka s nezlomitelnými mezerami', castka('23 843 100,00'), 23843100);
zkus('částka s jednotkou', castka('5 000 000 Kč bez DPH'), 5000000);
zkus('„neuvedena" není nula', castka('neuvedena'), null);
zkus('záporná částka dodatku', castka('-1 958 420,60'), -1958420.6);
zkus('datum z termínu s časem', datum('23.06.2022 10:00'), '2022-06-23');

console.log('\nEvidenční číslo zakázky');
zkus('základní tvar', normalizujKod('VŘ/22/2022'), 'VŘ/22/2022');
zkus('bez háčku a s mezerou místo lomítka', normalizujKod('VR 26/2022'), 'VŘ/26/2022');
zkus('vedoucí nula v pořadovém čísle se srovná', normalizujKod('VZ/08/2018'), 'VZ/8/2018');
// Ne každá zakázka má číslo ve tvaru VŘ/x/rok — tahle jich má na profilu 15.
zkus('cizí tvar čísla není kód', normalizujKod('04/19/JŘBU'), null);
zkus('prefix PM se pozná dřív než samotné P', normalizujKod('PM/04/2026'), 'PM/4/2026');
zkus('kód se odřízne i když je ze dvou slov',
  oddelKod('VR 26/2022 - Výstavba půdních bytů'), { kod: 'VŘ/26/2022', nazev: 'Výstavba půdních bytů' });
zkus('název bez kódu zůstane celý',
  oddelKod('Seniorské centrum Šatovka'), { kod: null, nazev: 'Seniorské centrum Šatovka' });

console.log('\nSeznam zakázek');
const seznam = parseSeznam(seznamHtml);
zkus('zakázka je na dvou řádcích, přesto se načte i s daty',
  seznam.polozky.map((p) => [p.dbid, p.kod, p.faze]),
  [[208, 'VŘ/22/2022', 'Zadáno'], [207, 'VŘ/26/2022', 'Zrušeno'], [2, null, 'Zadáno']]);
// Pager má „&amp;page=", onclick „&page=". Kdo hledá jen [?&]page=, stáhne první stránku.
zkus('počet stránek se přečte i z odkazů s &amp;', seznam.maxStranka, 32);
zkus('entity v názvu se rozbalí', seznam.polozky[2].nazev, 'Seniorské centrum Šatovka v Šáreckém údolí');

console.log('\nDetail zakázky');
const d = parseDetail(detailHtml, 2);
zkus('nadpis sekce nepřebije popisek „Název:"', d.nazev, 'Seniorské centrum Šatovka v Šáreckém údolí, Praha 6');
zkus('evidenční číslo se uloží i když z něj nejde kód', d.evidencni, '04/19/JŘBU');
zkus('fáze bez poznámky o archivu', d.faze, 'Zadáno');
zkus('druh řízení se čte i pod popiskem „Druh řízení"', d.postup, 'jednací řízení bez uveřejnění');
zkus('předpokládaná hodnota „neuvedena" je null', d.predpokladanaHodnota, null);
zkus('zadavatel', [d.zadavatel.nazev, d.zadavatel.ico], ['Městská část Praha 6', '00063703']);
zkus('smluvní cena vybraného dodavatele', d.dodavatele[0].cenaBezDph, 23843100);
zkus('datum uzavření smlouvy', d.datumSmlouvy, '2020-01-07');
zkus('účastník bez uvedené nabídky nemá vymyšlenou cenu', d.ucastnici[0].nabidkaBezDph, null);
zkus('tabulka uhrazených cen se načte i když je vyplněná nulami',
  d.uhrazeno, [{ rok: 2020, bezDph: 0, sDph: 0 }, { rok: 2021, bezDph: 0, sDph: 0 }]);

console.log('\nKódy zakázek ve smlouvách');
zkus('kód v předmětu smlouvy', kodyVTextu('Smlouva o dílo č. VZ/17/2023 - ZŠ Kocínka'), ['VZ/17/2023']);
zkus('kód v dodatku', kodyVTextu('Dodatek č. 1 ke Smlouvě o dílo č. VŘ/22/2022'), ['VŘ/22/2022']);
zkus('text bez kódu', kodyVTextu('Objednávka kancelářských potřeb'), []);
// Profil používá i prefixy PM a P; bez nich by se část zakázek nikdy nespárovala.
zkus('kód s prefixem PM', kodyVTextu('Na Dračkách 34 oprava bytu č. 1 podle VŘ PM/06/2024'), ['PM/6/2024']);
zkus('kód s prefixem P', kodyVTextu('Smlouva o dílo P/150/2021 — úklid'), ['P/150/2021']);
zkus('datum se nesplete s kódem', kodyVTextu('platba za 3/2024 a 12/2025'), []);

console.log('\nVýklad dodatků — místo, kde se dá nejsnáz vyrobit nesmysl');
const sml = (predmet, castkaBezDph, datumS) => ({ predmet, castkaBezDph, datum: datumS, mena: 'CZK' });

// VZ/8/2018, Dejvická 184/4: každý dodatek uvádí novou CELKOVOU cenu.
const celkova = cenovaOsa([
  sml('Smlouva o dílo č. VZ/8/2018', 92215548.38, '2019-02-14'),
  sml('Dodatek č. 1 ke smlouvě o dílo č. VZ/8/2018', 92977367.88, '2019-11-27'),
  sml('Dodatek č. 6 ke Smlouvě o dílo č. VZ/8/2018', 108430780.88, '2021-06-18'),
]);
zkus('dodatky s celkovou cenou: konečná je poslední, ne součet', celkova.konecna, 108430780.88);
zkus('a změna je +18 %, ne +118 %', Math.round(celkova.zmena * 100), 18);
zkus('výklad je označen', celkova.vyklad, 'celkova');

// VZ/17/2023, ZŠ Kocínka: dodatky uvádějí PŘÍRŮSTKY, jeden je záporný.
const prirustky = cenovaOsa([
  sml('Smlouva o dílo č. VZ/17/2023 - ZŠ Kocínka', 144008962.21, '2024-11-11'),
  sml('Dodatek č. 1 ke Smlouvě o dílo č. VZ/17/2023', 530119.3, '2025-03-10'),
  sml('Dodatek č. 3 ke Smlouvě o dílo č. VZ/17/2023', -1958420.6, '2025-07-09'),
]);
zkus('dodatky s přírůstky se přičtou k základu', Math.round(prirustky.konecna), 142580661);
zkus('záporný dodatek cenu snižuje', prirustky.zmena < 0, true);
zkus('výklad je označen', prirustky.vyklad, 'prirustkova');

// Kdyby zakázka měla obojí, nedá se to poctivě spočítat.
const sporna = cenovaOsa([
  sml('Smlouva o dílo č. VŘ/9/2020', 10000000, '2020-01-01'),
  sml('Dodatek č. 1 ke smlouvě VŘ/9/2020', 11000000, '2020-06-01'),
  sml('Dodatek č. 2 ke smlouvě VŘ/9/2020', 250000, '2020-09-01'),
]);
zkus('rozporná zakázka nedostane vymyšlenou konečnou cenu', sporna.konecna, null);
zkus('a je označena jako nejistá', sporna.vyklad, 'nejiste');

// VZ/1/2024: „Dodatek č. 1" je v registru dvakrát jako dvě samostatné smlouvy.
const dvakrat = cenovaOsa([
  sml('Smlouva o dílo č. VZ/1/2024', 113593314, '2025-04-25'),
  sml('Dodatek č. 1 ke smlouvě o dílo č. VZ/1/2024', 1854489.43, '2026-02-03'),
  sml('Dodatek č. 1 ke smlouvě o dílo č. VZ/1/2024', 1854489.43, '2026-02-03'),
  sml('Dodatek č. 2 ke smlouvě o dílo č. VZ/1/2024', 1668098.3, '2026-07-15'),
]);
zkus('dvakrát uveřejněný dodatek se započítá jednou',
  Math.round(dvakrat.konecna), Math.round(113593314 + 1854489.43 + 1668098.3));
zkus('ale z časové osy nezmizí', dvakrat.kroky.length, 4);
zkus('a je označený jako duplicita', dvakrat.duplicit, 1);
zkus('do počtu dodatků se nepočítá', dvakrat.dodatku, 2);

const bezDodatku = cenovaOsa([sml('Smlouva o dílo č. VŘ/1/2021', 500000, '2021-03-01')]);
zkus('zakázka bez dodatků má konečnou cenu rovnou základu', bezDodatku.konecna, 500000);
zkus('a žádnou změnu', bezDodatku.zmena, null);
zkus('dodatek bez uvedené částky nezmění cenu',
  cenovaOsa([sml('Smlouva č. VŘ/2/2021', 100000, '2021-01-01'),
    { predmet: 'Dodatek č. 1 ke smlouvě VŘ/2/2021', castkaBezDph: null, datum: '2021-05-01' }]).konecna, 100000);

console.log('\nPárování a souhrn');
const zakazky = [
  { dbid: 1, kod: 'VZ/8/2018', nazev: 'Dejvická', faze: 'Zadáno', url: 'x', zahajeni: '2018-05-01',
    dodavatele: [{ nazev: 'Firma a.s.', ico: '11111111', cenaBezDph: 92215548.38 }],
    ucastnici: [{ nazev: 'Firma a.s.', ico: '11111111', nabidkaBezDph: 92215548.38 }],
    uhrazeno: [{ rok: 2020, bezDph: 0 }] },
  { dbid: 2, kod: 'VŘ/99/2099', nazev: 'Nespárovaná', faze: 'Zrušeno', url: 'y', zahajeni: '2099-01-01',
    dodavatele: [], ucastnici: [], uhrazeno: [] },
];
const v = sparuj(zakazky, [
  sml('Smlouva o dílo č. VZ/8/2018', 92215548.38, '2019-02-14'),
  sml('Dodatek č. 6 ke Smlouvě o dílo č. VZ/8/2018', 108430780.88, '2021-06-18'),
  sml('Objednávka bez kódu', 1000, '2020-01-01'),
]);
zkus('smlouvy se přiřadily jen k té správné zakázce', v.items.map((z) => z.smluv), [2, 0]);
zkus('spárovaných zakázek', v.souhrn.sparovanych, 1);
zkus('zrušená zakázka se počítá zvlášť', v.souhrn.zrusenych, 1);
zkus('agregát bere jen zakázky, kde je základ i konečná cena', v.souhrn.dodatky.zakazek, 1);
zkus('agregovaná změna +18 %', Math.round(v.souhrn.dodatky.zmena * 100), 18);
zkus('nulami vyplněná tabulka se nepočítá jako zveřejněná cena', v.souhrn.uhrazenoVyplneno, 0);
zkus('ale eviduje se, že tabulka existuje', v.souhrn.uhrazenoTabulka, 1);
zkus('cena z profilu sedí se smlouvou, takže žádný rozpor', v.items[0].rozporSProfilem, false);
zkus('zdravý dataset projde kontrolou', zkontroluj(v).length, 0);
zkus('prázdný dataset se pozná', zkontroluj({ items: [], souhrn: {} }).length > 0, true);

console.log(ok ? '\nVŠECHNY KONTROLY PROŠLY ✓' : '\nNĚCO NESEDÍ ✗');
process.exit(ok ? 0 : 1);
