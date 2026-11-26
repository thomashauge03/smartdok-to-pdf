import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import {
  Feilmelding,
  SmartdokDialog,
  Spinner,
  Varsel,
  knappFare,
  knappLys,
  knappMork,
} from "@/components/SmartdokDialog";
import { avklarSending, fjernMerke, hentSendinger, type AvklarSvar, type Sending } from "@/lib/tripletex.functions";
import {
  anbefaltAvklaring,
  bekreftLinjerTekst,
  frigiTekst,
  gjeldendeStatus,
  handlinger,
  statusTekst,
  tripletexOrdreUrl,
} from "@/lib/tripletex-visning";

type Feil = { feil: string; loggInn?: boolean; ukjentUtfall?: boolean };
type Sjekk = Extract<AvklarSvar, { funnet: boolean }>;

const fmtTidspunkt = (s: string | null) => {
  if (!s) return "ukjent tidspunkt";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" });
};

const TONEKANT = { ok: "border-l-green-500", advarsel: "border-l-amber-500", feil: "border-l-red-600", noytral: "border-l-neutral-300" };

/**
 * Sendingene på ett prosjekt, med angring: «Fjern merke» (to bekreftelser) og
 * avklaring av sendinger der vi ikke vet hva som kom inn i Tripletex.
 */
export function Sendinger({
  open,
  onOpenChange,
  prosjekt,
  onEndret,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prosjekt: { nummer: string; navn: string };
  /** Etter fjern merke / merk / frigi: timetabellen bør hentes på nytt. */
  onEndret?: () => void;
}) {
  const [sendinger, setSendinger] = useState<Sending[] | null>(null);
  const [laster, setLaster] = useState(false);
  const [feil, setFeil] = useState<Feil | null>(null);
  const [naa, setNaa] = useState(() => Date.now());
  const [opptatt, setOpptatt] = useState(false);
  const generasjon = useRef(0);

  const last = useCallback(async () => {
    const gen = ++generasjon.current;
    setLaster(true);
    try {
      const svar = await hentSendinger({ data: { prosjekt: prosjekt.nummer } });
      if (gen !== generasjon.current) return;
      setNaa(Date.now());
      if (svar.ok) {
        setSendinger(svar.sendinger);
        setFeil(null);
      } else setFeil({ feil: svar.feil, loggInn: !!svar.loggInn });
    } catch (e) {
      if (gen !== generasjon.current) return;
      console.error("Henting av sendinger feilet:", e instanceof Error ? e.message : "ukjent feil");
      setFeil({ feil: "Kunne ikke hente sendingene. Prøv igjen." });
    } finally {
      if (gen === generasjon.current) setLaster(false);
    }
  }, [prosjekt.nummer]);

  useEffect(() => {
    if (!open) return;
    setSendinger(null);
    setFeil(null);
    void last();
  }, [open, last]);

  const endret = useCallback(() => {
    void last();
    onEndret?.();
  }, [last, onEndret]);

  return (
    <SmartdokDialog
      open={open}
      onOpenChange={onOpenChange}
      laast={opptatt}
      tittel="Sendinger til Tripletex"
      beskrivelse={`Prosjekt ${prosjekt.nummer} ${prosjekt.navn}`.trim()}
      bunn={
        <>
          <button type="button" className={`${knappLys} mr-auto`} onClick={() => void last()} disabled={laster || opptatt}>
            <RotateCcw className="h-3.5 w-3.5" /> Last inn på nytt
          </button>
          <button type="button" className={knappMork} onClick={() => onOpenChange(false)} disabled={opptatt}>
            Lukk
          </button>
        </>
      }
    >
      {laster && !sendinger && (
        <p className="flex items-center gap-2 text-sm text-[#4a4a4a]" role="status">
          <Spinner /> Henter sendinger…
        </p>
      )}
      {feil && <Feilmelding feil={feil.feil} loggInn={feil.loggInn} />}
      {sendinger && sendinger.length === 0 && (
        <p className="rounded-lg bg-[#fff7d6] px-4 py-6 text-center text-sm text-[#4a4a4a]">
          Ingen timer fra dette prosjektet er sendt til Tripletex ennå.
        </p>
      )}
      {sendinger && sendinger.length > 0 && (
        <ul className="space-y-3">
          {sendinger.map((s) => (
            <SendingKort key={s.kode} sending={s} naa={naa} onEndret={endret} onOpptatt={setOpptatt} />
          ))}
        </ul>
      )}
    </SmartdokDialog>
  );
}

type Steg = null | "fjern1" | "fjern2" | "frigi" | "merk";
type Arbeid = null | "fjern" | "sjekk" | "merk" | "frigi";

function SendingKort({
  sending: s,
  naa,
  onEndret,
  onOpptatt,
}: {
  sending: Sending;
  naa: number;
  onEndret: () => void;
  onOpptatt: (o: boolean) => void;
}) {
  const status = gjeldendeStatus(s.status, s.endret, naa);
  const tekst = statusTekst(status);
  const kan = handlinger(status, s.ny_ordre);
  const [steg, setSteg] = useState<Steg>(null);
  const [arbeid, setArbeid] = useState<Arbeid>(null);
  const [sjekk, setSjekk] = useState<Sjekk | null>(null);
  const [feil, setFeil] = useState<Feil | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [harSett, setHarSett] = useState(false);
  const opptatt = useRef(false);
  const ordre = s.ordrenummer ? `ordre ${s.ordrenummer}` : "ordren";

  // bekreftetLinjer sendes bare med «merk» etter at brukeren har krysset av for at linjene står på ordren.
  const kjor = async (hva: Exclude<Arbeid, null>, bekreftetLinjer = false) => {
    if (opptatt.current) return;
    opptatt.current = true;
    setArbeid(hva);
    onOpptatt(true);
    setFeil(null);
    setMelding(null);
    setSteg(null);
    try {
      const svar =
        hva === "fjern"
          ? await fjernMerke({ data: { kode: s.kode } })
          : await avklarSending({ data: { kode: s.kode, valg: hva, ...(bekreftetLinjer ? { bekreftetLinjer: true } : {}) } });
      if (!svar.ok) {
        setFeil({ feil: svar.feil, loggInn: !!svar.loggInn, ukjentUtfall: !!svar.ukjentUtfall });
        // Etter en skriving med ukjent utfall kan statusen ha endret seg.
        if (svar.ukjentUtfall) onEndret();
        return;
      }
      const r = svar.resultat;
      if ("funnet" in r) {
        setSjekk(r);
        return;
      }
      setSjekk(null);
      setMelding(r.melding);
      onEndret();
    } catch (e) {
      console.error("Handling på sending feilet:", e instanceof Error ? e.message : "ukjent feil");
      setFeil(
        hva === "sjekk"
          ? { feil: "Kunne ikke sjekke i Tripletex. Prøv igjen." }
          : {
              feil: "Fikk ikke svar. Endringen kan ha gått gjennom: last inn listen på nytt før du prøver igjen.",
              ukjentUtfall: true,
            },
      );
      if (hva !== "sjekk") onEndret();
    } finally {
      opptatt.current = false;
      setArbeid(null);
      onOpptatt(false);
    }
  };

  const travel = arbeid !== null;
  const anbefalt = sjekk ? anbefaltAvklaring(status, sjekk) : null;

  return (
    <li className={`rounded-lg border border-l-4 border-[#ecd27a] ${TONEKANT[tekst.tone]} bg-white px-4 py-3`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-sm font-bold text-[#2b2b2b]">
            {s.ordrenummer ? `Ordre ${s.ordrenummer}` : "Uten ordrenummer"}
            {s.ny_ordre !== null && (
              <span className="ml-2 text-xs font-normal text-neutral-500">{s.ny_ordre ? "ny ordre" : "eksisterende ordre"}</span>
            )}
          </p>
          <p className="text-xs text-neutral-500">
            Sendt {fmtTidspunkt(s.opprettet)}
            {s.antall_linjer !== null && ` · ${s.antall_linjer} ${s.antall_linjer === 1 ? "linje" : "linjer"}`} · sending{" "}
            <code>{s.kode}</code>
          </p>
        </div>
        <span className="rounded-full bg-[#4a4a4a] px-2.5 py-0.5 text-[11px] font-bold text-[#ffdc59]">{tekst.tittel}</span>
      </div>
      <p className="mt-2 text-sm text-[#4a4a4a]">{tekst.forklaring}</p>

      {s.ordre_id !== null && (
        <a
          href={tripletexOrdreUrl(s.ordre_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#4a4a4a] underline underline-offset-2"
        >
          Åpne {ordre} i Tripletex <ExternalLink className="h-3 w-3" aria-hidden />
          <span className="sr-only">(åpnes i ny fane)</span>
        </a>
      )}

      {/* Handlinger */}
      {(kan.fjernMerke || kan.avklar) && steg === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {kan.avklar && (
            <button type="button" className={`${knappLys} py-1.5 text-xs`} disabled={travel} onClick={() => void kjor("sjekk")}>
              {arbeid === "sjekk" ? (
                <>
                  <Spinner /> Sjekker…
                </>
              ) : (
                "Sjekk i Tripletex"
              )}
            </button>
          )}
          {kan.fjernMerke && (
            <button type="button" className={`${knappLys} py-1.5 text-xs`} disabled={travel} onClick={() => setSteg("fjern1")}>
              {arbeid === "fjern" ? (
                <>
                  <Spinner /> Fjerner merket…
                </>
              ) : (
                "Fjern merke"
              )}
            </button>
          )}
        </div>
      )}

      {/* Resultatet av «Sjekk i Tripletex», med neste steg */}
      {sjekk && kan.avklar && (
        <div className="mt-3 space-y-2 rounded-md bg-[#fff7d6] px-3 py-2.5 text-sm text-[#2b2b2b]" role="status">
          {sjekk.funnet ? (
            <p>
              Fant <strong>ordre {sjekk.ordrenummer}</strong> i Tripletex med koden til denne sendingen. Ordren har{" "}
              {sjekk.antallLinjer} {sjekk.antallLinjer === 1 ? "linje" : "linjer"}.{" "}
              {sjekk.nyOrdre
                ? "Ordren ble laget av denne sendingen."
                : "Det er en eksisterende ordre: se selv på ordren i Tripletex om linjene fra sendingen står der. Står de der, trykk «Merk som sendt» og bekreft at du har sett dem; mangler de, frigi timene."}
            </p>
          ) : (
            <p>
              Fant ingen ordre med koden til denne sendingen i Tripletex. Da kom trolig ingenting inn: frigi timene så de kan
              sendes på nytt.
            </p>
          )}
          <div className={`flex flex-wrap gap-2 ${steg === null ? "" : "hidden"}`}>
            {/* På en eksisterende ordre godtar adminbordet «merk» etter ukjent utfall bare med
                bekreftelse, og aldri når ordren ikke er funnet eller er tom: da vises knappen ikke. */}
            {kan.merk && (!kan.bekreftLinjer || (sjekk.funnet && sjekk.antallLinjer > 0)) && (
              <button
                type="button"
                className={`${anbefalt === "merk" ? knappMork : knappLys} py-1.5 text-xs`}
                disabled={travel}
                onClick={() => {
                  if (kan.bekreftLinjer) {
                    setHarSett(false);
                    setSteg("merk");
                  } else void kjor("merk");
                }}
              >
                {arbeid === "merk" ? (
                  <>
                    <Spinner lys={anbefalt === "merk"} /> Merker…
                  </>
                ) : (
                  "Merk som sendt"
                )}
              </button>
            )}
            <button
              type="button"
              className={`${anbefalt === "frigi" ? knappMork : knappLys} py-1.5 text-xs`}
              disabled={travel}
              onClick={() => setSteg("frigi")}
            >
              {arbeid === "frigi" ? (
                <>
                  <Spinner lys={anbefalt === "frigi"} /> Frigir…
                </>
              ) : (
                "Frigi timene"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Bekreftelser */}
      {steg === "fjern1" && (
        <Bekreft
          tekst={
            <>
              <strong>Fjerne merket for {ordre}?</strong> Timene blir stående som ikke sendt i SmartDok og kan sendes på nytt.
            </>
          }
          ja="Ja, gå videre"
          onJa={() => setSteg("fjern2")}
          onNei={() => setSteg(null)}
        />
      )}
      {steg === "fjern2" && (
        <Bekreft
          fare
          tekst={
            <>
              <strong>{ordre.charAt(0).toUpperCase() + ordre.slice(1)} i Tripletex endres ikke.</strong> Linjene blir liggende
              på ordren og blir fakturert om du ikke fjerner dem der for hånd. Fjerne merket likevel?
            </>
          }
          ja="Fjern merket"
          onJa={() => void kjor("fjern")}
          onNei={() => setSteg(null)}
        />
      )}
      {steg === "merk" && (
        <Bekreft
          tekst={
            <>
              <strong>Merke timene som sendt?</strong> Gjør det bare når du har sett linjene fra denne sendingen på ordren i
              Tripletex. Står de ikke der, blir timene ikke fakturert.
              <label className="mt-2 flex items-start gap-2 font-medium">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={harSett}
                  onChange={(e) => setHarSett(e.target.checked)}
                />
                {bekreftLinjerTekst(sjekk?.ordrenummer ?? s.ordrenummer)}
              </label>
            </>
          }
          ja="Merk som sendt"
          jaAv={!harSett}
          onJa={() => void kjor("merk", true)}
          onNei={() => setSteg(null)}
        />
      )}
      {steg === "frigi" && (
        <Bekreft
          fare
          tekst={
            <>
              <strong>Frigi timene?</strong> {frigiTekst(status, sjekk?.ordrenummer ?? s.ordrenummer)}
            </>
          }
          ja="Frigi timene"
          onJa={() => void kjor("frigi")}
          onNei={() => setSteg(null)}
        />
      )}

      {melding && (
        <div className="mt-3">
          <Varsel tone="ok">{melding}</Varsel>
        </div>
      )}
      {feil && (
        <div className="mt-3">
          <Feilmelding feil={feil.feil} loggInn={feil.loggInn} />
        </div>
      )}
    </li>
  );
}

function Bekreft({
  tekst,
  ja,
  onJa,
  onNei,
  fare = false,
  jaAv = false,
}: {
  tekst: ReactNode;
  ja: string;
  onJa: () => void;
  onNei: () => void;
  fare?: boolean;
  /** Ja-knappen er av til noe er krysset av (f.eks. at linjene er sett i Tripletex). */
  jaAv?: boolean;
}) {
  return (
    <div role="group" aria-label="Bekreft" className="mt-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
      <div aria-live="polite">{tekst}</div>
      <div className="flex flex-wrap gap-2">
        {/* Fokus på «Avbryt»: et ekstra Enter skal ikke bekrefte noe. */}
        <button type="button" className={`${knappLys} py-1.5 text-xs`} onClick={onNei} autoFocus>
          Avbryt
        </button>
        <button type="button" className={`${fare ? knappFare : knappMork} py-1.5 text-xs`} onClick={onJa} disabled={jaAv}>
          {ja}
        </button>
      </div>
    </div>
  );
}
