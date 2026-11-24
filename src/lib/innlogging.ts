export type Innloggingsstatus =
  | { status: "ute" }
  | { status: "ingen-tilgang" }
  | { status: "inne"; epost: string };

export type Innloggingsfeil = "feil-passord" | "ingen-tilgang" | "ukjent";

/**
 * Tilgangssjekken er bevisst strikt: bare et uttrykkelig `true` slipper inn.
 * `null` betyr at sjekken feilet, og da skal brukeren ikke få tilgang.
 */
export function vurderTilgang(
  bruker: { email?: string | null } | null,
  harTilgang: boolean | null,
): Innloggingsstatus {
  if (!bruker) return { status: "ute" };
  if (harTilgang !== true) return { status: "ingen-tilgang" };
  return { status: "inne", epost: bruker.email ?? "" };
}

const FEILMELDINGER: Record<Innloggingsfeil, string> = {
  "feil-passord": "Feil e-post eller passord.",
  "ingen-tilgang": "Du har ikke tilgang til denne siden. Spør Thomas.",
  ukjent: "Noe gikk galt. Prøv igjen.",
};

export function feilmelding(kode: Innloggingsfeil): string {
  return FEILMELDINGER[kode];
}
