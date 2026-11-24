# Hent timer fra SmartDok

Dato: 2026-11-24. Bygger på innloggingen (`2026-11-24-innlogging-design.md`).

## Hvorfor

PDF-en er timevedlegget Hauge Maskin sender med tilbud og fakturaer til eksterne
kunder i Tripletex. I dag eksporterer noen Excel fra SmartDok og laster den opp
her. Det skal bli mer automatisk: hent timene rett fra SmartDok, se alt som ligger
der, avgrens til det som skal med, og lag PDF-en som før.

Det faktureres **per prosjekt**.

Dette er prosjekt 1 av 3. De to neste er egne prosjekter med egne design senere:
2. Merke timer som fakturert i SmartDok, med dobbel bekreftelse og mulighet til å
   angre (gjøre dem ufakturert igjen).
3. Tripletex: opprette ordre, eller legge til på en eksisterende ordre.
Dette prosjektet skal ikke bygge noe av 2 eller 3, men innretningen (smale
innganger i adminbordet) skal kunne utvides til dem.

## Mål

- Knappen **Hent fra SmartDok** på forsiden, ved siden av Excel-opplastingen.
- Velg **ett prosjekt** (søkbar liste med nummer og navn) og en **periode** (fra–til).
- Alle timer på prosjektet i perioden hentes, **både fakturerte og ufakturerte**,
  også underprosjekter, både arbeidstimer og maskintimer.
- Timene havner i **samme tabell** som Excel-timene i dag: samme filtre, sortering,
  kolonnevalg, rediger/legg til/slett rader, og samme PDF.
- **PDF-oppsettet skal være likt som i dag** (Thomas). Én rad per arbeidstime,
  med de samme kolonnene som Excel-eksporten gir: tillegg som egne kolonner
  (f.eks. «Overtid 50%», «Tillegg tunnelarbeid») og maskiner som «Maskinnavn N» /
  «Maskintimer N» på personens rad.
- Ny kolonne **Fakturert** (Ja/Nei) som kan filtreres. Når timer hentes fra
  SmartDok, står filteret på **Nei** (ufakturert) fra start; man kan ta det bort
  og se alt.
- Ny kolonne **Underprosjekt** (filtrerbar), bare når noen rader har underprosjekt.
- **Prosjekt**-feltet fylles med «nummer navn», og **Vedlegg**-feltet med perioden,
  begge kan endres som i dag.
- Standardperiode: inneværende måned.
- Excel-opplastingen blir værende uendret.

## Ikke mål

- Ingen skriving til SmartDok eller Tripletex (prosjekt 2 og 3).
- «Pris mot kunde» finnes ikke på timene i SmartDok-API-et og blir ikke med for
  hentede timer.
- Ingen lagring av timer i navet. Hver henting går rett mot SmartDok.
- Ingen henting på tvers av flere prosjekter samtidig.

## Anti-mål

- At denne appen får navets service role-nøkkel, `KRYPTONOKKEL` eller SmartDok-
  nøkkelen. Den har fortsatt bare URL og anon-nøkkel (som i innloggingsdesignet).
- At adminbordets innganger svarer noen som ikke står på tilgangslista
  (`public.smartdok_pdf_har_tilgang()`), eller sender mer enn tabellen trenger.
  Særlig: SmartDoks brukerliste har fødselsdato, telefon og pårørende. Bare
  **navnet** går videre.
- At SmartDok-nøkkelen fornyes noe annet sted enn adminbordets nattlige synk.
  Fornyelse dreper den gamle nøkkelen på stedet.
- At kall til SmartDok går samtidig (SmartDok ba om ett om gangen).

## Tilnærminger

- **A. Adminbordet gjør SmartDok-kallene gjennom smale innganger (valgt).**
  Denne appens server kaller adminbordet med brukerens innlogging; adminbordet
  sjekker tilgangslista, henter fra SmartDok og sender bare det som trengs.
  Nøklene forlater aldri adminbordet. Samme mønster kan senere få «merk som
  fakturert», «angre» og «lag ordre». Pris: to apper endres, og hentingen virker
  ikke når adminbordet er nede.
- B. Denne appen får hovednøklene som internbelastning. Valgt bort: et innbrudd
  her ville åpnet hele navet, i strid med ønsket om å begrense tilgangen.
- C. En egen funksjon i Supabase. Valgt bort: samme vern som A, men en ny type
  tjeneste ingen av appene bruker i dag.

Thomas valgte A.

## Hva SmartDok gir (målt med et lesekall 2026-11-24)

`GET /WorkHours?fromDate=…&toDate=…T23:59:59&onlyAttested=false&includeExported=true&includeMachineHours=true`
(maks 93 dager per kall; ingen prosjektfilter, så det filtreres på `ProjectNumber`):

- Begge typer rader: `WorkHourID`, `Date`, `ProjectNumber`, `ProjectName`,
  `SubProjectNumber`, `SubProjectName`, `UserID`, `EmployeeNo`, `NetHours`,
  `Comment`, `WorkDescription` (aktivitet), `WageName` (lønnsart), `AeNumber`,
  `OrdinaryHoursFrom`/`OrdinaryHoursTo` (tid), **`Invoiced`** (fakturert),
  `Exported`, `ExportedExternal`, `AdminAttested`.
- Maskinrader har `MachineHourId`, `EquipmentId`, `EquipmentCode`.
- Navn: `GET /Users?all=true` → `EmployeeNo`/`Id` → `Name` (lista har også
  sensitive felt som ikke skal videre).
- Maskinnavn: `GET /Machines?all=true` → `Id` → `Name`.
- Autentisering: `POST /Authorize/ApiToken` med nøkkelen fra
  `public.smartdok_tilkobling` (kryptert, `KRYPTONOKKEL`). Se
  `internbelastning/src/lib/smartdok.ts` for kall, 429-pause og tidsavbrudd.

Feltenes eksakte format (dato, tid som tall) må leses av den som bygger.

## Innretning

### Adminbordet (`hauge-maskin-adminbord`, Next.js 16)

To ruter, f.eks. `GET /api/smartdok-pdf/prosjekter` og
`GET /api/smartdok-pdf/timer?prosjekt=<nummer>&fra=YYYY-MM-DD&til=YYYY-MM-DD`:

- **Hvem:** krever `Authorization: Bearer <brukerens navet-access-token>`.
  Adminbordet sjekker tokenet hos Supabase (`getUser`) og kaller
  `smartdok_pdf_har_tilgang()` **som den brukeren** (klient med brukerens token).
  Nei → 401/403 uten innhold.
- **Prosjekter:** fra `public.prosjekter` (adminbordets egen, synket fra
  SmartDok): nummer, navn, kunde. Aktive først.
- **Timer:** leser SmartDok-nøkkelen, henter `/WorkHours` i biter på maks 93 dager
  etter hverandre, filtrerer på prosjektnummeret, slår opp navn og maskinnavn,
  og svarer med en smal liste per time: id, type (arbeid/maskin), dato, fra, til,
  navn, aktivitet, lønnsart, kommentar, timer, fakturert, underprosjekt, AE-nummer,
  maskin, samt `WorkHourID`, tilleggsflaggene og lønnsart som trengs for å sette
  sammen radene. Ingen andre felt fra SmartDok går videre.
- Perioden kan være høyst 366 dager.
- Feil fra SmartDok (429, 401, nede) gir en kort norsk melding som denne appen
  viser videre.
- Hver henting skrives til adminbordets `hendelseslogg` (hvem, hvilket prosjekt,
  hvilken periode, antall rader), ikke selve timene.
- Fornyer aldri SmartDok-nøkkelen.

### Denne appen

- Server-funksjoner som krever innlogging og tilgang, henter brukerens
  access-token fra økten og kaller adminbordet server-til-server. Adresse i
  `ADMINBORD_URL` på Vercel (ikke hemmelig). Nettleseren snakker aldri med
  adminbordet direkte.
- En ren funksjon gjør adminbordets liste om til tabellens format (`Parsed` i
  `src/lib/smartdok-parser.ts`), med tester.
- Radene settes sammen slik Excel-eksporten gjør (målt 2026-11-24, 14 dager):
  - **Vanlige rader** (lønnsart «Timelønn», verken `WageAddition` eller
    `UnitAddition`) er én rad hver, nøklet på `WorkHourID`.
  - **Tilleggsrader** (`WageAddition`/`UnitAddition`, 146 av 155 har samme
    `WorkHourID` som en vanlig rad) blir en kolonne per lønnsart (`WageName`,
    f.eks. «Overtid 50%», «Tillegg tunnelarbeid», «Borteliggetillegg») på den
    vanlige raden, med verdien fra tilleggsraden.
  - **Maskinrader** (296 av 307 har samme `WorkHourID` som en arbeidsrad) blir
    «Maskinnavn N» / «Maskintimer N» på den vanlige raden, i rekkefølge.
  - Tillegg eller maskiner uten en vanlig rad i svaret blir egne rader, så
    ingenting forsvinner stille.
- **Fakturert** på den sammensatte raden: «Ja» bare hvis den vanlige raden er
  fakturert (verdien fra den). Tilleggs- og maskinrader med avvikende
  fakturert-merke vises likevel som del av raden; avviket skal ikke skjules
  (f.eks. vises som «Delvis»).
- Kolonnene og navnene skal være de samme som Excel-varianten
  (`src/lib/smartdok-parser.ts` `KNOWN`), så PDF-en blir lik.

## Avgjort av Claude (Thomas kan endre)

- **Henting erstatter tabellen**, slik det gjør å laste opp en ny Excel-fil i
  dag. Prosjekt- og Vedlegg-feltet fylles på nytt. Har tabellen redigerte rader,
  spør siden «Erstatte timene i tabellen?» før den henter.
- **Tidsgrense:** perioden er høyst 366 dager. Adminbord-ruten får lang nok
  kjøretid på Vercel (f.eks. `maxDuration` 60 s). Rekker den ikke, svarer den med
  en norsk feilmelding som ber om kortere periode – aldri halve data.
- **Underprosjekter:** rader filtreres på `ProjectNumber` (hovedprosjektet), og
  `SubProjectNumber`/`SubProjectName` gir Underprosjekt-kolonnen. Den som bygger
  bekrefter med et lesekall at underprosjektrader har hovedprosjektets nummer i
  `ProjectNumber`.
- **Maskintimer telles ikke dobbelt:** de står i Maskintimer-kolonnene på
  personens rad, som i Excel, og summeres for seg.
- **Prosjektlista** viser alle prosjekter i `public.prosjekter`, aktive først, og
  er søkbar på nummer og navn.
- **Utløpt økt:** denne appen fornyer økten (`getUser`) før den sender
  access-tokenet. Svarer adminbordet 401 likevel, sendes brukeren til innlogging.
- **Rekkefølge ved utrulling:** adminbordet rulles ut først. Mangler
  `ADMINBORD_URL`, eller svarer ikke adminbordet, viser panelet en norsk melding
  og Excel-opplastingen virker som før.

## Overlatt til den som bygger

- Utseendet på «Hent fra SmartDok»-panelet (i samme stil som siden).
- Eksakte rutenavn og svarformat mellom appene.
- Hvordan Next.js-ruten i adminbordet bygges (les `node_modules/next/dist/docs/`,
  Next.js 16; se adminbordets `AGENTS.md` om det finnes).
- Hvordan tid (`OrdinaryHoursFrom/To`) og dato formateres, så det ligner Excel.
