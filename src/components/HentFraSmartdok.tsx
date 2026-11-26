import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { SmartdokLogo } from "@/components/SmartdokLogo";
import { hentProsjekter, hentTimer } from "@/lib/smartdok.functions";
import { byggTabell } from "@/lib/smartdok-timer";
import type { Parsed } from "@/lib/smartdok-parser";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Koblingsliste } from "@/components/Koblingsliste";
import { Sendinger } from "@/components/Sendinger";
import type { SmartdokKilde } from "@/components/LeggPaaOrdre";

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

/**
 * Henter timene og bygger tabellen. Brukes av panelet og når tabellen hentes på
 * nytt etter en sending (samme prosjekt og periode).
 */
export async function hentSmartdokTabell(
  kilde: SmartdokKilde,
): Promise<{ ok: true; tabell: Parsed } | { ok: false; feil: string; loggInn: boolean }> {
  try {
    const svar = await hentTimer({ data: { prosjekt: kilde.nummer, fra: kilde.fra, til: kilde.til } });
    if (!svar.ok) return { ok: false, feil: svar.feil, loggInn: !!svar.loggInn };
    if (svar.timer.length === 0) return { ok: false, feil: "Fant ingen timer for prosjektet i perioden.", loggInn: false };
    return {
      ok: true,
      tabell: byggTabell(svar.timer, { nummer: kilde.nummer, navn: kilde.navn }, { fra: kilde.fra, til: kilde.til }),
    };
  } catch (e) {
    // Transportfeil kan inneholde interne detaljer; vis en fast tekst og logg meldingen.
    console.error("Henting av timer feilet:", e instanceof Error ? e.message : "ukjent feil");
    return { ok: false, feil: "Noe gikk galt under hentingen. Prøv igjen.", loggInn: false };
  }
}

export function HentFraSmartdok({
  onHentet,
  harTabell,
  onSendingEndret,
}: {
  onHentet: (p: Parsed, kilde: SmartdokKilde) => void;
  harTabell: boolean;
  /** Etter angring i Sendinger: tabellen hentes på nytt hvis den er fra samme prosjekt. */
  onSendingEndret?: (prosjekt: string) => void;
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
  const [koblingerAapen, setKoblingerAapen] = useState(false);
  const [sendingerAapen, setSendingerAapen] = useState(false);

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
      const kilde = { nummer: valgt.nummer, navn: valgt.navn, fra, til };
      const r = await hentSmartdokTabell(kilde);
      if (!r.ok) {
        visFeil(r.feil, r.loggInn);
        return;
      }
      onHentet(r.tabell, kilde);
    } finally {
      setHenter(false);
    }
  };

  // SmartDoks egne farger (smartdok.no): gult #FFDC59 med grått #4A4A4A.
  const feltKlasse =
    "w-full rounded-lg border-2 border-[#ecd27a] bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-[#4a4a4a] focus:ring-3 focus:ring-[#ffdc59]/60 disabled:opacity-60";
  const etikett = "mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-[#4a4a4a]/70";
  const smaaKnapp =
    "rounded-lg border border-[#d9bf5c] bg-white px-3 py-1.5 text-xs font-medium text-[#4a4a4a] transition hover:bg-[#fff1b8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a4a4a] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className={`group overflow-hidden rounded-xl border border-[#e6c24a] bg-[#ffdc59] transition duration-300 ease-out motion-reduce:transition-none ${
        aapen
          ? "shadow-[0_14px_32px_-16px_rgba(181,140,0,0.55)]"
          : "shadow-sm hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-14px_rgba(181,140,0,0.6)] motion-reduce:hover:translate-y-0"
      }`}
    >
      <button
        type="button"
        aria-expanded={aapen}
        aria-controls="hent-fra-smartdok-innhold"
        onClick={() => {
          const ny = !aapen;
          setAapen(ny);
          if (ny) void lastProsjekter();
        }}
        className="relative flex w-full items-center gap-3 overflow-hidden px-4 py-4 text-left sm:gap-5 sm:px-6 text-[#4a4a4a] transition duration-200 hover:bg-[#f7d044] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#4a4a4a] active:scale-[0.995] motion-reduce:active:scale-100"
      >
        {/* Lysskjæret glir én gang over det gule når musa kommer inn. */}
        <span aria-hidden className="smartdok-skjaer pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/45 to-transparent" />
        <SmartdokLogo className="relative h-5 w-auto shrink-0 sm:h-6" />
        <span aria-hidden className="relative hidden h-8 w-px bg-[#4a4a4a]/25 sm:block" />
        <span className="relative min-w-0 flex-1">
          <span className="block text-sm font-bold">Hent timer</span>
          <span className="hidden text-xs text-[#4a4a4a]/75 sm:block">Velg prosjekt og periode i stedet for å laste opp en fil</span>
        </span>
        <span
          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4a4a4a] text-[#ffdc59] transition duration-300 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
            aapen ? "rotate-180" : ""
          }`}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
        {/* Gul og grå stripe langs kanten mens timene hentes. */}
        {henter && <span aria-hidden className="smartdok-striper absolute inset-x-0 bottom-0 h-1" />}
      </button>

      {/* Folder seg ut og inn med høyden; inert når det er lukket, så Tab ikke havner i skjulte felt. */}
      <div
        id="hent-fra-smartdok-innhold"
        inert={!aapen}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          aapen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
        <div className="space-y-4 border-t border-[#e6c24a] bg-[#fff7d6] px-6 py-5">
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
              className="rounded-lg bg-[#4a4a4a] px-5 py-2.5 text-sm font-bold text-[#ffdc59] shadow-sm transition duration-150 hover:-translate-y-px hover:bg-[#333] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a4a4a] active:translate-y-0 active:scale-95 disabled:translate-y-0 disabled:opacity-60 motion-reduce:transform-none"
            >
              {henter ? "Henter…" : "Hent timer"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[#ecd27a] pt-3">
            <span className="mr-1 text-xs font-medium text-[#4a4a4a]/80">Tripletex:</span>
            <button type="button" onClick={() => setKoblingerAapen(true)} className={smaaKnapp}>
              Koblingsliste
            </button>
            <button
              type="button"
              onClick={() => setSendingerAapen(true)}
              disabled={!valgt}
              title={valgt ? undefined : "Velg et prosjekt først"}
              className={smaaKnapp}
            >
              Sendinger{valgt ? ` på ${valgt.nummer}` : ""}
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
                    Gå til innlogging
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      <Koblingsliste open={koblingerAapen} onOpenChange={setKoblingerAapen} />
      {valgt && (
        <Sendinger
          open={sendingerAapen}
          onOpenChange={setSendingerAapen}
          prosjekt={{ nummer: valgt.nummer, navn: valgt.navn }}
          onEndret={() => onSendingEndret?.(valgt.nummer)}
        />
      )}
    </div>
  );
}
