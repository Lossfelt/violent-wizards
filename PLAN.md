# Plan: Konseptnært mobil-først UI for Violent Wizards

## Summary
- Bruk konseptbildet `C:\Users\LevinLøssfelt\.codex\generated_images\019e22a0-e396-7fc0-b0d7-dfa64d5c488e\ig_0158dc26f95e30fb016a04cdb457008191b858acf9b83c88d7.png` som visuell retning.
- Implementer mørk, taktisk fantasy-UI med gullaksenter, tydelige paneler, stor hovedhandling og relevante informasjonsflater.
- Mobil skal ikke være én lang kolonne: den skal ha minimal topp, fasebar, hovedhandling som primær flate, fast bunnstatus med egen helse og ikonknapper for sekundære paneler.
- Ikke implementer konseptdata som bryter spillreglene eller dagens modell: motstanders helse/skjold-tall, shield-health, timer og ekstra Mado-slot 6.

## Key Changes
- Legg til `lucide-react` for diskrete ikoner.
- Komponentiser `App.tsx` rundt UI-flater:
  - `RoundProgress`
  - `MobileBottomBar`
  - `PanelDrawer`
  - `PlayerStatusPanel`
  - `PrimaryPhasePanel`
  - `MadoSlotGrid`
  - `OpponentsPanel`
  - `ShareInsightPanel`
  - `BattleHistoryPanel`
  - `ConnectionStatus`
- Mobil-layout:
  - Minimal topp med bare liten brand/ikon eller kompakt `Violent Wizards`.
  - Fasebar rett under topp.
  - Hovedhandling fyller mesteparten av skjermen.
  - Fast bunnbar viser egen helse tydelig og ikonknapper for `Opponents`, `Share insight` og `Battle history`.
  - Ikonknappene åpner modal/drawer-popups, ikke inline seksjoner.
- Desktop/tablet-layout:
  - Konseptnær flate med status/egen info, hovedhandling og høyre sidepaneler.
  - Sidepaneler kan vises inline på brede skjermer, men samme komponenter brukes i drawers på mobil.

## Behavior And Data
- Ingen server-API, socket event eller `GameSnapshot`-endringer.
- UI skal fortsatt bare vise informasjon spilleren har lov til å se.
- Motstanderpanel viser navn, alive/dead, online/offline og insight level/range, ikke helse eller skjulte skadetall.
- Share insight-popup bruker eksisterende share-flow og select-felter.
- Battle history-popup viser eksisterende historikk uten nye skadedetaljer.
- Connection/status i lobby holdes minimalt og viser ikke `Socket ID`, `Clients` eller `Server time`.

## Visual Direction
- Bruk design tokens for bakgrunn, paneler, border, tekst, muted tekst, gull, teal og fare.
- Paneler skal ha mørke flater, tynne brass/gull-kanter, 8px radius eller mindre, subtil dybde og tydelig typografi.
- Mado-valg skal være store, trykkvennlige kort med tydelig selected/disabled state.
- Primary action-knapper skal ligne konseptets gullknapper, men fortsatt være tilgjengelige og responsive.
- Mobil bunnbar skal føles som spill-HUD: kompakt, alltid tilgjengelig og ikke dekke kritiske kontroller.

## Test Plan
- Kjør `npm install` etter `lucide-react`.
- Kjør `npm run typecheck`.
- Kjør `npm test` hvis miljøet tillater det.
- Kjør `npm run build` hvis typecheck passerer.
- Rendered QA:
  - Mobil viewport først: verifiser topp, fasebar, hovedhandling, bunnbar og drawers.
  - Desktop viewport: verifiser konseptnær layout med inline sekundærpaneler.
  - Test statene lobby, round prepare, attack declaration, battle resolution, round cleanup og finished.
  - Test at drawer-knapper åpner/lukker riktig og ikke mister form-state unødvendig.
  - Sjekk at ingen tekst overlapper, ingen horisontal mobilscroll oppstår, og primærhandling er synlig uten tung scrolling.

## Assumptions
- Planen lagres i ny kontekst som `docs/mobile-first-ui-redesign-plan.md` eller tilsvarende.
- `lucide-react` er akseptabel som ny dependency.
- Konseptet er visuell retning, ikke pikselpresis funksjonell spec.
- Mobilopplevelsen prioriteres over desktop-kopi når de er i konflikt.
