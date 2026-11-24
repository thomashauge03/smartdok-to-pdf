import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { vurderTilgang } from "./innlogging";
import type { Innloggingsfeil, Innloggingsstatus } from "./innlogging";

// Importene fra .server.ts-filer skjer inne i handlerne så de aldri havner i
// klientpakken.

// En rpc-feil gir null, og vurderTilgang slipper da ikke inn (fail closed).
async function harTilgang(
  supabase: SupabaseClient,
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("smartdok_pdf_har_tilgang");
  return error ? null : (data as boolean | null);
}

export const hentInnlogging = createServerFn({ method: "GET" }).handler(
  async (): Promise<Innloggingsstatus> => {
    const { lagServerKlient } = await import("./supabase.server");
    const supabase = lagServerKlient();
    // getUser validerer JWT-en mot Supabase; getSession ville bare stolt på cookien.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return vurderTilgang(null, null);
    return vurderTilgang(data.user, await harTilgang(supabase));
  },
);

export const loggInn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ epost: z.string().email(), passord: z.string().min(1) }))
  .handler(
    async ({ data }): Promise<{ ok: true } | { ok: false; feil: Innloggingsfeil }> => {
      try {
        const { lagServerKlient } = await import("./supabase.server");
        const supabase = lagServerKlient();
        const { error } = await supabase.auth.signInWithPassword({
          email: data.epost,
          password: data.passord,
        });
        if (error) return { ok: false, feil: "feil-passord" };

        if ((await harTilgang(supabase)) !== true) {
          // Lokalt omfang fjerner cookien før nettverkskallet, så den ikke blir
          // liggende igjen hos en bruker uten tilgang hvis tilbakekallingen feiler.
          await supabase.auth.signOut({ scope: "local" });
          return { ok: false, feil: "ingen-tilgang" };
        }
        return { ok: true };
      } catch (e) {
        console.error("Innlogging feilet uventet:", e instanceof Error ? e.message : "ukjent feil");
        return { ok: false, feil: "ukjent" };
      }
    },
  );

export const loggUt = createServerFn({ method: "POST" }).handler(async (): Promise<void> => {
  const { lagServerKlient } = await import("./supabase.server");
  await lagServerKlient().auth.signOut({ scope: "local" });
});
