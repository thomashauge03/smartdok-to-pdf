import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import type { Row } from "@/lib/smartdok-parser";
import { Trash2, Plus, Filter, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { parseSmartdok, type Parsed, fmtSumNum } from "@/lib/smartdok-parser";
import { generatePdf, pdfFilename } from "@/lib/smartdok-pdf";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import logoAsset from "@/assets/hmLogo.png.asset.json";

type FilterKey = "navn" | "aerTimer" | "maskin";
const FILTER_COLS: FilterKey[] = ["navn", "aerTimer", "maskin"];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SmartDok → PDF | HM" },
      { name: "description", content: "Konverter SmartDok timer-eksport til pyntet PDF med HM-logo." },
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
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    navn: new Set(),
    aerTimer: new Set(),
    maskin: new Set(),
  });
  const [dateSort, setDateSort] = useState<"none" | "asc" | "desc">("none");

  const parseDato = (s: string): number => {
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (!m) return 0;
    const [, d, mo, y] = m;
    const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
    return yr * 10000 + Number(mo) * 100 + Number(d);
  };

  const toggleDateSort = () =>
    setDateSort((d) => (d === "none" ? "asc" : d === "asc" ? "desc" : "none"));

  const uniqueValues = useMemo(() => {
    const map: Record<FilterKey, string[]> = { navn: [], aerTimer: [], maskin: [] };
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

  const sumTimer = useMemo(
    () => visibleRows.reduce((s, r) => s + (Number(r.timer.replace(",", ".")) || 0), 0),
    [visibleRows],
  );
  const sumMaskinTimer = useMemo(
    () => visibleRows.reduce((s, r) => s + (Number(r.maskinTimer.replace(",", ".")) || 0), 0),
    [visibleRows],
  );

  const toggleFilter = (col: FilterKey, val: string) => {
    setFilters((f) => {
      const next = new Set(f[col]);
      if (next.has(val)) next.delete(val); else next.add(val);
      return { ...f, [col]: next };
    });
  };
  const clearFilter = (col: FilterKey) => setFilters((f) => ({ ...f, [col]: new Set() }));

  const updateCell = (i: number, key: keyof Row, value: string) => {
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
    setParsed((p) =>
      p
        ? {
            ...p,
            rows: [
              ...p.rows,
              { tid: "", navn: "", kommentar: "", dato: "", timer: "", aerTimer: "", maskin: "", maskinTimer: "" },
            ],
          }
        : p,
    );
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
      const doc = await generatePdf({ ...parsed, rows: visibleRows, sumTimer, sumMaskinTimer }, prosjekt, vedlegg);
      doc.save(pdfFilename(prosjekt, vedlegg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition ${
            drag ? "border-red-600 bg-red-50" : "border-neutral-300 bg-white hover:border-neutral-400"
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
            <div className="mt-3 text-sm text-neutral-700">Lastet: <span className="font-medium">{filename}</span></div>
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

            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm text-neutral-600">
                <span className="font-semibold">{visibleRows.length}</span>
                {visibleRows.length !== parsed.rows.length && (
                  <span className="text-neutral-400"> / {parsed.rows.length}</span>
                )}
                {" "}rader, sum timer: <span className="font-semibold">{fmtSumNum(sumTimer)}</span>
              </div>
              <button
                onClick={onDownload}
                disabled={busy}
                className="rounded-md bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Genererer…" : "Last ned PDF"}
              </button>
            </div>

            <div className="mt-6 overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full text-xs">
                <thead className="bg-neutral-100 text-left">
                  <tr>
                    {([
                      { label: "Tid" },
                      { label: "Navn", filter: "navn" as const },
                      { label: "Kommentar" },
                      { label: "Dato", sort: true as const },
                      { label: "Timer" },
                      { label: "AER timer", filter: "aerTimer" as const },
                      { label: "Maskinnavn1", filter: "maskin" as const },
                      { label: "Timer" },
                      { label: "" },
                    ]).map((col, i) => (
                      <th key={i} className="border-b border-neutral-200 px-2 py-2 font-semibold">
                        <div className="flex items-center gap-1">
                          <span>{col.label}</span>
                          {col.filter && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  className={`rounded p-0.5 transition ${
                                    filters[col.filter].size > 0
                                      ? "bg-red-600 text-white"
                                      : "text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                                  }`}
                                  aria-label={`Filter ${col.label}`}
                                >
                                  <Filter className="h-3 w-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-60 p-2">
                                <div className="mb-2 flex items-center justify-between px-1">
                                  <span className="text-xs font-semibold text-neutral-700">Filter {col.label}</span>
                                  {filters[col.filter].size > 0 && (
                                    <button
                                      onClick={() => clearFilter(col.filter!)}
                                      className="text-xs text-red-600 hover:underline"
                                    >
                                      Nullstill
                                    </button>
                                  )}
                                </div>
                                <div className="max-h-64 space-y-1 overflow-y-auto">
                                  {uniqueValues[col.filter].map((v) => (
                                    <label
                                      key={v}
                                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-100"
                                    >
                                      <Checkbox
                                        checked={filters[col.filter!].has(v)}
                                        onCheckedChange={() => toggleFilter(col.filter!, v)}
                                      />
                                      <span className="truncate">{v || <em className="text-neutral-400">(tom)</em>}</span>
                                    </label>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const i = parsed.rows.indexOf(r);
                    return (
                    <tr key={i} className="border-b border-neutral-100 hover:bg-neutral-50">
                      {(["tid","navn","kommentar","dato","timer","aerTimer","maskin","maskinTimer"] as const).map((k) => (
                        <td key={k} className="p-0 align-top">
                          {k === "kommentar" ? (
                            <textarea
                              value={r[k]}
                              onChange={(e) => updateCell(i, k, e.target.value)}
                              rows={Math.max(1, r[k].split("\n").length)}
                              className="w-full resize-none border-0 bg-transparent px-2 py-1.5 text-xs focus:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-500"
                            />
                          ) : (
                            <input
                              value={r[k]}
                              onChange={(e) => updateCell(i, k, e.target.value)}
                              className={`w-full border-0 bg-transparent px-2 py-1.5 text-xs focus:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-500 ${k === "timer" || k === "maskinTimer" ? "text-right" : ""}`}
                            />
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => deleteRow(i)}
                          className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Slett rad"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );})}
                  <tr className="bg-neutral-50 font-semibold">
                    <td colSpan={3}></td>
                    <td className="px-2 py-1.5">Sum</td>
                    <td className="px-2 py-1.5 text-right">{fmtSumNum(sumTimer)}</td>
                    <td colSpan={2}></td>
                    <td className="px-2 py-1.5 text-right">{fmtSumNum(sumMaskinTimer)}</td>
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
