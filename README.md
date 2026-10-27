# FoilLog

FoilLog serve ad analizzare e confrontare le uscite in wing foil. È una web app installabile (PWA): su iPhone e iPad la apri in Safari e la aggiungi alla schermata Home, sul Mac funziona nel browser. Non serve nessun abbonamento.

## Cosa fa (Fase 1)

- **Importa** file GPX (Apple Watch, iPhone, Strava), file Vakaros VKX (secondo la [specifica pubblica](https://github.com/vakaros/vkx)) e file CSV.
- **Mappa**: la traccia è colorata in base alla velocità, con le manovre (riuscite in foil o toccate), il punto di velocità massima, il vento e il replay animato.
- **Numeri**:
  - distanza, durata e tempo in foil;
  - velocità migliori su 2 s, 10 s, 5×10 s, 100 m, 500 m e 1 miglio nautico;
  - decolli e volo più lungo.
- **Vento**: la direzione è stimata dalla traccia, con i dati di [Open-Meteo](https://open-meteo.com) come riferimento, e si può correggere a mano.
- **Manovre e andature**:
  - strambate e virate, con la riuscita in foil e la percentuale per lato;
  - bolina e poppa per mure, VMG e polare.
- **Grafici**: velocità (selezionando un tratto vedi le sue statistiche), distribuzione delle velocità, sbandamento e beccheggio (Vakaros), battito cardiaco (Watch).
- **Confronto**: da 2 a 4 uscite fianco a fianco, con replay sincronizzato se erano in acqua insieme.

Le uscite restano salvate sul dispositivo (IndexedDB). La Fase 2 aggiungerà la crew con Supabase: account, feed, «La giornata» e classifiche.

## Sviluppo sul Mac

Serve Node.js (versione 24 o successiva).

```bash
npm install
```

```bash
npm run dev
```

Poi apri http://localhost:5173/foillog/.

```bash
npm test
```

I test controllano i lettori e l'analisi su tracce simulate. Se nella cartella `tracce test/` ci sono uscite vere, i test le leggono e verificano che un `.vkx` e il suo `.gpx` diano la stessa analisi. Quella cartella è esclusa da git e resta solo sul tuo Mac.

```bash
npm run build
```

## Pubblicazione

Il workflow `.github/workflows/deploy.yml` compila il sito e lo pubblica su GitHub Pages a ogni push su `main`. L'indirizzo finale è `https://<utente>.github.io/foillog/`. Il percorso `/foillog/` è impostato in `vite.config.ts` (`base`).

## Struttura del codice

| Cartella | Cosa contiene |
|---|---|
| `src/lib/parsers/` | lettori GPX, VKX e CSV, che producono una traccia a colonne |
| `src/lib/analysis/` | pulizia, record di velocità, foil, vento, manovre e andature |
| `src/workers/` | il web worker che esegue lettura e analisi fuori dal thread della pagina |
| `src/components/` | mappa (MapLibre + OpenFreeMap), grafici (ECharts), replay, bussola del vento |
| `src/pages/` | Uscite, Uscita, Confronta, Impostazioni |
| `tests/` | test con tracce simulate di cui si conosce il risultato (`src/lib/sim.ts`) |

Le icone dell'app si rigenerano da `public/logo.svg` con `npm run icons`.

## Crediti

Mappe © OpenStreetMap, tiles di OpenFreeMap, vento di Open-Meteo (CC BY 4.0), mappe con MapLibre GL, grafici con Apache ECharts.
