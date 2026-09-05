/**
 * Testy odvození dotací z registru smluv. Všechno jsou čisté funkce, takže
 * se testuje na vymyšlených smlouvách bez jediného stažení.
 *
 * Případy tu nejsou náhodné — každý odpovídá něčemu, co v opravdových datech
 * je a co by bez ošetření zkreslilo čísla na webu.
 */
import {
  sestav, zkontroluj, vycisti, jeDotace, urciOblast, urciProjekt, urciProgram,
} from '../scripts/lib/dotace.mjs';

let ok = true;
const zkus = (popis, skut, ocek) => {
  const p = JSON.stringify(skut) === JSON.stringify(ocek);
  if (!p) ok = false;
  console.log((p ? '  ✓ ' : '  ✗ ') + popis
    + (p ? '' : `\n      dostal jsem ${JSON.stringify(skut)}, čekal ${JSON.stringify(ocek)}`));
};

const smlouva = (o) => ({
  id: String(Math.random()).slice(2, 10),
  predmet: 'Smlouva o poskytnutí dotace',
  protistrana: 'Spolek Testovací, z.s.',
  protistranaIco: '11111111',
  castkaBezDph: 100000,
  datum: '2024-05-01',
  zverejneno: '2024-05-10',
  url: 'https://smlouvy.gov.cz/smlouva/1',
  ...o,
});

console.log('Čištění textu a rozpoznání dotace');
zkus('dvojitě zakódovaná uvozovka se rozbalí až na znak',
  vycisti('projekt &amp;quot;Peer pracovník&amp;quot;'), 'projekt "Peer pracovník"');
zkus('jednoduchý ampersand v názvu firmy', vycisti('Aliaves &amp; Co., a.s.'), 'Aliaves & Co., a.s.');
zkus('normální text zůstane beze změny', vycisti('  Dotace  na   projekt '), 'Dotace na projekt');
zkus('dotace se pozná', jeDotace('Smlouva o poskytnutí dotace'), true);
zkus('smlouva o dílo se nepozná jako dotace', jeDotace('Smlouva o dílo — oprava střechy'), false);

console.log('\nOblast');
zkus('hospic jde do sociální, ne do seniorů zvlášť',
  urciOblast('Podpora hospicové péče').kod, 'socialni');
zkus('oblast se pozná i z názvu příjemce',
  urciOblast('Smlouva o poskytnutí dotace', 'Trenéři ve škole, z.s.').kod, 'sport');
zkus('památková dotace má přednost před obnovou budovy',
  urciOblast('Veřejnoprávní smlouva o poskytnutí památkové dotace - kostel sv. Matěje').kod, 'pamatky');
zkus('bez klíčového slova zůstane nezařazeno',
  urciOblast('Smlouva o poskytnutí dotace').kod, 'ostatni');

console.log('\nProjekt a program');
zkus('projekt v rovných uvozovkách',
  urciProjekt('Smlouva o poskytnutí dotace na projekt "Terénní program Prahy 6"'), 'Terénní program Prahy 6');
zkus('projekt v českých uvozovkách',
  urciProjekt('Dotace na projekt „Dílna Eliáš“'), 'Dílna Eliáš');
zkus('projekt za pomlčkami u strukturovaného předmětu',
  urciProjekt('Šestka kulturní II. - 2026 - Dotace - Spolek Povaleč - NOC 6'), 'NOC 6');
zkus('holý předmět nevyrobí smyšlený projekt',
  urciProjekt('Smlouva o poskytnutí dotace'), null);
zkus('program se pozná', urciProgram('Šestka kulturní II. - 2026 - Dotace - X'), 'Šestka kulturní');
zkus('neznámý program je null', urciProgram('Smlouva o poskytnutí dotace'), null);

console.log('\nSměr peněz — nejdůležitější část');
const vzorek = [
  smlouva({ predmet: 'Smlouva o poskytnutí dotace na projekt "Poradna"', castkaBezDph: 50000 }),
  // publikovalo hlavní město, protistranou je sama Praha 6 → peníze tečou DO Prahy 6
  smlouva({ predmet: 'smlouva o poskytnutí dotace: Grantový program HMP pro MČ',
    protistrana: 'Městská část Praha 6', protistranaIco: '00063703', castkaBezDph: 150000 }),
  // Letiště Praha financuje dotační program — taky peníze DO Prahy 6
  smlouva({ predmet: 'Darovací smlouva za účelem realizace dotačního programu OTEVŘENÝ SVĚT 2026',
    protistrana: 'Letiště Praha, a. s.', protistranaIco: '28244532', castkaBezDph: 4000000 }),
  smlouva({ predmet: 'Dotace - Sokol - oprava hřiště', protistrana: 'TJ Sokol, z.s.',
    protistranaIco: '22222222', castkaBezDph: 300000 }),
];
const v = sestav(vzorek);
zkus('rozdané se spočítaly správně', v.souhrn.rozdano.pocet, 2);
zkus('přijaté se spočítaly správně', v.souhrn.prijato.pocet, 2);
zkus('do rozdaných se nezapočítal dar od Letiště', v.souhrn.rozdano.castka, 350000);
zkus('Letiště není mezi příjemci dotací',
  v.prijemci.some((p) => /Leti/.test(p.nazev)), false);
zkus('městská část není mezi příjemci vlastních dotací',
  v.prijemci.some((p) => p.ico === '00063703'), false);

console.log('\nSoučty u příjemců');
const opakovany = sestav([
  smlouva({ protistrana: 'Spolek A', protistranaIco: '33333333', castkaBezDph: 10000, zverejneno: '2020-01-01' }),
  smlouva({ protistrana: 'Spolek A', protistranaIco: '33333333', castkaBezDph: 25000, zverejneno: '2024-06-01' }),
  smlouva({ protistrana: 'Spolek A', protistranaIco: '33333333', castkaBezDph: null, zverejneno: '2022-03-01' }),
]);
const a = opakovany.prijemci.find((p) => p.ico === '33333333');
zkus('tři dotace jednoho příjemce se slily do jednoho profilu', a.pocet, 3);
zkus('součet přeskočí smlouvu bez uvedené částky', a.castka, 35000);
zkus('počet smluv s částkou se eviduje zvlášť', a.sCastkou, 2);
zkus('první a poslední datum', [a.prvni, a.posledni], ['2020-01-01', '2024-06-01']);

console.log('\nPřevzetí oblasti od příjemce');
const prevzeti = sestav([
  smlouva({ protistrana: 'Cesta domů, z.ú.', protistranaIco: '44444444', predmet: 'Dotace na hospicovou péči' }),
  smlouva({ protistrana: 'Cesta domů, z.ú.', protistranaIco: '44444444', predmet: 'Smlouva o poskytnutí dotace' }),
  smlouva({ protistrana: 'Různorodý spolek', protistranaIco: '55555555', predmet: 'Dotace na sportovní hřiště' }),
  smlouva({ protistrana: 'Různorodý spolek', protistranaIco: '55555555', predmet: 'Dotace na divadelní festival' }),
  smlouva({ protistrana: 'Různorodý spolek', protistranaIco: '55555555', predmet: 'Smlouva o poskytnutí dotace' }),
]);
const cesta = prevzeti.items.filter((x) => x.prijemceIco === '44444444');
zkus('jednoznačný příjemce předá oblast i neurčité dotaci',
  cesta.every((x) => x.oblast === 'socialni'), true);
zkus('a je označeno, že to není z předmětu',
  cesta.some((x) => x.oblastZPrijemce === true), true);
const ruzny = prevzeti.items.filter((x) => x.prijemceIco === '55555555' && x.predmet === 'Smlouva o poskytnutí dotace');
zkus('u příjemce s víc obory se oblast nehádá', ruzny[0].oblast, 'ostatni');

console.log('\nKontroly datasetu');
zkus('zdravý dataset projde', zkontroluj(v).length, 0);
zkus('prázdný dataset se pozná', zkontroluj(sestav([])).length > 0, true);

console.log(ok ? '\nVŠECHNY KONTROLY PROŠLY ✓' : '\nNĚCO NESEDÍ ✗');
process.exit(ok ? 0 : 1);
