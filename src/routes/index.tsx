import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import type { Row } from "@/lib/smartdok-parser";
import { Trash2, Plus, Filter } from "lucide-react";
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

  const sumTimer = useMemo(
    () => (parsed?.rows ?? []).reduce((s, r) => s + (Number(r.timer.replace(",", ".")) || 0), 0),
    [parsed],
  );
  const sumMaskinTimer = useMemo(
    () => (parsed?.rows ?? []).reduce((s, r) => s + (Number(r.maskinTimer.replace(",", ".")) || 0), 0),
    [parsed],
  );

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
      const doc = await generatePdf({ ...parsed, sumTimer, sumMaskinTimer }, prosjekt, vedlegg);
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
                <span className="font-semibold">{parsed.rows.length}</span> rader,
                {" "}sum timer: <span className="font-semibold">{fmtSumNum(sumTimer)}</span>
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
                    {["Tid", "Navn", "Kommentar", "Dato", "Timer", "AER timer", "Maskinnavn1", "Timer", ""].map((h, i) => (
                      <th key={i} className="border-b border-neutral-200 px-2 py-2 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r, i) => (
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
                  ))}
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
