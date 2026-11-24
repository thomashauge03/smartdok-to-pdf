# Hent timer fra SmartDok Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Knappen «Hent fra SmartDok» henter alle timer for ett prosjekt i en periode gjennom smale innganger i adminbordet, og viser dem i samme tabell og PDF som Excel-timene.

**Architecture:** Adminbordet (`C:\Users\thoma\hauge-maskin-adminbord`, Next.js 16) får to route handlers som sjekker brukerens navet-token og `smartdok_pdf_har_tilgang()`, leser SmartDok med den lagrede nøkkelen, og svarer med en smal liste. Denne appens server-funksjoner kaller dem server-til-server med brukerens access-token. En ren funksjon i appen setter radene sammen (tillegg og maskiner på personens rad) til `Parsed`, så resten av siden og PDF-en er uendret.

**Tech Stack:** Next.js 16 route handlers, `@supabase/supabase-js`, `node --test` (`.test.mjs` i adminbordet, `.test.ts` her), TanStack Start `createServerFn`, zod.

**Spec:** `docs/superpowers/specs/2026-11-24-hent-timer-design.md`

## Global Constraints

- Denne appen får aldri service role, `KRYPTONOKKEL` eller SmartDok-nøkkelen. Ny env her: bare `ADMINBORD_URL` (ikke hemmelig).
- Adminbordets innganger svarer 401 uten gyldig navet-token, 403 når `smartdok_pdf_har_tilgang()` ikke er `true`.
- Fra SmartDoks brukerliste går bare **navnet** videre. Ingen andre SmartDok-felt enn de i `SmartdokTime` (Task 1) forlater adminbordet.
- SmartDok-kall etter hverandre, aldri samtidig. 429: én pause (Retry-After, maks 10 s) og ett nytt forsøk — bruk adminbordets eksisterende `kall()` i `src/lib/prosjekter/smartdok.ts`.
- SmartDok-nøkkelen fornyes **aldri** fra denne koden.
- `/WorkHours` maks 93 dager per kall; perioden totalt maks 366 dager; `fra <= til`; format `YYYY-MM-DD`.
- Ingen skriving til SmartDok eller Tripletex.
- Adminbord: alt på norsk (også filnavn/funksjoner), `server-only` i filer som leser nøkler, `npm run typecheck`, `npm test`, `npm run build` grønne; commit-melding via `git commit -F <fil>`; les `node_modules/next/dist/docs/` før route handlers (Next 16).
- Denne appen: bokmål i synlig tekst og kommentarer; kommentarer sier hvorfor. `npx tsc --noEmit -p .`, `npm test`, `npm run build` grønne.
- Ingen push eller kjøring mot levende systemer uten Thomas' ja i chatten.
- SmartDok-format (målt 2026-11-24): `Date` = `"2026-11-10T00:00:00"`; `OrdinaryHoursFrom/To` = desimaltimer (7, 11, kan være 7.5); `NetHours` på tilleggsrader er mengden (timer eller enheter, f.eks. 60); `AeNumber` er fritekst (ikke timer — brukes ikke).

## Review Focus

1. **Tillegg/maskin uten vanlig rad** (≈3 % av radene): skal bli egne rader, ikke forsvinne. (Task 3-test.)
2. **Samme lønnsart to ganger på én arbeidstime** (f.eks. to «Borteliggetillegg»): verdiene summeres i kolonnen, ikke overskrives. (Task 3-test.)
3. **Utløpt eller manglende økt** når «Hent timer» trykkes: norsk melding og vei til innlogging, ikke en hengende knapp. (Task 4.)
4. **Adminbordet nede / `ADMINBORD_URL` mangler / SmartDok 429**: norsk melding i panelet; Excel-opplastingen virker fortsatt. (Task 4 + Task 5.)
5. **Periode over 366 dager eller fra > til** stoppes både i panelet og i adminbordet. (Task 1-test + Task 5.)

---

### Task 1: Adminbordet — ren tolking av SmartDok-timer

**Files (adminbordet):**
- Create: `src/lib/smartdok-pdf/tolk-timer.ts`
- Create: `src/lib/smartdok-pdf/tolk-timer.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export type SmartdokTime = {
    id: number            // WorkHourID
    maskinradId: number | null   // MachineHourId
    type: 'arbeid' | 'tillegg' | 'maskin'
    dato: string          // 'YYYY-MM-DD'
    fra: number | null    // OrdinaryHoursFrom
    til: number | null    // OrdinaryHoursTo
    navn: string          // fra brukerlista, '' hvis ukjent
    aktivitet: string     // WorkDescription
    lonnsart: string      // WageName
    kommentar: string     // Comment
    mengde: number        // NetHours
    fakturert: boolean    // Invoiced
    underprosjekt: string // `${SubProjectNumber} ${SubProjectName}` eller ''
    maskin: string        // maskinnavn fra /Machines, ellers EquipmentCode, ellers ''
  }
  export function tolkTimer(rader: unknown, prosjektnummer: string, navn: Map<string, string>, maskiner: Map<number, string>): SmartdokTime[]
  export function delPeriode(fra: string, til: string): { fra: string; til: string }[]   // biter på maks 93 dager, sammenhengende, uten overlapp
  export function sjekkPeriode(fra: string, til: string): string | null   // norsk feilmelding eller null
  export function tolkNavn(brukere: unknown): Map<string, string>     // Users: Id → Name (bare navnet)
  export function tolkMaskiner(maskiner: unknown): Map<number, string> // Machines: Id → Name
  ```
  `rader` kan være array eller `{ Items }`. `type`: `MachineHourId` satt → `maskin`; `WageAddition || UnitAddition` → `tillegg`; ellers `arbeid`. Filtrer på `String(ProjectNumber) === prosjektnummer`. Navn slås opp på `String(UserID)`.

- [ ] **Step 1: Skriv testene** (`node:test`, importer `./tolk-timer.ts`):
  - `tolkTimer` tar bare rader med riktig `ProjectNumber`; godtar både `[...]` og `{ Items: [...] }`.
  - riktig `type` for vanlig, lønnstillegg, enhetstillegg og maskinrad.
  - `dato` er `'2026-11-10'` fra `"2026-11-10T00:00:00"`.
  - `navn` fra kartet; ukjent bruker → `''`. Resultatet har **ingen** andre nøkler enn `SmartdokTime` sine (sjekk `Object.keys`).
  - `maskin` fra kartet, ellers `EquipmentCode`.
  - `delPeriode('2026-01-01','2026-12-31')` gir biter ≤ 93 dager som dekker hele perioden uten hull/overlapp; én dag gir én bit.
  - `sjekkPeriode`: ugyldig format, `fra > til`, og 367 dager gir melding; 366 dager og samme dag gir `null`.
  - `tolkNavn` returnerer bare `Id → Name` (ingen andre felt).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementer.
- [ ] **Step 4:** `npm test` og `npm run typecheck` → grønt.
- [ ] **Step 5: Commit** i adminbordet (ikke push).

### Task 2: Adminbordet — tilgangssjekk, SmartDok-lesing og to ruter

**Files (adminbordet):**
- Modify: `src/lib/prosjekter/smartdok.ts` (eksporter en lesefunksjon som gjenbruker `kall`/`økttoken`)
- Create: `src/lib/smartdok-pdf/tilgang.ts`
- Create: `src/app/api/smartdok-pdf/prosjekter/route.ts`
- Create: `src/app/api/smartdok-pdf/timer/route.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `lesFraSmartdok(stier: string[]): Promise<unknown[]>` i `smartdok.ts`: leser og dekrypterer nøkkelen (`smartdok_tilkobling` id 1), lager én økt, kaller stiene **etter hverandre** med `kall()`. Fornyer aldri. Ingen nøkkel → kaster «SmartDok er ikke satt opp».
  - `krevSmartdokPdfTilgang(request: Request): Promise<{ id: string; epost: string } | Response>` i `tilgang.ts`: leser `Authorization: Bearer <token>`; mangler → `Response` 401. Lager en Supabase-klient med anon-nøkkelen og `global.headers.Authorization` = brukerens token; `auth.getUser(token)` feiler → 401; `rpc('smartdok_pdf_har_tilgang')` ikke `true` → 403. Begge uten innhold utover `{ feil: string }` på norsk.
  - `GET /api/smartdok-pdf/prosjekter` → `{ prosjekter: { nummer: string; navn: string; kunde: string | null; aktiv: boolean }[] }` fra `public.prosjekter` (via `supabaseAdmin`), sortert aktive først, så nummer synkende.
  - `GET /api/smartdok-pdf/timer?prosjekt=&fra=&til=` → `{ timer: SmartdokTime[] }`. `sjekkPeriode` → 400 `{ feil }`. Henter `/Users?all=true`, `/Machines?all=true` og `/WorkHours?fromDate=<bit.fra>&toDate=<bit.til>T23:59:59&onlyAttested=false&includeExported=true&includeMachineHours=true` for hver bit fra `delPeriode`, i én `lesFraSmartdok`-runde. SmartDok-feil → 502 `{ feil: <melding> }`. `export const maxDuration = 120`.
  - Begge ruter: `logg('smartdok_pdf.prosjekter_hentet' | 'smartdok_pdf.timer_hentet', { utfortAv, utfortAvEpost, detaljer: { prosjekt, fra, til, antall } })` — aldri timene selv. `Cache-Control: private, no-store` på svaret.

- [ ] **Step 1:** Les Next 16-guiden for route handlers i `node_modules/next/dist/docs/`.
- [ ] **Step 2:** Implementer etter signaturene. `server-only` i `tilgang.ts` og rutene.
- [ ] **Step 3:** `npm run typecheck`, `npm test`, `npm run build` → grønt.
- [ ] **Step 4: Lokal røyktest uten SmartDok:** `npm run dev`, så `curl -i localhost:3000/api/smartdok-pdf/prosjekter` → 401; med `Authorization: Bearer tull` → 401. (Ingen kall med ekte token her.)
- [ ] **Step 5: Commit** i adminbordet (ikke push).

### Task 3: Appen — sett sammen radene til tabellen

**Files:**
- Modify: `src/lib/smartdok-parser.ts` (eksporter `buildColMeta`, `fmtNum`, og en `vedleggFraMaaneder(maaneder)` trukket ut av `parseSmartdok` uten å endre oppførselen)
- Create: `src/lib/smartdok-timer.ts`
- Create: `src/lib/smartdok-timer.test.ts`

**Interfaces:**
- Produces:
  - `type SmartdokTime` — samme form som i Task 1 (kopi; to repoer).
  - `byggTabell(timer: SmartdokTime[], prosjekt: { nummer: string; navn: string }, periode: { fra: string; til: string }): Parsed`
- Regler:
  - Én rad per `arbeid` (nøkkel `id`). Kolonner (rå overskrifter gjennom `buildColMeta`, i denne rekkefølgen): `Dato`, `Tid`, `Navn`, `Aktivitet`, `Lønnsart`, `Kommentar`, `Timer`, så én kolonne per tilleggs-`lonnsart` i rekkefølgen de først dukker opp, så `Fakturert`, så `Underprosjekt` (bare hvis noen rad har det), så `Maskinnavn1`, `Maskin1 Timer`, `Maskinnavn2`, `Maskin2 Timer` … så mange som den raden med flest maskiner trenger.
  - Tilleggskolonner er alltid `sum: true, align: "right"` (også ukjente lønnsarter). To tillegg med samme lønnsart på samme arbeidstime **summeres**.
  - `tillegg`/`maskin` med `id` som ikke finnes blant `arbeid` → egen rad (dato, navn, aktivitet, og verdien i sin kolonne).
  - `Dato`: `dd.mm.yyyy`. `Tid`: `HH:MM–HH:MM` fra desimaltimer (7.5 → `07:30`), `''` hvis `fra`/`til` mangler. Tall via `fmtNum` (komma).
  - `Fakturert`: `"Ja"` hvis arbeidsraden og alle dens tillegg/maskiner er fakturert, `"Nei"` hvis ingen er, ellers `"Delvis"`.
  - Rader sortert på dato, så tid, så navn.
  - `prosjekt` = `"<nummer> <navn>"`; `vedlegg` fra månedene i perioden (samme tekstform som Excel: «November 2026», «Januar - Mars 2026»).
  - `populatedCols` som i `parseSmartdok`.
- [ ] **Step 1: Skriv testene:** kolonnerekkefølge; tillegg på personens rad; to like tillegg summeres; maskin 1 og 2 på samme rad; foreldreløst tillegg og foreldreløs maskin blir egne rader; `Fakturert` Ja/Nei/Delvis; `Tid` `07:30–15:00`; ingen `Underprosjekt`-kolonne når ingen har det; `vedlegg` for én og flere måneder; Excel-parseren gir samme `vedlegg` som før (eksisterende tester grønne).
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implementer. **Step 4:** `npm test`, `npx tsc --noEmit -p .` → grønt. **Step 5: Commit.**

### Task 4: Appen — server-funksjoner mot adminbordet

**Files:**
- Create: `src/lib/smartdok.functions.ts`
- Modify: `.env.example` (`ADMINBORD_URL=`)

**Interfaces:**
- Consumes: `lagServerKlient` (`src/lib/supabase.server.ts`), `SmartdokTime` (Task 3).
- Produces:
  - `type Svar<T> = { ok: true } & T | { ok: false; feil: string; loggInn?: true }`
  - `hentProsjekter = createServerFn({ method: "GET" })` → `Svar<{ prosjekter: { nummer: string; navn: string; kunde: string | null; aktiv: boolean }[] }>`
  - `hentTimer = createServerFn({ method: "POST" })`, input `z.object({ prosjekt: z.string().min(1), fra: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), til: same })` → `Svar<{ timer: SmartdokTime[] }>`
- Begge: `getUser()` (fornyer økten) → ingen bruker → `{ ok:false, feil:"Du er logget ut. Logg inn på nytt.", loggInn:true }`; `rpc("smartdok_pdf_har_tilgang")` ikke `true` → `{ ok:false, feil: feilmelding("ingen-tilgang") }`; access-token fra `getSession()`; `ADMINBORD_URL` (lest i funksjonen) mangler → «Henting fra SmartDok er ikke satt opp.»; `fetch` med `Authorization: Bearer`, `AbortSignal.timeout(110_000)`; 401 → loggInn; 403 → ingen tilgang; annen feil → adminbordets `feil`-tekst eller «Fikk ikke kontakt med adminbordet.»; svaret valideres med zod før det returneres. Aldri logg tokenet.
- [ ] **Step 1:** Implementer. **Step 2:** `npx tsc --noEmit -p .`, `npm test`, `npm run build`; grep klientbygget for `ADMINBORD_URL|getSession|createServerClient` → ingen treff. **Step 3: Commit.**

### Task 5: Appen — panelet «Hent fra SmartDok»

**Files:**
- Create: `src/components/HentFraSmartdok.tsx`
- Modify: `src/routes/index.tsx` (`handleFile` ~linje 240-261, slippsonen ~linje 285+)

**Interfaces:**
- Consumes: `hentProsjekter`, `hentTimer` (Task 4), `byggTabell` (Task 3).
- `HentFraSmartdok` props: `{ onHentet: (p: Parsed) => void; harTabell: boolean }`.
- [ ] **Step 1:** Trekk ut det `handleFile` gjør etter parsing til `visTabell(p: Parsed, filnavn: string)` i `Index`, uendret oppførsel for Excel.
- [ ] **Step 2:** Panelet under/ved slippsonen, i sidens stil: søkbar prosjektvelger (`src/components/ui/command.tsx` i en Popover; viser «nummer navn», kunde i grått, inaktive merket), to datofelt (standard første og siste dag i inneværende måned), knappen «Hent timer» («Henter…» mens den venter). Panelet laster prosjektlista først når det åpnes. Feil vises i rødt; `loggInn` → lenke til `/logg-inn`. Klient-sjekk av perioden (maks 366 dager, fra ≤ til) før kall.
- [ ] **Step 3:** Er `harTabell`, spør `window.confirm("Erstatte timene i tabellen?")` før henting. Ved svar: `onHentet(byggTabell(...))`; `Index` kaller `visTabell(p, "smartdok-<nummer>")` og setter så filteret på `Fakturert`-kolonnen til `new Set(["Nei"])`.
- [ ] **Step 4:** `npx tsc --noEmit -p .`, `npm test`, `npm run build` → grønt. **Step 5: Commit.**

### Task 6: Ut i drift (stopper for Thomas' ja ved hver push)

- [ ] **Step 1 (controller, lesing):** Lesekall mot SmartDok som bekrefter (skriv bare tellinger): (a) underprosjektrader har hovedprosjektets nummer i `ProjectNumber`; (b) `String(WorkHours.UserID)` treffer `String(Users.Id)` for alle rader (ellers: nøkle navnekartet på `EmployeeNo` i Task 1). Rett Task 1 før push hvis en av dem ikke holder.
- [ ] **Step 2:** Spør Thomas; push adminbordet (`git fetch` + rebase først). Vent på Vercel. `curl -i https://hauge-maskin-adminbord.vercel.app/api/smartdok-pdf/prosjekter` → 401.
- [ ] **Step 3:** `vercel env add ADMINBORD_URL production` og `preview` i denne appen = `https://hauge-maskin-adminbord.vercel.app`.
- [ ] **Step 4:** Spør Thomas; `git fetch`, rebase på `origin/main`, alle sjekker grønne, push. Thomas henter timer for et prosjekt han kjenner og sammenligner med SmartDok / en Excel-eksport for samme periode (antall rader, sum timer, fakturert).
