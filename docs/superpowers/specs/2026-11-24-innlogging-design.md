# Innlogging i SmartDok → PDF

Dato: 2026-11-24

## Hvorfor

Siden er åpen for alle som har adressen. Thomas vil at den skal være låst, og
at bare folk han har gitt tilgang skal slippe inn. Låsen skal også ligge klar
før siden en dag får kobling til SmartDok og Tripletex (et eget prosjekt
etterpå), så et innbrudd i én konto gir så lite som mulig.

## Mål

- Hele siden ligger bak innlogging, også Excel → PDF-delen.
- Man logger inn på en egen innloggingsside her, med **samme konto** som i
  adminbordet og de andre appene i navet (Supabase-prosjektet `rxlkybaarxvyrrkkzjhj`).
- Bare de som står på tilgangslista for dette systemet slipper inn. En konto i
  navet alene er ikke nok.
- Thomas gir og tar tilgang under **Brukere i adminbordet**, på samme måte som for
  brøytesystemet. Denne siden har ingen egen brukerstyring.
- Eieren (aktiv `eier` i adminbordets `admin_brukere`) slipper alltid inn.
- 🔑-knappen fra Hauge Maskin-appen virker på innloggingssiden (den kommer av seg
  selv når det finnes et passordfelt; `Nokkelknapp` ligger alt i skallet).
- Logg ut-knapp.

## Ikke mål

- Ingen innlogging via adminbordet med engangskode, og ingen felles domene.
  Vurdert og valgt bort (se Tilnærminger).
- Ingen SmartDok- eller Tripletex-kobling nå.
- Ingen registrering, passordbytte eller «glemt passord» her. Kontoer lages og
  passord settes der de lages i dag.
- Ingen roller. Tilgang er av eller på.

## Anti-mål (feil selv om det virker)

- At denne appen får navets **service role-nøkkel** eller `KRYPTONOKKEL`. Den
  skal bare ha prosjekt-URL og den offentlige anon-nøkkelen. Et innbrudd her
  skal ikke åpne resten av navet.
- At en navet-konto uten rad i tilgangslista slipper inn.
- At sjekken bare skjer i nettleseren. Den skal skje på serveren før siden
  vises.
- At tilgangslista kan leses eller endres av vanlige innloggede brukere.

## Tilnærminger

1. **Egen innloggingsside, samme konto (valgt).** Siden logger inn mot navet
   selv og sjekker tilgangslista. Enkelt, likt internbelastning, virker fra
   mobilappen med 🔑. Ulempe: man logger inn én gang til her selv om man er
   innlogget i adminbordet.
2. **Innlogging via adminbordet med engangskode.** Rett inn fra lenken i
   adminbordet, men krever endringer i begge apper og en nøye laget kode-
   overlevering. Valgt bort for å holde det enkelt.
3. **Felles domene** (f.eks. `*.haugemaskin.no`) med delt innloggings-cookie.
   Krever egne domener og endrer innloggingen i adminbordet for alle. Valgt
   bort. (`*.vercel.app` kan ikke dele cookies mellom apper.)

Thomas valgte 1.

## Slik det skal virke

- Ikke innlogget → `/logg-inn` med e-post og passord. Feil passord eller ingen
  tilgang gir en kort melding på norsk. Ingen tilgang: «Du har ikke tilgang til
  denne siden. Spør Thomas.» (eller lignende).
- Innlogget med tilgang → siden som i dag.
- Innlogget uten tilgang (eller tilgangen tatt bort) → ut til `/logg-inn` med
  den meldingen.
- Økten varer like lenge som Supabase sin standard (fornyes av seg selv).

## Tilgangslista

Ny tabell i navet, samme mønster som `internbelastning_tilgang` og
`broyting.bruker`:

- `public.smartdok_pdf_tilgang`: `bruker_id` (uuid, primærnøkkel, → `auth.users`),
  `navn`, `epost`, `aktiv` (default true), `opprettet`, `endret`.
- RLS på, `revoke all` fra `anon` og `authenticated`.
- En SQL-funksjon `public.smartdok_pdf_har_tilgang()` (security definer, fast
  `search_path`) som svarer ja hvis `auth.uid()` har en aktiv rad der, **eller**
  er aktiv `eier` i `admin_brukere`. Bare `authenticated` får kjøre den. Det er
  slik appen sjekker tilgang med bare anon-nøkkelen og brukerens økt.
- «Ta bort» i adminbordet setter `aktiv = false`. Kontoen i `auth.users` slettes
  aldri herfra.

## I adminbordet

En migrasjon i `hauge-maskin-adminbord` (samme form som `0030_broytesystem_tilgang.sql`):

- Oppdater raden `smartdok-til-pdf` i `public.systemer`: `https://smartdok-to-pdf.vercel.app`
  i stedet for `smartdok-to-pdf.lovable.app`, Supabase-ref og -URL for navet, og
  notatet (ligger nå på Vercel, ikke Lovable).
- En rad i `public.tilgangsoppsett`: tabellen over, nøklet på `auth_id`,
  `modell = 'rolletabell'` uten rolle-kolonne, `aktiv_kolonne = 'aktiv'`,
  `kan_skrive = true`, `ekstra_kolonner` for `navn` og `epost`, så Brukere kan
  gi og ta tilgang.

## Hemmeligheter og oppsett

- Vercel får `SUPABASE_URL` og `SUPABASE_ANON_KEY` (eller publishable key) for
  navet. Ikke noe annet.
- Produksjonsadressen er `https://smartdok-to-pdf.vercel.app` (står i
  `hauge-maskin-mobil/twa/LES-MEG.md`, og `assetlinks.json` svarer der).
- 🔑-knappen fyller inn den e-posten og det passordet hver enkelt har lagret i
  sin egen mobilapp. Det finnes ingen felles konto. Hver person må derfor stå på
  tilgangslista selv. Migrasjonen legger ingen personer inn; Thomas gjør det
  under Brukere.
- Eier-sjekken kan bruke den eksisterende `public.er_eier()` i navet.

## Den gamle kopien på Lovable

`https://smartdok-to-pdf.lovable.app` er fortsatt oppe (sjekket 2026-11-24) og
viser hele siden uten lås. Så lenge den står, er låsen på Vercel lite verdt.
Thomas avpubliserer prosjektet i Lovable og kobler fra GitHub-synken der, så
Lovable heller ikke bygger den nye koden uten nøkler. Det kan bare gjøres i
Lovable. Til slutt sjekkes det at den gamle adressen ikke lenger viser siden.

## Viktig å vite

- Koden til siden (JavaScript) er ikke hemmelig og kan lastes ned av hvem som
  helst, som i dag. Låsen styrer hvem som får bruke siden, og den blir det som
  verner data når SmartDok/Tripletex kommer.
- Migrasjonene kjøres mot den levende navet-basen. Det gjøres først etter at
  Thomas har sagt ja.

## Overlatt til den som bygger

- Hvordan økten leses på serveren i TanStack Start (f.eks. `@supabase/ssr` med
  cookies) og hvor sjekken ligger (rotens `beforeLoad` eller lignende).
- Utseendet på innloggingssiden, i samme stil som resten (mørk topp, rød aksent).
- Plassering av Logg ut.
- Hvor migrasjonen for tabellen ligger (her i `supabase/migrations` eller i
  adminbordet) og hvordan den kjøres (internbelastning kjører sine via
  Management API).
