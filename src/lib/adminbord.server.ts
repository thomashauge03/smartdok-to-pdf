import process from "node:process";

import type { SupabaseClient } from "@supabase/supabase-js";

import { feilSvar, GENERELL_FEIL, IKKE_SATT_OPP, normaliserAdminbordUrl, skrivefeilSvar, UTLOGGET } from "./adminbord-svar.ts";
import type { Feil } from "./adminbord-svar.ts";
import { feilmelding } from "./innlogging.ts";

// Server-only: ADMINBORD_URL og økten finnes bare her. Importeres dynamisk fra
// handlerne så modulen aldri havner i klientpakken.

async function harTilgang(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("smartdok_pdf_har_tilgang");
  return !error && data === true;
}

// getUser validerer JWT-en mot Supabase og fornyer økten om nødvendig. Brukes
// også av kallene som går rett mot databasen (RLS), så de får samme sperre.
export async function krevTilgang(): Promise<{ supabase: SupabaseClient } | Feil> {
  const { lagServerKlient } = await import("./supabase.server.ts");
  const supabase = lagServerKlient();
  const { data: bruker, error } = await supabase.auth.getUser();
  if (error || !bruker.user) return UTLOGGET;
  if (!(await harTilgang(supabase))) return { ok: false, feil: feilmelding("ingen-tilgang") };
  return { supabase };
}

// `skriving`: kallet kan ha endret noe i Tripletex eller SmartDok. Da tolkes en feil
// uten adminbordets egen forklaring som ukjent utfall (skrivefeilSvar).
export type AdminbordInit = { sok?: URLSearchParams | null; body?: unknown; skriving?: boolean };

// Felles løp for alle kall til adminbordet. Returnerer enten en feil eller den
// rå JSON-en. Med body brukes POST med JSON, ellers GET.
export async function kallAdminbord(sti: string, init: AdminbordInit = {}): Promise<{ json: unknown } | Feil> {
  const t = await krevTilgang();
  if (!("supabase" in t)) return t;

  const { data: okt } = await t.supabase.auth.getSession();
  const token = okt.session?.access_token;
  if (!token) return UTLOGGET;

  const base = normaliserAdminbordUrl(process.env.ADMINBORD_URL);
  if (!base) return { ok: false, feil: IKKE_SATT_OPP };

  const url = `${base}${sti}${init.sok ? `?${init.sok.toString()}` : ""}`;
  const harBody = init.body !== undefined;
  const res = await fetch(url, {
    method: harBody ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(harBody ? { "Content-Type": "application/json" } : {}),
    },
    body: harBody ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(110_000),
    // Aldri følg omdirigeringer: tokenet skal ikke sendes videre.
    redirect: "manual",
  });

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    return { ok: false, feil: GENERELL_FEIL };
  }

  if (!res.ok) {
    let tekst: string | null = null;
    try {
      const b = (await res.json()) as { feil?: unknown };
      if (typeof b.feil === "string") tekst = b.feil;
    } catch {
      // Ikke JSON; bruk den generelle meldingen.
    }
    return init.skriving ? skrivefeilSvar(res.status, tekst) : feilSvar(res.status, tekst);
  }
  return { json: await res.json() };
}
