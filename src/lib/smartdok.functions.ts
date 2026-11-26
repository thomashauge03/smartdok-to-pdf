import process from "node:process";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { feilmelding } from "./innlogging";
import { feilSvar, GENERELL_FEIL, IKKE_SATT_OPP, TIDSAVBRUDD, normaliserAdminbordUrl, UTLOGGET } from "./adminbord-svar";
import type { Feil } from "./adminbord-svar";
import type { SmartdokTime } from "./smartdok-timer";

// Importene fra .server.ts-filer skjer inne i handlerne så de aldri havner i
// klientpakken.

export type Svar<T> = ({ ok: true } & T) | { ok: false; feil: string; loggInn?: true };

const prosjektSkjema = z.object({
  nummer: z.string(),
  navn: z.string(),
  kunde: z.string().nullable(),
  aktiv: z.boolean(),
});
const prosjekterSkjema = z.object({ prosjekter: z.array(prosjektSkjema) });

// Speiler SmartdokTime i smartdok-timer.ts.
const timeSkjema = z.object({
  id: z.number(),
  maskinradId: z.number().nullable(),
  type: z.enum(["arbeid", "tillegg", "maskin"]),
  dato: z.string(),
  fra: z.number().nullable(),
  til: z.number().nullable(),
  navn: z.string(),
  aktivitet: z.string(),
  lonnsart: z.string(),
  kommentar: z.string(),
  mengde: z.number(),
  fakturert: z.boolean(),
  underprosjekt: z.string(),
  maskin: z.string(),
  maskinId: z.number().nullish().transform((v) => v ?? null),
  eksterntMerke: z.string().nullish().transform((v) => v ?? null),
});
const timerSkjema = z.object({ timer: z.array(timeSkjema) });

async function harTilgang(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("smartdok_pdf_har_tilgang");
  return !error && data === true;
}

// Felles løp for begge kallene. Returnerer enten en feil eller den rå JSON-en.
async function kallAdminbord(sti: string, sok: URLSearchParams | null): Promise<{ json: unknown } | Feil> {
  const { lagServerKlient } = await import("./supabase.server");
  const supabase = lagServerKlient();

  // getUser validerer JWT-en mot Supabase og fornyer økten om nødvendig.
  const { data: bruker, error } = await supabase.auth.getUser();
  if (error || !bruker.user) return UTLOGGET;
  if (!(await harTilgang(supabase))) return { ok: false, feil: feilmelding("ingen-tilgang") };

  const { data: okt } = await supabase.auth.getSession();
  const token = okt.session?.access_token;
  if (!token) return UTLOGGET;

  const base = normaliserAdminbordUrl(process.env.ADMINBORD_URL);
  if (!base) return { ok: false, feil: IKKE_SATT_OPP };

  const url = `${base}${sti}${sok ? `?${sok.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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
    return feilSvar(res.status, tekst);
  }
  return { json: await res.json() };
}

// Logger bare stiene til feltene som ikke stemmer, aldri verdier.
function skjemaFeil(error: z.ZodError): Feil {
  console.error("Uventet svarformat fra adminbordet:", error.issues.map((i) => i.path.join(".")).join(", "));
  return { ok: false, feil: GENERELL_FEIL };
}

function uventet(e: unknown): Feil {
  console.error("Henting fra adminbordet feilet uventet:", e instanceof Error ? e.message : "ukjent feil");
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, feil: TIDSAVBRUDD };
  return { ok: false, feil: GENERELL_FEIL };
}

export const hentProsjekter = createServerFn({ method: "GET" }).handler(
  async (): Promise<Svar<{ prosjekter: z.infer<typeof prosjektSkjema>[] }>> => {
    try {
      const r = await kallAdminbord("/api/smartdok-pdf/prosjekter", null);
      if (!("json" in r)) return r;
      const parsed = prosjekterSkjema.safeParse(r.json);
      if (!parsed.success) return skjemaFeil(parsed.error);
      return { ok: true, prosjekter: parsed.data.prosjekter };
    } catch (e) {
      return uventet(e);
    }
  },
);

const datoSkjema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const hentTimer = createServerFn({ method: "POST" })
  .inputValidator(z.object({ prosjekt: z.string().min(1), fra: datoSkjema, til: datoSkjema }))
  .handler(async ({ data }): Promise<Svar<{ timer: SmartdokTime[] }>> => {
    try {
      const sok = new URLSearchParams({ prosjekt: data.prosjekt, fra: data.fra, til: data.til });
      const r = await kallAdminbord("/api/smartdok-pdf/timer", sok);
      if (!("json" in r)) return r;
      const parsed = timerSkjema.safeParse(r.json);
      if (!parsed.success) return skjemaFeil(parsed.error);
      return { ok: true, timer: parsed.data.timer };
    } catch (e) {
      return uventet(e);
    }
  });
