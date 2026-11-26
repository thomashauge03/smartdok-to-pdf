# Timer fra SmartDok på ordre i Tripletex

Dato: 2026-11-26. Bygger på innloggingen (`2026-11-24-innlogging-design.md`) og
hentingen av timer (`2026-11-24-hent-timer-design.md`).

## Hvorfor

I dag lager siden et PDF-vedlegg med timene, og noen legger timene inn på en
ordre i Tripletex for hånd. Thomas vil fakturere rett herfra: timene og
maskinene som er hentet fra SmartDok, legges som produkter på ordrelinjer i
Tripletex, på en ny eller en eksisterende ordre, med PDF-en som vedlegg.
Fakturaen lages og sendes fortsatt fra Tripletex.

Det dekker også det som var «prosjekt 2»: å se hva som er fakturert, og kunne
angre.

## Mål

- Etter henting og avgrensing (som i dag) finnes knappen **«Legg på ordre i
  Tripletex»**.
- Brukeren velger **ny ordre** eller **en åpen ordre på prosjektet** i Tripletex.
- **Én ordrelinje per Tripletex-produkt**, med summen av timene: 8 t + 7 t på
  samme maskin blir 15 t. Linjeteksten er produktnavnet fulgt av «arbeid utført
  iht. vedlegg».
- **Prisen kommer fra produktet** i Tripletex.
- **PDF-en** (den samme som «Last ned PDF» lager) legges ved ordren og følger
  neste faktura fra den.
- Før noe sendes, ser brukeren nøyaktig hvilke linjer som legges inn (produkt,
  antall, pris, sum) og bekrefter.
- **Koblingsliste maskin → produkt**, satt opp én gang i appen og endres ved
  behov. Hver SmartDok-maskin peker på ett Tripletex-produkt eller er merket
  **«Faktureres ikke»** (for eksempel firmabiler og tilleggsutstyr som rotortilt
  og henger). Appen foreslår produkt ut fra maskinens kategori og navn
  (størrelse i tonn, type); et forslag er ikke en kobling før brukeren har
  godkjent det.
- **Vern mot dobbel fakturering:** når linjene er lagt på ordren, merkes de
  SmartDok-timene som ble fakturert, som «eksportert eksternt» med
  ordrenummeret. Tabellen får kolonnen **Tripletex** («Ordre 1234») og et filter
  der timer som ikke er sendt, er valgt fra start. Merket kan **fjernes** igjen
  med dobbel bekreftelse.
- I SmartDok kan man finne de samme timene i **Rapporter → Timerapport** med
  filteret «Eksportert ekstern dato» (sett 2026-11-26).
- Alle som har tilgang til siden (tilgangslista fra innloggingsdesignet), kan
  sende til Tripletex. Ingen egen rolle.

## Hvilke rader som blir ordrelinjer

Målt i SmartDok 2026-11-26 (90 dager, 1433 arbeidstimer):

- **Maskinrader** blir linjer: produktet fra koblingslisten, antall = maskintimene.
  «Håndarbeid» er en maskin i SmartDok og kobles som de andre (forventet:
  «Grunnarbeider», 602).
- **Arbeidstimen til personen faktureres ikke i tillegg**: den er tiden bak
  maskintimen. 97 % av arbeidstimene har minst én maskinrad. 235 har flere (maskin
  + tilleggsutstyr); hver maskinrad behandles for seg etter koblingslisten.
- **Arbeidstimer uten maskinrad** (16 rader / 105 t på kundeprosjekter i 90
  dager) blir ikke linjer av seg selv. Forhåndsvisningen viser dem som en
  advarsel med antall timer, så brukeren ser dem før noe sendes.
- **Overtid:** tilleggsrader med lønnsart «Overtid 50%» og «Overtid 100%» blir
  linjer med produktene «50 % overtidsarbeid» (608) og «100 % overtidsarbeid»
  (609), antall = timene fra tilleggsraden. **Overtid er et tillegg oppå
  maskintimene** (Thomas, 2026-11-26): 10 maskintimer der 2 er overtid gir 10 t
  på maskinproduktet pluss 2 t «50 % overtidsarbeid», der produktet er påslaget
  alene. Maskintimene trekkes ikke ned. Andre tillegg (borteliggetillegg,
  matpenger, kjøretillegg osv.) er lønn og blir ikke ordrelinjer; de står
  fortsatt i PDF-en som i dag.
- Linjene regnes ut fra **de samme radene som står i tabellen og PDF-en** etter
  filtrene (det er det «iht. vedlegg» betyr). Rader brukeren har lagt til for
  hånd, finnes ikke i SmartDok: de vises som en advarsel og blir ikke linjer.
- En maskin uten kobling, eller et produkt uten pris, **stopper sendingen** med
  en melding om hvilken maskin/hvilket produkt det gjelder.

## Ikke mål

- Ingen faktura lages eller sendes herfra: bare ordre og ordrelinjer. Det samme
  avgjorde grusappen («ordre aldri faktura»).
- SmartDoks egen «Fakturert»-kolonne endres ikke: API-et kan ikke sette den på
  timer (bare på varer). Merket «eksportert eksternt» er vårt fakturert-merke.
  Får SmartDok en API-funksjon for fakturert på timer senere, kan den tas i bruk.
- Ingen endring av priser i Tripletex.
- Ingen sletting av ordre eller ordrelinjer i Tripletex.

## Anti-mål

- Dobbel fakturering: samme SmartDok-time på to ordrelinjer, eller samme
  sending lagt inn to ganger fordi noen trykket to ganger eller nettet hakket.
- Linjer uten pris eller med feil produkt som sendes uten at brukeren har sett
  dem.
- At denne appen får Tripletex-nøkkelen, SmartDok-nøkkelen, service role eller
  `KRYPTONOKKEL`.
- At svartekst fra Tripletex lagres eller vises rått (adminbordets regel og
  Tripletex' utviklervilkår).

## Tilnærminger

- **A. Adminbordet gjør kallene mot Tripletex og SmartDok gjennom smale
  innganger (valgt).** Samme mønster og samme tilgangssjekk som hentingen.
  Nøklene forlater aldri adminbordet.
- B. Appen får Tripletex-nøkkelen. Valgt bort: et innbrudd her ville åpnet
  regnskapet.
- C. Egen funksjon i Supabase. Valgt bort: samme vern som A, men en ny type
  tjeneste som må holdes ved like.

## Innretning

### Adminbordet (`hauge-maskin-adminbord`)

Nye innganger under `/api/smartdok-pdf/…`, alle med samme tilgangssjekk som i
dag (brukerens navet-token + `smartdok_pdf_har_tilgang()`), `Cache-Control:
private, no-store`, norske `{ feil }`, og logging av metadata i
`hendelseslogg` (aldri beløp utover antall linjer og sum, aldri svartekst):

- **Produkter:** aktive Tripletex-produkter (intern id, nummer, navn, pris eks.
  mva). Til koblingslisten og forhåndsvisningen.
- **Maskiner:** aktive SmartDok-maskiner (id, internnummer, navn, kategori). Til
  koblingslisten.
- **Åpne ordrer på et prosjekt:** ordrer i Tripletex på prosjektet med samme
  nummer som SmartDok-prosjektet, som ikke er lukket/fakturert (nummer,
  dato, kunde, antall linjer).
- **Legg på ordre:** tar prosjektnummer, enten «ny» eller en ordre-id, linjene
  (produkt-id, antall, tekst), SmartDok-timenes id-er og PDF-en. Gjør i
  rekkefølge: (1) ny ordre ved behov (kunde og prosjekt fra Tripletex-prosjektet,
  dagens dato), (2) ordrelinjene, (3) vedlegget med `PUT /order/{id}/:attach`
  (`addToInvoiceMode=NEXT`), (4) `SetExportedExternal` i SmartDok med
  ordrenummeret på timenes id-er. Svarer med ordrenummer og hva som lyktes.
- **Fjern merke:** `UnmarkExportedExternal` i SmartDok for et ordrenummer.
  Endrer ingenting i Tripletex (linjene må fjernes der for hånd om ordren skal
  rettes).

### Vern mot dobbel sending

Hver sending får en rad i en ny tabell i navet **før** noe sendes til Tripletex,
med de SmartDok-id-ene som inngår. En ny sending som inneholder en id som alt
finnes i en sending som ikke er angret, avvises. Statusen lagres som egne ord
(grusappens prinsipp: tilstand er et ord, ikke en setning), for eksempel
`startet`, `sendt`, `sendt_uten_merke` (Tripletex ok, SmartDok-merket feilet;
kan prøves igjen), `ukjent_utfall` (svaret fra Tripletex kom aldri; må sjekkes
i Tripletex før ny sending), `angret`. Bare id-er fra Tripletex lagres, aldri
svartekst.

### Koblingslisten

Ny tabell i navet: SmartDok-maskinens id → Tripletex-produktets **interne** id
(grusappen: ordrelinjer peker på intern id, ikke produktnummeret), eller
«faktureres ikke», med hvem som endret og når. Leses og endres fra appen av alle
med tilgang til siden.

### Appen

- Etter henting: knappen **«Legg på ordre i Tripletex»**. Den åpner en
  forhåndsvisning med valg av ny/eksisterende ordre, linjene (produkt, antall,
  pris, sum), advarsler (timer uten maskin, håndlagte rader, maskiner uten
  kobling) og **«Legg på ordre»**. Etterpå: ordrenummeret og en lenke til
  ordren i Tripletex.
- **Koblingslisten** som egen visning: alle aktive maskiner, med foreslått
  produkt, valgt produkt, eller «Faktureres ikke». Kan nås fra forhåndsvisningen
  når en maskin mangler kobling.
- **Tabellen** får kolonnen Tripletex og filteret «Ikke sendt til Tripletex»,
  valgt fra start (som Fakturert-filteret i dag).
- **Fjern merke** på timer som er sendt, med to bekreftelser
  («Fjerne merket for ordre 1234?» og så en som nevner at ordren i Tripletex
  ikke endres).
- PDF-en sendes som fil til adminbordet, server-til-server, ikke lagret noe sted
  ellers.

## Avgjort av Claude (Thomas kan endre)

- **Hvilke SmartDok-id-er som merkes:** `SetExportedExternal` tar time-id-er, og
  maskin- og tilleggsrader deler id med arbeidstimen sin. Merket settes på de
  arbeidstimene der minst én maskin- eller overtidsrad ble en ordrelinje. Timer
  uten maskin, timer der alle maskiner er «faktureres ikke», og håndlagte rader
  merkes ikke og blir stående som «ikke sendt».
- **Prosjektkobling:** eksakt likt prosjektnummer i SmartDok og Tripletex (68 av
  70 aktive stemte 2026-11-24). Ingen treff eller flere treff stopper sendingen
  med en melding; brukeren velger ikke prosjekt selv.
- **Pris:** hentes med Tripletex' egen `GET /order/orderline/orderLineTemplate`
  for ordren og produktet, så kundepriser og rabatter som er lagt inn i
  Tripletex, gjelder. Prisen fra malen vises i forhåndsvisningen og sendes som
  `unitPriceExcludingVatCurrency` (aldri begge prisfeltene). Mva fra produktet.
- **Antall:** timene sendes som SmartDok har dem, uten avrunding, summert med
  to desimaler.
- **Eksisterende ordre:** nye linjer legges alltid til som egne linjer; ingenting
  slås sammen med linjer som finnes. Forhåndsvisningen viser linjene ordren
  allerede har, så brukeren ser om perioden ligger der fra før. En ordre kan få
  flere PDF-vedlegg.
- **Gjenkjenning ved ukjent utfall:** hver sending får en egen kode som skrives i
  ordrens interne kommentar. Har en sending `ukjent_utfall`, slår adminbordet opp
  ordren på koden før en ny sending tillates, og viser brukeren hva som faktisk
  ble lagt inn. Id-ene i en uavklart sending er sperret til den er avklart.
- **Ordredato:** dagens dato. Perioden står i ordrens interne kommentar,
  ikke på fakturaen.
- **Koblingslisten:** alle med tilgang kan endre den. Hver endring logges (hvem,
  når, fra og til) i adminbordets `hendelseslogg`.

## Kjente fallgruver i Tripletex (fra grusappen)

Fra `hauge-maskin-grus/docs/superpowers/TRIPLETEX-OVERLEVERING.md`:
sesjonstoken med `ttlSeconds` ≥ 300, Basic med brukernavn `0`; ordrelinjer
peker på produktets interne id; `isPrioritizeAmountsIncludingVat: false` og
bare `unitPriceExcludingVatCurrency`, aldri begge prisfeltene; noen filtre på
`/customer` ignoreres stille og må filtreres hos oss.

## Overlatt til den som bygger

- Eksakte rutenavn, svarformater og tabellnavn.
- Hvordan maskin-id og SmartDok-id følger radene i tabellen (skjulte felt i
  `Parsed` eller lignende), så linjene kan regnes ut fra tabellens rader.
- Forslagslogikken for koblingslisten (kategori + tonn i navnet → nærmeste
  gravemaskin-produkt osv.).
- Utseendet, i SmartDok-panelets stil.
- Hvordan «åpen ordre» avgjøres i Tripletex sitt API.
