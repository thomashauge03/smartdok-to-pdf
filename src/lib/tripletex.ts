import { z } from "zod";

// Rene skjemaer og sjekker for Tripletex-kallene. Ingen nett og ingen
// miljøvariabler her, så alt kan testes med node --test.

// Vercel avviser forespørselskropper over 4,5 MB, og base64 gjør filen en
// tredjedel større. 3 MB PDF blir 4 MB base64: under grensen med margin til
// resten av kroppen (linjer, timer-id-er).
export const MAKS_PDF_BYTE = 3 * 1024 * 1024;
export const PDF_FOR_STOR =
  "PDF-en er for stor til å sendes (maks 3 MB). Skjul noen kolonner eller send en kortere periode.";

/** Størrelsen filen får når base64-teksten dekodes, regnet ut fra lengden alene. */
export function dekodetStorrelse(base64: string): number {
  const utfylling = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - utfylling;
}

export function pdfForStor(base64: string): boolean {
  return dekodetStorrelse(base64) > MAKS_PDF_BYTE;
}

// ── Inndata ──────────────────────────────────────────────────

const dato = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Samme form som adminbordets lagKode(): seks tegn.
export const kodeSkjema = z.string().regex(/^[a-z0-9]{6}$/);
// Adminbordet har 32 bit-grense på time-id-ene (int[] i databasen).
const timeId = z.number().int().positive().max(2_147_483_647);

export const prosjektInn = z.object({ prosjekt: z.string().trim().min(1).max(50) });

export const leggPaaOrdreInn = z.object({
  prosjekt: z.string().trim().min(1).max(50),
  ordre: z.union([z.object({ ny: z.literal(true) }).strict(), z.object({ id: z.number().int().positive() }).strict()]),
  linjer: z
    .array(
      z.object({
        produktId: z.number().int().positive(),
        antall: z.number().positive().max(10000),
        tekst: z.string().trim().min(1).max(200),
      }),
    )
    .min(1),
  timerIder: z.array(timeId).min(1).max(3000),
  pdf: z.string().min(1),
  filnavn: z.string().min(1).max(120),
  periode: z.object({ fra: dato, til: dato }),
});
export type LeggPaaOrdreInn = z.infer<typeof leggPaaOrdreInn>;

export const fjernMerkeInn = z.object({ kode: kodeSkjema });
export const avklarInn = z.object({ kode: kodeSkjema, valg: z.enum(["sjekk", "frigi", "merk"]) });

export const lagreKoblingInn = z
  .object({
    maskinId: z.number().int().positive(),
    maskinnavn: z.string().trim().min(1).max(200),
    faktureres: z.boolean(),
    produktId: z.number().int().positive().nullable(),
    produktnummer: z.string().max(100).nullable(),
    produktnavn: z.string().max(300).nullable(),
  })
  // Speiler check-regelen i databasen, så feilen kommer før turen dit.
  .refine((k) => !k.faktureres || k.produktId !== null, { path: ["produktId"] });
export type LagreKoblingInn = z.infer<typeof lagreKoblingInn>;

// ── Svar fra adminbordet (speiler rutene i adminbordet) ──────

export const produkterSvar = z.object({
  produkter: z.array(z.object({ id: z.number(), nummer: z.string(), navn: z.string(), pris: z.number().nullable() })),
});

export const maskinerSvar = z.object({
  maskiner: z.array(z.object({ id: z.number(), nummer: z.string(), navn: z.string(), kategori: z.string() })),
});

export const ordrerSvar = z.object({
  prosjekt: z.object({ id: z.number(), kundeId: z.number() }),
  ordrer: z.array(
    z.object({
      id: z.number(),
      nummer: z.string(),
      dato: z.string(),
      linjer: z.array(z.object({ produktnavn: z.string(), antall: z.number() })),
    }),
  ),
});

export const leggPaaOrdreSvar = z.object({
  status: z.enum(["sendt", "sendt_uten_vedlegg", "sendt_uten_merke", "ukjent_utfall"]),
  kode: z.string(),
  ordrenummer: z.string().nullable(),
  ordreId: z.number().nullable(),
  linjer: z.array(z.object({ produktId: z.number(), antall: z.number(), pris: z.number(), rabatt: z.number() })),
  melding: z.string().optional(),
});

// fjern-merke og «frigi»/«merk» i avklar svarer med denne.
export const statusSvar = z.object({
  status: z.enum(["angret", "sendt"]),
  kode: z.string(),
  ordrenummer: z.string().nullable(),
  melding: z.string(),
});

export const avklarSvar = z.union([
  statusSvar,
  // «sjekk»: om ordren med sendingens kode ble funnet i Tripletex.
  z.object({
    funnet: z.boolean(),
    nyOrdre: z.boolean(),
    ordrenummer: z.string().nullable(),
    antallLinjer: z.number(),
    status: z.string(),
  }),
]);

// ── Rader fra Supabase (RLS) ─────────────────────────────────

export const koblingRad = z.object({
  maskin_id: z.number(),
  maskinnavn: z.string(),
  faktureres: z.boolean(),
  produkt_id: z.number().nullable(),
  produktnummer: z.string().nullable(),
  produktnavn: z.string().nullable(),
  endret: z.string(),
});
export const KOBLING_KOLONNER = "maskin_id, maskinnavn, faktureres, produkt_id, produktnummer, produktnavn, endret";

export const sendingRad = z.object({
  kode: z.string(),
  prosjekt: z.string(),
  ordre_id: z.number().nullable(),
  ordrenummer: z.string().nullable(),
  merke: z.string().nullable(),
  status: z.string(),
  antall_linjer: z.number().nullable(),
  ny_ordre: z.boolean().nullable(),
  opprettet: z.string().nullable(),
  endret: z.string().nullable(),
});
export const SENDING_KOLONNER =
  "kode, prosjekt, ordre_id, ordrenummer, merke, status, antall_linjer, ny_ordre, opprettet, endret";

export const DATABASEFEIL = "Kunne ikke nå databasen. Prøv igjen om litt.";
