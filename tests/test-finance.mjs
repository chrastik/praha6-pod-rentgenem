/**
 * Testy odvození úplnosti faktur. Čisté funkce, žádné stahování.
 *
 * Případy odpovídají tomu, co v datech opravdu je: čtyři plné ročníky, rok 2025
 * useknutý koncem ledna, a probíhající rok, který je neúplný z podstaty a nesmí
 * se hlásit jako porucha.
 */
import { pokrytiFaktur, stariDni, vyjmenuj } from '../scripts/lib/finance.mjs';

let ok = true;
const zkus = (popis, skut, ocek) => {
  const p = JSON.stringify(skut) === JSON.stringify(ocek);
  if (!p) ok = false;
  console.log((p ? '  ✓ ' : '  ✗ ') + popis
    + (p ? '' : `\n      dostal jsem ${JSON.stringify(skut)}, čekal ${JSON.stringify(ocek)}`));
};

const DNES = new Date('2026-09-07');

/** Vyrobí `naMesic` faktur v každém z uvedených měsíců. */
const rocnik = (rok, mesice, naMesic = 350, castka = 100000) =>
  mesice.flatMap((m) => Array.from({ length: naMesic }, (_, i) => ({
    datum: `${rok}-${String(m).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
    vydaj: castka,
  })));

const rokZdroje = (rok, vydaje, rozpocet, validity) => ({
  year: rok, validity, expenditureAmount: vydaje, budgetExpenditureAmount: rozpocet,
});

const vsechny = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

console.log('Plné ročníky se nehlásí');
{
  const faktury = [2022, 2023, 2024].flatMap((r) => rocnik(r, vsechny));
  const zdroj = [2022, 2023, 2024].map((r) => rokZdroje(r, 1_500_000_000, 1_900_000_000, `${r}-12-31`));
  const p = pokrytiFaktur(zdroj, faktury, DNES);
  zkus('žádný ročník není označený', p.neuplneRoky, []);
  zkus('obvyklý počet je medián plných ročníků', p.obvyklyPocet, 4200);
}

console.log('\nUseknutý ročník (regrese: rok 2025 chyběl celý a nikdo si nevšiml)');
{
  const faktury = [
    ...[2023, 2024].flatMap((r) => rocnik(r, vsechny)),
    // leden plný, zbytek roku jen pár plateb, duben a srpen úplně chybí
    ...rocnik(2025, [1], 350),
    ...rocnik(2025, [2, 3, 5, 6, 7, 9, 10, 11, 12], 1),
  ];
  const zdroj = [
    rokZdroje(2023, 1_400_000_000, 1_690_000_000, '2023-12-31'),
    rokZdroje(2024, 1_594_000_000, 2_000_000_000, '2024-12-31'),
    rokZdroje(2025, 52_386_846, 1_607_316_000, '2025-01-28'),
  ];
  const p = pokrytiFaktur(zdroj, faktury, DNES);
  const r2025 = p.roky.find((r) => r.rok === 2025);
  zkus('označí se jen ten jeden rok', p.neuplneRoky, [2025]);
  zkus('chybějící měsíce se najdou', r2025.chybejiciMesice, [4, 8]);
  zkus('skloňování měsíců', r2025.duvody[0], 'chybí 2 měsíce — duben a srpen');
  zkus('počet se porovná s obvyklým', r2025.duvody[1], 'jen 359 faktur místo obvyklých 4\u00a0200');
  zkus('podíl rozpočtu se dopočítá', r2025.duvody[2],
    'CityVizor za ten rok vykazuje jen 3 % rozpočtovaných výdajů');
  zkus('děravý rok nesmí stáhnout laťku obvyklého počtu', p.obvyklyPocet, 4200);
}

console.log('\nProbíhající rok není porucha');
{
  const faktury = [
    ...rocnik(2025, vsechny),
    ...rocnik(2026, [1, 2, 3, 4, 5, 6]),
  ];
  const zdroj = [
    rokZdroje(2025, 1_500_000_000, 1_900_000_000, '2025-12-31'),
    rokZdroje(2026, 730_000_000, 2_445_000_000, '2026-05-31'),
  ];
  const p = pokrytiFaktur(zdroj, faktury, DNES);
  zkus('rozjetý rok se nehlásí jako neúplný', p.neuplneRoky, []);
  zkus('nízký podíl rozpočtu se u něj neuplatní',
    p.roky.find((r) => r.rok === 2026).duvody, []);
  zkus('poslední faktura se najde', p.posledniFaktura, '2026-06-27');
}

console.log('\nDíra uvnitř probíhajícího roku se ale pozná');
{
  const faktury = rocnik(2026, [1, 2, 4, 5]);
  const p = pokrytiFaktur([rokZdroje(2026, 1, 2, '2026-05-31')], faktury, DNES);
  zkus('chybějící březen se ohlásí', p.roky[0].duvody, ['chybí březen']);
}

console.log('\nOkrajové případy');
{
  const p = pokrytiFaktur([], [], DNES);
  zkus('prázdný vstup nespadne', [p.neuplneRoky, p.obvyklyPocet, p.posledniFaktura], [[], null, null]);
  zkus('rok evidovaný zdrojem bez jediné faktury je vidět',
    pokrytiFaktur([rokZdroje(2019, 0, 0, '2019-12-31')], [], DNES).roky[0].rok, 2019);
  zkus('stáří ve dnech', stariDni('2026-06-25', DNES), 74);
  zkus('stáří bez data', stariDni(null, DNES), null);
  zkus('výčet jednoho', vyjmenuj(['duben']), 'duben');
  zkus('výčet dvou', vyjmenuj(['duben', 'srpen']), 'duben a srpen');
  zkus('výčet tří', vyjmenuj(['duben', 'srpen', 'říjen']), 'duben, srpen a říjen');
}

console.log(ok ? '\nVšechno prošlo.' : '\nNěco selhalo.');
process.exit(ok ? 0 : 1);
