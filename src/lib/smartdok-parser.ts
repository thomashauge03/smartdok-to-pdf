import * as XLSX from "xlsx";

export type ColKey = string;

export type ColMeta = {
  key: ColKey;
  label: string;
  filter?: boolean;
  sort?: boolean;
  sum?: boolean;
  align?: "right";
  defaultWidth: number;
  pdfWidth: number;
};

export type Row = Record<string, string>;

export type Parsed = {
  rows: Row[];
  columns: ColMeta[];
  prosjekt: string;
  vedlegg: string;
  populatedCols: ColKey[];
};

// Known header → ColMeta config (key = normalized lowercase header)
const HEADER_CONFIG: Record<string, Omit<ColMeta, "key">> = {
  "dato":                   { label: "Dato",                  sort: true,                    defaultWidth: 90,  pdfWidth: 22 },
  "tid":                    { label: "Tid",                                                  defaultWidth: 70,  pdfWidth: 18 },
  "navn":                   { label: "Navn",                  filter: true,                  defaultWidth: 140, pdfWidth: 32 },
  "aktivitet":              { label: "Aktivitet",             filter: true,                  defaultWidth: 130, pdfWidth: 28 },
  "lønnsart":               { label: "Lønnsart",              filter: true,                  defaultWidth: 120, pdfWidth: 26 },
  "kommentar":              { label: "Kommentar",                                            defaultWidth: 300, pdfWidth: 64 },
  "pris mot kunde":         { label: "Pris mot kunde",        align: "right",                defaultWidth: 95,  pdfWidth: 20 },
  "timer":                  { label: "Timer",                 sum: true,  align: "right",    defaultWidth: 68,  pdfWidth: 14 },
  "sum":                    { label: "Sum",                   sum: true,  align: "right",    defaultWidth: 68,  pdfWidth: 16 },
  "fakturert":              { label: "Fakturert",                                            defaultWidth: 68,  pdfWidth: 16 },
  "overtid 50%":            { label: "Overtid 50%",           sum: true,  align: "right",    defaultWidth: 80,  pdfWidth: 18 },
  "overtid 100%":           { label: "Overtid 100%",          sum: true,  align: "right",    defaultWidth: 80,  pdfWidth: 18 },
  "overtid 70%":            { label: "Overtid 70%",           sum: true,  align: "right",    defaultWidth: 80,  pdfWidth: 18 },
  "tillegg tunnelarbeid":   { label: "Tillegg tunnelarbeid",  sum: true,  align: "right",    defaultWidth: 120, pdfWidth: 26 },
  "natttillegg":            { label: "Natttillegg",           sum: true,  align: "right",    defaultWidth: 80,  pdfWidth: 20 },
};

function headerToKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_æøå%]/g, "");
}

function buildColMeta(rawHeader: string): ColMeta {
  const norm = rawHeader.trim().toLowerCase();
  const key = headerToKey(rawHeader);

  // Exact known mapping
  if (HEADER_CONFIG[norm]) {
    return { key, ...HEADER_CONFIG[norm] };
  }

  // Machine name columns: "Maskinnavn1", "Maskinnavn2", …
  const maskinNavnM = norm.match(/^maskinnavn(\d+)$/);
  if (maskinNavnM) {
    return { key, label: `Maskinnavn${maskinNavnM[1]}`, filter: true, defaultWidth: 130, pdfWidth: 30 };
  }

  // Machine timer columns: "Maskin1 Timer", "Maskin2 Timer", …
  const maskinTimerM = norm.match(/^maskin(\d+)\s+timer$/);
  if (maskinTimerM) {
    return { key, label: `Maskintimer${maskinTimerM[1]}`, sum: true, align: "right", defaultWidth: 90, pdfWidth: 18 };
  }

  // Fallback: use the raw header as label
  return { key, label: rawHeader.trim(), defaultWidth: 100, pdfWidth: 22 };
}

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

  const rawHeaders = data[0].map((h) => String(h).trim());

  if (rawHeaders.length === 0) throw new Error("Ingen kolonner funnet");

  // Build column metadata for all headers except Pro.navn (used for prosjekt extraction)
  const proNavnIdx = rawHeaders.findIndex((h) => h.toLowerCase() === "pro.navn");
  const datoIdx = rawHeaders.findIndex((h) => h.trim().toLowerCase() === "dato");
  const komIdx = rawHeaders.findIndex((h) => h.toLowerCase() === "kommentar");

  if (datoIdx < 0) {
    throw new Error("Fant ikke 'Dato'-kolonne. Sjekk at filen er fra SmartDok.");
  }

  // Columns to expose (skip Pro.navn — only used for prosjekt)
  const columns: ColMeta[] = rawHeaders
    .filter((_, i) => i !== proNavnIdx)
    .map((h) => buildColMeta(h));

  // Deduplicate keys (e.g. two columns both called "Timer")
  const keyCounts = new Map<string, number>();
  for (const col of columns) {
    const baseKey = col.key;
    const count = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, count + 1);
    if (count > 0) col.key = `${baseKey}_${count + 1}`;
  }

  const rows: Row[] = [];
  let prosjektRaw = "";
  const months: { key: string; year: number; month: number }[] = [];
  const seenMonths = new Set<string>();

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r || r.every((v) => v === "" || v === null || v === undefined)) continue;
    const firstCell = String(r[0] ?? "").trim().toLowerCase();
    if (firstCell === "sum") continue;

    // Extract prosjekt from Pro.navn column
    if (proNavnIdx >= 0 && !prosjektRaw) {
      prosjektRaw = String(r[proNavnIdx] ?? "");
    }

    // Build row
    const row: Row = {};
    let colPointer = 0;
    for (let ci = 0; ci < rawHeaders.length; ci++) {
      if (ci === proNavnIdx) continue;
      const col = columns[colPointer];
      if (!col) { colPointer++; continue; }

      const rawVal = r[ci];
      const norm = rawHeaders[ci].trim().toLowerCase();

      if (norm === "dato") {
        const d = excelSerialToDate(rawVal);
        if (d) {
          const key = `${d.getFullYear()}-${d.getMonth()}`;
          if (!seenMonths.has(key)) {
            seenMonths.add(key);
            months.push({ key, year: d.getFullYear(), month: d.getMonth() });
          }
          row[col.key] = fmtDate(d);
        } else {
          row[col.key] = String(rawVal ?? "");
        }
      } else if (ci === komIdx) {
        row[col.key] = cleanKommentar(String(rawVal ?? ""));
      } else if (col.sum) {
        row[col.key] = fmtNum(rawVal);
      } else {
        row[col.key] = String(rawVal ?? "");
      }

      colPointer++;
    }

    rows.push(row);
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

  const populatedCols = columns
    .filter((c) => rows.some((r) => {
      const v = (r[c.key] ?? "").toString().trim();
      return v !== "" && v !== "0" && v.toLowerCase() !== "x";
    }))
    .map((c) => c.key);

  return { rows, columns, prosjekt: shortProsjekt(prosjektRaw), vedlegg, populatedCols };
}

export function fmtSumNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

export function sumCol(rows: Row[], key: ColKey): number {
  return rows.reduce((s, r) => s + (Number((r[key] || "").replace(",", ".")) || 0), 0);
}
