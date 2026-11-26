# Timer på ordre i Tripletex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fra tabellen med SmartDok-timer: legg maskintimer (og overtid) som produktlinjer på en ny eller eksisterende Tripletex-ordre, legg PDF-en ved, og merk timene i SmartDok med et eget merke som kan angres.

**Architecture:** Adminbordet får smale innganger mot Tripletex og SmartDok (samme tilgangssjekk som hentingen) og en sendingstabell i navet som sperrer dobbel sending. Appen regner ut linjene fra tabellens rader (det som står i PDF-en), viser en forhåndsvisning, og holder koblingslisten maskin → produkt i navet med RLS for brukerne på tilgangslista.

**Tech Stack:** Next.js 16 route handlers (adminbord), TanStack Start + React 19 (app), Supabase/Postgres (navet), PGlite for SQL-tester, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-26-tripletex-ordre-design.md`

## Global Constraints

- Appen får aldri Tripletex-nøkkel, SmartDok-nøkkel, service role eller `KRYPTONOKKEL`. Alle Tripletex- og SmartDok-kall går gjennom adminbordet.
- Alle nye adminbord-innganger: `krevSmartdokPdfTilgang` (401/403), `Cache-Control: private, no-store`, norske `{ feil }`, logg i `hendelseslogg` med bare metadata.
- Svartekst fra Tripletex lagres eller vises aldri; bare status og egne meldinger (adminbordets `tripletex/tilkobling.ts`).
- Tripletex: sesjonstoken med `ttlSeconds` 300, Basic `0:<token>`; ordrelinjer peker på produktets **interne id**; `isPrioritizeAmountsIncludingVat: false` og bare `unitPriceExcludingVatCurrency`. Referanse: `hauge-maskin-grus/supabase/functions/tripletex-ordre/api.ts` (`opprettOrdre`, `leggVedOrdre`, `vurder`).
- Bare ordre og ordrelinjer, aldri faktura. Ingen sletting i Tripletex.
- SmartDok-merket: `exportedExternalId` er tekst. Format `"Tripletex ordre <ordrenummer> (<kode>)"`, unikt per sending, så `UnmarkExportedExternal` bare angrer én sending.
- Linjetekst: `"<produktnavn> – arbeid utført iht. vedlegg"`. Én linje per produkt, antall = sum med to desimaler.
- Overtid er tillegg oppå maskintimene: kolonnene «Overtid 50%»/«Overtid 100%» blir produkt nummer `608`/`609`; maskintimene trekkes ikke ned.
- Bare maskinrader (inkl. «Håndarbeid») og overtid blir linjer. Arbeidstimer uten maskin, håndlagde rader, maskin uten kobling og produkt uten pris vises som advarsler; de tre siste stopper sendingen.
- Prosjekt: eksakt likt nummer i Tripletex; 0 eller flere treff stopper.
- Pris: `GET /order/orderline/orderLineTemplate?orderId&productId` etter at ordren finnes. Forhåndsvisning for ny ordre viser produktets listepris merket «listepris»; resultatet viser prisen som ble brukt.
- Ingen push, migrasjon mot navet eller test-sending mot Tripletex uten Thomas' ja i chatten.
- Adminbord: norsk overalt, `server-only` i filer med nøkler, `git commit -F <fil>`, les `node_modules/next/dist/docs/`. App: bokmål, kommentarer sier hvorfor.

## Review Focus

1. **Dobbeltrykk / to faner sender samme timer** → andre sending avvises (409) fordi id-ene finnes i en aktiv sending. (Task 3-test av `overlapp` + Task 5-sjekk før Tripletex-kall.)
2. **Nettet ryker etter at ordren eller linjene er laget** → status `ukjent_utfall`, id-ene sperret, brukeren får avklaring, ikke en ny sending. (Task 5.)
3. **Bruker har redigert maskintimer i tabellen** → linjene bruker tabellens tall (det PDF-en viser). (Task 7-test.)
4. **Samme arbeidstime med to maskiner der én er «faktureres ikke»** → bare den ene blir linje, timen merkes. (Task 7-test.)
5. **PDF over 4 MB / Vercel-grensen** → norsk melding før sending, ikke 413 fra plattformen. (Task 8.)

---

### Task 1: Navet — koblingsliste og sendinger

**Files (smartdok-to-pdf):**
- Create: `supabase/migrations/0002_tripletex_ordre.sql`
- Create: `src/lib/tripletex-sql.test.ts` (PGlite, samme oppsett som `src/lib/tilgang-sql.test.ts`)

**Interfaces:**
- Produces:
  - `public.smartdok_pdf_produktkobling(maskin_id int primary key, maskinnavn text not null, faktureres boolean not null default true, produkt_id bigint, produktnummer text, produktnavn text, endret_av uuid references auth.users, endret timestamptz not null default now(), check (not faktureres or produkt_id is not null))`. RLS: `select`, `insert`, `update` for `authenticated` med `using/with check (public.smartdok_pdf_har_tilgang())`; ingen delete. Grant tilsvarende.
  - Trigger på produktkobling (security definer, `search_path = public`) som setter `endret_av = auth.uid()`, `endret = now()` og skriver en rad i `public.hendelseslogg (handling 'smartdok_pdf.kobling_endret', utfort_av auth.uid(), detaljer {maskin_id, fra, til})`.
  - `public.smartdok_pdf_sending(id bigserial primary key, kode text unique not null, prosjekt text not null, ordre_id bigint, ordrenummer text, merke text, timer_ider int[] not null, status text not null check (status in ('startet','sendt','sendt_uten_vedlegg','sendt_uten_merke','ukjent_utfall','feilet','angret')), antall_linjer int, opprettet_av uuid, opprettet timestamptz default now(), endret timestamptz default now())`. RLS: `select` for `authenticated` med `smartdok_pdf_har_tilgang()`; ingen skriving for `authenticated`/`anon` (adminbordet skriver med service role).
- [ ] **Step 1: Tester** (stub `hendelseslogg(handling text, utfort_av uuid, utfort_av_epost text, system_id uuid, detaljer jsonb)` og `smartdok_pdf_har_tilgang()` som returnerer en settbar verdi): bruker med tilgang kan lese/legge inn/endre kobling; uten tilgang får ingen rader og insert avvises; `faktureres=true` uten `produkt_id` avvises; endring skriver én rad i `hendelseslogg` med `utfort_av`; `authenticated` kan lese men ikke skrive `smartdok_pdf_sending`; ugyldig status avvises; migrasjonen kan kjøres to ganger.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Migrasjonen (idempotent). **Step 4:** `npm test` → PASS. **Step 5: Commit.**

### Task 2: Adminbordet — maskin-id og merke på timene

**Files (adminbord):** Modify `src/lib/smartdok-pdf/tolk-timer.ts`, `tolk-timer.test.mjs`.

**Interfaces:**
- Produces: `SmartdokTime` får `maskinId: number | null` (`EquipmentId`, bare maskinrader) og `eksterntMerke: string | null` (`ExportedExternalId`, tom streng → null). Ingen andre felt endres.
- [ ] **Step 1: Tester:** maskinrad gir `maskinId` = `EquipmentId`; arbeidsrad gir `null`; `ExportedExternalId: "Tripletex ordre 12 (ab)"` gir samme tekst; `""`/`null` gir `null`; `Object.keys` er de 16 feltene.
- [ ] **Step 2–4:** RED, implementer, `npm test` + `npm run typecheck` grønt. **Step 5: Commit** på grenen `tripletex-ordre`.

### Task 3: Adminbordet — Tripletex-klient og rene hjelpere

**Files (adminbord):**
- Create: `src/lib/smartdok-pdf/tripletex.ts` (`server-only`)
- Create: `src/lib/smartdok-pdf/ordre.ts` (rent), `ordre.test.mjs`
- Modify: `src/lib/prosjekter/smartdok.ts` (eksporter `skrivTilSmartdok(sti: string, body: unknown): Promise<void>` som gjenbruker økt/`kall`, aldri fornyer)

**Interfaces:**
- `tripletex.ts`: `apneTripletex(): Promise<{ hent(sti: string): Promise<{ status: number; json: unknown }>; send(sti: string, init: RequestInit): Promise<{ status: number; json: unknown }> }>` — nøkkel fra `tripletex_tilkobling` (dekrypter), `sesjonstoken` fra `@/lib/tripletex/tilkobling`. Ingen svartekst ut.
- `ordre.ts`:
  - `lagMerke(ordrenummer: string, kode: string): string` → `"Tripletex ordre 1234 (k7x2)"`.
  - `lagKode(): string` — 6 tegn `[a-z0-9]`.
  - `overlapp(nye: number[], aktive: { kode: string; ordrenummer: string | null; timer_ider: number[] }[]): { kode: string; ordrenummer: string | null } | null` — første aktive sending som deler en id.
  - `tolkProdukter(json: unknown): { id: number; nummer: string; navn: string; pris: number | null }[]` — bare aktive.
  - `tolkProsjekt(json: unknown, nummer: string): { id: number; kundeId: number } | "ingen" | "flere"` — eksakt nummer.
  - `tolkApneOrdrer(json: unknown, prosjektId: number): { id: number; nummer: string; dato: string; antallLinjer: number }[]` — `isClosed === false` og `project.id === prosjektId`.
  - `sjekkLinjer(x: unknown): { produktId: number; antall: number; tekst: string }[] | string` — ikke tom, heltall-id, `0 < antall ≤ 10000`, maks to desimaler, tekst 1–200 tegn; ellers norsk melding.
- [ ] **Step 1: Tester** for hver funksjon (eksakt prosjektnummer `"2026118"` mot `"20261180"`; overlapp returnerer `null` ved ingen felles id; `sjekkLinjer` avviser `antall: 1.234`, tom liste, `produktId: "5"`).
- [ ] **Step 2–4:** RED, implementer, grønt (`npm test`, `npm run typecheck`). **Step 5: Commit.**

### Task 4: Adminbordet — leseinnganger

**Files (adminbord):** Create `src/app/api/smartdok-pdf/{produkter,maskiner,ordrer}/route.ts`.

**Interfaces (alle GET, tilgangssjekk, no-store, logg):**
- `produkter` → `{ produkter: { id, nummer, navn, pris }[] }` (alle sider, `fields=id,number,name,isInactive,priceExcludingVatCurrency`).
- `maskiner` → `{ maskiner: { id: number; nummer: string; navn: string; kategori: string }[] }` (aktive, `/Machines?all=true`).
- `ordrer?prosjekt=<nummer>` → `{ prosjekt: { id, kundeId }, ordrer: { id, nummer, dato, linjer: { produktnavn: string; antall: number }[] }[] }` (linjene ordren har fra før, så forhåndsvisningen kan vise dem) eller 409 `{ feil: "Fant ikke prosjekt <nr> i Tripletex." | "Flere prosjekter med nummer <nr> i Tripletex." }`. Ordrer for kunden med `isClosed=false`, filtrert på prosjekt-id med `tolkApneOrdrer`.
- [ ] **Step 1:** Implementer. **Step 2:** `npm run typecheck`, `npm test`, `npm run build`; lokal curl uten token → 401 på alle tre. **Step 3: Commit.**

### Task 5: Adminbordet — legg på ordre, fjern merke, avklar

**Files (adminbord):** Create `src/app/api/smartdok-pdf/{legg-paa-ordre,fjern-merke,avklar}/route.ts`, `src/lib/smartdok-pdf/send-ordre.ts` (`server-only`).

**Interfaces:**
- `POST legg-paa-ordre` body `{ prosjekt: string; ordre: { ny: true } | { id: number }; linjer: Linje[]; timerIder: number[]; pdf: string /* base64 */; filnavn: string; periode: { fra: string; til: string } }` → `{ status: "sendt" | "sendt_uten_vedlegg" | "sendt_uten_merke" | "ukjent_utfall"; kode; ordrenummer; ordreId; linjer: { produktId; antall; pris }[] }`. `export const maxDuration = 120`.
- Rekkefølge i `sendOrdre(input, bruker)`: valider (`sjekkLinjer`, ikke-tomme unike `timerIder`, pdf ≤ 4 MB) → prosjekt (`tolkProsjekt`, 409) → `overlapp` mot sendinger med status ≠ `angret`/`feilet` (409 «Timene er alt sendt til ordre …») → insert `startet` → ny ordre (`customer`, `project`, `orderDate`/`deliveryDate` i dag, `internalComment` `"SmartDok til PDF <kode>, <fra>–<til>"`, `isPrioritizeAmountsIncludingVat:false`) eller GET eksisterende (må høre til prosjektet og være åpen; legg koden til `internalComment` med PUT) → lagre `ordre_id`/`ordrenummer` → pris per linje fra `orderLineTemplate` (mangler pris → `feilet` uten linjer, melding med produkt) → `POST /order/orderline/list` → `PUT /order/{id}/:attach?addToInvoiceMode=NEXT` (multipart `file`) → `skrivTilSmartdok('/WorkHours/SetExportedExternal?exportedExternalId=<merke>&setAsExportedExternal=true', timerIder)` → status. Tidsavbrudd/nettfeil etter at ordre eller linjer er sendt → `ukjent_utfall`. Feil på vedlegg → `sendt_uten_vedlegg` (merket settes likevel). Feil på merke → `sendt_uten_merke`.
- `POST fjern-merke {kode}`: bare for `sendt`, `sendt_uten_vedlegg`; `UnmarkExportedExternal?exportedExternalId=<merke>` → `angret`. For `sendt_uten_merke` settes bare `angret`.
- `POST avklar {kode, valg: "sjekk" | "frigi" | "merk"}`: `sjekk` → `{ funnet: boolean; ordrenummer; antallLinjer }` (ordre_id om kjent, ellers kundens ordrer med `orderDate` = opprettelsesdag og koden i `internalComment`); `frigi` → `angret` (fra `ukjent_utfall` eller `sendt_uten_merke`); `merk` → setter merket og `sendt` (fra `ukjent_utfall` når ordren er funnet, eller `sendt_uten_merke`).
- [ ] **Step 1:** Implementer. **Step 2:** typecheck/test/build grønt; lokal curl uten token → 401 på alle tre. **Step 3: Commit.**

### Task 6: Appen — skjulte id-er og Tripletex-kolonne i tabellen

**Files:** Modify `src/lib/smartdok-timer.ts`, `smartdok-timer.test.ts`, `src/lib/smartdok.functions.ts` (zod: `maskinId`, `eksterntMerke`), `src/routes/index.tsx` (forhåndsvalg av filteret).

**Interfaces:**
- `SmartdokTime` får `maskinId: number | null`, `eksterntMerke: string | null`.
- Hver rad fra `byggTabell` får skjulte nøkler (ikke i `columns`, ikke i PDF): `__id` (arbeidstimens id, også foreldreløse grupper) og `__maskin<i>` (maskin-id for `Maskinnavn<i>`).
- Ny kolonne «Tripletex» (`filter: true`, ikke `sum`): `"Ordre <nummer>"` hentet fra `eksterntMerke` (`/^Tripletex ordre (\S+)/`), annet merke → merket som det er, ingen → `"Ikke sendt"`. `Parsed.tripletexKey?: string`.
- `index.tsx`: ved henting forhåndsvelg `filters[tripletexKey] = new Set(["Ikke sendt"])` i tillegg til Fakturert.
- [ ] **Step 1: Tester:** `__id`/`__maskin1` finnes og er ikke i `columns`; kolonnen viser `"Ordre 1234"` for `"Tripletex ordre 1234 (ab12cd)"`, `"Ikke sendt"` for `null`; `tripletexKey` peker på kolonnen; Excel-banen uendret.
- [ ] **Step 2–4:** RED, implementer, `npm test` + `npx tsc` grønt. **Step 5: Commit** på grenen `tripletex-ordre`.

### Task 7: Appen — ordrelinjer og forslag (rent)

**Files:** Create `src/lib/ordrelinjer.ts`, `ordrelinjer.test.ts`.

**Interfaces:**
- `type Produkt = { id: number; nummer: string; navn: string; pris: number | null }`
- `type Kobling = { maskinId: number; faktureres: boolean; produktId: number | null }`
- `beregnOrdrelinjer(rows: Row[], columns: ColMeta[], koblinger: Kobling[], produkter: Produkt[]): { linjer: { produktId: number; produktnavn: string; antall: number; tekst: string; listepris: number | null }[]; timerIder: number[]; advarsler: { utenMaskin: number; haandlagde: number; utenKobling: string[]; utenPris: string[] } }` — leser tallene fra tabellens celler («Maskin<i> Timer», «Overtid 50%», «Overtid 100%»), maskin-id fra `__maskin<i>`, overtid til produkt nummer `"608"`/`"609"`. `utenMaskin` = timer på rader med `__id` uten noen maskin; `haandlagde` = rader uten `__id`.
- `foreslåProdukt(maskin: { navn: string; kategori: string }, produkter: Produkt[]): { faktureres: false } | { produktId: number } | null` — «Firmabiler»/«Tilleggsutstyr» → `{ faktureres: false }`; navn «Håndarbeid» → produkt «Grunnarbeider»; Gravemaskiner → tonn fra navn (`(\d+([.,]\d+)?)\s*(t|tonn)`, ellers modell: `Cat 3NN` → NN, `ECR?|EC|SK` + `NNN` → NNN/10) og nærmeste «N t gravemaskin»-produkt; Dumperer/Traktor-hjullastere → produkt som inneholder modellkoden (f.eks. `A30`, `A25`, `A20`, `C50`, `L180`, `L 90`/`L90`, `L110`, `906`); ellers `null`.
- [ ] **Step 1: Tester:** 8 t + 7 t samme maskin → én linje 15; to maskiner på én rad der én er `faktureres:false` → én linje, `timerIder` har raden; overtid 2 t → linje på 608 og maskintimene uendret; redigert celle «Maskin1 Timer» = 6 brukes; rad uten `__id` teller i `haandlagde`; maskin uten kobling i `utenKobling`; produkt uten pris i `utenPris`; tekst `"25 t gravemaskin m/ GPS – arbeid utført iht. vedlegg"`; forslag: «Cat 324 E» → 25 t, «Kobelco SK140 SRLC 7» → 16t (nærmeste til 14), «Volvo L180G» → «Hjullaster L180G», «Håndarbeid» → Grunnarbeider, «Opel Combo» i Firmabiler → faktureres ikke, «Innleid Henger» i Lastebiler → `null`.
- [ ] **Step 2–4:** RED, implementer, grønt. **Step 5: Commit.**

### Task 8: Appen — server-funksjoner

**Files:** Create `src/lib/tripletex.functions.ts`; Modify `src/lib/adminbord-svar.ts` om nødvendig.

**Interfaces (alle med samme innlogging/tilgang/`ADMINBORD_URL`/redirect manual/zod som `smartdok.functions.ts`, gjenbruk `kallAdminbord`):**
- `hentTripletexProdukter` (GET), `hentSmartdokMaskiner` (GET), `hentApneOrdrer({ prosjekt })`, `leggPaaOrdre({ … })` (samme body som Task 5; avvis `pdf` > 4 MB base64 med «PDF-en er for stor til å sendes.»), `fjernMerke({ kode })`, `avklarSending({ kode, valg })`.
- Via brukerens Supabase-økt (RLS, ikke adminbordet): `hentKoblinger()`, `lagreKobling({ maskinId, maskinnavn, faktureres, produktId, produktnummer, produktnavn })`, `hentSendinger({ prosjekt })`.
- [ ] **Step 1:** Implementer. **Step 2:** tsc/test/build; klientbygget uten `ADMINBORD_URL|getSession|createServerClient`. **Step 3: Commit.**

### Task 9: Appen — forhåndsvisning, koblingsliste og angring

**Files:** Create `src/components/LeggPaaOrdre.tsx`, `src/components/Koblingsliste.tsx`; Modify `src/routes/index.tsx` (knapp ved «Last ned PDF», bare når tabellen kom fra SmartDok).

- [ ] **Step 1:** «Legg på ordre i Tripletex» åpner en dialog i SmartDok-panelets stil: valg «Ny ordre» / åpne ordrer på prosjektet (nummer, dato, og linjene ordren har fra før); linjene fra `beregnOrdrelinjer` på **de filtrerte radene, de samme som går i PDF-en**, med pris (listepris merket «listepris» ved ny ordre) og sum; advarsler; «Legg på ordre» deaktivert ved `utenKobling`/`utenPris`; PDF fra `generatePdf(...)` med de synlige radene/kolonnene og `doc.output("arraybuffer")` → base64; dobbeltklikk-vern.
- [ ] **Step 2:** Resultat: ordrenummer, status med norsk forklaring per statusord, lenke `https://tripletex.no/execute/orderMenu?orderId=<id>`; tabellen hentes på nytt så Tripletex-kolonnen oppdateres.
- [ ] **Step 3:** Koblingsliste (egen dialog fra panelet og fra advarselen): alle aktive maskiner, forslag fra `foreslåProdukt` vist som forslag til brukeren trykker «Godkjenn», søkbar produktvelger, «Faktureres ikke».
- [ ] **Step 4:** Sendinger på prosjektet (fra `hentSendinger`): per sending ordrenummer, status og knapper: «Fjern merke» (to bekreftelser, den andre sier at ordren i Tripletex ikke endres), og for `ukjent_utfall`/`sendt_uten_merke` «Sjekk i Tripletex» → «Merk som sendt» / «Frigi timene».
- [ ] **Step 5:** tsc/test/build grønt; lokal forhåndsvisning med midlertidig rute (slettes før commit) for å se dialogene. **Step 6: Commit.**

### Task 10: Ut i drift (stopper for Thomas' ja)

- [ ] **Step 1:** Spør; kjør `node db/kjor.mjs` (0002) mot navet; verifiser RLS og trigger med lesespørringer.
- [ ] **Step 2:** Spør; merge og push adminbordet; curl uten token → 401 på alle nye innganger.
- [ ] **Step 3:** Spør; merge og push appen.
- [ ] **Step 4:** Thomas setter opp koblingslisten og gjør én ekte sending på en liten periode, og sjekker ordren, linjene, prisen og vedlegget i Tripletex og merket i SmartDoks Timerapport; så «Fjern merke» på den.
