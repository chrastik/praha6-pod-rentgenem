/**
 * Testy odvození interpelací z odpovědi API portálu interpelace.praha6.cz.
 *
 * Vzorky odpovídají tvaru, který API opravdu vrací — včetně míst, kde je
 * nekonzistentní (chybějící typ tazatele, „undefined" místo oblasti,
 * náhodný identifikátor typu textu).
 */
import {
  prehled, detail, sestav, zkontroluj, inicialy, zanonymizuj, klicJmena,
} from '../scripts/lib/interpelace.mjs';

let ok = true;
const zkus = (popis, skut, ocek) => {
  const p = JSON.stringify(skut) === JSON.stringify(ocek);
  if (!p) ok = false;
  console.log((p ? '  ✓ ' : '  ✗ ') + popis
    + (p ? '' : `\n      dostal jsem ${JSON.stringify(skut)}, čekal ${JSON.stringify(ocek)}`));
};

const zaznam = (o = {}) => ({
  _id: '164',
  gid: 'inte-1771072834-abc',
  zmc_id: '2363',
  order: '1',
  year: '2024',
  number: 'Z10/001/2024',
  name: 'Veřejný prostor',
  date: '2024-02-26',
  termin: '2024-03-26',
  published_when: '2024-03-25 22:30:27',
  valid: '1',
  deleted: '0',
  topic_name: 'Veřejný prostor',
  responder_name: 'Štěpán Barták',
  responder_names: ['Štěpán Barták'],
  texts: [
    { gid: 't1', questioner_name: 'Jaroslav Minařík', questioner_type: 'obcan',
      questioner_time: '2024-02-26 00:00:00', text: 'Text  interpelace\r\n\r\n\r\n o lavičkách.',
      type: 'itty-nahodny-hash-1', type_name: 'Text interpelace', valid: '1', deleted: '0' },
    { gid: 't2', questioner_name: null, questioner_type: null,
      questioner_time: '2024-03-21 00:00:00', text: 'Vyjádření k interpelaci.',
      type: 'itty-nahodny-hash-2', type_name: 'Odpověď', valid: '1', deleted: '0' },
  ],
  attachments: [
    { gid: 'a1', name: 'odpoved.pdf', file_name: 'odpoved.pdf', mime: 'application/pdf',
      size: '74406', download_url: '/api/1.0/attachment/download/a1', valid: '1', deleted: '0' },
    { gid: 'a2', name: 'smazana.pdf', download_url: '/api/1.0/attachment/download/a2',
      size: '10', valid: '1', deleted: '1' },
  ],
  ...o,
});

console.log('Přehled jedné interpelace');
const p = prehled(zaznam());
zkus('číslo a název', [p.cislo, p.nazev], ['Z10/001/2024', 'Veřejný prostor']);
zkus('datum bez času', p.datum, '2024-02-26');
zkus('rok jako číslo', p.rok, 2024);
// Jméno občana se na webu zkracuje; zastupitel zůstává pod celým jménem.
zkus('občan dostane iniciály', p.tazatel, 'J. M.');
zkus('typ tazatele', p.typ, 'obcan');
zkus('zastupitel si celé jméno ponechá', prehled(zaznam({
  texts: [{ questioner_name: 'Ing. Eva Tichá', questioner_type: 'zastupitel',
    text: 'Dotaz.', type_name: 'Text interpelace' }],
})).tazatel, 'Ing. Eva Tichá');
zkus('odpovídající', p.odpovida, ['Štěpán Barták']);
zkus('odpověď se pozná podle popisku typu', p.maOdpoved, true);
zkus('smazaná příloha se nepočítá', p.priloh, 1);
zkus('odkaz na jednání', p.jednaniUrl, 'https://usneseni.praha6.cz:1190/usneseni-pozvanky/jednani/2363');
zkus('odkaz na zdroj obsahuje gid',
  p.url, 'https://interpelace.praha6.cz/print-detail?type=inter&source=public&gid=inte-1771072834-abc');

console.log('\nMísta, kde je zdroj nekonzistentní');
// API u části záznamů posílá do oblasti řetězec „undefined".
zkus('„undefined" není oblast', prehled(zaznam({ topic_name: 'undefined' })).oblast, null);
zkus('prázdná oblast je null', prehled(zaznam({ topic_name: null })).oblast, null);
// Typ textu se identifikuje náhodným hashem, spolehnout se dá jen na popisek.
zkus('bez odpovědi se to pozná', prehled(zaznam({
  texts: [{ questioner_name: 'A. B.', questioner_type: 'zastupitel', text: 'Dotaz.', type_name: 'Text interpelace' }],
})).maOdpoved, false);
zkus('neznámý typ tazatele se nehádá', prehled(zaznam({
  texts: [{ questioner_name: 'A. B.', questioner_type: 'host', text: 'Dotaz.', type_name: 'Text interpelace' }],
})).typ, null);
zkus('responder_names má přednost před jedním jménem', prehled(zaznam({
  responder_name: 'Někdo', responder_names: ['První', 'Druhý'],
})).odpovida, ['První', 'Druhý']);
zkus('prázdné responder_names spadne zpět na jedno jméno', prehled(zaznam({
  responder_names: [], responder_name: 'Jediný',
})).odpovida, ['Jediný']);

console.log('\nZkracování jmen občanů');
zkus('iniciály bez titulů', inicialy('JUDr. Ivan Hrůza'), 'I. H.');
zkus('příjmení napřed se nepřehazuje', inicialy('Nejedlá Kateřina, Ing.'), 'N. K.');
// „M.A" je titul psaný bez teček; jednopísmenné zbytky do iniciál nepatří.
zkus('titul bez teček nepřidá písmeno', inicialy('M.A Mikuláš Roubíček'), 'M. R.');
zkus('celé jméno v přepisu zmizí',
  zanonymizuj('Pan Jaroslav Minařík řekl.', 'Jaroslav Minařík'), 'Pan J. M. řekl.');
// Přepisy jsou psané česky, jméno se v nich skloňuje.
zkus('skloňované příjmení taky',
  zanonymizuj('Minaříkovi to vadí.', 'Jaroslav Minařík'), 'M. to vadí.');
// Křestní jméno sdílené s radním nesmí zmizet samo o sobě, ale v celém jménu ano.
zkus('sdílené křestní jméno se nahradí jen jako součást celého jména',
  zanonymizuj('Odpovídá Jan Lacina, ptal se Jan Lejčko.', 'Jan Lejčko', ['Mgr. Jan Lacina']),
  'Odpovídá Jan Lacina, ptal se J. L.');
// Čeština mění i kmen, ne jen koncovku — po prvním nasazení zůstalo v přepisech
// šestnáct tvarů jako „Aleše Moravce" nebo „Bedřišku Kopoldovou".
zkus('vypadávající „e" v příjmení',
  zanonymizuj('Aleše Moravce jsme slyšeli.', 'Ing. Aleš Moravec'), 'A. M. jsme slyšeli.');
zkus('přechýlené příjmení ve 4. pádě',
  zanonymizuj('Bedřišku Kopoldovou jsme vyslechli.', 'Bedřiška Kopoldová'), 'B. K. jsme vyslechli.');
zkus('krátké křestní jméno se skloňuje jen v celém jménu',
  zanonymizuj('Anny Lochmanové se to týká.', 'Anna Lochmanová'), 'A. L. se to týká.');
// Tečka iniciály slouží i jako tečka věty; „M.." je překlep, „..." se nesmí zkrátit.
zkus('dvojtečka na konci věty se slije',
  zanonymizuj('Mluvil Jiří Hoskovec.', 'Jiří Hoskovec'), 'Mluvil J. H.');
zkus('trojtečka zůstane', zanonymizuj('Řekl to takto... a dost.', 'Jan Novák'),
  'Řekl to takto... a dost.');
zkus('jméno radního zůstane',
  zanonymizuj('Lacina odpověděl.', 'Jan Lejčko', ['Mgr. Jan Lacina']), 'Lacina odpověděl.');
zkus('klíč jména nezáleží na titulu ani pořadí',
  klicJmena('Mgr. Ondřej Chrást') === klicJmena('Chrást Ondřej'), true);

console.log('\nPlné znění');
const d = detail(zaznam());
zkus('dva texty: interpelace a odpověď', d.texty.map((t) => t.druh), ['interpelace', 'odpoved']);
zkus('podpis občana u textu je zkrácený', d.texty[0].kdo, 'J. M.');
zkus('windows konce řádků a trojité mezery se srovnají',
  d.texty[0].text, 'Text interpelace\n\no lavičkách.');
zkus('příloha dostane absolutní URL',
  d.prilohy[0].url, 'https://interpelace.praha6.cz/api/1.0/attachment/download/a1');
zkus('smazaná příloha se nepřenáší', d.prilohy.length, 1);
zkus('velikost je číslo', d.prilohy[0].velikost, 74406);

console.log('\nRozdělení po letech');
const v = sestav([
  zaznam(),
  zaznam({ gid: 'g2', year: '2025', date: '2025-06-01', number: 'Z20/002/2025',
    texts: [{ questioner_name: 'Eva Tichá', questioner_type: 'zastupitel', text: 'Dotaz.', type_name: 'Text interpelace' }] }),
  zaznam({ gid: 'g3', year: '2025', date: '2025-09-01', number: 'Z21/003/2025' }),
  // smazaný záznam nemá na web co dělat
  zaznam({ gid: 'g4', year: '2025', date: '2025-09-02', deleted: '1' }),
]);
zkus('smazaný záznam se zahodí', v.items.length, 3);
zkus('texty jsou po letech', [...v.podleRoku.keys()].sort(), [2024, 2025]);
zkus('v roce 2025 jsou dvě interpelace', v.podleRoku.get(2025).length, 2);
zkus('přehled je seřazený od nejnovější', v.items.map((i) => i.datum),
  ['2025-09-01', '2025-06-01', '2024-02-26']);
zkus('souhrn: zastupitelé vs. občané',
  [v.souhrn.zastupitele, v.souhrn.obcane], [1, 2]);
zkus('souhrn po letech', v.souhrn.roky.map((r) => [r.rok, r.pocet]), [[2025, 2], [2024, 1]]);
zkus('bez odpovědi se počítá', v.souhrn.bezOdpovedi, 1);

console.log('\nTýž člověk jednou jako zastupitel, jednou jako občan');
// Portál takhle vede třináct lidí — kdo interpeloval před zvolením nebo po
// skončení mandátu. Bez pohledu na celý dataset by měl jednou celé jméno
// a podruhé iniciály.
const dvojrole = sestav([
  zaznam({ gid: 'z1', number: 'Z1/001/2023', year: '2023', date: '2023-01-01',
    texts: [{ questioner_name: 'Mgr. Ondřej Chrást', questioner_type: 'zastupitel',
      text: 'Jako zastupitel.', type_name: 'Text interpelace' }] }),
  zaznam({ gid: 'z2', number: 'Z1/002/2019', year: '2019', date: '2019-01-01',
    texts: [{ questioner_name: 'Ondřej Chrást', questioner_type: 'obcan',
      text: 'Pan Ondřej Chrást tehdy ještě jako občan.', type_name: 'Text interpelace' }] }),
]);
zkus('celé jméno i u záznamu vedeného jako občan',
  dvojrole.items.map((i) => i.tazatel).sort(), ['Mgr. Ondřej Chrást', 'Ondřej Chrást']);
zkus('a přepis se nezkracuje',
  dvojrole.podleRoku.get(2019)[0].texty[0].text, 'Pan Ondřej Chrást tehdy ještě jako občan.');

console.log('\nKontroly datasetu');
zkus('zdravý dataset projde', zkontroluj(v).length, 0);
zkus('prázdný dataset se pozná', zkontroluj({ items: [], podleRoku: new Map() }).length > 0, true);
// Přesně tohle by se stalo, kdyby se scrapovalo HTML místo API.
zkus('texty jen za jeden rok jsou podezřelé',
  zkontroluj({ items: v.items, podleRoku: new Map([[2026, []]]) }).some((x) => /jen za 1 rok/.test(x)), true);

console.log(ok ? '\nVŠECHNY KONTROLY PROŠLY ✓' : '\nNĚCO NESEDÍ ✗');
process.exit(ok ? 0 : 1);
