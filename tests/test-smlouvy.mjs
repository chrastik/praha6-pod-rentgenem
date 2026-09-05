/**
 * Test rozboru záznamu registru smluv.
 *
 * Hlavní věc, kterou hlídá: odkaz musí mířit na ID VERZE, ne na ID smlouvy.
 * Když se to poplete, odkaz zdánlivě funguje, ale otevře cizí smlouvu —
 * takhle web dlouho posílal lidi na Nemocnici Na Homolce místo na smlouvu
 * městské části.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let ok = true;
const zkus = (popis, skut, ocek) => {
  const p = JSON.stringify(skut) === JSON.stringify(ocek);
  if (!p) ok = false;
  console.log((p ? '  ✓ ' : '  ✗ ') + popis
    + (p ? '' : `\n      dostal jsem ${JSON.stringify(skut)}, čekal ${JSON.stringify(ocek)}`));
};

// parseZaznam není exportovaná (skript se sám spouští), proto se vytáhne zdrojem.
const zdroj = readFileSync('scripts/sync-smlouvy.mjs', 'utf8');
const zacatek = zdroj.indexOf('const tag = (xml, name)');
const konec = zdroj.indexOf('// ------------------------------------------------------------- inkrementálně ---');
const kod = zdroj.slice(zacatek, konec);

const modul = `const ICO='00063703';const BASE='https://smlouvy.gov.cz';
const parseDate=(s)=>{if(!s)return null;const m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(s).trim());return m?\`\${m[1]}-\${m[2]}-\${m[3]}\`:null;};
${kod}
export { parseZaznam };`;
const { writeFileSync, mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const path = await import('node:path');
const dir = mkdtempSync(path.join(tmpdir(), 'p6-'));
const soubor = path.join(dir, 'parse.mjs');
writeFileSync(soubor, modul);
const { parseZaznam } = await import(soubor);

const xml = readFileSync('tests/fixtures/zaznam-registr.xml', 'utf8');
const z = parseZaznam(xml);

console.log('Rozbor záznamu z registru');
zkus('identita záznamu je idSmlouvy', z.id, '37031293');
zkus('ODKAZ míří na idVerze, ne na idSmlouvy', z.url, 'https://smlouvy.gov.cz/smlouva/39389997');
zkus('odkaz NEobsahuje idSmlouvy', z.url.includes('37031293'), false);
zkus('idVerze se ukládá', z.idVerze, '39389997');
zkus('předmět', z.predmet, 'Smlouva o podnájmu parkovacího místa Prašný most č. 51');
zkus('datum uzavření', z.datum, '2026-09-04');
zkus('částka bez DPH', z.castkaBezDph, 128925.62);
zkus('měna', z.mena, 'CZK');
zkus('protistrana není publikující subjekt', z.protistrana, 'STETOM, advokátní kancelář, s.r.o.');

console.log('\nZáznam bez elementu odkaz');
const bezOdkazu = xml.replace(/<odkaz>[^<]*<\/odkaz>/, '');
const b = parseZaznam(bezOdkazu);
zkus('odkaz se poskládá z idVerze', b.url, 'https://smlouvy.gov.cz/smlouva/39389997');

console.log(ok ? '\nVŠECHNY KONTROLY PROŠLY ✓' : '\nNĚCO NESEDÍ ✗');
process.exit(ok ? 0 : 1);
