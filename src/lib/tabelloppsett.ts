import type { ColKey, ColMeta, Parsed } from "./smartdok-parser.ts";

// Ren logikk for å bytte timene i tabellen uten å miste oppsettet brukeren har
// gjort (filtre, synlige kolonner, bredder). Brukes når timene hentes på nytt
// etter en sending eller en angring.

export type Tabelloppsett = {
  columns: ColMeta[];
  filters: Record<string, Set<string>>;
  visibleCols: Set<ColKey>;
  colWidths: Record<ColKey, number>;
};

/** Filtrene som gjelder rett etter en henting fra SmartDok. */
export function forhandsfiltre(p: Pick<Parsed, "fakturertKey" | "tripletexKey">): Record<string, Set<string>> {
  return {
    ...(p.fakturertKey ? { [p.fakturertKey]: new Set(["Nei", "Delvis"]) } : {}),
    ...(p.tripletexKey ? { [p.tripletexKey]: new Set(["Ikke sendt"]) } : {}),
  };
}

/**
 * Oppsettet for den nye tabellen: alt brukeren har valgt for kolonner som fortsatt
 * finnes, beholdes. Nye kolonner får det en ny henting ville gitt dem
 * (forhåndsfilter, synlig hvis utfylt, standardbredde).
 */
export function behold(gammelt: Tabelloppsett, ny: Parsed): Omit<Tabelloppsett, "columns"> {
  const fantes = new Set(gammelt.columns.map((c) => c.key));
  const forhand = forhandsfiltre(ny);
  const populated = new Set(ny.populatedCols);

  const filters: Record<string, Set<string>> = {};
  for (const c of ny.columns) {
    if (!c.filter) continue;
    filters[c.key] =
      fantes.has(c.key) && gammelt.filters[c.key] ? new Set(gammelt.filters[c.key]) : new Set(forhand[c.key] ?? []);
  }

  const visibleCols = new Set<ColKey>();
  const colWidths: Record<ColKey, number> = {};
  for (const c of ny.columns) {
    if (fantes.has(c.key) ? gammelt.visibleCols.has(c.key) : populated.has(c.key)) visibleCols.add(c.key);
    colWidths[c.key] = fantes.has(c.key) ? gammelt.colWidths[c.key] ?? c.defaultWidth : c.defaultWidth;
  }
  return { filters, visibleCols, colWidths };
}

export const TABELL_IKKE_OPPDATERT = "Tabellen er ikke oppdatert – hent på nytt for å se Tripletex-status.";
export const BEKREFT_OPPDATERING = "Oppdatere timene fra SmartDok? Endringer du har gjort i tabellen, går tapt.";
