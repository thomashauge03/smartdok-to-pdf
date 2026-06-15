import * as XLSX from "xlsx";

export type Row = {
  tid: string;
  navn: string;
  kommentar: string;
  dato: string;
  timer: string;
  aerTimer: string;
  maskin: string;
  maskinTimer: string;
};

export type Parsed = {
  rows: Row[];
  prosjekt: string;
  vedlegg: string;
  sumTimer: number;
  sumMaskinTimer: number;
};

const MAANEDER = [
  "Januar", "Februar", "Mars", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Desember",
];

function excelSerialToDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel epoch: 1899-12-30
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
  // Norwegian decimal comma; strip trailing .0
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
  // "2026117 TT Anlegg 2012605 Herdalen" -> "2026117 Herdalen 2012605"
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
  const cMaskinNavn = idx("Maskinnavn1");
  const cMaskinTimer = idx("Maskin1 Timer");

  if (cDato < 0 || cTimer < 0 || cNavn < 0) {
    throw new Error("Fant ikke forventede kolonner (Dato, Navn, Timer). Sjekk at filen er fra SmartDok.");
  }

  const rows: Row[] = [];
  let prosjektRaw = "";
  const months: { key: string; year: number; month: number }[] = [];
  const seen = new Set<string>();
  let sumTimer = 0;
  let sumMaskinTimer = 0;

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r || r.every((v) => v === "" || v === null || v === undefined)) continue;

    const firstCell = String(r[0] ?? "").trim().toLowerCase();
    if (firstCell === "sum") continue;

    const d = cDato >= 0 ? excelSerialToDate(r[cDato]) : null;
    const datoStr = d ? fmtDate(d) : String(r[cDato] ?? "");
    if (d) {
      const key = `${MAANEDER[d.getMonth()]} ${d.getFullYear()}`;
      months.set(key, (months.get(key) ?? 0) + 1);
    }

    if (!prosjektRaw && cPro >= 0) prosjektRaw = String(r[cPro] ?? "");

    const timerNum = Number(String(r[cTimer] ?? "0").replace(",", "."));
    if (!isNaN(timerNum)) sumTimer += timerNum;
    const mtNum = cMaskinTimer >= 0 ? Number(String(r[cMaskinTimer] ?? "0").replace(",", ".")) : 0;
    if (!isNaN(mtNum)) sumMaskinTimer += mtNum;

    rows.push({
      tid: cTid >= 0 ? String(r[cTid] ?? "") : "",
      navn: String(r[cNavn] ?? ""),
      kommentar: cKom >= 0 ? cleanKommentar(String(r[cKom] ?? "")) : "",
      dato: datoStr,
      timer: fmtNum(r[cTimer]),
      aerTimer: cLonn >= 0 ? mapAer(String(r[cLonn] ?? "")) : "",
      maskin: cMaskinNavn >= 0 ? String(r[cMaskinNavn] ?? "") : "",
      maskinTimer: cMaskinTimer >= 0 ? fmtNum(r[cMaskinTimer]) : "",
    });
  }

  // most common month
  let vedlegg = "";
  let best = 0;
  for (const [k, c] of months) if (c > best) { best = c; vedlegg = k; }

  return {
    rows,
    prosjekt: shortProsjekt(prosjektRaw),
    vedlegg,
    sumTimer,
    sumMaskinTimer,
  };
}

export function fmtSumNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}
