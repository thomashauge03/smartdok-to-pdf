import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { skjemaFeil, uventet } from "./adminbord-svar";
import type { Svar } from "./adminbord-svar";
import type { SmartdokTime } from "./smartdok-timer";

// Importene fra .server.ts-filer skjer inne i handlerne så de aldri havner i
// klientpakken.

export type { Svar };

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

export const hentProsjekter = createServerFn({ method: "GET" }).handler(
  async (): Promise<Svar<{ prosjekter: z.infer<typeof prosjektSkjema>[] }>> => {
    try {
      const { kallAdminbord } = await import("./adminbord.server");
      const r = await kallAdminbord("/api/smartdok-pdf/prosjekter");
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
      const { kallAdminbord } = await import("./adminbord.server");
      const r = await kallAdminbord("/api/smartdok-pdf/timer", { sok });
      if (!("json" in r)) return r;
      const parsed = timerSkjema.safeParse(r.json);
      if (!parsed.success) return skjemaFeil(parsed.error);
      return { ok: true, timer: parsed.data.timer };
    } catch (e) {
      return uventet(e);
    }
  });
