import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRASJON = new URL(
  "../../supabase/migrations/0001_smartdok_pdf_tilgang.sql",
  import.meta.url,
);

const BRUKER = "00000000-0000-0000-0000-000000000001";
const EIER = "00000000-0000-0000-0000-000000000002";

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
    create table public.admin_brukere (id uuid primary key, rolle text, aktiv boolean);
    create function public.er_eier() returns boolean language sql security definer stable
      set search_path = public as $$
        select exists (select 1 from public.admin_brukere
          where id = auth.uid() and aktiv and rolle = 'eier');
      $$;
    -- Supabase gir execute på nye funksjoner til alle. Migrasjonen må tåle det.
    alter default privileges grant execute on functions to anon, authenticated;
    insert into auth.users (id, email) values
      ('${BRUKER}', 'bruker@example.no'), ('${EIER}', 'eier@example.no');
  `);
  const sql = readFileSync(MIGRASJON, "utf8");
  await db.exec(`begin;\n${sql}\ncommit;`);
  await db.exec(`begin;\n${sql}\ncommit;`);
});

afterEach(async () => {
  await db.exec(`
    reset role;
    delete from public.smartdok_pdf_tilgang;
    delete from public.admin_brukere;
    select set_config('request.jwt.claim.sub', '', false);
  `);
});

async function somBruker(rolle: "authenticated" | "anon", id: string) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
  await db.exec(`set role ${rolle}`);
}

async function harTilgang(): Promise<boolean> {
  const r = await db.query<{ t: boolean }>(
    `select public.smartdok_pdf_har_tilgang() as t`,
  );
  return r.rows[0].t;
}

async function leggTilRad(aktiv: boolean) {
  await db.query(
    `insert into public.smartdok_pdf_tilgang (bruker_id, navn, epost, aktiv)
     values ($1, 'Ola', 'bruker@example.no', $2)`,
    [BRUKER, aktiv],
  );
}

test("ingen rad gir false", async () => {
  await somBruker("authenticated", BRUKER);
  assert.equal(await harTilgang(), false);
});

test("aktiv rad gir true", async () => {
  await leggTilRad(true);
  await somBruker("authenticated", BRUKER);
  assert.equal(await harTilgang(), true);
});

test("aktiv = false gir false", async () => {
  await leggTilRad(false);
  await somBruker("authenticated", BRUKER);
  assert.equal(await harTilgang(), false);
});

test("eier uten rad gir true", async () => {
  await db.query(
    `insert into public.admin_brukere (id, rolle, aktiv) values ($1, 'eier', true)`,
    [EIER],
  );
  await somBruker("authenticated", EIER);
  assert.equal(await harTilgang(), true);
});

test("authenticated kan ikke lese tabellen", async () => {
  await somBruker("authenticated", BRUKER);
  await assert.rejects(
    db.query(`select * from public.smartdok_pdf_tilgang`),
    /permission denied/,
  );
});

test("anon kan ikke kjøre funksjonen", async () => {
  await somBruker("anon", BRUKER);
  await assert.rejects(harTilgang(), /permission denied/);
});
