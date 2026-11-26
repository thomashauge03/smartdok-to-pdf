import type { ColMeta, Row } from "./smartdok-parser.ts";

// Ren logikk for hva som havner på kunde-ordren i Tripletex. Ingen UI, ingen nett.
// Feil sum her blir feil faktura, så uleselige tall stopper beregningen (kaster) i stedet for å bli 0.

export type Produkt = { id: number; nummer: string; navn: string; pris: number | null };
export type Kobling = { maskinId: number; faktureres: boolean; produktId: number | null };
export type Ordrelinje = { produktId: number; produktnavn: string; antall: number; tekst: string; listepris: number | null };
export type Ordreberegning = {
  linjer: Ordrelinje[];
  timerIder: number[];
  advarsler: {
    utenMaskin: number;
    haandlagde: number;
    utenKobling: string[];
    utenPris: string[];
    ukjentOvertid: string[];
    /** Overtidstimer på rader uten fakturert maskin: blir ikke linjer, raden merkes ikke. */
    overtidUtenMaskin: number;
    /** Maskin- og overtidstimer som alt er fakturert i SmartDok, og som derfor hoppes over. */
    alleredeFakturert: number;
  };
};

const OVERTID: { label: string; nummer: string }[] = [
  { label: "Overtid 50%", nummer: "608" },
  { label: "Overtid 100%", nummer: "609" },
];

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

  const sum = new Map<number, number>();
  const leggTil = (p: Produkt, timer: number) => sum.set(p.id, (sum.get(p.id) ?? 0) + timer);
  const utenKobling = new Set<string>();
  const utenPris = new Set<string>();
  const ukjentOvertid = new Set<string>();
  const timerIder = new Set<number>();
  let utenMaskin = 0;
  let haandlagde = 0;
  let overtidUtenMaskin = 0;
  let alleredeFakturert = 0;

  rows.forEach((row, radNr) => {
    const hvor = (kol: string) => `rad ${radNr + 1}, ${kol}`;
    const idTekst = (row["__id"] ?? "").trim();
    // Håndlagde rader (uten __id) kan ikke merkes som sendt: de vises som advarsel og blir aldri linjer.
    if (idTekst === "") { haandlagde++; return; }
    if (!/^[0-9]+$/.test(idTekst)) throw new Error(`Ugyldig __id «${idTekst}» (${hvor("__id")}).`);
    const id = Number(idTekst);

    let harFakturertTimer = false; // linje laget fra denne raden
    let harFakturertMaskin = false; // minst én maskin ga linje
    let harMaskin = false; // minst én maskin med timer (også ukoblet eller faktureres:false)
    let harIkkeFakturertMaskin = false; // maskin med timer som ikke ga linje fordi faktureres:false
    let harAlleredeFakturert = false; // maskin med timer som alt er fakturert i SmartDok

    for (const s of slots) {
      const timer = lesTall(row[s.timer], hvor(`Maskintimer${s.i}`));
      if (timer <= 0) continue;
      harMaskin = true;
      // Alt fakturert i SmartDok (f.eks. fra før overgangen): aldri på ordren igjen, og
      // ingen krav om kobling for en maskin som ikke skal faktureres herfra.
      if (row[`__fakt_maskin${s.i}`] === "1") {
        alleredeFakturert += timer;
        harAlleredeFakturert = true;
        continue;
      }
      const k = kobling.get(Number(row[`__maskin${s.i}`] ?? ""));
      if (k && !k.faktureres) { harIkkeFakturertMaskin = true; continue; } // bevisst ikke fakturert: ingen linje, ingen advarsel
      const navn = (s.navn ? row[s.navn] : "")?.trim() || `Maskin ${s.i}`;
      const p = k && k.produktId !== null ? produktFraId.get(k.produktId) : undefined;
      if (!p) {
        utenKobling.add(k && k.produktId !== null ? `${navn} (produktet finnes ikke lenger i Tripletex)` : navn);
        continue;
      }
      leggTil(p, timer);
      harFakturertTimer = true;
      harFakturertMaskin = true;
      if (!p.pris) utenPris.add(p.navn);
    }

    for (const o of overtidKolonner) {
      if (!o.key) continue;
      const timer = lesTall(row[o.key], hvor(o.label));
      if (timer <= 0) continue;
      if (row[`__fakt_${o.key}`] === "1") { alleredeFakturert += timer; continue; }
      // Overtid er et tillegg oppå maskintimene (spec). Uten fakturert maskin på samme rad
      // blir den ingen linje, og raden merkes ikke, så den kan sendes når maskinen er på plass.
      if (!harFakturertMaskin) { overtidUtenMaskin += timer; continue; }
      const p = produktFraNummer(o.nummer);
      if (!p) {
        utenPris.add(`${o.nummer} ${o.label} (produktet finnes ikke i Tripletex)`);
        continue;
      }
      leggTil(p, timer);
      harFakturertTimer = true;
      if (!p.pris) utenPris.add(p.navn);
    }
    for (const c of ukjenteOvertid) {
      if (lesTall(row[c.key], hvor(c.label)) > 0) ukjentOvertid.add(c.label);
    }

    // Bare rader som ga minst én linje, merkes som sendt; resten skal kunne sendes senere.
    if (harFakturertTimer) timerIder.add(id);
    // «Timer uten fakturerbar maskin»: ingen maskin ga linje, og ingen ukoblet maskin har eget varsel.
    // Alt fakturerte maskiner har sitt eget varsel (alleredeFakturert). Kun advarsel, aldri sperre.
    const ukoblet = harMaskin && !harFakturertMaskin && !harIkkeFakturertMaskin;
    if (!harFakturertMaskin && !ukoblet && !harAlleredeFakturert && timerKey) utenMaskin += lesTall(row[timerKey], hvor("Timer"));
  });

  const linjer: Ordrelinje[] = [...sum.entries()]
    .map(([produktId, timer]) => {
      const p = produktFraId.get(produktId)!;
      return {
        produktId, produktnavn: p.navn, antall: rund2(timer),
        tekst: `${p.navn} – arbeid utført iht. vedlegg`, listepris: p.pris,
      };
    })
    .sort((a, b) =>
      produktFraId.get(a.produktId)!.nummer.localeCompare(produktFraId.get(b.produktId)!.nummer, "nb", { numeric: true }));

  return {
    linjer,
    timerIder: [...timerIder].sort((a, b) => a - b),
    advarsler: {
      utenMaskin: rund2(utenMaskin), haandlagde, utenKobling: [...utenKobling], utenPris: [...utenPris],
      ukjentOvertid: [...ukjentOvertid], overtidUtenMaskin: rund2(overtidUtenMaskin), alleredeFakturert: rund2(alleredeFakturert),
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
