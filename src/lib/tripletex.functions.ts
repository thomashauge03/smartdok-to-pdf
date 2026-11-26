import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { skjemaFeil, skjemaFeilSkriving, somSkrivefeil, uventet, uventetSkriving } from "./adminbord-svar";
import type { Feil, Svar } from "./adminbord-svar";
import {
  avklarInn,
  avklarSvar,
  erSkriving,
  DATABASEFEIL,
  fjernMerkeInn,
  KOBLING_KOLONNER,
  koblingRad,
  lagreKoblingInn,
  leggPaaOrdreInn,
  leggPaaOrdreSvar,
  maskinerSvar,
  ordrerSvar,
  pdfForStor,
  PDF_FOR_STOR,
  produkterSvar,
  prosjektInn,
  SENDING_KOLONNER,
  sendingRad,
  statusSvar,
} from "./tripletex";

// .server.ts-modulene importeres inne i handlerne så de aldri havner i
// klientpakken.

export type { Svar };

type Produkt = z.infer<typeof produkterSvar>["produkter"][number];
type Maskin = z.infer<typeof maskinerSvar>["maskiner"][number];
export type ApenOrdre = z.infer<typeof ordrerSvar>["ordrer"][number];
export type Kobling = z.infer<typeof koblingRad>;
export type Sending = z.infer<typeof sendingRad>;
export type LeggPaaOrdreSvar = z.infer<typeof leggPaaOrdreSvar>;
export type AvklarSvar = z.infer<typeof avklarSvar>;
export type StatusSvar = z.infer<typeof statusSvar>;

/* ── Via adminbordet ──────────────────────────────────────── */

export const hentTripletexProdukter = createServerFn({ method: "GET" }).handler(
  async (): Promise<Svar<{ produkter: Produkt[] }>> => {
    try {
      const { kallAdminbord } = await import("./adminbord.server");
      const r = await kallAdminbord("/api/smartdok-pdf/produkter");
      if (!("json" in r)) return r;
      const p = produkterSvar.safeParse(r.json);
      if (!p.success) return skjemaFeil(p.error);
      return { ok: true, produkter: p.data.produkter };
    } catch (e) {
      return uventet(e);
    }
  },
);

export const hentSmartdokMaskiner = createServerFn({ method: "GET" }).handler(
  async (): Promise<Svar<{ maskiner: Maskin[] }>> => {
    try {
      const { kallAdminbord } = await import("./adminbord.server");
      const r = await kallAdminbord("/api/smartdok-pdf/maskiner");
      if (!("json" in r)) return r;
      const p = maskinerSvar.safeParse(r.json);
      if (!p.success) return skjemaFeil(p.error);
      return { ok: true, maskiner: p.data.maskiner };
    } catch (e) {
      return uventet(e);
    }
  },
);

export const hentApneOrdrer = createServerFn({ method: "POST" })
  .inputValidator(prosjektInn)
  .handler(async ({ data }): Promise<Svar<{ prosjekt: { id: number; kundeId: number }; ordrer: ApenOrdre[] }>> => {
    try {
      const { kallAdminbord } = await import("./adminbord.server");
      const r = await kallAdminbord("/api/smartdok-pdf/ordrer", { sok: new URLSearchParams({ prosjekt: data.prosjekt }) });
      if (!("json" in r)) return r;
      const p = ordrerSvar.safeParse(r.json);
      if (!p.success) return skjemaFeil(p.error);
      return { ok: true, prosjekt: p.data.prosjekt, ordrer: p.data.ordrer };
    } catch (e) {
      return uventet(e);
    }
  });

export const leggPaaOrdre = createServerFn({ method: "POST" })
  .inputValidator(leggPaaOrdreInn)
  .handler(async ({ data }): Promise<Svar<{ sending: LeggPaaOrdreSvar }>> => {
    // Før noe nettkall: Vercel avviser for store kropper uten at vi får svar.
    if (pdfForStor(data.pdf)) return { ok: false, feil: PDF_FOR_STOR };
    try {
      const { kallAdminbord } = await import("./adminbord.server");
      const r = await kallAdminbord("/api/smartdok-pdf/legg-paa-ordre", { body: data, skriving: true });
      if (!("json" in r)) return somSkrivefeil(r);
      const p = leggPaaOrdreSvar.safeParse(r.json);
      if (!p.success) return skjemaFeilSkriving(p.error);
      return { ok: true, sending: p.data };
    } catch (e) {
      return uventetSkriving(e);
    }
  });

export const fjernMerke = createServerFn({ method: "POST" })
  .inputValidator(fjernMerkeInn)
  .handler(async ({ data }): Promise<Svar<{ resultat: StatusSvar }>> => {
    try {
      const { kallAdminbord } = await import("./adminbord.server");
      const r = await kallAdminbord("/api/smartdok-pdf/fjern-merke", { body: data, skriving: true });
      if (!("json" in r)) return somSkrivefeil(r);
      const p = statusSvar.safeParse(r.json);
      if (!p.success) return skjemaFeilSkriving(p.error);
      return { ok: true, resultat: p.data };
    } catch (e) {
      return uventetSkriving(e);
    }
  });

export const avklarSending = createServerFn({ method: "POST" })
  .inputValidator(avklarInn)
  .handler(async ({ data }): Promise<Svar<{ resultat: AvklarSvar }>> => {
    // «sjekk» er en lesing; bare frigi og merk kan ha skrevet noe.
    const skriver = erSkriving(data.valg);
    try {
      const { kallAdminbord } = await import("./adminbord.server");
      const r = await kallAdminbord("/api/smartdok-pdf/avklar", { body: data, skriving: skriver });
      if (!("json" in r)) return skriver ? somSkrivefeil(r) : r;
      const p = avklarSvar.safeParse(r.json);
      if (!p.success) return skriver ? skjemaFeilSkriving(p.error) : skjemaFeil(p.error);
      return { ok: true, resultat: p.data };
    } catch (e) {
      return skriver ? uventetSkriving(e) : uventet(e);
    }
  });

/* ── Via brukerens egen Supabase-økt (RLS) ────────────────── */

function databasefeil(e: { message: string }): Feil {
  // Teksten fra PostgREST kan nevne tabeller og kolonner: den blir på serveren.
  console.error("Databasefeil i Tripletex-funksjon:", e.message);
  return { ok: false, feil: DATABASEFEIL };
}

export const hentKoblinger = createServerFn({ method: "GET" }).handler(
  async (): Promise<Svar<{ koblinger: Kobling[] }>> => {
    try {
      const { krevTilgang } = await import("./adminbord.server");
      const t = await krevTilgang();
      if (!("supabase" in t)) return t;
      const { data, error } = await t.supabase
        .from("smartdok_pdf_produktkobling")
        .select(KOBLING_KOLONNER)
        .order("maskinnavn", { ascending: true })
        .limit(5000);
      if (error) return databasefeil(error);
      const p = z.array(koblingRad).safeParse(data);
      if (!p.success) return skjemaFeil(p.error);
      return { ok: true, koblinger: p.data };
    } catch (e) {
      return uventet(e);
    }
  },
);

export const lagreKobling = createServerFn({ method: "POST" })
  .inputValidator(lagreKoblingInn)
  .handler(async ({ data }): Promise<Svar<object>> => {
    try {
      const { krevTilgang } = await import("./adminbord.server");
      const t = await krevTilgang();
      if (!("supabase" in t)) return t;
      // endret_av og endret settes av triggeren, aldri av det vi sender.
      const { error } = await t.supabase.from("smartdok_pdf_produktkobling").upsert(
        {
          maskin_id: data.maskinId,
          maskinnavn: data.maskinnavn,
          faktureres: data.faktureres,
          produkt_id: data.produktId,
          produktnummer: data.produktnummer,
          produktnavn: data.produktnavn,
        },
        { onConflict: "maskin_id" },
      );
      if (error) return databasefeil(error);
      return { ok: true };
    } catch (e) {
      return uventet(e);
    }
  });

export const hentSendinger = createServerFn({ method: "POST" })
  .inputValidator(prosjektInn)
  .handler(async ({ data }): Promise<Svar<{ sendinger: Sending[] }>> => {
    try {
      const { krevTilgang } = await import("./adminbord.server");
      const t = await krevTilgang();
      if (!("supabase" in t)) return t;
      const { data: rader, error } = await t.supabase
        .from("smartdok_pdf_sending")
        .select(SENDING_KOLONNER)
        .eq("prosjekt", data.prosjekt)
        .order("opprettet", { ascending: false })
        .limit(200);
      if (error) return databasefeil(error);
      const p = z.array(sendingRad).safeParse(rader);
      if (!p.success) return skjemaFeil(p.error);
      return { ok: true, sendinger: p.data };
    } catch (e) {
      return uventet(e);
    }
  });
