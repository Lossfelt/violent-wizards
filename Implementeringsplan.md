# Implementeringsplan for Violent Wizards v1

Dette dokumentet er skrevet for en implementeringsrunde som ikke kjenner samtalen som ledet frem til reglene. Bruk `Konsept og regler.md` som menneskelig/regelmessig kilde, og dette dokumentet som teknisk plan for en spillbar v1.

## Mål for v1

Bygg en spillbar webapp der flere spillere kan bli med i samme spill via kort kode eller QR-kode. Spillet skal kunne brukes i samme rom på mobiltelefoner, men skal ikke være avhengig av Bluetooth, Wi-Fi discovery eller native mobil-API-er.

V1 skal fokusere på spillbar regelkjerne, ikke ferdig produksjonskvalitet. Eksisterende React-kode er gammel og kan erstattes.

## Foreslått teknisk retning

- Bygg som moderne webapp, helst med TypeScript.
- Bruk en server-autoritativ modell. Klienten skal aldri eie sannheten om helse, skjoldfrekvenser, Mado-frekvenser, innsiktspoeng eller kampresultater.
- Bruk realtime-kommunikasjon for lobby, rundestatus, kampvalg og kampavvikling. `Socket.IO` eller WebSocket er naturlig.
- Foreslått enkel stack: `Vite + React + TypeScript` på frontend, `Node.js + Express + Socket.IO` på backend.
- Persistens kan i v1 være in-memory per serverprosess. Database kan vente til senere.
- Ingen brukerkontoer i v1. Spillere identifiseres med session-id i browseren og visningsnavn valgt ved join.

## Kjernebegreper

- `Game`: ett aktivt spill med lobbykode, runde, spillere, status og innstillinger.
- `Player`: én deltaker med navn, helse, skjoldfrekvens, Mado-slots, innsikt om andre spillere og status.
- `Mado`: ett våpen med frekvens og fast grunnskade.
- `Mado-slot`: kan enten inneholde en klar Mado eller være tom frem til neste rundestart.
- `Insight`: én spillers skjulte kunnskap om en annen spillers skjoldfrekvens.
- `Round`: en full syklus med slot-fylling, forkasting, angrepsvalg, kampavvikling og opprydning.
- `Battle`: én kamp mellom to spillere i en runde.
- `Exchange`: én utveksling i en kamp, der spillere velger Mado eller flykt/avslutt etter reglene.

## Konstanter for v1

```ts
const MAX_MADOS = 5;
const STARTING_HEALTH = 100;
const MADO_BASE_DAMAGE = 25;
const MIN_FREQUENCY = 0;
const MAX_FREQUENCY = 359;
const INSIGHT_NOISE_MIN = 0.75;
const INSIGHT_NOISE_MAX = 1.25;
const INSIGHT_THRESHOLDS = [10, 25, 45, 70, 100];
const INSIGHT_SEGMENT_COUNTS = [1, 2, 4, 8, 16, 32];
const FLEE_DAMAGE_MULTIPLIERS = [0.5, 0.4, 0.3, 0.2, 0.1];
```

## Datastruktur

Minimumsmodell:

```ts
type GameStatus = "lobby" | "round_prepare" | "attack_declaration" | "battle_resolution" | "round_cleanup" | "finished";

type Player = {
  id: string;
  name: string;
  health: number;
  alive: boolean;
  shieldFrequency: number;
  madoSlots: Array<Mado | null>;
  discardedThisRound: Set<number>;
  attackIntent?: { targetPlayerId: string } | { pass: true };
  insightsByTarget: Record<string, InsightState>;
  receivedInsights: InsightTransfer[];
};

type Mado = {
  id: string;
  frequency: number;
  baseDamage: 25;
};

type InsightState = {
  points: number;
  level: number;
  segment: FrequencySegment;
};

type FrequencySegment = {
  level: number;
  index: number;
  start: number;
  end: number;
};

type InsightTransfer = {
  fromPlayerId: string;
  targetPlayerId: string;
  level: number;
  segment: FrequencySegment;
  roundNumber: number;
};

type Battle = {
  id: string;
  roundNumber: number;
  playerAId: string;
  playerBId: string;
  status: "active" | "finished";
  exchanges: Exchange[];
  fleeingPlayerIds: string[];
};

type ExchangeAction =
  | { type: "mado"; madoSlotIndex: number; madoId: string }
  | { type: "flee" }
  | { type: "end" };

type Exchange = {
  index: number;
  actionsByPlayerId: Record<string, ExchangeAction>;
  damageByPlayerId: Record<string, number>;
  insightGainByAttackerId: Record<string, number>;
  fleeingPlayerIdsAfterExchange: string[];
  usedMadoSlotIndexesByPlayerId: Record<string, number[]>;
};
```

Merk: innsiktssegmenter skal ikke genereres som vilkårlige utsnitt sentrert rundt eller forskjøvet fra den faktiske skjoldfrekvensen. For å unngå utilsiktet informasjonslekkasje deles sirkelen deterministisk inn i segmenter per nivå. Nivå 1 har 2 segmenter, nivå 2 har 4, nivå 3 har 8, nivå 4 har 16 og nivå 5 har 32. Spilleren får se segmentet på det aktuelle nivået som inneholder den skjulte skjoldfrekvensen.

## Regelalgoritmer

### Frekvensavstand

```ts
function circularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 360 - diff);
}
```

### Skade

```ts
function calculateDamage(madoFrequency: number, shieldFrequency: number, fleeMultiplier = 1): number {
  const distance = circularDistance(madoFrequency, shieldFrequency);
  const match = 1 - distance / 180;
  return 25 * match * fleeMultiplier;
}
```

Rund skade for visning, men vurder å beholde desimaler internt for enklere balanse.

### Innsikt

Når spiller A gjør faktisk skade på spiller B:

```ts
insightGain = actualDamage * randomFloat(0.75, 1.25)
```

Legg `insightGain` til A sin `InsightState` for B. Oppdater `level` når samlet poengsum passerer tersklene:

- `0-9.999`: nivå 0, hele sirkelen
- `10-24.999`: nivå 1, ett av 2 segmenter
- `25-44.999`: nivå 2, ett av 4 segmenter
- `45-69.999`: nivå 3, ett av 8 segmenter
- `70-99.999`: nivå 4, ett av 16 segmenter
- `100+`: nivå 5, ett av 32 segmenter

Når nivået øker, beregn segmentet for target sin faktiske skjoldfrekvens på det nye nivået. Spilleren skal se segmentet på en sirkel, ikke tallene.

```ts
function getInsightSegment(shieldFrequency: number, level: number): FrequencySegment {
  const segmentCount = INSIGHT_SEGMENT_COUNTS[level];
  const segmentWidth = 360 / segmentCount;
  const index = Math.floor(shieldFrequency / segmentWidth);
  return {
    level,
    index,
    start: index * segmentWidth,
    end: (index + 1) * segmentWidth,
  };
}
```

### Informasjonsutveksling

Spillere må kunne dele innsikt med hverandre i appen. V1 bør støtte en enkel skjerm som kan åpnes når spilleren ikke er i kamp.

- Spilleren velger en mottaker.
- Spilleren velger en annen spiller de har innsikt om.
- Appen viser hvilket innsiktsnivå/segment som kan deles.
- Når informasjon sendes, får mottakeren minst samme innsiktsnivå og segment om target.
- Mottakerens `points` settes til minst minimumsterskelen for mottatt nivå. Eksempel: mottar man nivå 3, må `points` minst settes til `45`. Dette hindrer mismatch der UI viser et nivå regelmotoren ikke mener spilleren har.
- Hvis mottakeren allerede har høyere innsiktsnivå om samme target, skal informasjonen ikke nedgradere mottakerens innsikt.
- Informasjonsdeling bør registreres i privat historikk for avsender og mottaker, men trenger ikke være offentlig.
- Døde spilleres frekvensinformasjon skal fjernes etter dødsopprydding etter reglene i konseptdokumentet.

## Spillflyt

### Lobby

- Én spiller oppretter et spill.
- Server genererer en kort spillkode.
- Klienten viser kode og QR-lenke.
- Andre spillere joiner med kode eller QR.
- Host starter spillet når alle er klare.
- Ved start får hver spiller `100` helse, tilfeldig skjoldfrekvens og fem Mados.

### Rundestart

- Alle tomme Mado-slots fylles med nye Mados.
- Mados som ikke ble brukt eller forkastet i forrige runde blir liggende.
- Spillere ser egne Mados, egen helse, egen skjoldfrekvens og kjent informasjon om andre spillere.

### Forkastingsfase

- Hver spiller kan forkaste null til fem Mados.
- Forkastede slots blir tomme resten av runden.
- Forkastede slots fylles først ved starten av neste runde.

### Angrepsfase

- Hver levende spiller velger enten å angripe én annen levende spiller eller stå over.
- Alle valg sendes inn før matchmaking løses.
- En spiller kan bare være med i én kamp per runde.
- Hvis A og B angriper hverandre, blir det én kamp mellom dem.
- Hvis flere angriper samme mål, velges én angriper tilfeldig til å få kampen.
- Angripere som ikke blir valgt mister handlingen sin den runden.

### Kampavvikling

- Alle kamper i samme runde regnes som samtidige.
- Praktisk kan appen avvikle alle kamper parallelt for involverte spillere.
- Resultater fra runden trer i kraft etter at alle kampene i runden er ferdige.
- Siden hver spiller bare kan være i én kamp per runde, kan kampene beregnes uavhengig og commits sammen etterpå.

### Kampregler

- Første utveksling krever at begge velger en Mado hvis de har en Mado.
- Hvis en spiller ikke har Mados, flykter spilleren automatisk fra start.
- Hvis begge spillere starter uten Mados, flykter begge automatisk og kampen avsluttes uten skade.
- Etter første utveksling kan hver spiller velge Mado eller flykt.
- Hvis en spiller velger flykt, er valget permanent for resten av kampen.
- Når én spiller flykter, velger den andre for hver videre utveksling om de vil skyte en Mado eller avslutte kampen.
- Hvis en spiller skyter mens den andre flykter, brukes fluktmodifikatorene `0.5`, `0.4`, `0.3`, `0.2`, `0.1` for første til femte fluktrunde. Femte verdi trengs hvis en spiller flykter fra start fordi de ikke har Mados.
- Informasjonsgevinst bruker faktisk skade etter fluktmodifikator.
- Kampen slutter når begge trekker seg tilbake/avslutter, når begge er tomme for Mados, eller når én er tom mens den andre flykter.
- Hvis begge spillere tar dødelig skade i samme simultane utveksling, dør begge.
- Hvis ingen spillere er igjen i live, ender spillet uavgjort.

### Rundeopprydning

- Brukte Mados fjernes fra slots.
- Spillere med helse `<= 0` markeres som døde.
- Informasjon om døde spilleres frekvenser fjernes fra aktive spillere etter behov.
- Kamp blir lagt til offentlig kamphistorikk.
- Hvis én spiller er i live, er spillet ferdig og den spilleren vinner.
- Hvis ingen spillere er i live, er spillet ferdig uavgjort.
- Ellers starter neste runde.

## UI-visninger

### Host/lobby

- Opprett spill.
- Vis lobbykode og QR-kode.
- Vis spillerliste.
- Start spill.

### Spillerens hovedskjerm

- Egen helse som tall.
- Eget skjold som markør på sirkel.
- Fem Mado-slots med frekvens visualisert som markører på sirkel.
- Liste over levende spillere.
- Kjent frekvensområde for hver motstander som segment på sirkel.
- Offentlig kamphistorikk.
- Knapp eller handling for å åpne informasjonsdeling når spilleren ikke er i kamp.

### Forkastingsfase

- Marker Mados som skal forkastes.
- Bekreft valg.
- Vis tydelig at forkastede slots er tomme gjennom resten av runden.

### Angrepsfase

- Velg en motstander eller stå over.
- Ventestatus til alle har valgt.

### Kampfase

- Vis motstander.
- Vis egne tilgjengelige Mados.
- Første utveksling: velg Mado hvis tilgjengelig.
- Senere utvekslinger: velg Mado eller flykt.
- Hvis motstander flykter: vis valg om å skyte videre eller avslutte.
- Etter hver utveksling: vis egen skade tatt, egen gjenstående helse, Mados brukt, og eventuell ny innsikt.

### Etter kamp/runde

- Vis kort oppsummering av egen kamp.
- Vis offentlig kamphistorikk for runden.
- Vis om spillere døde.
- Gå videre til neste runde når alle er klare eller automatisk etter kort pause.

### Informasjonsdeling

- Kan åpnes når spilleren ikke er i kamp. V1 kan enten tillate dette i alle ikke-kampfaser eller begrense det til en egen fase mellom runder.
- Velg mottaker.
- Velg hvilken innsikt som skal deles.
- Bekreft sending.
- Mottaker får en privat notifikasjon eller logginnslag med delt innsikt.

## Designkrav for v1

- Mobile first. Alle hovedhandlinger skal fungere godt på telefon.
- UI bør være mørkt, okkult og lesbart, men ikke overdøve bruken i et sosialt rom.
- Frekvenser må visualiseres som sirkler og segmenter, ikke tall.
- Tall for skade og helse kan vises til egen spiller. Motstanderes helse skal ikke vises.
- Motstanderes innsiktssegmenter skal være raske å lese.
- Unngå at spilleren må forstå formler for å ta grunnleggende valg.

## Implementeringstrinn

1. Avklar åpne spørsmål med bruker.
2. Erstatt gammel frontend-stack med moderne prosjektstruktur.
3. Sett opp server, realtime-kanal og delt TypeScript-typer mellom klient og server.
4. Implementer ren regelmotor uten UI: frekvensavstand, skade, innsikt, Mado-generering, rundeopprydning.
5. Skriv tester for regelmotoren.
6. Implementer lobby med spillkode og join.
7. Implementer rundeflyt: slot-fylling, forkasting, angrepsvalg, matchmaking.
8. Implementer kampflyt og samtidig resultat-commit for runden.
9. Implementer innsiktsvisning med sirkler/segmenter.
10. Implementer informasjonsdeling mellom spillere.
11. Implementer kamphistorikk, død, seier og uavgjort.
12. Gjør en lokal playtest med flere nettleservinduer.
13. Juster tekst, timing og UI-friksjon før eventuell hosting.

Stopp etter hvert implementeringstrinn og fortell brukeren hva som ble gjort, hva som ble endret, og hvilke valg som eventuelt gjenstår. Ikke gå videre til neste trinn før brukeren har hatt mulighet til å gi veiledning.

## Tester som bør finnes

- `circularDistance(10, 350) === 20`.
- Full frekvensmatch gir 25 skade.
- 90 graders forskjell gir 12.5 skade.
- 180 graders forskjell gir 0 skade.
- Fluktmodifikator reduserer faktisk skade og innsikt.
- Innsikt krysser terskler og oppdaterer nivå.
- Innsiktssegmentet er riktig deterministisk segment for skjoldfrekvens og innsiktsnivå.
- Informasjonsdeling oppgraderer mottakerens innsikt hvis avsender har høyere nivå.
- Informasjonsdeling nedgraderer ikke mottakerens innsikt hvis mottaker allerede har høyere nivå.
- Informasjonsdeling setter mottakerens `points` til minst minimumsterskelen for mottatt nivå.
- Forkastet Mado-slot er tom resten av runden og fylles neste runde.
- A og B som angriper hverandre blir én kamp.
- Flere angripere mot samme mål gir bare én kamp.
- Spillere som ikke blir valgt til kamp bruker opp handlingen.
- Hvis begge spillere starter kamp uten Mados, avsluttes kampen uten skade.
- Hvis en spiller flykter fra start fordi de mangler Mados, kan motparten bruke femte fluktmodifikator hvis de skyter fem Mados.
- Samtidig dødelig skade dreper begge.
- Ingen levende spillere gir uavgjort.

## Spørsmål som må stilles før eller under bygging

- Skal v1 bygges som lokal utviklingsapp først, eller skal den deployes slik at telefoner kan bruke den via internett?
- Skal spillkoder være korte tallkoder, ordkoder eller begge deler?
- Skal host kunne sette rundeintervall i v1, eller skal v1 først bruke manuell "neste runde"?
- Skal spillere kunne reconnecte hvis de lukker browseren?
- Skal navn være fritekst, eller skal host kunne godkjenne/kicke spillere?
- Skal UI-språket være norsk eller engelsk i v1?
- Hvilken visuell retning ønskes: minimalistisk okkult dashboard, mer dramatisk spillgrafikk, eller noe midt imellom?
- Skal døde spillere fortsatt kunne se kamphistorikk og spillets utvikling?
- Skal død spiller kunne chatte/dele info utenfor appen håndteres kun som gentleman's rule?
- Skal rundeoppsummering vise eksakte skadetall fra egen kamp, eller bare egen helseendring og ny innsikt?
- Skal innsiktssegmentet oppdateres synlig umiddelbart etter hver utveksling, eller først etter kampen?
- Skal informasjonsdeling være tilgjengelig i alle ikke-kampfaser, eller bare i en egen informasjonsfase mellom runder?

## Bevisst utsatt til senere versjoner

- Skjoldrotasjon.
- Momentum eller annen bonus for å ha vært i kamp.
- Varierende Mado-styrke.
- Ulike Mado-typer.
- Helbredelse.
- Drift i skjoldfrekvens.
- Kontoer, historikk på tvers av spill og persistent lagring.
- Native nearby discovery.
