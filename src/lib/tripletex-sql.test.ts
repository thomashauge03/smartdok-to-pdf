import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRASJON = new URL(
  "../../supabase/migrations/0002_tripletex_ordre.sql",
  import.meta.url,
);

const BRUKER = "00000000-0000-0000-0000-000000000001";
const ANNEN = "00000000-0000-0000-0000-000000000002";

let db: PGlite;

/** Etterligner det av navet migrasjonen er avhengig av, og kjører den to ganger. */
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    -- Tilgangsfunksjonen er testet i tilgang-sql.test.ts. Her styres den av en innstilling.
    create function public.smartdok_pdf_har_tilgang() returns boolean
      language sql stable as
      $$ select coalesce(current_setting('test.tilgang', true), '') = 'ja' $$;
    grant execute on function public.smartdok_pdf_har_tilgang() to authenticated;
    -- Samme kolonner som hendelseslogg i adminbordet. authenticated har ingen rettigheter her.
    create table public.hendelseslogg (
      id bigint generated always as identity primary key,
      utfort_av uuid references auth.users (id) on delete set null,
      utfort_av_epost text,
      handling text not null,
      system_id uuid,
      detaljer jsonb not null default '{}'::jsonb,
      tid timestamptz not null default now()
    );
    alter table public.hendelseslogg enable row level security;
    create table public.systemer (id uuid primary key, slug text not null);
    alter default privileges grant execute on functions to anon, authenticated;
    insert into auth.users (id, email) values
      ('${BRUKER}', 'bruker@example.no'), ('${ANNEN}', 'annen@example.no');
  `);
  const sql = readFileSync(MIGRASJON, "utf8");
  await db.exec(`begin;\n${sql}\ncommit;`);
  await db.exec(`begin;\n${sql}\ncommit;`);
});

afterEach(async () => {
  await db.exec(`
    reset role;
    delete from public.smartdok_pdf_produktkobling;
    delete from public.smartdok_pdf_sending;
    delete from public.hendelseslogg;
    delete from public.systemer;
    select set_config('test.tilgang', '', false);
    select set_config('request.jwt.claim.sub', '', false);
  `);
});

async function somBruker(medTilgang: boolean, id = BRUKER) {
  await db.query(`select set_config('test.tilgang', $1, false)`, [
    medTilgang ? "ja" : "nei",
  ]);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
  await db.exec(`set role authenticated`);
}

async function somAnon() {
  await db.exec(`set role anon`);
}

async function seedSending() {
  await db.exec(`
    insert into public.smartdok_pdf_sending (kode, prosjekt, timer_ider, status)
    values ('abc', 'P1', '{1,2}', 'startet')`);
}

test("bruker med tilgang kan legge inn, lese og endre kobling", async () => {
  await somBruker(true);
  await db.exec(`
    insert into public.smartdok_pdf_produktkobling
      (maskin_id, maskinnavn, produkt_id, produktnummer, produktnavn)
    values (7, 'Gravemaskin', 100, 'P-100', 'Gravemaskin time')`);
  let r = await db.query<{ produkt_id: string }>(
    `select produkt_id from public.smartdok_pdf_produktkobling where maskin_id = 7`,
  );
  assert.equal(r.rows.length, 1);
  await db.exec(
    `update public.smartdok_pdf_produktkobling set produkt_id = 200 where maskin_id = 7`,
  );
  r = await db.query(
    `select produkt_id from public.smartdok_pdf_produktkobling where maskin_id = 7`,
  );
  assert.equal(Number(r.rows[0].produkt_id), 200);
});

test("bruker uten tilgang ser ingen rader og kan ikke legge inn", async () => {
  await db.exec(`
    insert into public.smartdok_pdf_produktkobling (maskin_id, maskinnavn, faktureres)
    values (1, 'Skjult', false)`);
  await somBruker(false);
  const r = await db.query(`select * from public.smartdok_pdf_produktkobling`);
  assert.equal(r.rows.length, 0);
  await assert.rejects(
    db.exec(`insert into public.smartdok_pdf_produktkobling (maskin_id, maskinnavn, faktureres)
             values (2, 'Ny', false)`),
    /row-level security/,
  );
});

test("anon har ikke tilgang til koblingene", async () => {
  await somAnon();
  await assert.rejects(
    db.query(`select * from public.smartdok_pdf_produktkobling`),
    /permission denied/,
  );
});

test("faktureres = true uten produkt_id avvises", async () => {
  await somBruker(true);
  await assert.rejects(
    db.exec(`insert into public.smartdok_pdf_produktkobling (maskin_id, maskinnavn, faktureres)
             values (3, 'Uten produkt', true)`),
    /check constraint/,
  );
});

test("faktureres = false uten produkt_id er lov", async () => {
  await somBruker(true);
  await db.exec(`insert into public.smartdok_pdf_produktkobling (maskin_id, maskinnavn, faktureres)
                 values (4, 'Ikke fakturert', false)`);
});

test("sletting er ikke tillatt", async () => {
  await somBruker(true);
  await db.exec(`insert into public.smartdok_pdf_produktkobling (maskin_id, maskinnavn, faktureres)
                 values (5, 'X', false)`);
  await assert.rejects(
    db.exec(`delete from public.smartdok_pdf_produktkobling where maskin_id = 5`),
    /permission denied/,
  );
});

test("endring skriver én rad i hendelseslogg med utfort_av, og setter endret_av", async () => {
  await somBruker(true);
  await db.exec(`insert into public.smartdok_pdf_produktkobling
    (maskin_id, maskinnavn, produkt_id, produktnummer) values (8, 'Hjullaster', 1, 'A')`);
  await db.exec(`update public.smartdok_pdf_produktkobling
    set produkt_id = 2, produktnummer = 'B' where maskin_id = 8`);
  // Å spoofe endret_av skal ikke virke
  await db.query(
    `update public.smartdok_pdf_produktkobling set endret_av = $1, faktureres = false where maskin_id = 8`,
    [ANNEN],
  );
  await db.exec(`reset role`);
  const logg = await db.query<{
    utfort_av: string;
    handling: string;
    detaljer: { maskin_id: number; fra: unknown; til: { produkt_id: number } };
  }>(`select utfort_av, handling, detaljer from public.hendelseslogg order by id`);
  assert.equal(logg.rows.length, 3);
  for (const rad of logg.rows) {
    assert.equal(rad.utfort_av, BRUKER);
    assert.equal(rad.handling, "smartdok_pdf.kobling_endret");
    assert.equal(rad.detaljer.maskin_id, 8);
  }
  assert.equal(logg.rows[0].detaljer.fra, null);
  assert.equal(logg.rows[1].detaljer.til.produkt_id, 2);
  const k = await db.query<{ endret_av: string }>(
    `select endret_av from public.smartdok_pdf_produktkobling where maskin_id = 8`,
  );
  assert.equal(k.rows[0].endret_av, BRUKER);
});

test("authenticated kan lese sending, men ikke skrive", async () => {
  await seedSending();
  await somBruker(true);
  const r = await db.query(`select * from public.smartdok_pdf_sending`);
  assert.equal(r.rows.length, 1);
  await assert.rejects(
    db.exec(`insert into public.smartdok_pdf_sending (kode, prosjekt, timer_ider, status)
             values ('x', 'P', '{1}', 'startet')`),
    /permission denied/,
  );
  await assert.rejects(
    db.exec(`update public.smartdok_pdf_sending set status = 'sendt'`),
    /permission denied/,
  );
});

test("sending har ny_ordre (boolean, kan være null), og authenticated kan ikke skrive den", async () => {
  const k = await db.query<{ data_type: string; is_nullable: string }>(
    `select data_type, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = 'smartdok_pdf_sending' and column_name = 'ny_ordre'`,
  );
  assert.equal(k.rows.length, 1);
  assert.equal(k.rows[0].data_type, "boolean");
  assert.equal(k.rows[0].is_nullable, "YES");

  await db.exec(`insert into public.smartdok_pdf_sending (kode, prosjekt, timer_ider, status, ny_ordre)
                 values ('nyord1', 'P1', '{3}', 'startet', true)`);
  await somBruker(true);
  const r = await db.query<{ ny_ordre: boolean }>(
    `select ny_ordre from public.smartdok_pdf_sending where kode = 'nyord1'`,
  );
  assert.equal(r.rows[0].ny_ordre, true);
  await assert.rejects(
    db.exec(`update public.smartdok_pdf_sending set ny_ordre = false where kode = 'nyord1'`),
    /permission denied/,
  );
  await assert.rejects(
    db.exec(`insert into public.smartdok_pdf_sending (kode, prosjekt, timer_ider, status, ny_ordre)
             values ('nyord2', 'P', '{4}', 'startet', true)`),
    /permission denied/,
  );
});

test("bruker uten tilgang ser ingen sendinger", async () => {
  await seedSending();
  await somBruker(false);
  const r = await db.query(`select * from public.smartdok_pdf_sending`);
  assert.equal(r.rows.length, 0);
});

test("ugyldig status på sending avvises", async () => {
  await assert.rejects(
    db.exec(`insert into public.smartdok_pdf_sending (kode, prosjekt, timer_ider, status)
             values ('y', 'P', '{1}', 'noe_annet')`),
    /check constraint/,
  );
});

test("kode på sending er unik", async () => {
  await seedSending();
  await assert.rejects(seedSending(), /unique|duplicate/);
});

const SYSTEM = "00000000-0000-0000-0000-0000000000aa";

test("loggraden får system_id fra systemer, og maskinnavn i detaljer", async () => {
  await db.query(`insert into public.systemer (id, slug) values ($1, 'smartdok-til-pdf')`, [SYSTEM]);
  await somBruker(true);
  await db.exec(`insert into public.smartdok_pdf_produktkobling (maskin_id, maskinnavn, faktureres)
                 values (20, 'Dumper', false)`);
  await db.exec(`reset role`);
  const r = await db.query<{ system_id: string; detaljer: { maskinnavn: string } }>(
    `select system_id, detaljer from public.hendelseslogg`,
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].system_id, SYSTEM);
  assert.equal(r.rows[0].detaljer.maskinnavn, "Dumper");
});

test("uten systemer-rad blir system_id null og skrivingen lykkes", async () => {
  await somBruker(true);
  await db.exec(`insert into public.smartdok_pdf_produktkobling (maskin_id, maskinnavn, faktureres)
                 values (21, 'Tipp', false)`);
  await db.exec(`reset role`);
  const r = await db.query<{ system_id: string | null }>(
    `select system_id from public.hendelseslogg`,
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].system_id, null);
});

test("oppdatering uten endring logger ikke", async () => {
  await somBruker(true);
  await db.exec(`insert into public.smartdok_pdf_produktkobling (maskin_id, maskinnavn, faktureres)
                 values (22, 'Same', false)`);
  await db.exec(`update public.smartdok_pdf_produktkobling set faktureres = false where maskin_id = 22`);
  await db.exec(`reset role`);
  const r = await db.query(`select 1 from public.hendelseslogg`);
  assert.equal(r.rows.length, 1);
});

const UPSERT = `insert into public.smartdok_pdf_produktkobling
    (maskin_id, maskinnavn, faktureres, produkt_id, produktnummer, produktnavn)
  values ($1, $2, $3, $4, $5, $6)
  on conflict (maskin_id) do update set
    maskinnavn = excluded.maskinnavn, faktureres = excluded.faktureres, produkt_id = excluded.produkt_id,
    produktnummer = excluded.produktnummer, produktnavn = excluded.produktnavn`;

test("upsert på en eksisterende kobling logger én gang, med den virkelige fra-verdien", async () => {
  await somBruker(true);
  await db.query(UPSERT, [30, "Gravemaskin", true, 1, "A", "Produkt A"]);
  await db.query(UPSERT, [30, "Gravemaskin", true, 2, "B", "Produkt B"]);
  await db.exec(`reset role`);
  const r = await db.query<{ detaljer: { fra: { produkt_id: number } | null; til: { produkt_id: number } } }>(
    `select detaljer from public.hendelseslogg order by id`,
  );
  assert.equal(r.rows.length, 2, "én rad for innsettingen og én for endringen");
  assert.equal(r.rows[0].detaljer.fra, null);
  assert.equal(r.rows[0].detaljer.til.produkt_id, 1);
  assert.equal(r.rows[1].detaljer.fra?.produkt_id, 1);
  assert.equal(r.rows[1].detaljer.til.produkt_id, 2);
});

test("upsert uten endring logger ikke og beholder stemplingen", async () => {
  await somBruker(true);
  await db.query(UPSERT, [31, "Dumper", false, null, null, null]);
  await db.exec(`reset role`);
  const før = await db.query<{ endret: string }>(`select endret::text from public.smartdok_pdf_produktkobling where maskin_id = 31`);
  await somBruker(true, ANNEN);
  await db.query(UPSERT, [31, "Dumper", false, null, null, null]);
  await db.exec(`reset role`);
  const r = await db.query(`select 1 from public.hendelseslogg`);
  assert.equal(r.rows.length, 1);
  const k = await db.query<{ endret_av: string; endret: string }>(
    `select endret_av, endret::text from public.smartdok_pdf_produktkobling where maskin_id = 31`,
  );
  assert.equal(k.rows[0].endret_av, BRUKER);
  assert.equal(k.rows[0].endret, før.rows[0].endret);
});

test("loggingen ligger i en AFTER-trigger og stemplingen i en BEFORE-trigger", async () => {
  const r = await db.query<{ tgname: string; before: boolean }>(`
    select tgname, (tgtype & 2) <> 0 as before
    from pg_trigger
    where tgrelid = 'public.smartdok_pdf_produktkobling'::regclass and not tgisinternal
    order by tgname`);
  assert.deepEqual(r.rows, [
    { tgname: "smartdok_pdf_kobling_endret", before: true },
    { tgname: "smartdok_pdf_kobling_logg", before: false },
  ]);
});

test("anon og authenticated har ikke rettigheter på sekvensen til sending", async () => {
  await somBruker(true);
  await assert.rejects(
    db.exec(`select nextval('public.smartdok_pdf_sending_id_seq')`),
    /permission denied/,
  );
});
