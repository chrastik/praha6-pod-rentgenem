# Praha 6 pod rentgenem

Veřejná data městské části Praha 6 na jednom místě — usnesení rady a zastupitelstva,
rozpočet, faktury, smlouvy a úřední deska, u každého záznamu odkaz na originální zdroj.

Inspirováno projektem [Praha 8 v přehledech](https://praha8vprehledech.cz/). Kód je vlastní.

**Není to oficiální web městské části.** Oficiální je [praha6.cz](https://www.praha6.cz).

---

## Jak to funguje

Tři oddělené vrstvy, žádný server a žádná databáze:

1. **Scrapery** (`scripts/`) — čistý Node.js, nulové závislosti. Obejdou zdroje a uloží
   výsledek do `data/*.json`.
2. **GitHub Actions** (`.github/workflows/`) — spouštějí scrapery na cronu a commitují
   data zpět do repozitáře. Tím vzniká i historie: je dohledatelné, kdy se který
   záznam objevil nebo zmizel.
3. **Statický web** (`web/`) — vanilla JS, hash router, žádný build krok. Načítá
   předgenerované JSONy po ročnících, takže první vykreslení netahá desítky MB.

### Datové zdroje

| Zdroj | Co dává | Jak často |
|---|---|---|
| `praha6.cz` — vestavěný JSON v `div#js-data` | usnesení 2002–2022, zápisy, úřední deska | týdně / denně |
| `usneseni.praha6.cz:1190` (MARBES) | usnesení od 2022 v plném znění | denně |
| `cityvizor.praha.eu` REST API | položkový rozpočet, jednotlivé faktury | týdně |
| `data.smlouvy.gov.cz` + `smlouvy.gov.cz` | registr smluv, IČO 00063703 | denně (přírůstek) |
| `monitor.statnipokladna.gov.cz` | účetní výkazy | ručně |

Podrobný rozbor dostupnosti každého zdroje je v analýze, ze které projekt vznikl.

### Co zatím chybí

**Jmenovité hlasování zastupitelů.** Zastupitelstvo hlasuje elektronickým zařízením
a jednací řád (§ 15 odst. 8) ukládá zveřejnit jmenovitá hlasování do tří dnů po ověření
zápisu. Portál usnesení má pro hlasování připravená pole, ale nejsou naplněná; otevřená
data z let 2014–2018 existovala, jejich soubory dnes vracejí chybu. Dokud radnice
publikaci nezapne, umí web ukázat jen účast a souhrnné výsledky ze zápisů.

---

## Spuštění

Potřebuješ jen Node 20+. Žádné `npm install` — projekt nemá závislosti.

```bash
node scripts/probe-sources.mjs      # test dostupnosti všech zdrojů, ~30 s
npm run sync:usneseni-web           # archiv 2002–2022
npm run sync:usneseni-marbes        # 2022+ (inkrementálně; FULL=1 vynutí přeběh)
npm run sync:finance                # CityVizor
npm run sync:smlouvy                # denní přírůstek; BACKFILL=1 projde dumpy
npm run merge && npm run index      # sloučení a fulltextový index
npm run validate                    # kontrola integrity
```

Náhled webu lokálně:

```bash
cp -r data web/data && (cd web && python3 -m http.server 8000)
```

### Užitečné proměnné

| Proměnná | Účinek |
|---|---|
| `HTTP_CACHE=1` | cachuje stažené stránky do `.cache/` — při vývoji šetří radnici i čas |
| `FULL=1` | MARBES stáhne znovu i to, co už zná |
| `BACKFILL=1` | registr smluv projde všechny měsíční dumpy (dlouhé) |
| `ALLOW_SHRINK=1` | povolí zápis datasetu, který se výrazně zmenšil (jinak se odmítne) |
| `PARALEL=3` | souběžné požadavky na MARBES |

---

## Zásady

- **Selhání jednoho zdroje nesmí přepsat funkční dataset prázdným souborem.** Zápis do
  `data/` se odmítne, pokud by dataset přišel o víc než 20 % záznamů.
- **Nic se nedopočítává.** Když zdroj hodnotu nemá, je prázdná — ne odhadnutá.
- **U každého záznamu odkaz na originál.** Web je rozcestník, ne náhrada úřední desky.
- **Šetrné chování ke zdrojům.** Omezená paralelita, retry s odstupem, inkrementální běh.

## Nasazení

Web se publikuje přes GitHub Pages workflow `pages.yml` — poskládá `web/` a `data/`
do jedné složky a nasadí ji. Žádný externí hosting není potřeba.

Vlastní doména `praha6podrentgenem.cz`:

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Pages → Custom domain:** `praha6podrentgenem.cz` → Save
3. U správce DNS domény (Active24) nastav:
   - kořen `praha6podrentgenem.cz` — **A** na `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`
   - kořen `praha6podrentgenem.cz` — **AAAA** na `2606:50c0:8000::153`,
     `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - `www` — **CNAME** na `chrastik.github.io.`
   MX a SPF záznamy zůstávají beze změny, e-mail na doméně tím není dotčen.
4. Až se DNS rozšíří (minuty až hodiny) a GitHub vystaví certifikát,
   zaškrtni **Enforce HTTPS**.

Původní adresa `praha6podrentgenem.chrast.eu` slouží už jen jako přesměrování
na novou doménu.

## Licence

Kód: MIT. Data pocházejí z veřejných zdrojů a zůstávají veřejná.
