import { feilmelding } from "./innlogging.ts";

export type Feil = { ok: false; feil: string; loggInn?: true; ukjentUtfall?: true };

export const UTLOGGET: Feil = { ok: false, feil: "Du er logget ut. Logg inn på nytt.", loggInn: true };
export const GENERELL_FEIL = "Fikk ikke kontakt med adminbordet.";
export const TIDSAVBRUDD = "Hentingen tok for lang tid. Prøv en kortere periode.";
export const IKKE_SATT_OPP = "Henting fra SmartDok er ikke satt opp.";

// Ren hjelper: oversetter en feilstatus fra adminbordet til et Svar.
export function feilSvar(status: number, adminbordFeil: string | null): Feil {
  if (status === 401) return UTLOGGET;
  if (status === 403) return { ok: false, feil: feilmelding("ingen-tilgang") };
  if (status === 504) return { ok: false, feil: TIDSAVBRUDD };
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

export type Svar<T> = ({ ok: true } & T) | Feil;

// Logger bare stiene til feltene som ikke stemmer, aldri verdier.
export function skjemaFeil(error: { issues: { path: PropertyKey[] }[] }): Feil {
  console.error("Uventet svarformat fra adminbordet:", error.issues.map((i) => i.path.map(String).join(".")).join(", "));
  return { ok: false, feil: GENERELL_FEIL };
}

export function uventet(e: unknown): Feil {
  console.error("Kallet til adminbordet feilet uventet:", e instanceof Error ? e.message : "ukjent feil");
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, feil: TIDSAVBRUDD };
  return { ok: false, feil: GENERELL_FEIL };
}

// Skriving: uten svar vet vi ikke om Tripletex tok imot. Da må brukeren få vite
// at det ikke er trygt å sende på nytt, og flagget lar UI-et peke til «Sendinger».
export const UKJENT_UTFALL_FEIL =
  "Fikk ikke svar i tide. Det kan ha gått gjennom – ikke send på nytt, men åpne «Sendinger» og sjekk sendingen der.";

/** Uventet feil (tidsavbrudd, nettfeil, kaste unntak) under en skriving. */
export function uventetSkriving(e: unknown): Feil {
  console.error("Skriving mot adminbordet feilet uventet:", e instanceof Error ? e.message : "ukjent feil");
  return { ok: false, feil: UKJENT_UTFALL_FEIL, ukjentUtfall: true };
}

/** Gjør en feil fra kallAdminbord om til skrivefeil: 504 betyr også ukjent utfall. */
export function somSkrivefeil(f: Feil): Feil {
  return f.feil === TIDSAVBRUDD ? { ok: false, feil: UKJENT_UTFALL_FEIL, ukjentUtfall: true } : f;
}

/** Svaret kom, men var uleselig: også her vet vi ikke hva som ble gjort. */
export function skjemaFeilSkriving(error: { issues: { path: PropertyKey[] }[] }): Feil {
  skjemaFeil(error);
  return { ok: false, feil: UKJENT_UTFALL_FEIL, ukjentUtfall: true };
}
