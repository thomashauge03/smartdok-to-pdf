import * as XLSX from "xlsx";

export type ColKey =
  | "tid"
  | "navn"
  | "kommentar"
  | "dato"
  | "timer"
  | "aerTimer"
  | "maskin1"
  | "maskinTimer1"
  | "maskin2"
  | "maskinTimer2"
  | "maskin3"
  | "maskinTimer3";

export type Row = Record<ColKey, string>;

export type ColMeta = {
  key: ColKey;
  label: string;
  filter?: boolean;
  sort?: boolean;
  sum?: boolean;
  align?: "right";
  defaultWidth: number; // px in UI
  pdfWidth: number; // mm in PDF
};

export const COLUMNS: ColMeta[] = [
  { key: "tid", label: "Tid", defaultWidth: 70, pdfWidth: 22 },
  { key: "navn", label: "Navn", filter: true, defaultWidth: 140, pdfWidth: 32 },
  { key: "kommentar", label: "Kommentar", defaultWidth: 360, pdfWidth: 70 },
  { key: "dato", label: "Dato", sort: true, defaultWidth: 90, pdfWidth: 22 },
  { key: "timer", label: "Timer", sum: true, align: "right", defaultWidth: 70, pdfWidth: 14 },
  { key: "aerTimer", label: "AER timer", filter: true, defaultWidth: 120, pdfWidth: 22 },
  { key: "maskin1", label: "Maskinnavn1", filter: true, defaultWidth: 130, pdfWidth: 32 },
  { key: "maskinTimer1", label: "Timer", sum: true, align: "right", defaultWidth: 65, pdfWidth: 14 },
  { key: "maskin2", label: "Maskinnavn2", filter: true, defaultWidth: 130, pdfWidth: 32 },
  { key: "maskinTimer2", label: "Timer", sum: true, align: "right", defaultWidth: 65, pdfWidth: 14 },
  { key: "maskin3", label: "Maskinnavn3", filter: true, defaultWidth: 130, pdfWidth: 32 },
  { key: "maskinTimer3", label: "Timer", sum: true, align: "right", defaultWidth: 65, pdfWidth: 14 },
];

export type Parsed = {
  rows: Row[];
  prosjekt: string;
  vedlegg: string;
  /** Columns that contain at least one non-empty value (suggested default visibility). */
  populatedCols: ColKey[];
};

const MAANEDER = [
  "Januar", "Februar", "Mars", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Desember",
];

function excelSerialToDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms);
  }
  if (typeof v === "string") {
    const m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function fmtNum(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (isNaN(n)) return String(v);
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

function mapAer(lonnsart: string): string {
  if (!lonnsart) return "";
  const l = lonnsart.toLowerCase();
  if (l.includes("timel")) return "Regning (1)";
  return lonnsart;
}

function cleanKommentar(s: string): string {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/^\s*-\s*/, "")
    .replace(/\n\s*-\s*/g, "\n")
    .trim();
}

function shortProsjekt(p: string): string {
  const m = String(p).match(/^(\d+)\s+(.*?)(\d+)\s+(.+)$/);
  if (m) return `${m[1]} ${m[4].trim()} ${m[3]}`;
  return p;
}

export async function parseSmartdok(file: File): Promise<Parsed> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

  if (!data.length) throw new Error("Tom fil");

  const header = data[0].map((h) => String(h).trim().toLowerCase());
  const idx = (name: string) => header.findIndex((h) => h === name.toLowerCase());

  const cTid = idx("Tid");
  const cPro = idx("Pro.navn");
  const cNavn = idx("Navn");
  const cLonn = idx("Lønnsart");
  const cKom = idx("Kommentar");
  const cTimer = idx("Timer");
  const cDato = idx("Dato");
  const cMaskin = [idx("Maskinnavn1"), idx("Maskinnavn2"), idx("Maskinnavn3")];
  const cMaskinTimer = [idx("Maskin1 Timer"), idx("Maskin2 Timer"), idx("Maskin3 Timer")];

  if (cDato < 0 || cTimer < 0 || cNavn < 0) {
    throw new Error("Fant ikke forventede kolonner (Dato, Navn, Timer). Sjekk at filen er fra SmartDok.");
  }

  const rows: Row[] = [];
  let prosjektRaw = "";
  const months: { key: string; year: number; month: number }[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r || r.every((v) => v === "" || v === null || v === undefined)) continue;
    const firstCell = String(r[0] ?? "").trim().toLowerCase();
    if (firstCell === "sum") continue;

    const d = cDato >= 0 ? excelSerialToDate(r[cDato]) : null;
    const datoStr = d ? fmtDate(d) : String(r[cDato] ?? "");
    if (d) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!seen.has(key)) {
        seen.add(key);
        months.push({ key, year: d.getFullYear(), month: d.getMonth() });
      }
    }
    if (!prosjektRaw && cPro >= 0) prosjektRaw = String(r[cPro] ?? "");

    rows.push({
      tid: cTid >= 0 ? String(r[cTid] ?? "") : "",
      navn: String(r[cNavn] ?? ""),
      kommentar: cKom >= 0 ? cleanKommentar(String(r[cKom] ?? "")) : "",
      dato: datoStr,
      timer: fmtNum(r[cTimer]),
      aerTimer: cLonn >= 0 ? mapAer(String(r[cLonn] ?? "")) : "",
      maskin1: cMaskin[0] >= 0 ? String(r[cMaskin[0]] ?? "") : "",
      maskinTimer1: cMaskinTimer[0] >= 0 ? fmtNum(r[cMaskinTimer[0]]) : "",
      maskin2: cMaskin[1] >= 0 ? String(r[cMaskin[1]] ?? "") : "",
      maskinTimer2: cMaskinTimer[1] >= 0 ? fmtNum(r[cMaskinTimer[1]]) : "",
      maskin3: cMaskin[2] >= 0 ? String(r[cMaskin[2]] ?? "") : "",
      maskinTimer3: cMaskinTimer[2] >= 0 ? fmtNum(r[cMaskinTimer[2]]) : "",
    });
  }

  months.sort((a, b) => a.year - b.year || a.month - b.month);
  let vedlegg = "";
  if (months.length === 1) {
    vedlegg = `${MAANEDER[months[0].month]} ${months[0].year}`;
  } else if (months.length > 1) {
    const first = months[0];
    const last = months[months.length - 1];
    vedlegg = first.year === last.year
      ? `${MAANEDER[first.month]} - ${MAANEDER[last.month]} ${last.year}`
      : `${MAANEDER[first.month]} ${first.year} - ${MAANEDER[last.month]} ${last.year}`;
  }

  const populatedCols = COLUMNS
    .filter((c) => rows.some((r) => (r[c.key] ?? "").toString().trim() !== ""))
    .map((c) => c.key);

  return { rows, prosjekt: shortProsjekt(prosjektRaw), vedlegg, populatedCols };
}

export function fmtSumNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

export function sumCol(rows: Row[], key: ColKey): number {
  return rows.reduce((s, r) => s + (Number((r[key] || "").replace(",", ".")) || 0), 0);
}
