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
} from "lucide-react";
import {
  parseSmartdok,
  fmtSumNum,
  sumCol,
  COLUMNS,
  type Parsed,
  type Row,
  type ColKey,
} from "@/lib/smartdok-parser";
import { generatePdf, pdfFilename } from "@/lib/smartdok-pdf";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import logoAsset from "@/assets/hmLogo.png.asset.json";

const FILTER_COLS = COLUMNS.filter((c) => c.filter).map((c) => c.key);

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

  const [filters, setFilters] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(FILTER_COLS.map((k) => [k, new Set<string>()])),
  );
  const [dateSort, setDateSort] = useState<"none" | "asc" | "desc">("none");
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    () => new Set(COLUMNS.map((c) => c.key)),
  );

  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultWidth])) as Record<ColKey, number>,
  );
  const resizing = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);

  const onResizeStart = (key: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = { key, startX: e.clientX, startW: colWidths[key] };
    const onMove = (ev: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      const next = Math.max(40, r.startW + (ev.clientX - r.startX));
      setColWidths((ws) => ({ ...ws, [r.key]: next }));
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
    () => COLUMNS.filter((c) => visibleCols.has(c.key)),
    [visibleCols],
  );

  const uniqueValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!parsed) return map;
    for (const k of FILTER_COLS) {
      const set = new Set<string>();
      for (const r of parsed.rows) set.add(r[k] || "");
      map[k] = Array.from(set).sort();
    }
    return map;
  }, [parsed]);

  const visibleRows = useMemo(() => {
    if (!parsed) return [] as Row[];
    const filtered = parsed.rows.filter((r) =>
      FILTER_COLS.every((k) => filters[k].size === 0 || filters[k].has(r[k] || "")),
    );
    if (dateSort === "none") return filtered;
    const sorted = [...filtered].sort((a, b) => parseDato(a.dato) - parseDato(b.dato));
    return dateSort === "desc" ? sorted.reverse() : sorted;
  }, [parsed, filters, dateSort]);

  const toggleFilter = (col: ColKey, val: string) => {
    setFilters((f) => {
      const next = new Set(f[col]);
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
  const deleteRow = (i: number) => {
    setParsed((p) => (p ? { ...p, rows: p.rows.filter((_, idx) => idx !== i) } : p));
  };
  const addRow = () => {
    setParsed((p) => {
      if (!p) return p;
      const empty = Object.fromEntries(COLUMNS.map((c) => [c.key, ""])) as Row;
      return { ...p, rows: [...p.rows, empty] };
    });
  };

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const p = await parseSmartdok(file);
      setParsed(p);
      setProsjekt(p.prosjekt);
      setVedlegg(p.vedlegg);
      setFilename(file.name.replace(/\.[^.]+$/, ""));
      // Default visibility: only columns that actually contain data
      setVisibleCols(new Set(p.populatedCols));
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
      const doc = await generatePdf(visibleRows, visibleColList.map((c) => c.key), prosjekt, vedlegg);
      doc.save(pdfFilename(prosjekt, vedlegg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Auto-grow textareas when visible rows change
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    if (!tbodyRef.current) return;
    const tas = tbodyRef.current.querySelectorAll("textarea");
    tas.forEach((ta) => {
      const el = ta as HTMLTextAreaElement;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    });
  });

  const resetWidths = () =>
    setColWidths(
      Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultWidth])) as Record<ColKey, number>,
    );

  const tableWidth =
    visibleColList.reduce((a, c) => a + colWidths[c.key], 0) + 40; // + delete col

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Timeliste → PDF</h1>
            <p className="text-sm text-neutral-500">SmartDok-eksport til pyntet PDF</p>
          </div>
          <img src={logoAsset.url} alt="HM" className="h-12 w-auto" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition ${
            drag
              ? "border-red-600 bg-red-50"
              : "border-neutral-300 bg-white hover:border-neutral-400"
          }`}
        >
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="text-base font-medium text-neutral-900">
            Slipp Excel-fil her, eller klikk for å velge
          </div>
          <div className="mt-1 text-sm text-neutral-500">.xls, .xlsx eller .csv fra SmartDok</div>
          {filename && (
            <div className="mt-3 text-sm text-neutral-700">
              Lastet: <span className="font-medium">{filename}</span>
            </div>
          )}
        </label>

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {parsed && (
          <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Prosjekt
                </label>
                <input
                  value={prosjekt}
                  onChange={(e) => setProsjekt(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Vedlegg
                </label>
                <input
                  value={vedlegg}
                  onChange={(e) => setVedlegg(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-neutral-600">
                <span className="font-semibold">{visibleRows.length}</span>
                {visibleRows.length !== parsed.rows.length && (
                  <span className="text-neutral-400"> / {parsed.rows.length}</span>
                )}{" "}
                rader, sum timer:{" "}
                <span className="font-semibold">{fmtSumNum(sumCol(visibleRows, "timer"))}</span>
              </div>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                      <Eye className="h-3.5 w-3.5" /> Kolonner ({visibleCols.size}/{COLUMNS.length})
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-2">
                    <div className="mb-2 px-1 text-xs font-semibold text-neutral-700">
                      Vis i tabell og PDF
                    </div>
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      {COLUMNS.map((c) => (
                        <label
                          key={c.key}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-100"
                        >
                          <Checkbox
                            checked={visibleCols.has(c.key)}
                            onCheckedChange={() => toggleColumn(c.key)}
                          />
                          <span>{c.label}</span>
                          <span className="ml-auto text-[10px] uppercase text-neutral-400">
                            {c.key}
                          </span>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <button
                  onClick={resetWidths}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Nullstill bredder
                </button>
                <button
                  onClick={onDownload}
                  disabled={busy}
                  className="rounded-md bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? "Genererer…" : "Last ned PDF"}
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-md border border-neutral-200">
              <table className="text-xs" style={{ tableLayout: "fixed", width: tableWidth }}>
                <colgroup>
                  {visibleColList.map((c) => (
                    <col key={c.key} style={{ width: colWidths[c.key] }} />
                  ))}
                  <col style={{ width: 40 }} />
                </colgroup>
                <thead className="bg-neutral-100 text-left">
                  <tr>
                    {visibleColList.map((c) => (
                      <th
                        key={c.key}
                        className="relative border-b border-neutral-200 px-2 py-2 font-semibold"
                      >
                        <div className="flex items-center gap-1">
                          <span className="truncate">{c.label}</span>
                          {c.filter && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  className={`rounded p-0.5 transition ${
                                    filters[c.key].size > 0
                                      ? "bg-red-600 text-white"
                                      : "text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                                  }`}
                                  aria-label={`Filter ${c.label}`}
                                >
                                  <Filter className="h-3 w-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-60 p-2">
                                <div className="mb-2 flex items-center justify-between px-1">
                                  <span className="text-xs font-semibold text-neutral-700">
                                    Filter {c.label}
                                  </span>
                                  {filters[c.key].size > 0 && (
                                    <button
                                      onClick={() => clearFilter(c.key)}
                                      className="text-xs text-red-600 hover:underline"
                                    >
                                      Nullstill
                                    </button>
                                  )}
                                </div>
                                <div className="max-h-64 space-y-1 overflow-y-auto">
                                  {(uniqueValues[c.key] ?? []).map((v) => (
                                    <label
                                      key={v}
                                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-100"
                                    >
                                      <Checkbox
                                        checked={filters[c.key].has(v)}
                                        onCheckedChange={() => toggleFilter(c.key, v)}
                                      />
                                      <span className="truncate">
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
                                  : "text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                              }`}
                              aria-label="Sorter dato"
                              title={
                                dateSort === "asc"
                                  ? "Stigende"
                                  : dateSort === "desc"
                                    ? "Synkende"
                                    : "Sorter"
                              }
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
                            className="ml-auto rounded p-0.5 text-neutral-300 hover:bg-neutral-200 hover:text-neutral-700"
                            aria-label={`Skjul ${c.label}`}
                            title="Skjul kolonne"
                          >
                            <EyeOff className="h-3 w-3" />
                          </button>
                        </div>
                        <div
                          onMouseDown={(e) => onResizeStart(c.key, e)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-red-400/50"
                          aria-hidden
                        />
                      </th>
                    ))}
                    <th className="border-b border-neutral-200"></th>
                  </tr>
                </thead>
                <tbody ref={tbodyRef}>
                  {visibleRows.map((r) => {
                    const i = parsed.rows.indexOf(r);
                    return (
                      <tr key={i} className="border-b border-neutral-100 hover:bg-neutral-50">
                        {visibleColList.map((c) => (
                          <td key={c.key} className="p-0 align-top">
                            <textarea
                              value={r[c.key]}
                              onChange={(e) => updateCell(i, c.key, e.target.value)}
                              rows={1}
                              className={`block w-full resize-y overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-2 py-1.5 text-xs focus:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-500 ${
                                c.align === "right" ? "text-right" : ""
                              }`}
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right align-top">
                          <button
                            onClick={() => deleteRow(i)}
                            className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                            aria-label="Slett rad"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-neutral-50 font-semibold">
                    {visibleColList.map((c, idx) => {
                      const firstSumIdx = visibleColList.findIndex((x) => x.sum);
                      if (c.sum)
                        return (
                          <td key={c.key} className="px-2 py-1.5 text-right">
                            {fmtSumNum(sumCol(visibleRows, c.key))}
                          </td>
                        );
                      if (idx === firstSumIdx - 1)
                        return (
                          <td key={c.key} className="px-2 py-1.5 text-right">
                            Sum
                          </td>
                        );
                      return <td key={c.key}></td>;
                    })}
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <button
              onClick={addRow}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <Plus className="h-3.5 w-3.5" /> Legg til rad
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
