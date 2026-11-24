import {
  buildColMeta, cleanKommentar, fmtNum, vedleggFraMaaneder,
  type ColMeta, type Parsed, type Row,
} from "./smartdok-parser.ts";

// Speiler hauge-maskin-adminbord/src/lib/smartdok-pdf/tolk-timer.ts. Hold de to identiske.
export type SmartdokTime = {
  id: number                     // WorkHourID — tillegg og maskin-rader deler id med arbeidsraden
  maskinradId: number | null
  type: 'arbeid' | 'tillegg' | 'maskin'
  dato: string                   // 'YYYY-MM-DD'
  fra: number | null             // desimaltimer, f.eks. 7.5
  til: number | null
  navn: string
  aktivitet: string
  lonnsart: string               // for tillegg er dette kolonnenavnet, f.eks. "Overtid 50%"
  kommentar: string
  mengde: number                 // timer for arbeid/maskin; mengde for tillegg (kan være enheter, f.eks. 60)
  fakturert: boolean
  underprosjekt: string          // '' hvis ingen
  maskin: string                 // maskinnavn for maskin-rader
}

function fmtDato(iso: string): string {
  // Deler på strengen i stedet for Date, så tidssone ikke kan flytte dagen.
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function fmtKlokke(t: number): string {
  const min = Math.round(t * 60);
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Avrunder bort flyttallsstøy (0.1 + 0.2) før visning.
const rund = (n: number) => Math.round(n * 1000) / 1000;

type Gruppe = {
  hoved: SmartdokTime;          // arbeidsraden, eller første tillegg/maskin hvis foreldreløs
  arbeid: boolean;
  tillegg: SmartdokTime[];
  maskiner: SmartdokTime[];
};

export function byggTabell(
  timer: SmartdokTime[],
  prosjekt: { nummer: string; navn: string },
  periode: { fra: string; til: string },
): Parsed {
  // Grupper på id: tillegg og maskin hører til arbeidsraden med samme id.
  const grupper = new Map<number, Gruppe>();
  for (const t of timer) {
    if (t.type === "arbeid") {
      // To arbeidsrader med samme id betyr ugyldige data fra adminbordet; bedre å stoppe enn å droppe en stille.
      if (grupper.has(t.id)) throw new Error(`To arbeidsrader har samme id (${t.id}). Dataene fra adminbordet er ugyldige.`);
      grupper.set(t.id, { hoved: t, arbeid: true, tillegg: [], maskiner: [] });
    }
  }
  for (const t of timer) {
    if (t.type === "arbeid") continue;
    let g = grupper.get(t.id);
    // Foreldreløs rad får sin egen gruppe, så verdien ikke forsvinner fra tabellen.
    if (!g) {
      g = { hoved: t, arbeid: false, tillegg: [], maskiner: [] };
      grupper.set(t.id, g);
    }
    (t.type === "tillegg" ? g.tillegg : g.maskiner).push(t);
  }
  const liste = [...grupper.values()];

  const tilleggNavn: string[] = [];
  for (const t of timer) {
    if (t.type === "tillegg" && !tilleggNavn.includes(t.lonnsart)) tilleggNavn.push(t.lonnsart);
  }
  const harUnderprosjekt = liste.some((g) => g.hoved.underprosjekt !== "");
  const antallMaskiner = Math.max(0, ...liste.map((g) => g.maskiner.length));

  // Rå overskrifter gjennom buildColMeta, slik at etikett og flagg blir som i Excel.
  const overskrifter: { raw: string; tillegg?: boolean }[] = [
    ...["Dato", "Tid", "Navn", "Aktivitet", "Lønnsart", "Kommentar", "Timer"].map((raw) => ({ raw })),
    ...tilleggNavn.map((raw) => ({ raw, tillegg: true })),
    { raw: "Fakturert" },
    ...(harUnderprosjekt ? [{ raw: "Underprosjekt" }] : []),
  ];
  for (let i = 1; i <= antallMaskiner; i++) {
    overskrifter.push({ raw: `Maskinnavn${i}` }, { raw: `Maskin${i} Timer` });
  }

  const columns: ColMeta[] = overskrifter.map(({ raw, tillegg }) => {
    const c = buildColMeta(raw);
    // Ukjente lønnsarter faller tilbake til en kolonne uten sum; tillegg skal alltid summeres.
    return tillegg ? { ...c, sum: true, align: "right" as const } : c;
  });
  // Samme nøkkeldeduplisering som parseSmartdok.
  const antall = new Map<string, number>();
  for (const c of columns) {
    const n = antall.get(c.key) ?? 0;
    antall.set(c.key, n + 1);
    if (n > 0) c.key = `${c.key}_${n + 1}`;
  }
  // Nøkler slås opp på kolonneindeks, ikke på overskriftstekst: et tillegg kan hete det samme
  // som en basiskolonne («Timer», «Fakturert»), og da må de ha hver sin (dedupede) nøkkel.
  const basisNokkel = new Map<string, string>();
  const tilleggNokkel = new Map<string, string>();
  overskrifter.forEach((o, i) => {
    (o.tillegg ? tilleggNokkel : basisNokkel).set(o.raw, columns[i].key);
  });
  const nokkel = (raw: string) => basisNokkel.get(raw)!;
  const fakturertKey = nokkel("Fakturert");
  // Fakturert og Underprosjekt skal kunne filtreres (HEADER_CONFIG er delt med Excel-flyten og urørt).
  columns.forEach((c, i) => {
    if (!overskrifter[i].tillegg && (overskrifter[i].raw === "Fakturert" || overskrifter[i].raw === "Underprosjekt")) c.filter = true;
  });

  const sortert = [...liste].sort((a, b) =>
    a.hoved.dato.localeCompare(b.hoved.dato) ||
    (a.hoved.fra ?? -1) - (b.hoved.fra ?? -1) ||
    a.hoved.navn.localeCompare(b.hoved.navn, "nb"));

  const rows: Row[] = sortert.map((g) => {
    const h = g.hoved;
    const row: Row = {};
    for (const c of columns) row[c.key] = "";
    row[nokkel("Dato")] = fmtDato(h.dato);
    if (g.arbeid && h.fra !== null && h.til !== null) row[nokkel("Tid")] = `${fmtKlokke(h.fra)}–${fmtKlokke(h.til)}`;
    row[nokkel("Navn")] = h.navn;
    row[nokkel("Aktivitet")] = h.aktivitet;
    if (g.arbeid) {
      row[nokkel("Lønnsart")] = h.lonnsart;
      row[nokkel("Kommentar")] = cleanKommentar(h.kommentar);
      row[nokkel("Timer")] = fmtNum(rund(h.mengde));
    }
    const sum = new Map<string, number>();
    for (const t of g.tillegg) sum.set(t.lonnsart, (sum.get(t.lonnsart) ?? 0) + t.mengde);
    for (const [navn, v] of sum) row[tilleggNokkel.get(navn)!] = fmtNum(rund(v));

    const alle = [...(g.arbeid ? [h] : []), ...g.tillegg, ...g.maskiner];
    const antallFakt = alle.filter((t) => t.fakturert).length;
    row[nokkel("Fakturert")] = antallFakt === alle.length ? "Ja" : antallFakt === 0 ? "Nei" : "Delvis";
    if (harUnderprosjekt) row[nokkel("Underprosjekt")] = h.underprosjekt;
    g.maskiner.forEach((m, i) => {
      row[nokkel(`Maskinnavn${i + 1}`)] = m.maskin;
      row[nokkel(`Maskin${i + 1} Timer`)] = fmtNum(rund(m.mengde));
    });
    return row;
  });

  // Alle månedene fra periodens start til slutt.
  const [fy, fm] = periode.fra.split("-").map(Number);
  const [ty, tm] = periode.til.split("-").map(Number);
  const maaneder: { year: number; month: number }[] = [];
  for (let y = fy, m = fm - 1; y < ty || (y === ty && m <= tm - 1); m++) {
    if (m > 11) { m = 0; y++; if (y > ty) break; }
    maaneder.push({ year: y, month: m });
  }

  // Samme definisjon av «utfylt» som i parseSmartdok.
  const populatedCols = columns
    // Fakturert starter skjult, som i Excel-flyten; den kan slås på og filtreres likevel.
    .filter((c) => c.key !== fakturertKey)
    .filter((c) => rows.some((r) => {
      const v = (r[c.key] ?? "").trim();
      return v !== "" && v !== "0" && v.toLowerCase() !== "x";
    }))
    .map((c) => c.key);

  return {
    rows, columns,
    prosjekt: `${prosjekt.nummer} ${prosjekt.navn}`.trim(),
    vedlegg: vedleggFraMaaneder(maaneder),
    populatedCols,
    fakturertKey,
  };
}

