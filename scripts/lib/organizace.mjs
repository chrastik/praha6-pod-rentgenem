/**
 * Organizace a firmy zřizované MČ Praha 6.
 *
 * Seznam i IČO pocházejí z „Přehledu zřizovaných organizací" na webu radnice:
 * https://www.praha6.cz/nezarazeno/prehled-zrizovanych-organizaci_69689.html
 * Nehádáme je — kdyby radnice nějakou organizaci přidala nebo zrušila, patří
 * změna sem, ne do scraperu.
 *
 * Organizační složky (Dětská skupina Sluníčko, PRO6) tu schválně nejsou:
 * nemají vlastní IČO, jsou součástí městské části a jejich smlouvy publikuje MČ.
 *
 * DŮLEŽITÉ: každý subjekt je samostatný publikující subjekt registru smluv.
 * Jeho čísla se NESČÍTAJÍ s čísly městské části — smlouva mezi radnicí a její
 * školou by se pak počítala dvakrát.
 */

/** Skupiny subjektů. Pořadí určuje pořadí na stránce. */
export const TYPY = {
  ostatni: { nazev: 'Další organizace', jednotne: 'Organizace' },
  zs: { nazev: 'Základní školy', jednotne: 'Základní škola' },
  ms: { nazev: 'Mateřské školy', jednotne: 'Mateřská škola' },
  firma: { nazev: 'Městské firmy', jednotne: 'Městská firma' },
};

/** Skupina, do které patří obchodní společnosti — má vlastní stránku. */
export const SKUPINA_FIRMY = 'firma';

export const SUBJEKTY = [
  // --- neškolské příspěvkové organizace ---
  { ico: '45243956', nazev: 'Léčebna dlouhodobě nemocných', typ: 'ostatni' },
  { ico: '70893969', nazev: 'Pečovatelská služba', typ: 'ostatni' },
  { ico: '19712031', nazev: 'KITT6, příspěvková organizace', typ: 'ostatni' },

  // --- mateřské školy ---
  { ico: '65994027', nazev: 'Fakultní MŠ se speciální péčí', typ: 'ms' },
  { ico: '70885397', nazev: 'MŠ Bubeníčkova', typ: 'ms' },
  { ico: '70920613', nazev: 'MŠ Čínská', typ: 'ms' },
  { ico: '70945276', nazev: 'MŠ Charlese de Gaulla', typ: 'ms' },
  { ico: '70886857', nazev: 'MŠ Jílkova', typ: 'ms' },
  { ico: '70942676', nazev: 'MŠ Juárezova', typ: 'ms' },
  { ico: '70942897', nazev: 'MŠ Libocká', typ: 'ms' },
  { ico: '63834359', nazev: 'MŠ Meziškolská', typ: 'ms' },
  { ico: '70921580', nazev: 'MŠ Motýlek', typ: 'ms' },
  { ico: '70920681', nazev: 'MŠ Na Dlouhém lánu', typ: 'ms' },
  { ico: '70920753', nazev: 'MŠ Na Okraji', typ: 'ms' },
  { ico: '70920605', nazev: 'MŠ Parléřova', typ: 'ms' },
  { ico: '70885401', nazev: 'MŠ Sbíhavá', typ: 'ms' },
  { ico: '70921539', nazev: 'MŠ Šmolíkova', typ: 'ms' },
  { ico: '70886466', nazev: 'MŠ Terronská', typ: 'ms' },
  { ico: '70886423', nazev: 'MŠ Velvarská', typ: 'ms' },
  { ico: '70920494', nazev: 'MŠ Vokovická', typ: 'ms' },
  { ico: '70920761', nazev: 'MŠ Volavkova', typ: 'ms' },
  { ico: '70885419', nazev: 'Waldorfská MŠ', typ: 'ms' },

  // --- základní školy (většina má i mateřskou školu) ---
  { ico: '48133850', nazev: 'ZŠ a MŠ Antonína Čermáka', typ: 'zs' },
  { ico: '48133833', nazev: 'ZŠ a MŠ Bílá', typ: 'zs' },
  { ico: '48133809', nazev: 'ZŠ a MŠ Červený vrch', typ: 'zs' },
  { ico: '48133914', nazev: 'ZŠ Dědina', typ: 'zs' },
  { ico: '48133892', nazev: 'ZŠ a MŠ Emy Destinnové', typ: 'zs' },
  { ico: '48133787', nazev: 'ZŠ a MŠ Hanspaulka', typ: 'zs' },
  { ico: '48133817', nazev: 'ZŠ a MŠ J. A. Komenského', typ: 'zs' },
  { ico: '63834341', nazev: 'ZŠ Marjánka', typ: 'zs' },
  { ico: '68407122', nazev: 'ZŠ a MŠ Na Dlouhém lánu', typ: 'zs' },
  { ico: '67798543', nazev: 'ZŠ a MŠ nám. Svobody 2', typ: 'zs' },
  { ico: '48133906', nazev: 'ZŠ Norbertov', typ: 'zs' },
  { ico: '48133779', nazev: 'ZŠ a MŠ Věry Čáslavské', typ: 'zs' },
  { ico: '48133795', nazev: 'ZŠ Petřiny – sever', typ: 'zs' },
  { ico: '48133761', nazev: 'ZŠ Pod Marjánkou', typ: 'zs' },
  { ico: '49624521', nazev: 'ZŠ a MŠ T. G. Masaryka', typ: 'zs' },

  // --- obchodní společnosti ---
  { ico: '27114112', nazev: 'SNEO, a.s.', typ: 'firma' },
];

/** IČO městské části. Sem nepatří — má vlastní dataset a vlastní stránku. */
export const ICO_MC = '00063703';

export const podleIco = new Map(SUBJEKTY.map((s) => [s.ico, s]));

/** Pojistka proti překlepu v IČO nebo proti tomu, že si sem někdo omylem přidá MČ. */
export function zkontrolujSeznam() {
  const potize = [];
  const videna = new Set();
  for (const s of SUBJEKTY) {
    if (!/^\d{8}$/.test(s.ico)) potize.push(`${s.nazev}: IČO „${s.ico}" nemá osm číslic`);
    if (videna.has(s.ico)) potize.push(`${s.nazev}: IČO ${s.ico} je v seznamu dvakrát`);
    videna.add(s.ico);
    if (!TYPY[s.typ]) potize.push(`${s.nazev}: neznámý typ „${s.typ}"`);
    if (s.ico === ICO_MC) potize.push(`${s.nazev}: to je IČO městské části, sem nepatří`);
  }
  return potize;
}
