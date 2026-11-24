# Innlogging i SmartDok → PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lås hele siden bak innlogging med navet-kontoen, og slipp bare inn dem som står på tilgangslista (eller er eier).

**Architecture:** Siden logger inn mot navet (Supabase `rxlkybaarxvyrrkkzjhj`) med bare URL og anon-nøkkel. Økten ligger i cookies og leses på serveren med `@supabase/ssr` i TanStack Start-serverfunksjoner. Tilgang avgjøres av SQL-funksjonen `public.smartdok_pdf_har_tilgang()` (security definer) som brukeren selv kaller med sin økt. Adminbordet får tilgangslista inn i Brukere gjennom `tilgangsoppsett`.

**Tech Stack:** TanStack Start 1.168 (React 19, Vite), `@supabase/supabase-js`, `@supabase/ssr`, `node --test` for enhetstester, PGlite for SQL-tester, Supabase Management API for migrasjoner.

**Spec:** `docs/superpowers/specs/2026-11-24-innlogging-design.md`

## Global Constraints

- Appen får **bare** `SUPABASE_URL` og `SUPABASE_ANON_KEY` for navet. Aldri service role-nøkkel, aldri `KRYPTONOKKEL`.
- Env leses inne i funksjoner, aldri på modulnivå (se `src/lib/config.server.ts`).
- Tilgangssjekken skjer på serveren før `/` vises.
- `public.smartdok_pdf_tilgang`: RLS på, `revoke all` fra `anon` og `authenticated`.
- Funksjonen kan kjøres av `authenticated`, ikke av `anon`/`public`.
- Ingen registrering, passordbytte eller «glemt passord».
- Migrasjoner kjøres mot den levende navet-basen **bare etter at Thomas har sagt ja i chatten**.
- Produksjonsadresse: `https://smartdok-to-pdf.vercel.app`.
- Alt synlig på bokmål. Kommentarer sier hvorfor, ikke hva.
- `npx tsc --noEmit -p .`, `npm test` og `npm run build` grønne før push. Hent `origin/main` før push (Lovable/andre kan ha pushet).

## Review Focus

1. **Nøkkelknappen fyller skjemaet:** den setter verdier med native setter + `input`/`change`. Skjemaet må lese verdiene fra `FormData` ved innsending, ikke stole på React-state, ellers sendes tomme felt. (Task 4, browser-steg.)
2. **Tilgang tatt bort mens noen er innlogget:** neste lasting av `/` sender dem til `/logg-inn?ingen-tilgang=1`. (Task 2 `vurderTilgang`-test + Task 4 browser-steg.)
3. **Utløpt eller ugyldig økt-cookie:** `getUser()` feiler → behandles som utlogget, ikke som feilside. (Task 2 test for `null`-bruker + Task 3 håndtering.)
4. **Riktig passord, men ingen tilgang:** økten logges ut igjen på serveren, så det ikke blir liggende en gyldig cookie. (Task 3.)
5. **Den gamle Lovable-kopien** viser siden uten lås til Thomas har avpublisert den. (Task 6, manuell sjekk.)

---

### Task 1: Tilgangslista og tilgangsfunksjonen i SQL

**Files:**
- Create: `supabase/migrations/0001_smartdok_pdf_tilgang.sql`
- Create: `src/lib/tilgang-sql.test.ts`
- Modify: `package.json` (devDependency `@electric-sql/pglite`)

**Interfaces:**
- Produces: tabell `public.smartdok_pdf_tilgang(bruker_id uuid pk → auth.users on delete cascade, navn text not null, epost text not null, aktiv boolean not null default true, opprettet timestamptz not null default now(), endret timestamptz not null default now())`; funksjon `public.smartdok_pdf_har_tilgang() returns boolean` (language sql, security definer, stable, `set search_path = public`) = aktiv rad for `auth.uid()` **eller** `public.er_eier()`.

- [ ] **Step 1: Skriv SQL-testen** i `src/lib/tilgang-sql.test.ts` med PGlite. Oppsett etterligner navet: rollene `anon`, `authenticated`; `auth.users`; `auth.uid()` fra `request.jwt.claim.sub` (som `haugemaskinbroyting/db/pglite.mjs`); `public.admin_brukere(id uuid, rolle text, aktiv boolean)`; `public.er_eier()` slik den er i `hauge-maskin-adminbord/supabase/migrations/0001_init.sql:71-82`; `alter default privileges grant execute on functions to anon, authenticated`. Kjør migrasjonen **to ganger** (den skal tåle det). Tester:
  - `ingen rad → false`
  - `aktiv rad → true`
  - `aktiv = false → false`
  - `eier uten rad → true`
  - `authenticated kan ikke lese tabellen` (select som `authenticated` kaster permission denied)
  - `anon kan ikke kjøre funksjonen` (kaster permission denied)
- [ ] **Step 2:** `npm i -D @electric-sql/pglite`, kjør `npm test`. Forventet: FAIL (fila finnes ikke).
- [ ] **Step 3: Skriv migrasjonen.** Idempotent (`create table if not exists`, `create or replace function`). `alter table … enable row level security; revoke all on … from anon, authenticated;` `revoke execute on function … from public, anon; grant execute … to authenticated;`. Kommentarhode som i `internbelastning/supabase/migrations/0014_tilgang.sql`: hvorfor raden er tilgangen, at `aktiv = false` er «ta bort», at kontoen aldri slettes herfra.
- [ ] **Step 4:** `npm test`. Forventet: PASS.
- [ ] **Step 5: Commit** `supabase/migrations/0001_smartdok_pdf_tilgang.sql src/lib/tilgang-sql.test.ts package.json package-lock.json`.

### Task 2: Ren tilgangslogikk og meldinger

**Files:**
- Create: `src/lib/innlogging.ts`
- Create: `src/lib/innlogging.test.ts`

**Interfaces:**
- Produces:
  - `type Innloggingsstatus = { status: "ute" } | { status: "ingen-tilgang" } | { status: "inne"; epost: string }`
  - `vurderTilgang(bruker: { email?: string | null } | null, harTilgang: boolean | null): Innloggingsstatus`
  - `type Innloggingsfeil = "feil-passord" | "ingen-tilgang" | "ukjent"`
  - `feilmelding(kode: Innloggingsfeil): string`

- [ ] **Step 1: Skriv testene:**
  - `vurderTilgang(null, null)` → `{ status: "ute" }`
  - `vurderTilgang({ email: "a@b.no" }, false)` → `{ status: "ingen-tilgang" }`
  - `vurderTilgang({ email: "a@b.no" }, null)` → `{ status: "ingen-tilgang" }` (feil i sjekken slipper aldri inn)
  - `vurderTilgang({ email: "a@b.no" }, true)` → `{ status: "inne", epost: "a@b.no" }`
  - `feilmelding("feil-passord")` === `"Feil e-post eller passord."`
  - `feilmelding("ingen-tilgang")` === `"Du har ikke tilgang til denne siden. Spør Thomas."`
  - `feilmelding("ukjent")` === `"Noe gikk galt. Prøv igjen."`
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementer i `src/lib/innlogging.ts` (ingen imports fra Supabase; ren logikk).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit.**

### Task 3: Supabase på serveren og serverfunksjonene

**Files:**
- Create: `src/lib/supabase.server.ts`
- Create: `src/lib/innlogging.functions.ts`
- Delete: `src/lib/api/example.functions.ts` (ubrukt eksempel)
- Modify: `package.json` (`@supabase/supabase-js`, `@supabase/ssr`)
- Create: `.env.example` med `SUPABASE_URL=` og `SUPABASE_ANON_KEY=` (tomme)
- Modify: `.gitignore` (legg til `!.env.example`, siden `.env*` ellers skjuler den)

**Interfaces:**
- Consumes: `vurderTilgang`, `Innloggingsstatus`, `Innloggingsfeil` fra Task 2; `smartdok_pdf_har_tilgang` fra Task 1.
- Produces:
  - `lagServerKlient(): SupabaseClient` i `supabase.server.ts` — `createServerClient` fra `@supabase/ssr` med `cookies.getAll` fra `getCookies()` og `setAll` via `setCookie()` fra `@tanstack/react-start/server`. Kaster hvis env mangler.
  - `hentInnlogging` = `createServerFn({ method: "GET" })` → `Promise<Innloggingsstatus>`: `auth.getUser()`; feil/ingen bruker → `vurderTilgang(null, null)`; ellers `rpc("smartdok_pdf_har_tilgang")` (feil → `null`).
  - `loggInn` = `createServerFn({ method: "POST" })`, input `z.object({ epost: z.string().email(), passord: z.string().min(1) })` → `Promise<{ ok: true } | { ok: false; feil: Innloggingsfeil }>`: `signInWithPassword` (feil → `feil-passord`), så rpc; ikke `true` → `auth.signOut()` og `ingen-tilgang`; uventet unntak → `ukjent`.
  - `loggUt` = `createServerFn({ method: "POST" })` → `Promise<void>`: `auth.signOut()`.

- [ ] **Step 1:** `npm i @supabase/supabase-js @supabase/ssr`.
- [ ] **Step 2:** Implementer `supabase.server.ts` og `innlogging.functions.ts` etter signaturene over. Slett eksempelfila.
- [ ] **Step 3:** `npx tsc --noEmit -p .` → ingen feil. `npm test` → PASS.
- [ ] **Step 4: Commit.**

### Task 4: Innloggingssiden, låsen og Logg ut

**Files:**
- Create: `src/routes/logg-inn.tsx`
- Modify: `src/routes/index.tsx` (Route-definisjonen ~linje 32-40, header ~linje 270-281)
- `src/routeTree.gen.ts` regenereres av dev-serveren/bygget

**Interfaces:**
- Consumes: `hentInnlogging`, `loggInn`, `loggUt` (Task 3), `feilmelding` (Task 2).

- [ ] **Step 1: `/logg-inn`.** `validateSearch` tar valgfri `ingen-tilgang`. `beforeLoad`: `hentInnlogging()`; `inne` → `redirect({ to: "/" })`. Skjema i samme stil som siden (mørk topp med `/hmLogo.png`, rød aksent): `<form>` med `<input type="email" name="epost" autoComplete="username">` **før** `<input type="password" name="passord" autoComplete="current-password">` (nøkkelknappen fyller tekstfeltet rett før passordfeltet og hopper over felt som ligner søk/filter, og felt med `new-password`). Ved innsending: les `new FormData(form)`, kall `loggInn`, `ok` → `router.navigate({ to: "/" })` med `router.invalidate()`, ellers vis `feilmelding(feil)`. Med `?ingen-tilgang=1` vises `feilmelding("ingen-tilgang")` fra start. Knappen viser «Logger inn…» mens den venter. `<title>`: «Logg inn | SmartDok → PDF».
- [ ] **Step 2: Låsen på `/`.** I `createFileRoute("/")`: `beforeLoad` kaller `hentInnlogging()`; `ute` → `redirect({ to: "/logg-inn" })`; `ingen-tilgang` → `redirect({ to: "/logg-inn", search: { "ingen-tilgang": 1 } })`; `inne` → returner `{ epost }` som kontekst.
- [ ] **Step 3: Logg ut** til høyre i headeren: e-posten i liten grå tekst og en knapp «Logg ut» (ikon `LogOut`) i samme stil som de mørke kontrollknappene. Klikk → `loggUt()` → `router.navigate({ to: "/logg-inn" })`.
- [ ] **Step 4:** `npx tsc --noEmit -p .` og `npm run build` → grønt.
- [ ] **Step 5: Lokalt i nettleseren** (krever `.env.local` med navets URL og anon-nøkkel, hentet fra Management API `GET /v1/projects/rxlkybaarxvyrrkkzjhj/api-keys` med tokenet fra `C:/Users/thoma/varslingskontroll/db/token.js`; anon-nøkkelen er offentlig, men skriv den aldri i chatten): `preview_start dev`.
  - `/` uten økt → havner på `/logg-inn`.
  - Feil passord → «Feil e-post eller passord.»
  - Simuler nøkkelknappen: sett verdiene med native setter + `input`/`change` (som `settVerdi` i `src/components/Nokkelknapp.tsx`), send inn → riktig felt brukes.
  - Innlogging med testkonto kan bare gjøres etter Task 5 og med en konto Thomas oppgir eller logger inn med selv; Claude skriver aldri inn Thomas' ekte passord.
- [ ] **Step 6: Commit.**

### Task 5: Navet og adminbordet (krever Thomas' ja)

**Files:**
- Create: `db/navet.mjs` (kopi av `haugemaskinbroyting/db/navet.mjs`: `sql(sporring, { lesbar })` mot Management API, token fra Varslingskontroll)
- Create: `db/kjor.mjs` — kjører alle `supabase/migrations/*.sql` i rekkefølge gjennom `sql()`
- Create i adminbordet: `C:\Users\thoma\hauge-maskin-adminbord\supabase\migrations\0031_smartdok_pdf_tilgang.sql`

**Interfaces:**
- Consumes: tabellen fra Task 1.

- [ ] **Step 1: Adminbord-migrasjonen**, samme form som `0030_broytesystem_tilgang.sql`:
  - `update public.systemer` for `slug = 'smartdok-til-pdf'`: `url = 'https://smartdok-to-pdf.vercel.app'`, `supabase_prosjekt_ref = 'rxlkybaarxvyrrkkzjhj'`, `supabase_url = 'https://rxlkybaarxvyrrkkzjhj.supabase.co'`, `konto_id` som adminbordets, nytt `notat` (Vercel, tilgang er en rad i `smartdok_pdf_tilgang`). Sjekk kolonnenavnene for Vercel-prosjekt i `0001_init.sql` og sett dem hvis de finnes.
  - `insert into public.tilgangsoppsett (system_id, skjema, tabell, bruker_kolonne, bruker_nokkel, rolle_kolonne, aktiv_kolonne, modell, etikett, kan_skrive, sortering, ekstra_kolonner, notat)` med `'public', 'smartdok_pdf_tilgang', 'bruker_id', 'auth_id', null, 'aktiv', 'rolletabell', 'Tilgang', true, 10, {"navn":"{{navn}}","epost":"{{epost}}"}`, `on conflict (system_id, etikett) do nothing`.
- [ ] **Step 2: Spør Thomas i chatten** om å kjøre begge migrasjonene mot navet. Vent på ja.
- [ ] **Step 3:** Kjør `node db/kjor.mjs`, deretter adminbord-migrasjonen gjennom `sql()`. Verifiser med lesbar spørring: tabellen finnes, `relrowsecurity = true`, `has_function_privilege('anon', 'public.smartdok_pdf_har_tilgang()', 'execute') = false`, raden i `tilgangsoppsett` finnes, `systemer.url` er Vercel-adressen.
- [ ] **Step 4: Vercel-env.** `vercel env add SUPABASE_URL production` og `SUPABASE_ANON_KEY production` (og `preview`) hvis `vercel whoami` virker og prosjektet er lenket; ellers be Thomas legge dem inn. Verdiene skrives aldri i chatten.
- [ ] **Step 5: Commit** her (`db/`) og i adminbordet (egen commit i det repoet, `git fetch` og rebase før push der også).

### Task 6: Ut i drift og sluttsjekk

- [ ] **Step 1:** `git fetch origin && git rebase origin/main`, `npx tsc --noEmit -p .`, `npm test`, `npm run build`, push.
- [ ] **Step 2:** Når Vercel har rullet ut: `https://smartdok-to-pdf.vercel.app/` uten økt sender til `/logg-inn`; `/.well-known/assetlinks.json` svarer fortsatt 200.
- [ ] **Step 3:** Be Thomas gi seg selv eller en person tilgang under Brukere, logge inn, og sjekke at siden virker; ta bort tilgangen og sjekk at neste lasting gir «ingen tilgang».
- [ ] **Step 4:** Sjekk `https://smartdok-to-pdf.lovable.app`. Viser den fortsatt siden, si fra til Thomas at den må avpubliseres i Lovable.
