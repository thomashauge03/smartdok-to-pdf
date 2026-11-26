-- ═══════════════════════════════════════════════════════════
-- Timer på ordre i Tripletex: koblingsliste og sendinger
--
-- smartdok_pdf_produktkobling: hvilket Tripletex-produkt hver maskin i
--   SmartDok skal faktureres som. De med tilgang leser og endrer den selv
--   med sin egen innlogging (RLS). Ingen kan slette, fordi en maskin som
--   ikke skal faktureres markeres med faktureres = false.
-- smartdok_pdf_sending: logg over hva som er sendt til Tripletex. Bare
--   adminbordet skriver hit (service role går utenom RLS); brukerne leser.
--
-- Migrasjonen kan kjøres flere ganger.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.smartdok_pdf_produktkobling (
  maskin_id     int primary key,
  maskinnavn    text not null,
  faktureres    boolean not null default true,
  produkt_id    bigint,
  produktnummer text,
  produktnavn   text,
  endret_av     uuid references auth.users (id) on delete set null,
  endret        timestamptz not null default now(),
  -- En maskin som faktureres må peke på et produkt, ellers blir linjen tom i Tripletex.
  check (not faktureres or produkt_id is not null)
);

alter table public.smartdok_pdf_produktkobling enable row level security;
revoke all on public.smartdok_pdf_produktkobling from anon, authenticated;
grant select, insert, update on public.smartdok_pdf_produktkobling to authenticated;

drop policy if exists "tilgang leser kobling" on public.smartdok_pdf_produktkobling;
create policy "tilgang leser kobling" on public.smartdok_pdf_produktkobling
  for select to authenticated using (public.smartdok_pdf_har_tilgang());

drop policy if exists "tilgang legger inn kobling" on public.smartdok_pdf_produktkobling;
create policy "tilgang legger inn kobling" on public.smartdok_pdf_produktkobling
  for insert to authenticated with check (public.smartdok_pdf_har_tilgang());

drop policy if exists "tilgang endrer kobling" on public.smartdok_pdf_produktkobling;
create policy "tilgang endrer kobling" on public.smartdok_pdf_produktkobling
  for update to authenticated
  using (public.smartdok_pdf_har_tilgang())
  with check (public.smartdok_pdf_har_tilgang());

-- Trigger: stempler hvem som endret, og logger endringen i hendelseslogg.
-- Security definer fordi authenticated ikke har skriverett på hendelseslogg.
-- search_path er låst så ingen kan skygge tabellene med egne objekter.
-- Logging er en del av revisjonskravet: feiler den, skal skrivingen feile.
create or replace function public.smartdok_pdf_kobling_endret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fra jsonb;
  til jsonb;
begin
  -- Alltid brukeren som faktisk skriver, aldri en verdi klienten sender med.
  new.endret_av := auth.uid();
  new.endret := now();

  til := jsonb_build_object(
    'faktureres', new.faktureres,
    'produkt_id', new.produkt_id,
    'produktnummer', new.produktnummer,
    'produktnavn', new.produktnavn
  );
  if tg_op = 'UPDATE' then
    fra := jsonb_build_object(
      'faktureres', old.faktureres,
      'produkt_id', old.produkt_id,
      'produktnummer', old.produktnummer,
      'produktnavn', old.produktnavn
    );
  end if;

  insert into public.hendelseslogg (handling, utfort_av, utfort_av_epost, detaljer)
  values (
    'smartdok_pdf.kobling_endret',
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    jsonb_build_object('maskin_id', new.maskin_id, 'fra', fra, 'til', til)
  );
  return new;
end;
$$;

revoke execute on function public.smartdok_pdf_kobling_endret() from public, anon, authenticated;

drop trigger if exists smartdok_pdf_kobling_endret on public.smartdok_pdf_produktkobling;
create trigger smartdok_pdf_kobling_endret
  before insert or update on public.smartdok_pdf_produktkobling
  for each row execute function public.smartdok_pdf_kobling_endret();

create table if not exists public.smartdok_pdf_sending (
  id            bigserial primary key,
  kode          text unique not null,
  prosjekt      text not null,
  ordre_id      bigint,
  ordrenummer   text,
  merke         text,
  timer_ider    int[] not null,
  status        text not null check (status in (
    'startet', 'sendt', 'sendt_uten_vedlegg', 'sendt_uten_merke',
    'ukjent_utfall', 'feilet', 'angret')),
  antall_linjer int,
  opprettet_av  uuid,
  opprettet     timestamptz default now(),
  endret        timestamptz default now()
);

-- Brukerne får bare lese. Adminbordet skriver med service role, som går utenom RLS.
alter table public.smartdok_pdf_sending enable row level security;
revoke all on public.smartdok_pdf_sending from anon, authenticated;
grant select on public.smartdok_pdf_sending to authenticated;

drop policy if exists "tilgang leser sending" on public.smartdok_pdf_sending;
create policy "tilgang leser sending" on public.smartdok_pdf_sending
  for select to authenticated using (public.smartdok_pdf_har_tilgang());
