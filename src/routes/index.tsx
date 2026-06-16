import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Trash2,
  Plus,
  Filter,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Eye,
  EyeOff,
  UploadCloud,
  RotateCcw,
  Download,
  X,
  RectangleHorizontal,
  RectangleVertical,
} from "lucide-react";
import {
  parseSmartdok,
  fmtSumNum,
  sumCol,
  type Parsed,
  type Row,
  type ColKey,
  type ColMeta,
} from "@/lib/smartdok-parser";
import { generatePdf, pdfFilename, type PdfOrientation } from "@/lib/smartdok-pdf";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import logoAsset from "@/assets/hmLogo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SmartDok → PDF | HM" },
      { name: "description", content: "Konverter SmartDok timer-eksport til pyntet PDF med HM-logo." },
    ],
  }),
  component: Index,
});

/** HM monogram brand mark */
function HMLogo() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a1a1a] shadow-md">
      <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
        <text
          x="2" y="24"
          fontFamily="Inter, Arial, sans-serif"
          fontWeight="800"
          fontSize="22"
          fill="#dc2626"
          letterSpacing="-1"
        >HM</text>
      </svg>
    </div>
  );
}

function Index() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [prosjekt, setProsjekt] = useState("");
  const [vedlegg, setVedlegg] = useState("");
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [orientation, setOrientation] = useState<PdfOrientation>("landscape");

  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [dateSort, setDateSort] = useState<"none" | "asc" | "desc">("none");
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(new Set());
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>({});

  const resizing = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);

  const columns: ColMeta[] = parsed?.columns ?? [];
  const filterCols = columns.filter((c) => c.filter).map((c) => c.key);
  const activeFilterCount = filterCols.filter((k) => (filters[k]?.size ?? 0) > 0).length;

  const onResizeStart = (key: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = { key, startX: e.clientX, startW: colWidths[key] ?? 100 };
    const onMove = (ev: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      setColWidths((ws) => ({ ...ws, [r.key]: Math.max(40, r.startW + (ev.clientX - r.startX)) }));
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const parseDato = (s: string): number => {
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (!m) return 0;
    const [, d, mo, y] = m;
    const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
    return yr * 10000 + Number(mo) * 100 + Number(d);
  };

  const toggleDateSort = () =>
    setDateSort((d) => (d === "none" ? "asc" : d === "asc" ? "desc" : "none"));

  const visibleColList = useMemo(
    () => columns.filter((c) => visibleCols.has(c.key)),
    [columns, visibleCols],
  );

  const datoKey = useMemo(() => columns.find((c) => c.sort)?.key ?? null, [columns]);

  const uniqueValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!parsed) return map;
    for (const k of filterCols) {
      const set = new Set<string>();
      for (const r of parsed.rows) set.add(r[k] ?? "");
      map[k] = Array.from(set).sort();
    }
    return map;
  }, [parsed, filterCols]);

  const visibleRows = useMemo(() => {
    if (!parsed) return [] as Row[];
    const filtered = parsed.rows.filter((r) =>
      filterCols.every((k) => (filters[k]?.size ?? 0) === 0 || filters[k].has(r[k] ?? "")),
    );
    if (dateSort === "none" || !datoKey) return filtered;
    const sorted = [...filtered].sort(
      (a, b) => parseDato(a[datoKey] ?? "") - parseDato(b[datoKey] ?? ""),
    );
    return dateSort === "desc" ? sorted.reverse() : sorted;
  }, [parsed, filters, filterCols, dateSort, datoKey]);

  const timerSum = useMemo(() => {
    const col = columns.find((c) => c.key === "timer");
    return col ? sumCol(visibleRows, "timer") : null;
  }, [visibleRows, columns]);

  const toggleFilter = (col: ColKey, val: string) => {
    setFilters((f) => {
      const next = new Set(f[col] ?? []);
      next.has(val) ? next.delete(val) : next.add(val);
      return { ...f, [col]: next };
    });
  };
  const clearFilter = (col: ColKey) =>
    setFilters((f) => ({ ...f, [col]: new Set() }));

  const toggleColumn = (col: ColKey) =>
    setVisibleCols((s) => {
      const next = new Set(s);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });

  const updateCell = (i: number, key: ColKey, value: string) =>
    setParsed((p) => {
      if (!p) return p;
      return { ...p, rows: p.rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)) };
    });

  const deleteRow = (i: number) =>
    setParsed((p) => (p ? { ...p, rows: p.rows.filter((_, idx) => idx !== i) } : p));

  const addRow = () =>
    setParsed((p) => {
      if (!p) return p;
      const empty = Object.fromEntries(p.columns.map((c) => [c.key, ""])) as Row;
      return { ...p, rows: [...p.rows, empty] };
    });

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const p = await parseSmartdok(file);
      setParsed(p);
      setProsjekt(p.prosjekt);
      setVedlegg(p.vedlegg);
      setFilename(file.name.replace(/\.[^.]+$/, ""));
      setDateSort("none");
      setVisibleCols(new Set(p.populatedCols));
      setFilters(Object.fromEntries(p.columns.filter((c) => c.filter).map((c) => [c.key, new Set<string>()])));
      setColWidths(Object.fromEntries(p.columns.map((c) => [c.key, c.defaultWidth])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setParsed(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const onDownload = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const doc = await generatePdf(visibleRows, visibleColList, prosjekt, vedlegg, orientation);
      doc.save(pdfFilename(prosjekt, vedlegg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    if (!tbodyRef.current) return;
    tbodyRef.current.querySelectorAll("textarea").forEach((ta) => {
      const el = ta as HTMLTextAreaElement;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    });
  });

  const resetWidths = () =>
    setColWidths(Object.fromEntries(columns.map((c) => [c.key, c.defaultWidth])));

  const tableWidth =
    visibleColList.reduce((a, c) => a + (colWidths[c.key] ?? c.defaultWidth), 0) + 40;

  return (
    <div className="min-h-screen" style={{ background: "#f0f0f0" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b-4 border-red-600" style={{ background: "#1a1a1a" }}>
        <div className="mx-auto flex max-w-full items-center gap-4 px-6 py-3">
          <img src={logoAsset.url} alt="Hauge Maskin" className="h-10 w-auto brightness-0 invert" />
          <div className="h-6 w-px bg-neutral-700" />
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-tight text-white">Timeliste → PDF</p>
            <p className="text-[11px] text-neutral-400">SmartDok-eksport</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-full space-y-5 px-6 py-8">

        {/* ── Drop zone ── */}
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`group relative flex cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border-2 border-dashed px-8 py-12 text-center transition-all duration-200 ${
            drag
              ? "border-red-500 bg-red-50"
              : "border-neutral-300 bg-white hover:border-red-400 hover:bg-red-50/30"
          }`}
        >
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <div className={`flex h-14 w-14 items-center justify-center rounded-xl border-2 transition-all duration-200 ${
            drag ? "border-red-300 bg-red-100" : "border-neutral-200 bg-neutral-50 group-hover:border-red-200 group-hover:bg-red-50"
          }`}>
            {busy
              ? <div className="h-6 w-6 animate-spin rounded-full border-2 border-red-200 border-t-red-600" />
              : <UploadCloud className={`h-6 w-6 transition-colors ${drag ? "text-red-500" : "text-neutral-400 group-hover:text-red-400"}`} />
            }
          </div>
          <div>
            {filename ? (
              <>
                <p className="text-sm font-semibold text-neutral-800"><span className="text-red-600">{filename}</span></p>
                <p className="mt-0.5 text-xs text-neutral-500">Klikk for å bytte fil</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-neutral-700">
                  Slipp Excel-fil her, eller <span className="text-red-600 underline underline-offset-2">klikk for å velge</span>
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">.xls, .xlsx eller .csv fra SmartDok</p>
              </>
            )}
          </div>
        </label>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* ── Main panel ── */}
        {parsed && (
          <div className="overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-md">

            {/* Meta inputs */}
            <div className="border-b-2 border-red-600 bg-white px-6 py-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {[
                  { label: "Prosjekt", value: prosjekt, set: setProsjekt },
                  { label: "Vedlegg",  value: vedlegg,  set: setVedlegg  },
                ].map(({ label, value, set }) => (
                  <div key={label}>
                    <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                      {label}
                    </label>
                    <input
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="w-full rounded-lg border-2 border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium text-neutral-900 outline-none transition focus:border-red-500 focus:ring-3 focus:ring-red-500/10"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-6 py-3" style={{ background: "#1a1a1a" }}>
              {/* Stats */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-semibold text-white">
                  {visibleRows.length}
                  {visibleRows.length !== parsed.rows.length && (
                    <span className="font-normal text-neutral-400"> / {parsed.rows.length}</span>
                  )}{" "}
                  <span className="font-normal text-neutral-400">rader</span>
                </span>
                {timerSum !== null && (
                  <>
                    <span className="text-neutral-600">|</span>
                    <span className="text-neutral-400">
                      Timer: <span className="font-bold text-white">{fmtSumNum(timerSum)}</span>
                    </span>
                  </>
                )}
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    <Filter className="h-3 w-3" />
                    {activeFilterCount} filter{activeFilterCount > 1 ? "e" : ""}
                  </span>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">

                {/* Column picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-700">
                      <Eye className="h-3.5 w-3.5" />
                      Kolonner
                      <span className="rounded bg-neutral-700 px-1.5 py-0.5 font-semibold tabular-nums text-neutral-300">
                        {visibleCols.size}/{columns.length}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-2">
                    <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                      Vis i tabell og PDF
                    </p>
                    <div className="max-h-72 space-y-0.5 overflow-y-auto">
                      {columns.map((c) => (
                        <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-neutral-50">
                          <Checkbox checked={visibleCols.has(c.key)} onCheckedChange={() => toggleColumn(c.key)} />
                          <span className="text-neutral-700">{c.label}</span>
                          <code className="ml-auto text-[10px] text-neutral-400">{c.key}</code>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Orientation */}
                <div className="flex overflow-hidden rounded-lg border border-neutral-600">
                  {(["landscape", "portrait"] as PdfOrientation[]).map((o) => (
                    <button
                      key={o}
                      onClick={() => setOrientation(o)}
                      title={o === "landscape" ? "Liggende A4" : "Stående A4"}
                      className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-xs font-medium transition ${
                        orientation === o
                          ? "bg-red-600 text-white"
                          : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
                      } ${o === "portrait" ? "border-l border-neutral-600" : ""}`}
                    >
                      {o === "landscape"
                        ? <RectangleHorizontal className="h-3.5 w-3.5" />
                        : <RectangleVertical className="h-3.5 w-3.5" />
                      }
                      {o === "landscape" ? "Liggende" : "Stående"}
                    </button>
                  ))}
                </div>

                {/* Reset widths */}
                <button
                  onClick={resetWidths}
                  title="Nullstill kolonnebredder"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-600 bg-neutral-800 text-neutral-400 transition hover:border-neutral-500 hover:bg-neutral-700 hover:text-neutral-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>

                {/* Download */}
                <button
                  onClick={onDownload}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? (
                    <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />Genererer…</>
                  ) : (
                    <><Download className="h-3.5 w-3.5" />Last ned PDF</>
                  )}
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ tableLayout: "fixed", minWidth: tableWidth, borderCollapse: "collapse" }}>
                <colgroup>
                  {visibleColList.map((c) => (
                    <col key={c.key} style={{ width: colWidths[c.key] ?? c.defaultWidth }} />
                  ))}
                  <col style={{ width: 40 }} />
                </colgroup>

                {/* Dark header */}
                <thead style={{ background: "#1a1a1a" }}>
                  <tr>
                    {visibleColList.map((c) => (
                      <th
                        key={c.key}
                        className="group/th relative border-r border-neutral-700 px-2.5 py-2.5 text-left text-xs font-semibold text-neutral-200 last:border-r-0"
                        style={{ borderBottom: "2px solid #dc2626" }}
                      >
                        <div className="flex items-center gap-1">
                          <span className="truncate">{c.label}</span>

                          {c.filter && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  className={`ml-0.5 rounded p-0.5 transition ${
                                    (filters[c.key]?.size ?? 0) > 0
                                      ? "bg-red-600 text-white"
                                      : "text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300"
                                  }`}
                                  aria-label={`Filter ${c.label}`}
                                >
                                  <Filter className="h-3 w-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-60 p-2">
                                <div className="mb-2 flex items-center justify-between px-1">
                                  <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                                    Filter: {c.label}
                                  </span>
                                  {(filters[c.key]?.size ?? 0) > 0 && (
                                    <button onClick={() => clearFilter(c.key)} className="text-xs text-red-600 hover:underline">Nullstill</button>
                                  )}
                                </div>
                                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                                  {(uniqueValues[c.key] ?? []).map((v) => (
                                    <label key={v} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-neutral-50">
                                      <Checkbox checked={filters[c.key]?.has(v) ?? false} onCheckedChange={() => toggleFilter(c.key, v)} />
                                      <span className="truncate text-neutral-700">{v || <em className="text-neutral-400">(tom)</em>}</span>
                                    </label>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}

                          {c.sort && (
                            <button
                              onClick={toggleDateSort}
                              className={`rounded p-0.5 transition ${
                                dateSort !== "none"
                                  ? "bg-red-600 text-white"
                                  : "text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300"
                              }`}
                              aria-label="Sorter dato"
                            >
                              {dateSort === "asc" ? <ArrowUp className="h-3 w-3" /> : dateSort === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3" />}
                            </button>
                          )}

                          <button
                            onClick={() => toggleColumn(c.key)}
                            className="ml-auto rounded p-0.5 text-neutral-600 opacity-0 transition hover:bg-neutral-700 hover:text-neutral-300 group-hover/th:opacity-100"
                            aria-label={`Skjul ${c.label}`}
                          >
                            <EyeOff className="h-3 w-3" />
                          </button>
                        </div>
                        <div
                          onMouseDown={(e) => onResizeStart(c.key, e)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-red-600/50"
                          aria-hidden
                        />
                      </th>
                    ))}
                    <th className="border-neutral-700" style={{ background: "#1a1a1a", borderBottom: "2px solid #dc2626" }} />
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleColList.length + 1} className="px-6 py-14 text-center">
                        <p className="text-sm font-medium text-neutral-400">Ingen rader matcher filtrene</p>
                        <p className="mt-1 text-xs text-neutral-300">Fjern et filter for å se flere rader</p>
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((r, rowIdx) => {
                      const i = parsed.rows.indexOf(r);
                      const isEven = rowIdx % 2 === 0;
                      return (
                        <tr
                          key={i}
                          className="group/row"
                          style={{
                            background: isEven ? "#ffffff" : "#f9f9f9",
                            borderBottom: "1px solid #d4d4d4",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#fff1f1")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = isEven ? "#ffffff" : "#f9f9f9")}
                        >
                          {visibleColList.map((c) => (
                            <td
                              key={c.key}
                              className="p-0 align-top"
                              style={{ borderRight: "1px solid #d4d4d4" }}
                            >
                              <textarea
                                value={r[c.key] ?? ""}
                                onChange={(e) => updateCell(i, c.key, e.target.value)}
                                rows={1}
                                className={`block w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-2.5 py-2 text-xs leading-relaxed text-neutral-800 outline-none transition-colors focus:bg-red-50 focus:ring-1 focus:ring-inset focus:ring-red-400 ${
                                  c.align === "right" ? "text-right" : ""
                                }`}
                              />
                            </td>
                          ))}
                          <td className="px-1.5 py-1.5 text-right align-top">
                            <button
                              onClick={() => deleteRow(i)}
                              className="rounded-lg p-1.5 text-neutral-300 opacity-0 transition group-hover/row:opacity-100 hover:bg-red-100 hover:text-red-600"
                              aria-label="Slett rad"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}

                  {/* Sum row */}
                  {visibleRows.length > 0 && visibleColList.some((c) => c.sum) && (
                    <tr style={{ background: "#1a1a1a", borderTop: "2px solid #dc2626" }}>
                      {visibleColList.map((c, idx) => {
                        const firstSumIdx = visibleColList.findIndex((x) => x.sum);
                        if (c.sum)
                          return (
                            <td key={c.key} className="px-2.5 py-2.5 text-right text-xs font-bold tabular-nums text-white" style={{ borderRight: "1px solid #333" }}>
                              {fmtSumNum(sumCol(visibleRows, c.key))}
                            </td>
                          );
                        if (idx === firstSumIdx - 1)
                          return (
                            <td key={c.key} className="px-2.5 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-red-500" style={{ borderRight: "1px solid #333" }}>
                              Sum
                            </td>
                          );
                        return <td key={c.key} style={{ borderRight: "1px solid #333" }} />;
                      })}
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="border-t border-neutral-200 bg-neutral-50 px-6 py-3">
              <button
                onClick={addRow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:border-red-400 hover:bg-red-50 hover:text-red-600"
              >
                <Plus className="h-3.5 w-3.5" />
                Legg til rad
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
