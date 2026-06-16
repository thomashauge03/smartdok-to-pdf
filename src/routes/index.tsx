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
  FileSpreadsheet,
  RotateCcw,
  Download,
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
import { generatePdf, pdfFilename } from "@/lib/smartdok-pdf";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import logoAsset from "@/assets/hmLogo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SmartDok → PDF | HM" },
      {
        name: "description",
        content: "Konverter SmartDok timer-eksport til pyntet PDF med HM-logo.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [prosjekt, setProsjekt] = useState("");
  const [vedlegg, setVedlegg] = useState("");
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

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
    const timerCol = columns.find((c) => c.key === "timer");
    return timerCol ? sumCol(visibleRows, "timer") : null;
  }, [visibleRows, columns]);

  const toggleFilter = (col: ColKey, val: string) => {
    setFilters((f) => {
      const next = new Set(f[col] ?? []);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return { ...f, [col]: next };
    });
  };
  const clearFilter = (col: ColKey) =>
    setFilters((f) => ({ ...f, [col]: new Set() }));

  const toggleColumn = (col: ColKey) =>
    setVisibleCols((s) => {
      const next = new Set(s);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });

  const updateCell = (i: number, key: ColKey, value: string) => {
    setParsed((p) => {
      if (!p) return p;
      const rows = p.rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r));
      return { ...p, rows };
    });
  };
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
      setFilters(
        Object.fromEntries(p.columns.filter((c) => c.filter).map((c) => [c.key, new Set<string>()])),
      );
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
      const doc = await generatePdf(visibleRows, visibleColList, prosjekt, vedlegg);
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

  const tableWidth = visibleColList.reduce((a, c) => a + (colWidths[c.key] ?? c.defaultWidth), 0) + 40;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600">
              <FileSpreadsheet className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-neutral-900">Timeliste → PDF</h1>
              <p className="text-xs text-neutral-500">SmartDok-eksport</p>
            </div>
          </div>
          <img src={logoAsset.url} alt="HM" className="h-10 w-auto" />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">

        {/* Drop zone */}
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-all duration-200 ${
            drag
              ? "border-red-500 bg-red-50 scale-[1.01]"
              : "border-neutral-300 bg-white hover:border-red-400 hover:bg-red-50/30"
          }`}
        >
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-colors duration-200 ${
            drag ? "bg-red-100" : "bg-neutral-100 group-hover:bg-red-100"
          }`}>
            <UploadCloud className={`h-7 w-7 transition-colors duration-200 ${
              drag ? "text-red-600" : "text-neutral-400 group-hover:text-red-500"
            }`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">
              {filename
                ? <span className="text-red-600">{filename}</span>
                : "Slipp Excel-fil her, eller klikk for å velge"}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {filename ? "Klikk for å bytte fil" : ".xls, .xlsx eller .csv fra SmartDok"}
            </p>
          </div>
        </label>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Main panel */}
        {parsed && (
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">

            {/* Meta fields */}
            <div className="border-b border-neutral-100 px-6 py-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Prosjekt
                  </label>
                  <input
                    value={prosjekt}
                    onChange={(e) => setProsjekt(e.target.value)}
                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-900 transition focus:border-red-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Vedlegg
                  </label>
                  <input
                    value={vedlegg}
                    onChange={(e) => setVedlegg(e.target.value)}
                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-900 transition focus:border-red-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  />
                </div>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-6 py-3">
              {/* Stats */}
              <div className="flex items-center gap-3 text-xs text-neutral-500">
                <span>
                  <span className="font-semibold text-neutral-800">{visibleRows.length}</span>
                  {visibleRows.length !== parsed.rows.length && (
                    <span className="text-neutral-400"> / {parsed.rows.length}</span>
                  )}{" "}
                  rader
                </span>
                {timerSum !== null && (
                  <>
                    <span className="text-neutral-300">·</span>
                    <span>
                      Sum timer:{" "}
                      <span className="font-semibold text-neutral-800">{fmtSumNum(timerSum)}</span>
                    </span>
                  </>
                )}
                {activeFilterCount > 0 && (
                  <>
                    <span className="text-neutral-300">·</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      <Filter className="h-3 w-3" />
                      {activeFilterCount} filter{activeFilterCount > 1 ? "" : ""}
                    </span>
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50">
                      <Eye className="h-3.5 w-3.5" />
                      Kolonner
                      <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
                        {visibleCols.size}/{columns.length}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-2">
                    <p className="mb-2 px-1 text-xs font-semibold text-neutral-600">
                      Vis i tabell og PDF
                    </p>
                    <div className="max-h-72 space-y-0.5 overflow-y-auto">
                      {columns.map((c) => (
                        <label
                          key={c.key}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs transition hover:bg-neutral-50"
                        >
                          <Checkbox
                            checked={visibleCols.has(c.key)}
                            onCheckedChange={() => toggleColumn(c.key)}
                          />
                          <span className="text-neutral-700">{c.label}</span>
                          <span className="ml-auto font-mono text-[10px] text-neutral-400">
                            {c.key}
                          </span>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <button
                  onClick={resetWidths}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50"
                  title="Nullstill kolonnebredder"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>

                <button
                  onClick={onDownload}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="text-xs"
                style={{ tableLayout: "fixed", width: tableWidth, minWidth: "100%" }}
              >
                <colgroup>
                  {visibleColList.map((c) => (
                    <col key={c.key} style={{ width: colWidths[c.key] ?? c.defaultWidth }} />
                  ))}
                  <col style={{ width: 40 }} />
                </colgroup>

                <thead className="sticky top-[57px] z-10 bg-neutral-50 text-left">
                  <tr>
                    {visibleColList.map((c) => (
                      <th
                        key={c.key}
                        className="relative border-b border-neutral-200 px-2 py-2.5 font-semibold text-neutral-600"
                      >
                        <div className="flex items-center gap-1">
                          <span className="truncate">{c.label}</span>
                          {c.filter && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  className={`rounded p-0.5 transition ${
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
                                  <span className="text-xs font-semibold text-neutral-700">
                                    Filter: {c.label}
                                  </span>
                                  {(filters[c.key]?.size ?? 0) > 0 && (
                                    <button
                                      onClick={() => clearFilter(c.key)}
                                      className="text-xs text-red-600 hover:underline"
                                    >
                                      Nullstill
                                    </button>
                                  )}
                                </div>
                                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                                  {(uniqueValues[c.key] ?? []).map((v) => (
                                    <label
                                      key={v}
                                      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs transition hover:bg-neutral-50"
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
                            className="ml-auto rounded p-0.5 text-neutral-300 opacity-0 transition group-hover:opacity-100 hover:bg-neutral-200 hover:text-neutral-600 [th:hover_&]:opacity-100"
                            aria-label={`Skjul ${c.label}`}
                            title="Skjul kolonne"
                          >
                            <EyeOff className="h-3 w-3" />
                          </button>
                        </div>
                        <div
                          onMouseDown={(e) => onResizeStart(c.key, e)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-red-400/40"
                          aria-hidden
                        />
                      </th>
                    ))}
                    <th className="border-b border-neutral-200 bg-neutral-50" />
                  </tr>
                </thead>

                <tbody ref={tbodyRef} className="divide-y divide-neutral-100">
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleColList.length + 1}
                        className="px-6 py-12 text-center text-sm text-neutral-400"
                      >
                        Ingen rader matcher valgte filtre
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((r) => {
                      const i = parsed.rows.indexOf(r);
                      return (
                        <tr
                          key={i}
                          className="group/row transition-colors hover:bg-neutral-50"
                        >
                          {visibleColList.map((c) => (
                            <td key={c.key} className="p-0 align-top">
                              <textarea
                                value={r[c.key] ?? ""}
                                onChange={(e) => updateCell(i, c.key, e.target.value)}
                                rows={1}
                                className={`block w-full resize-y overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-2 py-1.5 text-xs leading-relaxed text-neutral-800 focus:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-400 ${
                                  c.align === "right" ? "text-right" : ""
                                }`}
                              />
                            </td>
                          ))}
                          <td className="px-1.5 py-1.5 text-right align-top">
                            <button
                              onClick={() => deleteRow(i)}
                              className="rounded-md p-1 text-neutral-300 opacity-0 transition group-hover/row:opacity-100 hover:bg-red-50 hover:text-red-500"
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
                    <tr className="border-t-2 border-neutral-300 bg-neutral-50">
                      {visibleColList.map((c, idx) => {
                        const firstSumIdx = visibleColList.findIndex((x) => x.sum);
                        if (c.sum)
                          return (
                            <td key={c.key} className="px-2 py-2 text-right text-xs font-bold text-neutral-900">
                              {fmtSumNum(sumCol(visibleRows, c.key))}
                            </td>
                          );
                        if (idx === firstSumIdx - 1)
                          return (
                            <td key={c.key} className="px-2 py-2 text-right text-xs font-bold text-neutral-500">
                              Sum
                            </td>
                          );
                        return <td key={c.key} />;
                      })}
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="border-t border-neutral-100 px-6 py-3">
              <button
                onClick={addRow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-700"
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
