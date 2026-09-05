/**
 * Proudové čtení CSV od ČSÚ. Soubory sčítání mají až 150 MB a jdou až na úroveň
 * základních sídelních jednotek — do paměti se nevejdou, takže se filtrují za běhu.
 * Hodnoty jsou v uvozovkách a některé popisky obsahují čárky
 * („Osoby v domácnosti, děti předškolního věku, …“), proto plnohodnotný parser řádku.
 */
export function parseRadek(radek) {
  const pole = [];
  let bunka = '';
  let vUvozovkach = false;
  for (let i = 0; i < radek.length; i++) {
    const z = radek[i];
    if (vUvozovkach) {
      if (z === '"') {
        if (radek[i + 1] === '"') { bunka += '"'; i++; }
        else vUvozovkach = false;
      } else bunka += z;
    } else if (z === '"') {
      vUvozovkach = true;
    } else if (z === ',') {
      pole.push(bunka); bunka = '';
    } else if (z !== '\r') {
      bunka += z;
    }
  }
  pole.push(bunka);
  return pole;
}

/**
 * Jeden pokus o stažení a přečtení celého souboru.
 */
async function jedenPruchod(url, chce, ua) {
  const res = await fetch(url, { headers: { 'user-agent': ua } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);

  const dekoder = new TextDecoder('utf-8');
  let zbytek = '';
  let hlavicka = null;
  let radku = 0;
  let bajtu = 0;
  const vysledek = [];

  const zpracujRadek = (radek) => {
    if (!radek) return;
    const pole = parseRadek(radek);
    if (!hlavicka) { hlavicka = pole; return; }
    radku++;
    const z = {};
    for (let i = 0; i < hlavicka.length; i++) z[hlavicka[i]] = pole[i] ?? '';
    if (chce(z)) vysledek.push(z);
  };

  for await (const chunk of res.body) {
    bajtu += chunk.length;
    zbytek += dekoder.decode(chunk, { stream: true });
    let konec;
    while ((konec = zbytek.indexOf('\n')) !== -1) {
      zpracujRadek(zbytek.slice(0, konec));
      zbytek = zbytek.slice(konec + 1);
    }
  }
  zpracujRadek(zbytek + dekoder.decode());

  return { radky: vysledek, prohlednuto: radku, mb: bajtu / 1048576 };
}

/**
 * Stáhne CSV a zavolá `chce(zaznam)` pro každý řádek. Vrací jen ty, které projdou.
 *
 * Server ČSÚ u velkých souborů občas zavře spojení uprostřed přenosu
 * (UND_ERR_SOCKET „other side closed“). Range requesty nepodporuje, takže
 * jediná spolehlivá obrana je stáhnout soubor znovu od začátku; parsování je
 * čistá funkce bez vedlejších účinků, takže opakování nic nerozbije.
 *
 * @param {(z: Record<string,string>) => boolean} chce
 */
export async function ctiCsvProudove(url, chce, { ua = 'praha6-pod-rentgenem/0.1', pokusu = 4 } = {}) {
  let posledni;
  for (let pokus = 1; pokus <= pokusu; pokus++) {
    try {
      return await jedenPruchod(url, chce, ua);
    } catch (e) {
      posledni = e;
      if (pokus === pokusu) break;
      const cekat = 3000 * pokus;
      console.warn(`    pokus ${pokus}/${pokusu} selhal (${e.message}), zkouším znovu za ${cekat / 1000} s`);
      await new Promise((r) => setTimeout(r, cekat));
    }
  }
  throw new Error(`${url}: nepodařilo se stáhnout ani na ${pokusu}. pokus — ${posledni?.message}`);
}
