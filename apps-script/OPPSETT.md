# Sett opp synken til Google Sheets (ca. 5 minutter)

Arket: https://docs.google.com/spreadsheets/d/1EEfugP3ZegFr2-jPaaXH6zyhn5tIp5kE_T0J98nDCZk/edit

Gjøres på PC, innlogget med kontoen som eier Firebase-prosjektet (pji.idistudios@gmail.com).

1. Åpne arket. Velg **Utvidelser → Apps Script**. En ny fane åpnes.
2. Klikk **tannhjulet** (Prosjektinnstillinger) i venstremenyen. Huk av for
   **«Vis manifestfilen appsscript.json i redigeringsprogrammet»**.
3. Klikk **< >** (Redigeringsprogram) i venstremenyen. Du ser nå to filer: `Kode.gs` og `appsscript.json`.
4. Åpne `appsscript.json`. Marker alt (Ctrl/Cmd+A), slett, og lim inn innholdet fra
   [`apps-script/appsscript.json`](https://github.com/kautokeinoil/basar/blob/main/apps-script/appsscript.json).
5. Åpne `Kode.gs`. Marker alt, slett, og lim inn innholdet fra
   [`apps-script/Code.gs`](https://github.com/kautokeinoil/basar/blob/main/apps-script/Code.gs).
   Tips: på GitHub-siden finnes en kopier-knapp øverst til høyre over koden.
6. Klikk **Lagre** (diskettikonet). Lukk Apps Script-fanen.
7. Last inn regnearket på nytt. Etter noen sekunder dukker menyen **Basar** opp ved siden av Hjelp.
8. Velg **Basar → Oppsett (kjør én gang)**. Google ber om tillatelse:
   - Velg kontoen din.
   - Står det «Google har ikke bekreftet denne appen»: klikk **Avansert** → **Gå til … (utrygt)**.
     Det er ditt eget skript, så dette er forventet.
   - Klikk **Tillat**.
9. Sjekk fanen **Synkstatus**: Resultat skal være **OK**. Fanen **Vakter** viser påmeldingene.

Etter dette synker arket automatisk hvert 5. minutt. **Basar → Synk nå** tvinger en synk med en gang.

## Hvis noe feiler
- Feilmeldingen står i fanen **Synkstatus**. Send den til Claude.
- Feiler synken tre ganger på rad, får du e-post.
- Ikke flytt eller gi nytt navn til kolonner i fanene Vakter, Kaker, Gevinster eller Synkstatus.
  Bygg egne faner som leser fra dem i stedet.

## Når koden oppdateres
Gjenta trinn 5–6 med ny `Code.gs`. Oppsett trenger ikke kjøres på nytt.
