/**
 * Úplnost dat o fakturách po jednotlivých letech.
 *
 * CityVizor u Prahy 6 přestal koncem ledna 2025 dostávat export z účetnictví a
 * rozjel se až v lednu 2026. Za rok 2025 je proto zveřejněno 168 faktur místo
 * obvyklých čtyř tisíc a z toho 133 v lednu. Web to nesmí ukazovat jako hotové
 * číslo: kdo si vyfiltruje rok 2025, uvidí patnáct milionů a odnese si, že
 * radnice skoro nic neutratila.
 *
 * Nic se tu nepíše natvrdo. Které ročníky jsou děravé, se pozná z dat samotných —
 * aby se příští výpadek chytil sám a aby poznámka zase sama zmizela, až radnice
 * ročník doplní.
 */

const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

/** Podíl zveřejněných výdajů k rozpočtu, pod kterým je dokončený rok podezřelý. */
export const PRAH_PODILU_ROZPOCTU = 0.5;

/** Podíl obvyklého počtu faktur, pod kterým je dokončený rok podezřelý. */
export const PRAH_POCTU_FAKTUR = 0.4;

/** Po kolika dnech bez nové faktury se to bere jako zaseknutý zdroj. */
export const PRAH_ZASTARANI_DNI = 45;

const den = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const p = Math.floor(s.length / 2);
  return s.length % 2 ? s[p] : Math.round((s[p - 1] + s[p]) / 2);
}

/** 1 měsíc, 2–4 měsíce, 5+ měsíců — bez tohohle by tam bylo „chybí 2 měsíců“. */
const sklonuj = (n, jeden, dva, pet) => (n === 1 ? jeden : (n >= 2 && n <= 4 ? dva : pet));

/** 4173 → „4 173“ s pevnou mezerou; nespoléhá na ICU, ať jsou testy stabilní. */
const cislo = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

/** ['duben','srpen'] → „duben a srpen“; tři a víc → „duben, srpen a říjen“. */
export function vyjmenuj(polozky) {
  if (polozky.length <= 1) return polozky.join('');
  return `${polozky.slice(0, -1).join(', ')} a ${polozky.at(-1)}`;
}

/**
 * @param rokyZdroje pole z CityVizor API /years — nese validity a rozpočet
 * @param faktury    normalizované faktury ({ datum, vydaj })
 * @param dnes       kvůli testovatelnosti; „dokončený rok“ závisí na dnešku
 */
export function pokrytiFaktur(rokyZdroje = [], faktury = [], dnes = new Date()) {
  const letos = Number(den(dnes).slice(0, 4));

  const zdrojPodleRoku = new Map(
    (rokyZdroje ?? []).filter((r) => r?.year).map((r) => [Number(r.year), r]),
  );

  // Roky, o kterých vůbec něco víme — ze seznamu období i z faktur samotných.
  // Rok, který zdroj eviduje a nemá v něm ani fakturu, musí být vidět taky.
  const roky = new Set(zdrojPodleRoku.keys());
  for (const f of faktury) {
    const r = Number((f?.datum ?? '').slice(0, 4));
    if (Number.isFinite(r) && r) roky.add(r);
  }

  const zaznamy = [...roky].sort((a, b) => b - a).map((rok) => {
    const sve = faktury.filter((f) => (f?.datum ?? '').startsWith(String(rok)));
    const mesice = new Set(sve.map((f) => Number(f.datum.slice(5, 7))));
    const data = sve.map((f) => f.datum).sort();
    const z = zdrojPodleRoku.get(rok) ?? {};
    const probihajici = rok >= letos;

    // U dokončeného roku se čeká všech dvanáct měsíců. U probíhajícího jen ty,
    // do kterých data sahají — že poslední měsíce ještě nedorazily, není díra
    // v roce, ale zpoždění zdroje, a to se hlásí zvlášť.
    const doMesice = probihajici ? (mesice.size ? Math.max(...mesice) : 0) : 12;
    const chybejiciMesice = [];
    for (let m = 1; m <= doMesice; m += 1) if (!mesice.has(m)) chybejiciMesice.push(m);

    const rozpocetVydaju = Number(z.budgetExpenditureAmount) || null;
    const vydajeZdroje = Number(z.expenditureAmount) || null;
    const podilRozpoctu = rozpocetVydaju && vydajeZdroje != null
      ? vydajeZdroje / rozpocetVydaju : null;

    return {
      rok,
      faktur: sve.length,
      vydaje: sve.reduce((a, f) => a + (f.vydaj ?? 0), 0),
      prvni: data[0] ?? null,
      posledni: data.at(-1) ?? null,
      mesicu: mesice.size,
      chybejiciMesice,
      vydajeZdroje,
      rozpocetVydaju,
      podilRozpoctu,
      platnostDo: z.validity ? den(z.validity) : null,
      probihajici,
    };
  });

  // Obvyklý počet faktur se počítá jen z ročníků, které samy o sobě nevypadají
  // rozbitě — jinak by jeden prázdný rok stáhl laťku a schoval další.
  const podezrele = (r) => r.chybejiciMesice.length > 0
    || (r.podilRozpoctu != null && r.podilRozpoctu < PRAH_PODILU_ROZPOCTU);
  const obvyklyPocet = median(
    zaznamy.filter((r) => !r.probihajici && !podezrele(r)).map((r) => r.faktur),
  );

  for (const r of zaznamy) {
    const duvody = [];
    if (r.chybejiciMesice.length) {
      const jmena = r.chybejiciMesice.map((m) => MESICE[m - 1]);
      duvody.push(jmena.length === 1
        ? `chybí ${jmena[0]}`
        : `chybí ${jmena.length} ${sklonuj(jmena.length, 'měsíc', 'měsíce', 'měsíců')} — ${vyjmenuj(jmena)}`);
    }
    if (!r.probihajici && obvyklyPocet && r.faktur < obvyklyPocet * PRAH_POCTU_FAKTUR) {
      duvody.push(`jen ${cislo(r.faktur)} faktur místo obvyklých ${cislo(obvyklyPocet)}`);
    }
    if (!r.probihajici && r.podilRozpoctu != null && r.podilRozpoctu < PRAH_PODILU_ROZPOCTU) {
      const procent = Math.round(r.podilRozpoctu * 100);
      duvody.push(`CityVizor za ten rok vykazuje jen ${procent} % rozpočtovaných výdajů`);
    }
    r.duvody = duvody;
    r.neuplny = duvody.length > 0;
  }

  const vsechnaData = faktury.map((f) => f?.datum).filter(Boolean).sort();

  return {
    prvniFaktura: vsechnaData[0] ?? null,
    posledniFaktura: vsechnaData.at(-1) ?? null,
    obvyklyPocet,
    neuplneRoky: zaznamy.filter((r) => r.neuplny).map((r) => r.rok),
    roky: zaznamy,
  };
}

/** Stáří v celých dnech; null, když datum chybí. */
export function stariDni(datum, dnes = new Date()) {
  if (!datum) return null;
  const t = Date.parse(`${den(datum)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.parse(`${den(dnes)}T00:00:00Z`) - t) / 864e5);
}
