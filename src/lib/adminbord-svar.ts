import { feilmelding } from "./innlogging.ts";

export type Feil = { ok: false; feil: string; loggInn?: true };

export const UTLOGGET: Feil = { ok: false, feil: "Du er logget ut. Logg inn på nytt.", loggInn: true };
export const GENERELL_FEIL = "Fikk ikke kontakt med adminbordet.";
export const IKKE_SATT_OPP = "Henting fra SmartDok er ikke satt opp.";

// Ren hjelper: oversetter en feilstatus fra adminbordet til et Svar.
export function feilSvar(status: number, adminbordFeil: string | null): Feil {
  if (status === 401) return UTLOGGET;
  if (status === 403) return { ok: false, feil: feilmelding("ingen-tilgang") };
  const tekst = adminbordFeil?.trim().slice(0, 300);
  return { ok: false, feil: tekst || GENERELL_FEIL };
}

// Bare https, med http tillatt mot localhost og 127.0.0.1 under utvikling.
export function normaliserAdminbordUrl(rå: string | undefined): string | null {
  const base = rå?.trim().replace(/\/+$/, "");
  if (!base) return null;
  if (/^https:\/\//i.test(base)) return base;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(base)) return base;
  return null;
}
