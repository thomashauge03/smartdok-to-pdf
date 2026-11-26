import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Feilmelding,
  SmartdokDialog,
  Spinner,
  Varsel,
  etikett,
  knappLys,
  knappMork,
} from "@/components/SmartdokDialog";
import { Koblingsliste } from "@/components/Koblingsliste";
import { Sendinger } from "@/components/Sendinger";
import {
  hentApneOrdrer,
  hentKoblinger,
  hentSendinger,
  hentTripletexProdukter,
  leggPaaOrdre,
  type ApenOrdre,
  type LeggPaaOrdreSvar,
} from "@/lib/tripletex.functions";
import { leggPaaOrdreInn, pdfForStor, PDF_FOR_STOR } from "@/lib/tripletex";
import { UKJENT_UTFALL_FEIL } from "@/lib/adminbord-svar";
import { beregnOrdrelinjer, type Ordreberegning, type Ordrelinje, type Produkt } from "@/lib/ordrelinjer";
import type { ColMeta, Row } from "@/lib/smartdok-parser";
import {
  alleredeSendte,
  byggLeggPaaOrdre,
  fmtAntall,
  fmtDato,
  fmtKr,
  forklarInndatafeil,
  linjesum,
  resultatnavn,
  sendingSperre,
  SJEKK_I_TRIPLETEX,
  skjulteFaktureringskolonner,
  statusTekst,
  tilBase64,
  tilKobling,
  totalsum,
  tripletexOrdreUrl,
  vurderForhandsvisning,
  type KoblingRad,
} from "@/lib/tripletex-visning";

export type SmartdokKilde = { nummer: string; navn: string; fra: string; til: string };

type Feil = { feil: string; loggInn?: boolean };
type Sendingsvar = Parameters<typeof sendingSperre>[0];
type Valg = "ny" | number | null;
type Fase = "forhand" | "sender" | "resultat" | "uavklart";

/**
 * Forhåndsvisning og sending av timene til en ordre i Tripletex. Linjene regnes
 * ut fra de samme radene som står i tabellen og i PDF-en.
 */
export function LeggPaaOrdre({
  open,
  onOpenChange,
  kilde,
  rows,
  columns,
  synlige,
  tripletexKey,
  lagPdf,
  hentPaaNytt,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kilde: SmartdokKilde;
  /** De filtrerte radene, de samme som går i PDF-en. */
  rows: Row[];
  /** Alle kolonnene: også skjulte maskinkolonner har timer som faktureres. */
  columns: ColMeta[];
  /** Nøklene til kolonnene som vises i tabellen og PDF-en. */
  synlige: Set<string>;
  tripletexKey?: string;
  /** Samme PDF som «Last ned PDF». */
  lagPdf: () => Promise<{ data: ArrayBuffer; filnavn: string }>;
  /** Henter timene fra SmartDok på nytt. Gir null når det gikk, ellers en feil. */
  hentPaaNytt: () => Promise<Feil | null>;
}) {
  const [produkter, setProdukter] = useState<Produkt[] | null>(null);
  const [koblinger, setKoblinger] = useState<KoblingRad[] | null>(null);
  const [ordrer, setOrdrer] = useState<ApenOrdre[] | null>(null);
  const [laster, setLaster] = useState(false);
  const [lastefeil, setLastefeil] = useState<Feil | null>(null);
  const [valg, setValg] = useState<Valg>(null);
  const [fase, setFase] = useState<Fase>("forhand");
  const [sendefeil, setSendefeil] = useState<Feil | null>(null);
  const [resultat, setResultat] = useState<LeggPaaOrdreSvar | null>(null);
  // Linjene slik de ble sendt: tekstlinjene har ikke navn i svaret, og tabellen hentes på nytt etterpå.
  const [sendteLinjer, setSendteLinjer] = useState<Ordrelinje[]>([]);
  const [oppdatering, setOppdatering] = useState<"venter" | "ok" | Feil | null>(null);
  // Sendingene på prosjektet: en uavklart sending sperrer nye (også etter at dialogen er lukket og åpnet igjen).
  const [sendingsvar, setSendingsvar] = useState<Sendingsvar | null>(null);
  const [sendingSjekkTid, setSendingSjekkTid] = useState(0);
  // Feil fra å hente tabellen på nytt etter en endring under Sendinger.
  const [tabellvarsel, setTabellvarsel] = useState<Feil | null>(null);
  const [koblingerAapen, setKoblingerAapen] = useState(false);
  const [sendingerAapen, setSendingerAapen] = useState(false);
  const sender = useRef(false);
  const generasjon = useRef(0);

  const last = useCallback(async () => {
    const gen = ++generasjon.current;
    setLaster(true);
    setLastefeil(null);
    try {
      const [p, k, o] = await Promise.all([
        hentTripletexProdukter(),
        hentKoblinger(),
        hentApneOrdrer({ data: { prosjekt: kilde.nummer } }),
      ]);
      if (gen !== generasjon.current) return;
      const feil = [p, k, o].find((s) => !s.ok);
      if (feil && !feil.ok) {
        setLastefeil({ feil: feil.feil, loggInn: !!feil.loggInn });
        return;
      }
      if (p.ok) setProdukter(p.produkter);
      if (k.ok) setKoblinger(k.koblinger);
      if (o.ok) {
        setOrdrer(o.ordrer);
        // Uten åpne ordrer finnes bare ett valg. Ellers må brukeren velge selv.
        if (o.ordrer.length === 0) setValg("ny");
      }
    } catch (e) {
      if (gen !== generasjon.current) return;
      console.error("Henting til forhåndsvisningen feilet:", e instanceof Error ? e.message : "ukjent feil");
      setLastefeil({ feil: "Kunne ikke hente produkter og ordrer fra Tripletex. Prøv igjen." });
    } finally {
      if (gen === generasjon.current) setLaster(false);
    }
  }, [kilde.nummer]);

  const lastSendinger = useCallback(async () => {
    let svar: Sendingsvar;
    try {
      const s = await hentSendinger({ data: { prosjekt: kilde.nummer } });
      svar = s.ok ? { ok: true, sendinger: s.sendinger } : { ok: false, feil: s.feil, loggInn: !!s.loggInn };
    } catch (e) {
      console.error("Henting av sendinger feilet:", e instanceof Error ? e.message : "ukjent feil");
      svar = { ok: false, feil: "Kunne ikke hente sendingene. Prøv igjen." };
    }
    setSendingsvar(svar);
    setSendingSjekkTid(Date.now());
  }, [kilde.nummer]);

  const oppdaterTabell = useCallback(async (): Promise<Feil | null> => {
    try {
      return await hentPaaNytt();
    } catch (e) {
      console.error("Henting av timene på nytt feilet:", e instanceof Error ? e.message : "ukjent feil");
      return { feil: "Kunne ikke hente timene på nytt." };
    }
  }, [hentPaaNytt]);

  const lastKoblinger = useCallback(async () => {
    try {
      const k = await hentKoblinger();
      if (k.ok) setKoblinger(k.koblinger);
    } catch {
      // Forhåndsvisningen beholder de gamle koblingene; neste åpning henter dem.
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setProdukter(null);
    setKoblinger(null);
    setOrdrer(null);
    setValg(null);
    setFase("forhand");
    setSendefeil(null);
    setResultat(null);
    setSendteLinjer([]);
    setOppdatering(null);
    setSendingsvar(null);
    setTabellvarsel(null);
    void last();
    void lastSendinger();
  }, [open, last, lastSendinger]);

  const sendingsperre = useMemo(
    () => (sendingsvar ? sendingSperre(sendingsvar, sendingSjekkTid) : null),
    [sendingsvar, sendingSjekkTid],
  );

  const beregnet = useMemo((): { b: Ordreberegning } | { feil: string } | null => {
    if (!produkter || !koblinger) return null;
    try {
      return { b: beregnOrdrelinjer(rows, columns, koblinger.map(tilKobling), produkter) };
    } catch (e) {
      return { feil: e instanceof Error ? e.message : String(e) };
    }
  }, [rows, columns, koblinger, produkter]);

  const vurdering = useMemo(() => {
    if (!beregnet || !("b" in beregnet)) return null;
    return vurderForhandsvisning(beregnet.b, {
      alleredeSendt: alleredeSendte(rows, tripletexKey, beregnet.b.timerIder),
      skjulteKolonner: skjulteFaktureringskolonner(
        rows,
        columns,
        synlige,
        (koblinger ?? []).map(tilKobling),
        beregnet.b.advarsler.somGrunnarbeider > 0,
      ),
    });
  }, [beregnet, rows, columns, synlige, tripletexKey, koblinger]);

  const valgtOrdre = typeof valg === "number" ? ordrer?.find((o) => o.id === valg) ?? null : null;
  const kanSende =
    fase === "forhand" &&
    !laster &&
    !lastefeil &&
    // Fail closed: uten svar fra sendingslisten sendes ingenting.
    sendingsvar !== null &&
    sendingsperre === null &&
    ordrer !== null &&
    valg !== null &&
    !!beregnet &&
    "b" in beregnet &&
    !!vurdering &&
    vurdering.sperrer.length === 0;

  const send = async () => {
    // Dobbeltklikk-vern: ref-en settes før noe venter, så et klikk til i samme øyeblikk ser den.
    if (sender.current || !kanSende || !beregnet || !("b" in beregnet) || valg === null) return;
    sender.current = true;
    setFase("sender");
    setSendefeil(null);
    try {
      let inn;
      try {
        const { data, filnavn } = await lagPdf();
        const pdf = tilBase64(data);
        if (pdfForStor(pdf)) {
          setSendefeil({ feil: PDF_FOR_STOR });
          setFase("forhand");
          return;
        }
        const p = leggPaaOrdreInn.safeParse(
          byggLeggPaaOrdre({
            prosjekt: kilde.nummer,
            ordre: valg === "ny" ? { ny: true } : { id: valg },
            beregning: beregnet.b,
            pdf,
            filnavn,
            periode: { fra: kilde.fra, til: kilde.til },
          }),
        );
        if (!p.success) {
          setSendefeil({ feil: forklarInndatafeil(p.error.issues) });
          setFase("forhand");
          return;
        }
        inn = p.data;
        setSendteLinjer(beregnet.b.linjer);
      } catch (e) {
        // Ingenting er sendt ennå: trygt å prøve igjen.
        setSendefeil({ feil: `Kunne ikke lage PDF-en: ${e instanceof Error ? e.message : String(e)}` });
        setFase("forhand");
        return;
      }

      let svar;
      try {
        svar = await leggPaaOrdre({ data: inn });
      } catch (e) {
        // Forespørselen kan ha nådd fram: behandles som ukjent utfall, aldri «prøv igjen».
        console.error("Legg på ordre feilet:", e instanceof Error ? e.message : "ukjent feil");
        setSendefeil({ feil: UKJENT_UTFALL_FEIL });
        setFase("uavklart");
        return;
      }
      if (!svar.ok) {
        setSendefeil({ feil: svar.feil, loggInn: !!svar.loggInn });
        setFase(svar.ukjentUtfall ? "uavklart" : "forhand");
        return;
      }
      setResultat(svar.sending);
      setFase("resultat");
      // Tabellen hentes på nytt så Tripletex-kolonnen viser ordren.
      setOppdatering("venter");
      const f = await oppdaterTabell();
      setOppdatering(f ?? "ok");
    } finally {
      sender.current = false;
    }
  };

  const produktnavn = (id: number) => produkter?.find((p) => p.id === id)?.navn ?? `Produkt ${id}`;
  const knappetekst =
    valg === "ny" ? "Legg på ny ordre" : valgtOrdre ? `Legg på ordre ${valgtOrdre.nummer}` : "Legg på ordre";

  const bunn =
    fase === "resultat" || fase === "uavklart" ? (
      <>
        {fase === "resultat" && (
          <button type="button" className={`${knappLys} mr-auto`} onClick={() => setSendingerAapen(true)}>
            Sendinger
          </button>
        )}
        <button type="button" className={knappMork} onClick={() => onOpenChange(false)}>
          Lukk
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          className={`${knappLys} mr-auto`}
          onClick={() => setSendingerAapen(true)}
          disabled={fase === "sender"}
        >
          Sendinger
        </button>
        {fase === "forhand" && (sendingsperre || vurdering?.sperrer.length || (beregnet && "feil" in beregnet)) ? (
          <span className="text-xs font-medium text-red-700">Kan ikke sendes før det som står i rødt er rettet.</span>
        ) : fase === "forhand" && !laster && ordrer && valg === null ? (
          <span className="text-xs text-[#4a4a4a]/80">Velg ordre først.</span>
        ) : null}
        <button type="button" className={knappLys} onClick={() => onOpenChange(false)} disabled={fase === "sender"}>
          Avbryt
        </button>
        <button type="button" className={knappMork} onClick={() => void send()} disabled={!kanSende}>
          {fase === "sender" ? (
            <>
              <Spinner lys /> Legger på ordre…
            </>
          ) : (
            knappetekst
          )}
        </button>
      </>
    );

  return (
    <SmartdokDialog
      open={open}
      onOpenChange={onOpenChange}
      laast={fase === "sender"}
      tittel="Legg på ordre i Tripletex"
      beskrivelse={`Prosjekt ${kilde.nummer} ${kilde.navn} · ${fmtDato(kilde.fra)}–${fmtDato(kilde.til)}`}
      bunn={bunn}
    >
      {fase === "resultat" && resultat && (
        <Resultat
          r={resultat}
          navn={resultatnavn(resultat.linjer, sendteLinjer, produktnavn)}
          oppdatering={oppdatering}
          onSendinger={() => setSendingerAapen(true)}
        />
      )}

      {fase === "uavklart" && sendefeil && (
        <div role="alert" className="space-y-3 rounded-lg border-2 border-red-400 bg-red-50 px-5 py-4 text-red-900">
          <p className="text-base font-bold">Vi vet ikke om linjene kom inn i Tripletex</p>
          <p className="text-sm">{sendefeil.feil}</p>
          <p className="text-sm">
            Ikke send timene på nytt. Åpne «Sendinger», trykk «Sjekk i Tripletex» på sendingen og velg så «Merk som sendt»
            eller «Frigi timene».
          </p>
          <button type="button" className={knappMork} onClick={() => setSendingerAapen(true)}>
            Åpne Sendinger
          </button>
        </div>
      )}

      {tabellvarsel && <Feilmelding tone="advarsel" feil={tabellvarsel.feil} loggInn={tabellvarsel.loggInn} />}

      {(fase === "forhand" || fase === "sender") && (
        <>
          {sendingsperre && (
            <div role="alert" className="space-y-2 rounded-lg border-2 border-red-400 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p className="font-semibold">{sendingsperre.tekst}</p>
              {sendingsperre.loggInn ? (
                <Link to="/logg-inn" className="font-medium underline underline-offset-2">
                  Gå til innlogging
                </Link>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sendingsperre.id === "uavklart" ? (
                    <button type="button" className={`${knappMork} py-1.5 text-xs`} onClick={() => setSendingerAapen(true)}>
                      Åpne Sendinger
                    </button>
                  ) : (
                    <button type="button" className={`${knappLys} py-1.5 text-xs`} onClick={() => void lastSendinger()}>
                      Prøv igjen
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {laster && (
            <p className="flex items-center gap-2 text-sm text-[#4a4a4a]" role="status">
              <Spinner /> Henter produkter, koblinger og åpne ordrer fra Tripletex…
            </p>
          )}
          {lastefeil && (
            <div className="space-y-2">
              <Feilmelding feil={lastefeil.feil} loggInn={lastefeil.loggInn} />
              {!lastefeil.loggInn && (
                <button type="button" className={knappLys} onClick={() => void last()} disabled={laster}>
                  Prøv igjen
                </button>
              )}
            </div>
          )}

          {ordrer && (
            <Ordrevalg ordrer={ordrer} valg={valg} onValg={setValg} laast={fase === "sender"} />
          )}

          {beregnet && "feil" in beregnet && (
            <Varsel tone="feil" tittel="Kan ikke regne ut linjene" alert>
              <p>{beregnet.feil}</p>
            </Varsel>
          )}

          {beregnet && "b" in beregnet && vurdering && (
            <>
              <Linjer b={beregnet.b} />
              <p className="text-xs text-[#4a4a4a]/80">
                {beregnet.b.timerIder.length}{" "}
                {beregnet.b.timerIder.length === 1 ? "timeregistrering merkes" : "timeregistreringer merkes"} som sendt i
                SmartDok. PDF-en med {rows.length}{" "}
                {rows.length === 1 ? "rad" : "rader"} (den samme som «Last ned PDF» lager) legges ved ordren.
              </p>
              {(vurdering.sperrer.length > 0 || vurdering.sjekk.length > 0 || vurdering.advarsler.length > 0) && (
                <div className="space-y-2">
                  {vurdering.sperrer.map((m) => (
                    <Varsel key={m.id} tone="feil">
                      <p>{m.tekst}</p>
                    </Varsel>
                  ))}
                  {vurdering.sjekk.length > 0 && (
                    <Varsel tone="advarsel" tittel={SJEKK_I_TRIPLETEX}>
                      <ul className="list-disc space-y-1 pl-5">
                        {vurdering.sjekk.map((m) => (
                          <li key={m.id}>{m.tekst}</li>
                        ))}
                      </ul>
                      {vurdering.sjekk.some((m) => m.id === "utenKobling") && (
                        <button type="button" className={`${knappLys} py-1.5 text-xs`} onClick={() => setKoblingerAapen(true)}>
                          Åpne koblingslisten
                        </button>
                      )}
                    </Varsel>
                  )}
                  {vurdering.advarsler.map((m) => (
                    <Varsel key={m.id} tone="advarsel">
                      <p>{m.tekst}</p>
                    </Varsel>
                  ))}
                </div>
              )}
            </>
          )}

          {sendefeil && fase === "forhand" && <Feilmelding feil={sendefeil.feil} loggInn={sendefeil.loggInn} />}
        </>
      )}

      <Koblingsliste
        open={koblingerAapen}
        onOpenChange={setKoblingerAapen}
        bareMangler
        onEndret={() => void lastKoblinger()}
      />
      <Sendinger
        open={sendingerAapen}
        onOpenChange={(o) => {
          setSendingerAapen(o);
          // Etter avklaring kan sperren være borte: sjekk listen på nytt.
          if (!o) void lastSendinger();
        }}
        prosjekt={{ nummer: kilde.nummer, navn: kilde.navn }}
        onEndret={() => {
          void lastSendinger();
          void oppdaterTabell().then(setTabellvarsel);
        }}
      />
    </SmartdokDialog>
  );
}

function Ordrevalg({
  ordrer,
  valg,
  onValg,
  laast,
}: {
  ordrer: ApenOrdre[];
  valg: Valg;
  onValg: (v: Valg) => void;
  laast: boolean;
}) {
  const kort = (aktiv: boolean) =>
    `flex cursor-pointer gap-3 rounded-lg border-2 px-4 py-3 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#4a4a4a] ${
      aktiv ? "border-[#4a4a4a] bg-[#fff7d6]" : "border-[#ecd27a] bg-white hover:bg-[#fffbea]"
    }`;
  return (
    <fieldset disabled={laast} className="space-y-2">
      <legend className={`${etikett} mb-2`}>Hvilken ordre?</legend>
      <label className={kort(valg === "ny")}>
        <input
          type="radio"
          name="ordrevalg"
          checked={valg === "ny"}
          onChange={() => onValg("ny")}
          className="mt-1 h-4 w-4 accent-[#4a4a4a]"
        />
        <span>
          <span className="block text-sm font-bold text-[#2b2b2b]">Ny ordre</span>
          <span className="block text-xs text-neutral-600">
            Lages i Tripletex med dagens dato, og med kunde og prosjekt fra prosjektet der.
          </span>
        </span>
      </label>
      {ordrer.length === 0 && <p className="px-1 text-xs text-neutral-500">Ingen åpne ordrer på prosjektet i Tripletex.</p>}
      {ordrer.map((o) => (
        <label key={o.id} className={kort(valg === o.id)}>
          <input
            type="radio"
            name="ordrevalg"
            checked={valg === o.id}
            onChange={() => onValg(o.id)}
            className="mt-1 h-4 w-4 accent-[#4a4a4a]"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-[#2b2b2b]">
              Ordre {o.nummer}
              <span className="ml-2 font-normal text-neutral-600">{fmtDato(o.dato)}</span>
            </span>
            {o.linjer.length === 0 ? (
              <span className="block text-xs text-neutral-500">Ingen linjer fra før.</span>
            ) : (
              <>
                <span className="block text-xs text-neutral-600">
                  {o.linjer.length} {o.linjer.length === 1 ? "linje" : "linjer"} fra før (nye linjer legges til under dem):
                </span>
                <ul className="mt-1 max-h-28 overflow-y-auto text-xs text-neutral-700">
                  {o.linjer.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 border-b border-dotted border-neutral-200 py-0.5">
                      <span className="truncate">{l.produktnavn}</span>
                      <span className="shrink-0 tabular-nums">{fmtAntall(l.antall)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Linjer({ b }: { b: Ordreberegning }) {
  if (b.linjer.length === 0) return null;
  const total = totalsum(b.linjer.map((l) => ({ antall: l.antall, pris: l.listepris })));
  return (
    <section aria-labelledby="linjer-tittel" className="space-y-2">
      <h3 id="linjer-tittel" className={etikett}>
        Linjer som legges inn
      </h3>
      <div className="overflow-x-auto rounded-lg border border-[#ecd27a]">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="bg-[#fff7d6] text-left text-xs text-[#4a4a4a]">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Produkt</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Antall</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Listepris</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Sum</th>
            </tr>
          </thead>
          <tbody>
            {b.linjer.map((l) => (
              <tr key={l.produktId ?? `tekst:${l.produktnavn}`} className="border-t border-[#f0e3b0]">
                <td className="px-3 py-2">
                  <span className="font-medium">{l.produktnavn}</span>
                  {l.produktId === null && <UtenProdukt />}
                  <span className="block text-xs text-neutral-500">{l.tekst}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtAntall(l.antall)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.listepris ? (
                    fmtKr(l.listepris)
                  ) : (
                    <span className="text-xs font-semibold text-amber-800">0 kr – sett pris i Tripletex</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.listepris ? fmtKr(linjesum(l.antall, l.listepris)) : fmtKr(0)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#4a4a4a] bg-[#fffbea]">
              <th scope="row" colSpan={3} className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-[#4a4a4a]">
                Sum eks. mva. (listepris)
              </th>
              <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtKr(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-[#4a4a4a]/80">
        Prisene er listepriser fra produktene. Har kunden egen pris eller rabatt i Tripletex, bruker Tripletex den når linjene
        legges inn; de faktiske prisene vises etterpå. Ordren godkjennes i Tripletex før den faktureres.
      </p>
    </section>
  );
}

/** Merke på en tekstlinje: linjen har ikke produkt i Tripletex. */
function UtenProdukt() {
  return (
    <span className="ml-2 inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-800">
      uten produkt
    </span>
  );
}

function Resultat({
  r,
  navn,
  oppdatering,
  onSendinger,
}: {
  r: LeggPaaOrdreSvar;
  /** Navnet på hver linje i r.linjer, i samme rekkefølge (resultatnavn). */
  navn: string[];
  oppdatering: "venter" | "ok" | Feil | null;
  onSendinger: () => void;
}) {
  const t = statusTekst(r.status);
  const total = totalsum(r.linjer.map((l) => ({ antall: l.antall, pris: l.pris, rabatt: l.rabatt })));
  const ukjent = r.status === "ukjent_utfall";
  return (
    <div className="space-y-4">
      <div
        role={ukjent ? "alert" : "status"}
        className={`rounded-lg px-5 py-4 ${ukjent ? "border-2 border-red-400 bg-red-50 text-red-900" : "border border-[#e6c24a] bg-[#fff7d6] text-[#2b2b2b]"}`}
      >
        <p className="text-base font-bold">
          {r.ordrenummer ? `Ordre ${r.ordrenummer}` : "Uten ordrenummer"} · {t.tittel}
        </p>
        <p className="mt-1 text-sm">{t.forklaring}</p>
        {r.melding && <p className="mt-2 text-sm font-medium">{r.melding}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {r.ordreId !== null && (
            <a
              href={tripletexOrdreUrl(r.ordreId)}
              target="_blank"
              rel="noopener noreferrer"
              className={knappMork}
            >
              Åpne ordre {r.ordrenummer ?? ""} i Tripletex <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">(åpnes i ny fane)</span>
            </a>
          )}
          {(ukjent || r.status === "sendt_uten_merke") && (
            <button type="button" className={knappLys} onClick={onSendinger}>
              Åpne Sendinger
            </button>
          )}
        </div>
      </div>

      {r.linjer.length > 0 && (
        <section aria-labelledby="lagt-inn-tittel" className="space-y-2">
          <h3 id="lagt-inn-tittel" className={etikett}>
            Lagt inn i Tripletex
          </h3>
          <div className="overflow-x-auto rounded-lg border border-[#ecd27a]">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-[#fff7d6] text-left text-xs text-[#4a4a4a]">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Produkt</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Antall</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Pris</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Rabatt</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Sum</th>
                </tr>
              </thead>
              <tbody>
                {r.linjer.map((l, i) => (
                  <tr key={`${l.produktId ?? "tekst"}-${i}`} className="border-t border-[#f0e3b0]">
                    <td className="px-3 py-2 font-medium">
                      {navn[i]}
                      {l.produktId === null && <UtenProdukt />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtAntall(l.antall)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l.pris ? (
                        fmtKr(l.pris)
                      ) : (
                        <span className="text-xs font-semibold text-amber-800">0 kr – sett pris i Tripletex</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.rabatt ? `${fmtAntall(l.rabatt)} %` : "–"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtKr(linjesum(l.antall, l.pris, l.rabatt))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#4a4a4a] bg-[#fffbea]">
                  <th scope="row" colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-[#4a4a4a]">
                    Sum eks. mva.
                  </th>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtKr(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-[#4a4a4a]/80">Summen er regnet ut her; fakturaen i Tripletex er fasit.</p>
        </section>
      )}

      <p className="flex items-center gap-2 text-xs text-[#4a4a4a]" role="status">
        {oppdatering === "venter" && (
          <>
            <Spinner /> Henter timene fra SmartDok på nytt…
          </>
        )}
        {oppdatering === "ok" && "Timetabellen er hentet på nytt, og Tripletex-kolonnen viser ordren."}
      </p>
      {oppdatering && typeof oppdatering === "object" && (
        <Feilmelding
          tone="advarsel"
          feil={`${oppdatering.feil} Ikke send noe mer før timene er hentet på nytt.`}
          loggInn={oppdatering.loggInn}
        />
      )}
    </div>
  );
}
