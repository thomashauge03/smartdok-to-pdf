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

/** Timesheet icon — rows of lines representing a timelist */
function TimesheetIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="2" width="18" height="20" rx="2" />
      <line x1="7" y1="7" x2="17" y2="7" />
      <line x1="7" y1="11" x2="17" y2="11" />
      <line x1="7" y1="15" x2="13" y2="15" />
      <circle cx="17.5" cy="17.5" r="3" fill="currentColor" stroke="none" opacity="0" />
      <line x1="15" y1="18" x2="17" y2="18" />
      <line x1="17" y1="16" x2="17" y2="18" />
    </svg>
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
    <div className="min-h-screen" style={{ background: "#f6f7f9" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-full items-center justify-between px-6 py-3">

          {/* Brand */}
          <div className="flex items-center gap-3">
            {/* Icon: timesheet document with clock hand */}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 shadow-sm shadow-red-200">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden
              >
                {/* Document body */}
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                {/* Lines representing rows */}
                <line x1="8" y1="12" x2="13" y2="12" />
                <line x1="8" y1="15.5" x2="11" y2="15.5" />
                {/* Clock circle */}
                <circle cx="17" cy="17" r="3.5" strokeWidth="1.6" />
                <polyline points="17 15.5 17 17 18 18" strokeWidth="1.5" />
              </svg>
            </div>

            <div className="leading-tight">
              <p className="text-[13px] font-bold tracking-tight text-neutral-900">Timeliste → PDF</p>
              <p className="text-[11px] text-neutral-400">SmartDok-eksport</p>
            </div>
          </div>

          {/* Logo */}
          <img src={logoAsset.url} alt="HM" className="h-9 w-auto opacity-90" />
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
          className={`group relative flex cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-all duration-200 ${
            drag
              ? "border-red-400 bg-red-50 shadow-inner"
              : "border-neutral-200 bg-white hover:border-red-300 hover:bg-red-50/20 hover:shadow-sm"
          }`}
        >
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          {/* Background decoration */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,38,38,0.03)_0%,transparent_70%)]" />

          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border-2 transition-all duration-200 ${
            drag
              ? "border-red-200 bg-red-100"
              : "border-neutral-200 bg-neutral-50 group-hover:border-red-200 group-hover:bg-red-50"
          }`}>
            {busy ? (
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-red-200 border-t-red-600" />
            ) : (
              <UploadCloud className={`h-7 w-7 transition-colors duration-200 ${
                drag ? "text-red-500" : "text-neutral-400 group-hover:text-red-400"
              }`} />
            )}
          </div>

          <div>
            {filename ? (
              <>
                <p className="text-sm font-semibold text-neutral-800">
                  <span className="text-red-600">{filename}</span>
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">Klikk for å bytte fil</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-neutral-700">
                  Slipp Excel-fil her, eller{" "}
                  <span className="text-red-600 underline underline-offset-2">klikk for å velge</span>
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">.xls, .xlsx eller .csv fra SmartDok</p>
              </>
            )}
          </div>
        </label>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Main panel ── */}
        {parsed && (
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">

            {/* Meta inputs */}
            <div className="border-b border-neutral-100 px-6 py-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {[
                  { label: "Prosjekt", value: prosjekt, set: setProsjekt },
                  { label: "Vedlegg", value: vedlegg, set: setVedlegg },
                ].map(({ label, value, set }) => (
                  <div key={label}>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                      {label}
                    </label>
                    <input
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="w-full rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2.5 text-sm font-medium text-neutral-900 outline-none transition-all placeholder:text-neutral-400 focus:border-red-400 focus:bg-white focus:ring-3 focus:ring-red-500/10"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50/50 px-6 py-3">
              {/* Stats */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                <span className="font-medium text-neutral-700">
                  {visibleRows.length}
                  {visibleRows.length !== parsed.rows.length && (
                    <span className="font-normal text-neutral-400"> / {parsed.rows.length}</span>
                  )}{" "}
                  <span className="font-normal">rader</span>
                </span>

                {timerSum !== null && (
                  <>
                    <span className="text-neutral-300">|</span>
                    <span>
                      Timer:{" "}
                      <span className="font-semibold text-neutral-800">{fmtSumNum(timerSum)}</span>
                    </span>
                  </>
                )}

                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">
                    <Filter className="h-3 w-3" />
                    {activeFilterCount} aktiv{activeFilterCount > 1 ? "e filtre" : "t filter"}
                  </span>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                {/* Column picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 shadow-xs transition hover:border-neutral-300 hover:bg-neutral-50">
                      <Eye className="h-3.5 w-3.5" />
                      Kolonner
                      <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-semibold tabular-nums text-neutral-500">
                        {visibleCols.size}/{columns.length}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-2">
                    <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                      Vis i tabell og PDF
                    </p>
                    <div className="max-h-72 space-y-0.5 overflow-y-auto">
                      {columns.map((c) => (
                        <label
                          key={c.key}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-neutral-50"
                        >
                          <Checkbox checked={visibleCols.has(c.key)} onCheckedChange={() => toggleColumn(c.key)} />
                          <span className="text-neutral-700">{c.label}</span>
                          <code className="ml-auto text-[10px] text-neutral-400">{c.key}</code>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Orientation toggle */}
                <div className="flex overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xs">
                  <button
                    onClick={() => setOrientation("landscape")}
                    title="Liggende (A4)"
                    className={`inline-flex h-7 items-center gap-1 px-2.5 text-xs font-medium transition ${
                      orientation === "landscape"
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
                    }`}
                  >
                    <RectangleHorizontal className="h-3.5 w-3.5" />
                    Liggende
                  </button>
                  <button
                    onClick={() => setOrientation("portrait")}
                    title="Stående (A4)"
                    className={`inline-flex h-7 items-center gap-1 border-l border-neutral-200 px-2.5 text-xs font-medium transition ${
                      orientation === "portrait"
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
                    }`}
                  >
                    <RectangleVertical className="h-3.5 w-3.5" />
                    Stående
                  </button>
                </div>

                {/* Reset widths */}
                <button
                  onClick={resetWidths}
                  title="Nullstill kolonnebredder"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 shadow-xs transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>

                {/* Download */}
                <button
                  onClick={onDownload}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Genererer…
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      Last ned PDF
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table
                className="w-full text-xs"
                style={{ tableLayout: "fixed", minWidth: tableWidth }}
              >
                <colgroup>
                  {visibleColList.map((c) => (
                    <col key={c.key} style={{ width: colWidths[c.key] ?? c.defaultWidth }} />
                  ))}
                  <col style={{ width: 40 }} />
                </colgroup>

                <thead className="bg-neutral-50 text-left">
                  <tr>
                    {visibleColList.map((c) => (
                      <th
                        key={c.key}
                        className="group/th relative border-b border-r border-neutral-200 px-2.5 py-2.5 font-semibold text-xs text-neutral-600 last:border-r-0"
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
                                      : "text-neutral-300 hover:bg-neutral-200 hover:text-neutral-600"
                                  }`}
                                  aria-label={`Filter ${c.label}`}
                                >
                                  <Filter className="h-3 w-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-60 p-2">
                                <div className="mb-2 flex items-center justify-between px-1">
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                    Filter: {c.label}
                                  </span>
                                  {(filters[c.key]?.size ?? 0) > 0 && (
                                    <button onClick={() => clearFilter(c.key)} className="text-xs text-red-600 hover:underline">
                                      Nullstill
                                    </button>
                                  )}
                                </div>
                                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                                  {(uniqueValues[c.key] ?? []).map((v) => (
                                    <label
                                      key={v}
                                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-neutral-50"
                                    >
                                      <Checkbox
                                        checked={filters[c.key]?.has(v) ?? false}
                                        onCheckedChange={() => toggleFilter(c.key, v)}
                                      />
                                      <span className="truncate text-neutral-700">
                                        {v || <em className="text-neutral-400">(tom)</em>}
                                      </span>
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
                                  : "text-neutral-300 hover:bg-neutral-200 hover:text-neutral-600"
                              }`}
                              aria-label="Sorter dato"
                            >
                              {dateSort === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : dateSort === "desc" ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ArrowUpDown className="h-3 w-3" />
                              )}
                            </button>
                          )}

                          <button
                            onClick={() => toggleColumn(c.key)}
                            className="ml-auto rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-600 [th:hover_&]:opacity-100 group-hover/th:opacity-100"
                            aria-label={`Skjul ${c.label}`}
                            title="Skjul kolonne"
                          >
                            <EyeOff className="h-3 w-3" />
                          </button>
                        </div>
                        <div
                          onMouseDown={(e) => onResizeStart(c.key, e)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-red-400/30"
                          aria-hidden
                        />
                      </th>
                    ))}
                    <th className="border-b border-neutral-200 bg-neutral-50" />
                  </tr>
                </thead>

                <tbody ref={tbodyRef} className="divide-y divide-neutral-200">
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleColList.length + 1}
                        className="px-6 py-14 text-center"
                      >
                        <p className="text-sm font-medium text-neutral-400">Ingen rader matcher filtrene</p>
                        <p className="mt-1 text-xs text-neutral-300">Fjern et filter for å se flere rader</p>
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((r) => {
                      const i = parsed.rows.indexOf(r);
                      return (
                        <tr key={i} className="group/row transition-colors hover:bg-neutral-50/80">
                          {visibleColList.map((c) => (
                            <td key={c.key} className="border-r border-neutral-200 p-0 align-top last:border-r-0">
                              <textarea
                                value={r[c.key] ?? ""}
                                onChange={(e) => updateCell(i, c.key, e.target.value)}
                                rows={1}
                                className={`block w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-2.5 py-2 text-xs leading-relaxed text-neutral-800 transition-colors focus:bg-red-50/60 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-red-300 ${
                                  c.align === "right" ? "text-right" : ""
                                }`}
                              />
                            </td>
                          ))}
                          <td className="px-1.5 py-1.5 text-right align-top">
                            <button
                              onClick={() => deleteRow(i)}
                              className="rounded-lg p-1.5 text-neutral-300 opacity-0 transition group-hover/row:opacity-100 hover:bg-red-50 hover:text-red-500"
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
                    <tr className="bg-neutral-50" style={{ borderTop: "2px solid #e5e7eb" }}>
                      {visibleColList.map((c, idx) => {
                        const firstSumIdx = visibleColList.findIndex((x) => x.sum);
                        if (c.sum)
                          return (
                            <td key={c.key} className="border-r border-neutral-200 px-2.5 py-2.5 text-right text-xs font-bold text-neutral-900 tabular-nums last:border-r-0">
                              {fmtSumNum(sumCol(visibleRows, c.key))}
                            </td>
                          );
                        if (idx === firstSumIdx - 1)
                          return (
                            <td key={c.key} className="border-r border-neutral-200 px-2.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                              Sum
                            </td>
                          );
                        return <td key={c.key} className="border-r border-neutral-200 last:border-r-0" />;
                      })}
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Panel footer */}
            <div className="border-t border-neutral-100 bg-neutral-50/40 px-6 py-3">
              <button
                onClick={addRow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:border-red-300 hover:bg-red-50/50 hover:text-red-600"
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
