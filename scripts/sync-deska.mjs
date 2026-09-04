#!/usr/bin/env node
/**
 * Úřední deska. Web radnice drží jen aktuálně vyvěšené dokumenty (~130) a archiv
 * nemá, proto se vyvěšené položky průběžně kumulují do vlastního archivu:
 * co jednou uvidíme, to si necháme i po sejmutí.
 */
import { fetchJsData, largestRecordArray, pick, absolutize } from './lib/jsdata.mjs';
import { writeDataset, readItems, parseDate } from './lib/util.mjs';

const URL_DESKA = 'https://www.praha6.cz/cs/uredni-deska/uredni-deska-rozcestnik.html';

const data = await fetchJsData(URL_DESKA);
const raw = largestRecordArray(data);

const dnes = new Date().toISOString().slice(0, 10);
const aktualni = raw.map((r) => {
  const id = String(pick(r, 'strom_id', 'id', 'cislo') ?? '');
  if (!id) return null;
  return {
    id,
    nazev: String(pick(r, 'nazev', 'title') ?? '').trim(),
    vyveseno: parseDate(pick(r, 'vyveseno', 'dateFrom')),
    sveseno: parseDate(pick(r, 'sveseno', 'dateTo')),
    oblast: pick(r, 'oblast', 'category') ?? null,
    typ: pick(r, 'typ', 'type') ?? null,
    url: absolutize(pick(r, 'url', 'odkaz')),
    naDesce: true,
    poprveViden: dnes,
    naposledViden: dnes,
  };
}).filter(Boolean);

const archiv = new Map((await readItems('deska')).map((d) => [d.id, { ...d, naDesce: false }]));
for (const d of aktualni) {
  const stary = archiv.get(d.id);
  archiv.set(d.id, { ...d, poprveViden: stary?.poprveViden ?? dnes });
}

const items = [...archiv.values()].sort((a, b) => (b.vyveseno ?? '').localeCompare(a.vyveseno ?? ''));
console.log(`  na desce ${aktualni.length}, v archivu celkem ${items.length}`);
await writeDataset('deska', items, {
  naDesce: aktualni.length,
  poznamka: 'Archiv je budován inkrementálně — radnice sejmuté dokumenty nezveřejňuje.',
});
