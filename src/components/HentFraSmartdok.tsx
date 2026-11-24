import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, ChevronsUpDown, DownloadCloud } from "lucide-react";
import { hentProsjekter, hentTimer } from "@/lib/smartdok.functions";
import { byggTabell } from "@/lib/smartdok-timer";
import type { Parsed } from "@/lib/smartdok-parser";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

type Prosjekt = { nummer: string; navn: string; kunde: string | null; aktiv: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Lokal tid, ikke UTC: ellers havner første dag i forrige måned i feltet for folk øst for Greenwich.
function standardPeriode(): { fra: string; til: string } {
  const na = new Date();
  return {
    fra: iso(new Date(na.getFullYear(), na.getMonth(), 1)),
    til: iso(new Date(na.getFullYear(), na.getMonth() + 1, 0)),
  };
}

function dagerMellom(fra: string, til: string): number {
  const [fy, fm, fd] = fra.split("-").map(Number);
  const [ty, tm, td] = til.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

const DATO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function HentFraSmartdok({
  onHentet,
  harTabell,
}: {
  onHentet: (p: Parsed, nummer: string) => void;
  harTabell: boolean;
}) {
  const [aapen, setAapen] = useState(false);
  const [prosjekter, setProsjekter] = useState<Prosjekt[] | null>(null);
  const [lasterProsjekter, setLasterProsjekter] = useState(false);
  const [valgt, setValgt] = useState<Prosjekt | null>(null);
  const [velgerAapen, setVelgerAapen] = useState(false);
  const [periode, setPeriode] = useState(standardPeriode);
  const [henter, setHenter] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [loggInn, setLoggInn] = useState(false);

  const visFeil = (melding: string, krevInnlogging = false) => {
    setFeil(melding);
    setLoggInn(krevInnlogging);
  };

  const lastProsjekter = async () => {
    // Bare én gang: ferdig liste eller pågående kall skal ikke startes på nytt.
    if (prosjekter || lasterProsjekter) return;
    setLasterProsjekter(true);
    try {
      const svar = await hentProsjekter();
      if (svar.ok) {
        // Adminbordet sender bare aktive; filteret her er for sikkerhets skyld (Thomas: ingen inaktive).
        setProsjekter(svar.prosjekter.filter((p) => p.aktiv));
        setFeil(null);
        setLoggInn(false);
      } else {
        visFeil(svar.feil, !!svar.loggInn);
      }
    } catch {
      visFeil("Kunne ikke hente prosjektlista. Prøv igjen.");
    } finally {
      setLasterProsjekter(false);
    }
  };

  const hent = async () => {
    if (!valgt) return visFeil("Velg et prosjekt først.");
    const { fra, til } = periode;
    if (!DATO_RE.test(fra) || !DATO_RE.test(til)) return visFeil("Fyll inn både fra- og til-dato.");
    if (fra > til) return visFeil("Fra-datoen kan ikke være etter til-datoen.");
    if (dagerMellom(fra, til) > 365) return visFeil("Perioden kan være maks 366 dager.");
    if (harTabell && !window.confirm("Erstatte timene i tabellen?")) return;

    setFeil(null);
    setLoggInn(false);
    setHenter(true);
    try {
      const svar = await hentTimer({ data: { prosjekt: valgt.nummer, fra, til } });
      if (!svar.ok) {
        visFeil(svar.feil, !!svar.loggInn);
        return;
      }
      if (svar.timer.length === 0) {
        visFeil("Fant ingen timer for prosjektet i perioden.");
        return;
      }
      onHentet(byggTabell(svar.timer, { nummer: valgt.nummer, navn: valgt.navn }, { fra, til }), valgt.nummer);
    } catch (e) {
      // Transportfeil kan inneholde interne detaljer; vis en fast tekst og logg meldingen.
      console.error("Henting av timer feilet:", e instanceof Error ? e.message : "ukjent feil");
      visFeil("Noe gikk galt under hentingen. Prøv igjen.");
    } finally {
      setHenter(false);
    }
  };

  const feltKlasse =
    "w-full rounded-lg border-2 border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-red-500 focus:ring-3 focus:ring-red-500/10";
  const etikett = "mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-neutral-500";

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={aapen}
        onClick={() => {
          const ny = !aapen;
          setAapen(ny);
          if (ny) void lastProsjekter();
        }}
        className="flex w-full items-center gap-3 px-6 py-4 text-left transition hover:bg-red-50/30"
      >
        <DownloadCloud className="h-5 w-5 text-neutral-400" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-neutral-700">Hent fra SmartDok</span>
          <span className="block text-xs text-neutral-400">Velg prosjekt og periode i stedet for å laste opp en fil</span>
        </span>
        {aapen ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
      </button>

      {aapen && (
        <div className="space-y-4 border-t border-neutral-200 px-6 py-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
            <div>
              <span id="hent-prosjekt-etikett" className={etikett}>Prosjekt</span>
              <Popover
                open={velgerAapen}
                onOpenChange={(o) => {
                  setVelgerAapen(o);
                  if (o) void lastProsjekter();
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-labelledby="hent-prosjekt-etikett"
                    className={`${feltKlasse} flex items-center justify-between gap-2 text-left`}
                  >
                    <span className={`truncate ${valgt ? "font-medium" : "text-neutral-400"}`}>
                      {valgt ? `${valgt.nummer} ${valgt.navn}` : lasterProsjekter ? "Laster prosjekter…" : "Velg prosjekt"}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-neutral-400" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
                  <Command>
                    <CommandInput placeholder="Søk etter prosjekt…" />
                    <CommandList>
                      <CommandEmpty>{lasterProsjekter ? "Laster…" : "Ingen prosjekter funnet."}</CommandEmpty>
                      {(prosjekter ?? []).map((p) => (
                        <CommandItem
                            key={p.nummer}
                            value={`${p.nummer} ${p.navn} ${p.kunde ?? ""}`}
                            onSelect={() => {
                              setValgt(p);
                              setFeil(null);
                              setLoggInn(false);
                              setVelgerAapen(false);
                            }}
                          >
                            <span className="truncate">
                              {p.nummer} {p.navn}
                              {p.kunde && <span className="ml-2 text-neutral-400">{p.kunde}</span>}
                            </span>
                          </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <label htmlFor="hent-fra" className={etikett}>Fra</label>
              <input
                id="hent-fra"
                type="date"
                disabled={henter}
                value={periode.fra}
                onChange={(e) => setPeriode((p) => ({ ...p, fra: e.target.value }))}
                className={feltKlasse}
              />
            </div>
            <div>
              <label htmlFor="hent-til" className={etikett}>Til</label>
              <input
                id="hent-til"
                type="date"
                disabled={henter}
                value={periode.til}
                onChange={(e) => setPeriode((p) => ({ ...p, til: e.target.value }))}
                className={feltKlasse}
              />
            </div>

            <button
              type="button"
              disabled={henter || lasterProsjekter}
              onClick={() => void hent()}
              className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {henter ? "Henter…" : "Hent timer"}
            </button>
          </div>

          {feil && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {feil}
              {!prosjekter && !lasterProsjekter && !loggInn && (
                <>
                  {" "}
                  <button type="button" onClick={() => void lastProsjekter()} className="font-medium underline underline-offset-2">
                    Prøv igjen
                  </button>
                </>
              )}
              {loggInn && (
                <>
                  {" "}
                  <Link to="/logg-inn" className="font-medium underline underline-offset-2">
                    Logg inn på nytt
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
