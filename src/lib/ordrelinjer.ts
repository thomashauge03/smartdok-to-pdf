import type { ColMeta, Row } from "./smartdok-parser.ts";

// Ren logikk for hva som havner på kunde-ordren i Tripletex. Ingen UI, ingen nett.
// Feil sum her blir feil faktura, så uleselige tall stopper beregningen (kaster) i stedet for å bli 0.

export type Produkt = { id: number; nummer: string; navn: string; pris: number | null };
export type Kobling = { maskinId: number; faktureres: boolean; produktId: number | null };
/**
 * produktId null er en tekstlinje uten produkt: den legges på ordren med 0 kr
 * og fylles ut i Tripletex (ordren er godkjenningen).
 */
export type Ordrelinje = { produktId: number | null; produktnavn: string; antall: number; tekst: string; listepris: number | null };
/** Alt i advarsler er informasjon: ingenting her stopper sendingen. */
export type Ordreberegning = {
  linjer: Ordrelinje[];
  timerIder: number[];
  advarsler: {
    /** Personens timer (Timer-kolonnen) på rader uten fakturerbar maskin: lagt på som Grunnarbeider (602). */
    somGrunnarbeider: number;
    /** Rader uten __id (lagt til for hånd): står i PDF-en, blir aldri linjer. */
    haandlagde: number;
    /** Maskiner uten kobling (eller med borte produkt): lagt på som tekstlinjer uten produkt. */
    utenKobling: string[];
    /** Produkter uten pris i Tripletex: lagt på med 0 kr. */
    utenPris: string[];
    /** 602, 608 eller 609 finnes ikke i Tripletex: lagt på som tekstlinjer med samme navn. */
    manglerProdukt: string[];
    /** «Overtid …»-kolonner uten produkt: blir ikke linjer. */
    ukjentOvertid: string[];
    /** Timer som er lagt på ordren, men som alt er merket fakturert i SmartDok. */
    alleredeFakturert: number;
  };
};

const GRUNNARBEIDER = { nummer: "602", navn: "Grunnarbeider" };
const OVERTID: { label: string; nummer: string; navn: string }[] = [
  { label: "Overtid 50%", nummer: "608", navn: "50 % overtidsarbeid" },
  { label: "Overtid 100%", nummer: "609", navn: "100 % overtidsarbeid" },
];

const linjetekst = (navn: string) => `${navn} – arbeid utført iht. vedlegg`;

// Cellene er norsk formatert («7,5», tom = 0). Alt annet er en feil som må vises, ikke gjettes på.
function lesTall(celle: string | undefined, hvor: string): number {
  const s = (celle ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return 0;
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Kan ikke lese «${celle}» som timer (${hvor}). Rett cellen før du sender.`);
  // Negative timer ville trukket fra ordren uten at noen merker det.
  if (s.startsWith("-")) throw new Error(`Negative timer («${celle}») er ikke tillatt (${hvor}). Rett cellen før du sender.`);
  return Number(s);
}

const rund2 = (n: number) => Math.round(n * 100) / 100;

export function beregnOrdrelinjer(
  rows: Row[],
  columns: ColMeta[],
  koblinger: Kobling[],
  produkter: Produkt[],
): Ordreberegning {
  // Kolonner finnes via etikett, aldri hardkodede nøkler (nøkler kan være deduplisert).
  const finn = (label: string) => columns.find((c) => c.label === label)?.key;
  const timerKey = finn("Timer");
  const slots: { navn: string | undefined; timer: string; i: number }[] = [];
  for (const c of columns) {
    const m = c.label.match(/^Maskintimer(\d+)$/);
    if (m) slots.push({ i: Number(m[1]), timer: c.key, navn: finn(`Maskinnavn${m[1]}`) });
  }
  const overtidKolonner = OVERTID.map((o) => ({ ...o, key: finn(o.label) }));
  // Andre «Overtid …»-kolonner har ikke produkt; de varsles, de blir aldri stille borte.
  const ukjenteOvertid = columns.filter((c) => /^overtid/i.test(c.label) && !OVERTID.some((o) => o.label === c.label));

  const kobling = new Map(koblinger.map((k) => [k.maskinId, k]));
  const produktFraId = new Map(produkter.map((p) => [p.id, p]));
  const produktFraNummer = (nr: string) => produkter.find((p) => p.nummer === nr);

  // Timene summeres per produkt (produktlinjer) og per navn (tekstlinjer), og rundes først til slutt.
  const produktSum = new Map<number, number>();
  const tekstSum = new Map<string, number>();
  const utenKobling = new Set<string>();
  const utenPris = new Set<string>();
  const manglerProdukt = new Set<string>();
  const ukjentOvertid = new Set<string>();
  const timerIder = new Set<number>();
  let somGrunnarbeider = 0;
  let haandlagde = 0;
  let alleredeFakturert = 0;

  const paaProdukt = (p: Produkt, timer: number) => {
    produktSum.set(p.id, (produktSum.get(p.id) ?? 0) + timer);
    if (!p.pris) utenPris.add(p.navn);
  };
  const somTekst = (navn: string, timer: number) => tekstSum.set(navn, (tekstSum.get(navn) ?? 0) + timer);
  // 602, 608 og 609 slås opp på nummer. Finnes de ikke i Tripletex, blir det tekstlinje med samme navn.
  const paaStandard = (s: { nummer: string; navn: string }, timer: number) => {
    const p = produktFraNummer(s.nummer);
    if (p) return paaProdukt(p, timer);
    manglerProdukt.add(`${s.nummer} ${s.navn}`);
    somTekst(s.navn, timer);
  };

  rows.forEach((row, radNr) => {
    const hvor = (kol: string) => `rad ${radNr + 1}, ${kol}`;
    const idTekst = (row["__id"] ?? "").trim();
    // Håndlagde rader (uten __id) kan ikke merkes som sendt: de vises som advarsel og blir aldri linjer.
    if (idTekst === "") { haandlagde++; return; }
    if (!/^[0-9]+$/.test(idTekst)) throw new Error(`Ugyldig __id «${idTekst}» (${hvor("__id")}).`);
    const id = Number(idTekst);

    let gaLinje = false; // minst én linje fra denne raden
    let harFakturerbarMaskin = false; // maskin med timer som faktureres: koblet, ukoblet eller med borte produkt

    for (const s of slots) {
      const timer = lesTall(row[s.timer], hvor(`Maskintimer${s.i}`));
      if (timer <= 0) continue;
      const k = kobling.get(Number(row[`__maskin${s.i}`] ?? ""));
      if (k && !k.faktureres) continue; // bevisst ikke fakturert: ingen linje
      harFakturerbarMaskin = true;
      gaLinje = true;
      // Alt fakturert i SmartDok tas med likevel (godkjennes i Tripletex), men telles så det vises.
      if (row[`__fakt_maskin${s.i}`] === "1") alleredeFakturert += timer;
      const p = k && k.produktId !== null ? produktFraId.get(k.produktId) : undefined;
      if (p) { paaProdukt(p, timer); continue; }
      const navn = (s.navn ? row[s.navn] : "")?.trim() || `Maskin ${s.i}`;
      utenKobling.add(k && k.produktId !== null ? `${navn} (produktet finnes ikke lenger i Tripletex)` : navn);
      somTekst(navn, timer);
    }

    // Overtid blir alltid linje, med eller uten maskin på raden.
    for (const o of overtidKolonner) {
      if (!o.key) continue;
      const timer = lesTall(row[o.key], hvor(o.label));
      if (timer <= 0) continue;
      if (row[`__fakt_${o.key}`] === "1") alleredeFakturert += timer;
      paaStandard(o, timer);
      gaLinje = true;
    }
    for (const c of ukjenteOvertid) {
      if (lesTall(row[c.key], hvor(c.label)) > 0) ukjentOvertid.add(c.label);
    }

    // Uten fakturerbar maskin (ingen maskin med timer, eller bare «faktureres ikke»):
    // personens timer blir Grunnarbeider. En ukoblet maskin er en maskin (tekstlinje over).
    if (!harFakturerbarMaskin && timerKey) {
      const timer = lesTall(row[timerKey], hvor("Timer"));
      if (timer > 0) {
        paaStandard(GRUNNARBEIDER, timer);
        somGrunnarbeider += timer;
        gaLinje = true;
      }
    }

    if (gaLinje) timerIder.add(id);
  });

  const produktlinjer = [...produktSum.entries()]
    .map(([id, timer]) => ({ p: produktFraId.get(id)!, timer }))
    .sort((a, b) => a.p.nummer.localeCompare(b.p.nummer, "nb", { numeric: true }))
    .map(({ p, timer }): Ordrelinje => ({
      produktId: p.id, produktnavn: p.navn, antall: rund2(timer), tekst: linjetekst(p.navn), listepris: p.pris,
    }));
  const tekstlinjer = [...tekstSum.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "nb", { numeric: true }))
    .map(([navn, timer]): Ordrelinje => ({
      produktId: null, produktnavn: navn, antall: rund2(timer), tekst: linjetekst(navn), listepris: null,
    }));

  return {
    linjer: [...produktlinjer, ...tekstlinjer],
    timerIder: [...timerIder].sort((a, b) => a - b),
    advarsler: {
      somGrunnarbeider: rund2(somGrunnarbeider), haandlagde, utenKobling: [...utenKobling], utenPris: [...utenPris],
      manglerProdukt: [...manglerProdukt], ukjentOvertid: [...ukjentOvertid], alleredeFakturert: rund2(alleredeFakturert),
    },
  };
}

// ---------- Forslag til produktkobling ----------

// Navn uten mellomrom og i små bokstaver, så «L 90 G» og «L90G» blir like.
const tett = (s: string) => s.toLowerCase().replace(/\s+/g, "");

// Modellkoder som «a30», «l90», «c50» og frittstående tretall som «906» (Cat 906).
// Lookbehind hindrer at «t 906» i «Cat 906» leses som koden «t906».
function modellkoder(navn: string): Set<string> {
  const koder = new Set<string>();
  for (const m of navn.toLowerCase().matchAll(/(?<![a-zæøå])([a-z])\s?(\d{2,3})(?!\d)/g)) koder.add(m[1] + m[2]);
  for (const m of navn.matchAll(/(?<!\d)(\d{3})(?!\d)/g)) koder.add(m[1]);
  return koder;
}

function tonnFraNavn(navn: string): number | null {
  const eksplisitt = navn.match(/(\d+(?:[.,]\d+)?)\s*(?:t|tonn)\b/i);
  if (eksplisitt) return Number(eksplisitt[1].replace(",", "."));
  const cat = navn.match(/\bcat\s*3(\d\d)(?!\d)/i);
  if (cat) return Number(cat[1]);
  const delt = navn.match(/\b(?:ecr?|sk)\s*(\d{2,3})/i) ?? navn.match(/\bvolvo\s+(\d{3})\s*d\b/i);
  if (delt) return Number(delt[1]) / 10;
  return null;
}

export function foreslåProdukt(
  maskin: { navn: string; kategori: string },
  produkter: Produkt[],
): { faktureres: false } | { produktId: number } | null {
  const kategori = maskin.kategori.trim().toLowerCase();
  if (kategori === "firmabiler" || kategori === "tilleggsutstyr") return { faktureres: false };

  if (tett(maskin.navn) === "håndarbeid" || kategori === "håndarbeid") {
    const p = produkter.find((x) => tett(x.navn) === "grunnarbeider");
    return p ? { produktId: p.id } : null;
  }

  if (kategori === "gravemaskiner") {
    const tonn = tonnFraNavn(maskin.navn);
    if (tonn === null || !(tonn > 0 && tonn <= 80)) return null;
    let beste: { id: number; tonn: number } | null = null;
    for (const p of produkter) {
      const m = p.navn.match(/^\s*(\d+(?:[.,]\d+)?)\s*t\s+gravemaskin/i);
      if (!m) continue;
      const t = Number(m[1].replace(",", "."));
      const diff = Math.abs(t - tonn);
      // Likt avstand: velg den største, så kunden aldri får billigere maskin enn den som ble brukt.
      if (!beste || diff < Math.abs(beste.tonn - tonn) || (diff === Math.abs(beste.tonn - tonn) && t > beste.tonn)) {
        beste = { id: p.id, tonn: t };
      }
    }
    return beste ? { produktId: beste.id } : null;
  }

  if (kategori === "dumperer" || kategori === "traktor-hjullastere") {
    const mine = modellkoder(maskin.navn);
    if (mine.size === 0) return null;
    const treff = produkter.filter((p) => [...modellkoder(p.navn)].some((k) => mine.has(k)));
    // Flere mulige produkter er gjetting, og da er null tryggere enn feil produkt.
    return treff.length === 1 ? { produktId: treff[0].id } : null;
  }

  return null;
}
