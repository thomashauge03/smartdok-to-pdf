import { foreslåProdukt, type Kobling, type Ordreberegning, type Produkt } from "./ordrelinjer.ts";
import type { ColMeta, Row } from "./smartdok-parser.ts";
import type { LagreKoblingInn, LeggPaaOrdreInn } from "./tripletex.ts";

// Ren logikk bak dialogene for Tripletex: tekster, summer, sperrer og
// kroppen til «Legg på ordre». Ingen React og ingen nett, så alt kan testes
// med node --test.

/* ── Tall og datoer ───────────────────────────────────────── */

export const rund2 = (n: number) => Math.round(n * 100) / 100;

const kroner = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const antallFormat = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 });

export const fmtKr = (n: number) => `kr ${kroner.format(n)}`;
export const fmtAntall = (n: number) => antallFormat.format(n);

/** «2026-11-03» → «03.11.2026». Delt på strengen, så tidssone ikke flytter dagen. */
export function fmtDato(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Sum for én linje. Rabatten er i prosent, som i Tripletex. */
export function linjesum(antall: number, pris: number, rabatt = 0): number {
  return rund2(antall * pris * (1 - rabatt / 100));
}

export function totalsum(linjer: { antall: number; pris: number | null; rabatt?: number }[]): number {
  return rund2(linjer.reduce((s, l) => s + (l.pris === null ? 0 : linjesum(l.antall, l.pris, l.rabatt ?? 0)), 0));
}

export const tripletexOrdreUrl = (ordreId: number) =>
  `https://tripletex.no/execute/orderMenu?orderId=${encodeURIComponent(String(ordreId))}`;

/* ── PDF ──────────────────────────────────────────────────── */

/**
 * Bytes → base64 i biter: String.fromCharCode(...hele) sprenger kallstakken
 * på store filer, og btoa tar bare latin1-tekst.
 */
export function tilBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const BIT = 0x8000;
  const deler: string[] = [];
  for (let i = 0; i < bytes.length; i += BIT) deler.push(String.fromCharCode(...bytes.subarray(i, i + BIT)));
  return btoa(deler.join(""));
}

/**
 * Filnavnet havner i Content-Disposition hos adminbordet: bort med styretegn,
 * anførselstegn og skråstreker, høyst 120 tegn og alltid .pdf til slutt.
 */
export function sendbartFilnavn(navn: string): string {
  const rent = navn
    .replace(/[\x00-\x1f\x7f"\\/]/g, "")
    .trim()
    .replace(/\.pdf$/i, "");
  const stamme = (rent || "timeliste").slice(0, 116);
  return `${stamme}.pdf`;
}

/* ── Statusord ────────────────────────────────────────────── */

export type Tone = "ok" | "advarsel" | "feil" | "noytral";

const STATUS: Record<string, { tittel: string; forklaring: string; tone: Tone }> = {
  sendt: {
    tittel: "Sendt",
    forklaring: "Linjene og PDF-en er lagt på ordren, og timene er merket som sendt i SmartDok.",
    tone: "ok",
  },
  sendt_uten_vedlegg: {
    tittel: "Sendt uten vedlegg",
    forklaring:
      "Linjene er lagt på ordren og timene er merket i SmartDok, men PDF-en kom ikke sikkert med. " +
      "Se på ordren i Tripletex og legg ved PDF-en for hånd om den mangler.",
    tone: "advarsel",
  },
  sendt_uten_merke: {
    tittel: "Sendt, men ikke merket",
    forklaring:
      "Linjene er lagt på ordren, men timene ble ikke merket som sendt i SmartDok. Ikke send dem på nytt: " +
      "avklar sendingen under «Sendinger» med «Sjekk i Tripletex» og så «Merk som sendt».",
    tone: "advarsel",
  },
  ukjent_utfall: {
    tittel: "Ukjent utfall",
    forklaring:
      "Vi vet ikke om linjene kom inn i Tripletex. Ikke send timene på nytt før sendingen er avklart med «Sjekk i Tripletex» under «Sendinger».",
    tone: "feil",
  },
  startet: {
    tittel: "Sendes nå",
    forklaring: "Sendingen pågår. Står den slik i mer enn ti minutter, må den sjekkes i Tripletex.",
    tone: "noytral",
  },
  feilet: {
    tittel: "Feilet",
    forklaring: "Ingenting ble lagt på ordren. Timene kan sendes på nytt.",
    tone: "noytral",
  },
  angret: {
    tittel: "Angret",
    forklaring: "Timene er ikke lenger merket som sendt og kan sendes på nytt. Ordren i Tripletex er ikke endret herfra.",
    tone: "noytral",
  },
};

export function statusTekst(status: string): { tittel: string; forklaring: string; tone: Tone } {
  return STATUS[status] ?? { tittel: status, forklaring: "Ukjent status. Last inn listen på nytt.", tone: "noytral" };
}

// Speiler adminbordets FORELDET_MS og gjeldendeStatus(): en «startet» som har
// stått i over ti minutter, døde underveis og regnes som ukjent utfall.
export const FORELDET_MS = 10 * 60 * 1000;

export function gjeldendeStatus(status: string, endret: string | null, naa: number): string {
  if (status !== "startet") return status;
  const t = endret ? Date.parse(endret) : NaN;
  if (!Number.isFinite(t) || naa - t > FORELDET_MS) return "ukjent_utfall";
  return status;
}

/**
 * Hvilke knapper en sending får. Serveren avgjør likevel; dette er bare hva som vises.
 * «Merk som sendt» etter ukjent utfall på en eksisterende ordre godtar adminbordet
 * (kanMerke) bare med bekreftetLinjer: vi kan ikke se om våre linjer kom inn blant
 * dem som sto der fra før, så et menneske må ha sett dem (`bekreftLinjer`).
 * Null for ny_ordre regnes som eksisterende ordre, som hos adminbordet.
 */
export function handlinger(
  status: string,
  nyOrdre: boolean | null = null,
): { fjernMerke: boolean; avklar: boolean; merk: boolean; bekreftLinjer: boolean } {
  const avklar = ["ukjent_utfall", "sendt_uten_merke"].includes(status);
  return {
    fjernMerke: ["sendt", "sendt_uten_vedlegg", "sendt_uten_merke"].includes(status),
    avklar,
    merk: avklar,
    bekreftLinjer: status === "ukjent_utfall" && nyOrdre !== true,
  };
}

/** Det brukeren bekrefter før «Merk som sendt» på en eksisterende ordre etter ukjent utfall. */
export function bekreftLinjerTekst(ordrenummer: string | null): string {
  return `Jeg har sett at linjene står på ${ordrenummer ? `ordre ${ordrenummer}` : "ordren"} i Tripletex.`;
}

/** Teksten i bekreftelsen før «Frigi timene». */
export function frigiTekst(status: string, ordrenummer: string | null): string {
  if (status === "sendt_uten_merke") {
    return (
      `Linjene står på ordre ${ordrenummer ?? "(ukjent nummer)"} i Tripletex. ` +
      "Fjern dem der først, ellers blir timene fakturert to ganger."
    );
  }
  return (
    "Timene blir sendbare igjen og kan legges på en ordre på nytt. Gjør dette bare når linjene fra denne " +
    "sendingen ikke står på ordren i Tripletex, eller du har fjernet dem der."
  );
}

export const UAVKLART_SPERRE = "Det finnes en sending som ikke er avklart. Avklar den under Sendinger før du sender mer.";

/**
 * Sperre fra sendingslisten: en sending som ikke er avklart (ukjent utfall, sendt
 * uten merke, eller startet for under ti minutter siden) stopper nye sendinger.
 * Kan listen ikke hentes, sperres det også: vi vet ikke om noe henger.
 */
export function sendingSperre(
  svar: { ok: true; sendinger: { status: string; endret: string | null }[] } | { ok: false; feil: string; loggInn?: boolean },
  naa: number,
): (Melding & { loggInn?: boolean }) | null {
  if (!svar.ok) {
    return {
      id: "sendingerFeil",
      tekst: `Kunne ikke sjekke tidligere sendinger: ${svar.feil}`,
      ...(svar.loggInn ? { loggInn: true } : {}),
    };
  }
  const uavklart = svar.sendinger.some((s) =>
    ["ukjent_utfall", "sendt_uten_merke", "startet"].includes(gjeldendeStatus(s.status, s.endret, naa)),
  );
  return uavklart ? { id: "uavklart", tekst: UAVKLART_SPERRE } : null;
}

/**
 * Hvilken knapp som fremheves etter «Sjekk i Tripletex». Speiler adminbordets
 * kanMerke(): merk bare når ordren sikkert har linjene (sendt_uten_merke, eller
 * en ny ordre fra sendingen med linjer). Ingen ordre funnet: frigi. En
 * eksisterende ordre må et menneske se på (merk krever bekreftelse): ingen
 * anbefaling. Serveren avgjør likevel.
 */
export function anbefaltAvklaring(
  status: string,
  sjekk: { funnet: boolean; nyOrdre: boolean; antallLinjer: number },
): "merk" | "frigi" | null {
  if (status === "sendt_uten_merke") return "merk";
  if (!sjekk.funnet) return "frigi";
  if (!sjekk.nyOrdre) return null;
  return sjekk.antallLinjer > 0 ? "merk" : "frigi";
}

/* ── Forhåndsvisningen ────────────────────────────────────── */

export type Melding = { id: string; tekst: string };

const liste = (xs: string[]) => xs.map((x) => `«${x}»`).join(", ");

const OVERTID_SOM_FAKTURERES = ["Overtid 50%", "Overtid 100%"];

const harTimer = (celle: string | undefined) => {
  const n = Number((celle ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0;
};

/**
 * Kolonner som hører til ordrelinjer, men er skjult i PDF-en: da står det på
 * fakturaen «iht. vedlegg» om timer vedlegget ikke viser. Maskintimer telles bare
 * der maskinen faktureres (ikke «Faktureres ikke»); maskinnavnet telles når timene
 * ved siden av faktureres. Timer-kolonnen telles når noe går som Grunnarbeider.
 */
export function skjulteFaktureringskolonner(
  rows: Row[],
  columns: ColMeta[],
  synlige: Set<string>,
  koblinger: Kobling[] = [],
  /** Noen timer i Timer-kolonnen legges på som Grunnarbeider (advarsler.somGrunnarbeider > 0). */
  timerFaktureres = false,
): string[] {
  const faktureresIkke = new Set(koblinger.filter((k) => !k.faktureres).map((k) => k.maskinId));
  const nokkel = (label: string) => columns.find((c) => c.label === label)?.key;
  const ut: string[] = [];
  for (const c of columns) {
    if (synlige.has(c.key)) continue;
    if (c.label === "Timer") {
      if (timerFaktureres) ut.push(c.label);
      continue;
    }
    if (OVERTID_SOM_FAKTURERES.includes(c.label)) {
      if (rows.some((r) => harTimer(r[c.key]))) ut.push(c.label);
      continue;
    }
    const m = c.label.match(/^(Maskintimer|Maskinnavn)(\d+)$/);
    if (!m) continue;
    const timerKey = m[1] === "Maskintimer" ? c.key : nokkel(`Maskintimer${m[2]}`);
    if (!timerKey) continue;
    const fakturerbar = rows.some(
      (r) => harTimer(r[timerKey]) && !faktureresIkke.has(Number(r[`__maskin${m[2]}`] ?? "")),
    );
    if (fakturerbar) ut.push(c.label);
  }
  return ut;
}

/**
 * «Ordre <nr>» er formen vårt eget merke vises med i Tripletex-kolonnen (byggTabell).
 * Bare den betyr sendt herfra; fremmede merker vises som de er og stopper ingenting.
 */
export const erSendtHerfra = (verdi: string) => /^Ordre \S+$/.test(verdi.trim());

/** Tripletex-verdiene («Ordre 1234») på rader som skal merkes, men alt er sendt herfra. */
export function alleredeSendte(rows: Row[], tripletexKey: string | undefined, timerIder: number[]): string[] {
  if (!tripletexKey) return [];
  const ider = new Set(timerIder);
  const ut = new Set<string>();
  for (const r of rows) {
    const id = Number((r["__id"] ?? "").trim());
    if (!ider.has(id)) continue;
    const v = (r[tripletexKey] ?? "").trim();
    if (erSendtHerfra(v)) ut.add(v);
  }
  return [...ut];
}

const timer = (n: number) => `${fmtAntall(n)} ${n === 1 ? "time" : "timer"}`;

/** Overskriften på boksen med det som må sjekkes på ordren før den faktureres. */
export const SJEKK_I_TRIPLETEX = "Sjekk i Tripletex før fakturering";

/**
 * Sperrer stopper «Legg på ordre»: bare rader som alt er sendt herfra, og en
 * sending uten linjer (beregningsfeil, uavklart sending og for stor PDF sperres
 * i dialogen). Ordren i Tripletex er godkjenningen, så tekstlinjer, 0 kr-linjer
 * og timer alt fakturert i SmartDok går på ordren og står i `sjekk`.
 * Advarsler er annen informasjon. Ingenting i sjekk eller advarsler stopper.
 */
export function vurderForhandsvisning(
  b: Ordreberegning,
  ekstra: { alleredeSendt: string[]; skjulteKolonner: string[] },
): { sperrer: Melding[]; sjekk: Melding[]; advarsler: Melding[] } {
  const sperrer: Melding[] = [];
  const sjekk: Melding[] = [];
  const advarsler: Melding[] = [];
  const a = b.advarsler;

  if (ekstra.alleredeSendt.length) {
    sperrer.push({
      id: "alleredeSendt",
      tekst:
        `Noen av radene er alt sendt til Tripletex (${ekstra.alleredeSendt.join(", ")}). ` +
        "Ta dem bort med filteret på Tripletex-kolonnen (fjern «Ordre …»-verdiene) før du sender.",
    });
  }
  if (b.linjer.length === 0) {
    sperrer.push({
      id: "ingenLinjer",
      tekst: "Ingen linjer å legge inn: ingen av timene fra SmartDok i tabellen har timer som kan legges på ordren.",
    });
  }

  if (a.utenKobling.length) {
    sjekk.push({
      id: "utenKobling",
      tekst:
        `Maskiner uten kobling legges på som tekstlinje uten produkt, med 0 kr: ${liste(a.utenKobling)}. ` +
        "Sett produkt eller pris på linjene i Tripletex. Koble maskinene i koblingslisten, så blir de produktlinjer neste gang.",
    });
  }
  if (a.manglerProdukt.length) {
    sjekk.push({
      id: "manglerProdukt",
      tekst:
        `Finnes ikke som produkt i Tripletex og legges på som tekstlinje med 0 kr: ${liste(a.manglerProdukt)}. ` +
        "Sett pris på linjene i Tripletex.",
    });
  }
  if (a.utenPris.length) {
    sjekk.push({
      id: "utenPris",
      tekst: `Produkter uten pris i Tripletex legges på med 0 kr: ${liste(a.utenPris)}. Sett pris på linjene i Tripletex.`,
    });
  }
  if (a.alleredeFakturert > 0) {
    sjekk.push({
      id: "alleredeFakturert",
      tekst:
        `${timer(a.alleredeFakturert)} (maskin eller overtid) er alt merket fakturert i SmartDok, men legges på ordren likevel. ` +
        "Ta dem bort fra ordren i Tripletex om kunden alt har fått dem fakturert.",
    });
  }

  if (a.somGrunnarbeider > 0) {
    advarsler.push({
      id: "somGrunnarbeider",
      tekst: `${timer(a.somGrunnarbeider)} uten fakturerbar maskin legges på som «Grunnarbeider».`,
    });
  }
  if (a.haandlagde > 0) {
    advarsler.push({
      id: "haandlagde",
      tekst:
        a.haandlagde === 1
          ? "1 rad er lagt til for hånd. Den står i PDF-en, men blir ikke en ordrelinje og merkes ikke i SmartDok."
          : `${a.haandlagde} rader er lagt til for hånd. De står i PDF-en, men blir ikke ordrelinjer og merkes ikke i SmartDok.`,
    });
  }
  if (a.ukjentOvertid.length) {
    advarsler.push({
      id: "ukjentOvertid",
      tekst: `Overtid som ikke blir ordrelinjer: ${liste(a.ukjentOvertid)}. Bare «Overtid 50%» og «Overtid 100%» faktureres herfra; legg resten inn for hånd i Tripletex om den skal faktureres.`,
    });
  }
  if (ekstra.skjulteKolonner.length) {
    advarsler.push({
      id: "skjulteKolonner",
      tekst: `${liste(ekstra.skjulteKolonner)} er skjult i PDF-en, men hører til timer som faktureres. Vis ${ekstra.skjulteKolonner.length === 1 ? "kolonnen" : "kolonnene"} så vedlegget viser det som faktureres.`,
    });
  }
  return { sperrer, sjekk, advarsler };
}

/* ── Kroppen til «Legg på ordre» ──────────────────────────── */

export type Ordrevalg = { ny: true } | { id: number };

export function byggLeggPaaOrdre(a: {
  prosjekt: string;
  ordre: Ordrevalg;
  beregning: Ordreberegning;
  pdf: string;
  filnavn: string;
  periode: { fra: string; til: string };
}): LeggPaaOrdreInn {
  return {
    prosjekt: a.prosjekt,
    ordre: "id" in a.ordre ? { id: a.ordre.id } : { ny: true },
    linjer: a.beregning.linjer.map((l) => ({ produktId: l.produktId, antall: l.antall, tekst: l.tekst })),
    timerIder: [...a.beregning.timerIder],
    pdf: a.pdf,
    filnavn: sendbartFilnavn(a.filnavn),
    periode: { fra: a.periode.fra, til: a.periode.til },
  };
}

/**
 * Navn på linjene i svaret fra adminbordet. Tekstlinjer (produktId null) har ikke
 * navn i svaret: de får navnet fra linjene som ble sendt, i samme rekkefølge, men
 * bare når antallet stemmer. Ellers gjettes det ikke.
 */
export function resultatnavn(
  svar: { produktId: number | null }[],
  sendte: { produktId: number | null; produktnavn: string }[],
  produktnavn: (id: number) => string,
): string[] {
  const tekst = sendte.filter((l) => l.produktId === null).map((l) => l.produktnavn);
  const stemmer = svar.filter((l) => l.produktId === null).length === tekst.length;
  let k = 0;
  return svar.map((l) =>
    l.produktId !== null ? produktnavn(l.produktId) : stemmer ? tekst[k++] : "Linje uten produkt",
  );
}

/** Zod-feil på kroppen, på norsk: egne meldinger (refine) brukes som de er. */
export function forklarInndatafeil(issues: { path: (string | number)[]; message: string; code: string }[]): string {
  const i = issues[0];
  if (!i) return "Kan ikke sende: ugyldige data.";
  if (i.code === "custom") return `Kan ikke sende: ${i.message}`;
  const felt = i.path[0];
  if (felt === "linjer" && i.path[2] === "tekst") return "Kan ikke sende: en linjetekst er for lang (maks 200 tegn).";
  if (felt === "linjer") return "Kan ikke sende: en av linjene har ugyldig antall eller produkt.";
  if (felt === "timerIder") return "Kan ikke sende: ingen eller for mange timer å merke (maks 3000).";
  if (felt === "periode") return "Kan ikke sende: perioden mangler. Hent timene fra SmartDok på nytt.";
  return `Kan ikke sende: ugyldig verdi i «${String(felt)}».`;
}

/* ── Koblingslisten ───────────────────────────────────────── */

export type KoblingRad = {
  maskin_id: number;
  maskinnavn: string;
  faktureres: boolean;
  produkt_id: number | null;
  produktnummer: string | null;
  produktnavn: string | null;
};
export type Maskin = { id: number; nummer: string; navn: string; kategori: string };

export const tilKobling = (k: KoblingRad): Kobling => ({
  maskinId: k.maskin_id,
  faktureres: k.faktureres,
  produktId: k.produkt_id,
});

export type Koblingsrad = {
  maskinId: number;
  navn: string;
  nummer: string;
  kategori: string;
  /** Finnes blant de aktive maskinene i SmartDok. */
  aktiv: boolean;
  lagret: {
    faktureres: boolean;
    produktId: number | null;
    produkt: Produkt | null;
    /** Produktet er koblet, men finnes ikke lenger blant de aktive i Tripletex. */
    produktBorte: boolean;
    produkttekst: string | null;
  } | null;
  /** Bare et forslag: lagres aldri uten at brukeren trykker «Godkjenn». */
  forslag: { faktureres: false } | { produkt: Produkt } | null;
  /** Maskinen kan ikke faktureres før noen velger: ingen kobling, eller produktet er borte. */
  mangler: boolean;
};

export function koblingsrader(maskiner: Maskin[], koblinger: KoblingRad[], produkter: Produkt[]): Koblingsrad[] {
  const lagret = new Map(koblinger.map((k) => [k.maskin_id, k]));
  const produkt = new Map(produkter.map((p) => [p.id, p]));

  const rad = (m: Maskin, aktiv: boolean): Koblingsrad => {
    const k = lagret.get(m.id);
    const p = k && k.produkt_id !== null ? produkt.get(k.produkt_id) ?? null : null;
    const produktBorte = !!k && k.faktureres && !p;
    const mangler = !k || produktBorte;
    let forslag: Koblingsrad["forslag"] = null;
    if (mangler) {
      const f = foreslåProdukt({ navn: m.navn, kategori: m.kategori }, produkter);
      if (f && "faktureres" in f) forslag = { faktureres: false };
      else if (f) {
        const fp = produkt.get(f.produktId);
        if (fp) forslag = { produkt: fp };
      }
    }
    const produkttekst = k
      ? p
        ? `${p.nummer} ${p.navn}`
        : [k.produktnummer, k.produktnavn].filter(Boolean).join(" ") || null
      : null;
    return {
      maskinId: m.id,
      navn: m.navn,
      nummer: m.nummer,
      kategori: m.kategori,
      aktiv,
      lagret: k ? { faktureres: k.faktureres, produktId: k.produkt_id, produkt: p, produktBorte, produkttekst } : null,
      forslag,
      mangler,
    };
  };

  const aktive = new Set(maskiner.map((m) => m.id));
  const rader = maskiner.map((m) => rad(m, true));
  // Lagrede koblinger for maskiner som ikke er aktive lenger: vises, men sist.
  const gamle = koblinger
    .filter((k) => !aktive.has(k.maskin_id))
    .map((k) => rad({ id: k.maskin_id, nummer: "", navn: k.maskinnavn, kategori: "" }, false));

  const sorter = (a: Koblingsrad, b: Koblingsrad) =>
    a.kategori.localeCompare(b.kategori, "nb") || a.navn.localeCompare(b.navn, "nb", { numeric: true });
  return [...rader.sort(sorter), ...gamle.sort(sorter)];
}

export function lagreInn(rad: Pick<Koblingsrad, "maskinId" | "navn">, valg: { faktureres: false } | { produkt: Produkt }): LagreKoblingInn {
  const maskinnavn = rad.navn.trim().slice(0, 200) || `Maskin ${rad.maskinId}`;
  if ("produkt" in valg) {
    return {
      maskinId: rad.maskinId,
      maskinnavn,
      faktureres: true,
      produktId: valg.produkt.id,
      produktnummer: valg.produkt.nummer.slice(0, 100),
      produktnavn: valg.produkt.navn.slice(0, 300),
    };
  }
  return { maskinId: rad.maskinId, maskinnavn, faktureres: false, produktId: null, produktnummer: null, produktnavn: null };
}

/** Kroppen som legger en tidligere lagret kobling tilbake («Angre»). */
export function angreInn(forrige: KoblingRad): LagreKoblingInn {
  return {
    maskinId: forrige.maskin_id,
    maskinnavn: forrige.maskinnavn.trim().slice(0, 200) || `Maskin ${forrige.maskin_id}`,
    faktureres: forrige.faktureres,
    produktId: forrige.produkt_id,
    produktnummer: forrige.produktnummer,
    produktnavn: forrige.produktnavn,
  };
}

/** Søk i koblingslisten: navn, internnummer, kategori og koblet produkt. */
export function treffer(rad: Koblingsrad, sok: string): boolean {
  const s = sok.trim().toLowerCase();
  if (!s) return true;
  return [rad.navn, rad.nummer, rad.kategori, rad.lagret?.produkttekst ?? ""].some((x) => x.toLowerCase().includes(s));
}
