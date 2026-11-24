-- ═══════════════════════════════════════════════════════════
-- Hvem som slipper inn i SmartDok til PDF
--
-- Raden i denne tabellen er tilgangen: at noen har konto i navet (auth.users)
-- betyr ikke at de skal inn her, for kontoene deles med de andre appene.
-- Eieren (public.er_eier(), fra adminbordet) slipper alltid inn uten rad.
--
-- Tilgang slås av med aktiv = false. Kontoen i auth.users slettes aldri
-- herfra, fordi den kan brukes av andre apper i navet.
--
-- Tabellen er stengt for klientene. Appen spør bare om svaret gjennom
-- smartdok_pdf_har_tilgang(), som kjører med eierrettigheter.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.smartdok_pdf_tilgang (
  bruker_id  uuid primary key references auth.users(id) on delete cascade,
  navn       text not null,
  epost      text not null,
  aktiv      boolean not null default true,
  opprettet  timestamptz not null default now(),
  endret     timestamptz not null default now()
);

alter table public.smartdok_pdf_tilgang enable row level security;
revoke all on public.smartdok_pdf_tilgang from anon, authenticated;

create or replace function public.smartdok_pdf_har_tilgang()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.smartdok_pdf_tilgang
    where bruker_id = auth.uid() and aktiv
  ) or public.er_eier();
$$;

-- Supabase gir execute på nye funksjoner til alle; anonyme skal ikke kunne spørre.
revoke execute on function public.smartdok_pdf_har_tilgang() from public, anon;
grant execute on function public.smartdok_pdf_har_tilgang() to authenticated;
