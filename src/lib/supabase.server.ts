import process from "node:process";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCookies, setCookie } from "@tanstack/react-start/server";

// Miljøvariablene leses inne i funksjonen, ikke i modulen, fordi de bindes
// først per forespørsel (se config.server.ts). Bare anon-nøkkelen brukes:
// tilgang avgjøres av RLS og SQL-funksjonen, aldri av en servicenøkkel.
export function lagServerKlient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonNokkel = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonNokkel) {
    throw new Error("SUPABASE_URL og SUPABASE_ANON_KEY må være satt på serveren.");
  }

  return createServerClient(url, anonNokkel, {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, options);
        }
      },
    },
  });
}
