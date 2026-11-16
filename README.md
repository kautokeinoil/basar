# KIL Romjulsbasar – påmelding

Webapp for frivillige vakter, kakeleveranser og gevinster til Kautokeino ILs romjulsbasar.
Spesifikasjon: «Basar påmeldingssystem – spesifikasjon» (Claude-dokument).

- Frontend: React + Vite, publisert til GitHub Pages: https://kautokeinoil.github.io/basar/
- Data: Firestore i Firebase-prosjektet `basar-ba738`, (default)-databasen
- Admin: https://kautokeinoil.github.io/basar/#/admin

## Utvikling

```bash
npm install
npm run dev          # lokal utvikling
npm test             # tildelingsregler (uten Firebase)
npm run test:rules   # sikkerhetsregler mot Firestore-emulatoren (krever Java)
```

## Regler

`firestore.rules` er kilden. Etter at testene består (lokalt eller i GitHub Actions),
limes filen inn i Firebase-konsollen → Firestore → Regler → Publiser.

## Endre oppsett

Skift-ID-er endres aldri etter første påmelding. Følg skill-en `basar-config-endring`.
Før lenken deles: kjør `basar-for-lansering`.
