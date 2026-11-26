import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Feilmelding,
  SmartdokDialog,
  Spinner,
  etikett,
  knappLys,
  knappMork,
} from "@/components/SmartdokDialog";
import { hentKoblinger, hentSmartdokMaskiner, hentTripletexProdukter, lagreKobling } from "@/lib/tripletex.functions";
import type { Produkt } from "@/lib/ordrelinjer";
import type { LagreKoblingInn } from "@/lib/tripletex";
import {
  angreInn,
  fmtKr,
  koblingsrader,
  lagreInn,
  treffer,
  type KoblingRad,
  type Koblingsrad,
  type Maskin,
} from "@/lib/tripletex-visning";

type Feil = { feil: string; loggInn?: boolean };

/**
 * Koblingslisten: hver aktive SmartDok-maskin peker på ett Tripletex-produkt
 * eller er «Faktureres ikke». Forslag vises, men lagres bare når brukeren
 * trykker «Godkjenn».
 */
export function Koblingsliste({
  open,
  onOpenChange,
  bareMangler = false,
  onEndret,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Start med bare maskinene som mangler kobling (fra advarselen i forhåndsvisningen). */
  bareMangler?: boolean;
  onEndret?: () => void;
}) {
  const [maskiner, setMaskiner] = useState<Maskin[] | null>(null);
  const [koblinger, setKoblinger] = useState<KoblingRad[] | null>(null);
  const [produkter, setProdukter] = useState<Produkt[] | null>(null);
  const [laster, setLaster] = useState(false);
  const [lastefeil, setLastefeil] = useState<Feil | null>(null);
  const [sok, setSok] = useState("");
  const [visBareMangler, setVisBareMangler] = useState(bareMangler);
  const [lagrer, setLagrer] = useState<Record<number, boolean>>({});
  const [radfeil, setRadfeil] = useState<Record<number, Feil>>({});
  const [velgerFor, setVelgerFor] = useState<number | null>(null);
  // Lagret i denne runden: blir stående synlige med «Lagret», også under «Bare de som mangler».
  const [lagretNaa, setLagretNaa] = useState<Set<number>>(new Set());
  const generasjon = useRef(0);
  // Rett etter «Faktureres ikke»: den forrige koblingen, så «Angre» kan legge den tilbake i noen sekunder.
  const [angre, setAngre] = useState<Record<number, KoblingRad>>({});
  const angreTimere = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const glemAngre = useCallback((id: number) => {
    const t = angreTimere.current.get(id);
    if (t) clearTimeout(t);
    angreTimere.current.delete(id);
    setAngre(({ [id]: _, ...rest }) => rest);
  }, []);

  useEffect(() => {
    const timere = angreTimere.current;
    return () => timere.forEach((t) => clearTimeout(t));
  }, []);

  const last = useCallback(async () => {
    const gen = ++generasjon.current;
    setLaster(true);
    setLastefeil(null);
    try {
      const [m, k, p] = await Promise.all([hentSmartdokMaskiner(), hentKoblinger(), hentTripletexProdukter()]);
      if (gen !== generasjon.current) return;
      const feil = [m, k, p].find((s) => !s.ok);
      if (feil && !feil.ok) {
        setLastefeil({ feil: feil.feil, loggInn: !!feil.loggInn });
        return;
      }
      if (m.ok) setMaskiner(m.maskiner);
      if (k.ok) setKoblinger(k.koblinger);
      if (p.ok) setProdukter(p.produkter);
    } catch (e) {
      if (gen !== generasjon.current) return;
      console.error("Henting til koblingslisten feilet:", e instanceof Error ? e.message : "ukjent feil");
      setLastefeil({ feil: "Kunne ikke hente maskiner og produkter. Prøv igjen." });
    } finally {
      if (gen === generasjon.current) setLaster(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSok("");
    setVisBareMangler(bareMangler);
    setRadfeil({});
    setVelgerFor(null);
    setLagretNaa(new Set());
    angreTimere.current.forEach((t) => clearTimeout(t));
    angreTimere.current.clear();
    setAngre({});
    void last();
  }, [open, bareMangler, last]);

  const rader = useMemo(
    () => (maskiner && koblinger && produkter ? koblingsrader(maskiner, koblinger, produkter) : null),
    [maskiner, koblinger, produkter],
  );
  const synlige = useMemo(
    () => (rader ?? []).filter((r) => treffer(r, sok) && (!visBareMangler || r.mangler || lagretNaa.has(r.maskinId))),
    [rader, sok, visBareMangler, lagretNaa],
  );
  const antallMangler = rader?.filter((r) => r.mangler && r.aktiv).length ?? 0;

  const lagre = (rad: Koblingsrad, valg: { faktureres: false } | { produkt: Produkt }) => {
    const forrige = koblinger?.find((k) => k.maskin_id === rad.maskinId);
    // Angre gir bare mening når det fantes en kobling til et produkt å gå tilbake til.
    const angreTil = "faktureres" in valg && forrige?.faktureres && forrige.produkt_id !== null ? forrige : null;
    void skriv(lagreInn(rad, valg), angreTil);
  };

  const skriv = async (inn: LagreKoblingInn, angreTil: KoblingRad | null) => {
    const id = inn.maskinId;
    if (lagrer[id]) return;
    glemAngre(id);
    setLagrer((s) => ({ ...s, [id]: true }));
    setRadfeil(({ [id]: _, ...rest }) => rest);
    try {
      const svar = await lagreKobling({ data: inn });
      if (!svar.ok) {
        setRadfeil((s) => ({ ...s, [id]: { feil: svar.feil, loggInn: !!svar.loggInn } }));
        return;
      }
      const ny: KoblingRad = {
        maskin_id: inn.maskinId,
        maskinnavn: inn.maskinnavn,
        faktureres: inn.faktureres,
        produkt_id: inn.produktId,
        produktnummer: inn.produktnummer,
        produktnavn: inn.produktnavn,
      };
      setKoblinger((ks) => [...(ks ?? []).filter((k) => k.maskin_id !== ny.maskin_id), ny]);
      setVelgerFor(null);
      setLagretNaa((s) => new Set(s).add(ny.maskin_id));
      if (angreTil) {
        setAngre((a) => ({ ...a, [id]: angreTil }));
        angreTimere.current.set(id, setTimeout(() => glemAngre(id), 8000));
      }
      onEndret?.();
    } catch (e) {
      console.error("Lagring av kobling feilet:", e instanceof Error ? e.message : "ukjent feil");
      setRadfeil((s) => ({ ...s, [id]: { feil: "Kunne ikke lagre koblingen. Prøv igjen." } }));
    } finally {
      setLagrer(({ [id]: _, ...rest }) => rest);
    }
  };

  return (
    <SmartdokDialog
      open={open}
      onOpenChange={onOpenChange}
      tittel="Koblingsliste: maskin → produkt"
      beskrivelse="Hver maskin i SmartDok peker på ett produkt i Tripletex, eller faktureres ikke. En maskin uten kobling legges på ordren som tekstlinje uten produkt. Forslag lagres bare når du trykker «Godkjenn»."
      onEscape={() => {
        if (velgerFor === null) return false;
        setVelgerFor(null);
        return true;
      }}
      bunn={
        <button type="button" className={knappMork} onClick={() => onOpenChange(false)}>
          Ferdig
        </button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="kobling-sok" className={`${etikett} mb-1.5 block`}>
            Søk
          </label>
          <input
            id="kobling-sok"
            type="search"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            placeholder="Maskin, nummer, kategori eller produkt"
            className="w-full rounded-lg border-2 border-[#ecd27a] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#4a4a4a] focus:ring-3 focus:ring-[#ffdc59]/60"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-[#4a4a4a]">
          <input
            type="checkbox"
            checked={visBareMangler}
            onChange={(e) => setVisBareMangler(e.target.checked)}
            className="h-4 w-4 accent-[#4a4a4a]"
          />
          Bare de som mangler kobling
        </label>
      </div>

      {laster && !rader && (
        <p className="flex items-center gap-2 text-sm text-[#4a4a4a]" role="status">
          <Spinner /> Henter maskiner fra SmartDok og produkter fra Tripletex…
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

      {rader && (
        <>
          <p className="text-xs text-[#4a4a4a]/80" role="status">
            {rader.filter((r) => r.aktiv).length} aktive maskiner ·{" "}
            {antallMangler === 0 ? "alle er koblet" : `${antallMangler} mangler kobling`}
            {visBareMangler || sok ? ` · viser ${synlige.length}` : ""}
          </p>
          {synlige.length === 0 ? (
            <p className="rounded-lg bg-[#fff7d6] px-4 py-6 text-center text-sm text-[#4a4a4a]">
              {visBareMangler && !sok ? "Alle maskinene er koblet." : "Ingen maskiner passer søket."}
            </p>
          ) : (
            <ul className="divide-y divide-[#f0e3b0] rounded-lg border border-[#ecd27a]">
              {synlige.map((r) => (
                <KoblingsRad
                  key={r.maskinId}
                  rad={r}
                  produkter={produkter ?? []}
                  lagrer={!!lagrer[r.maskinId]}
                  feil={radfeil[r.maskinId] ?? null}
                  lagret={lagretNaa.has(r.maskinId)}
                  velgerAapen={velgerFor === r.maskinId}
                  onVelger={(aapen) => setVelgerFor(aapen ? r.maskinId : null)}
                  onLagre={(valg) => lagre(r, valg)}
                  angre={angre[r.maskinId] ?? null}
                  onAngre={() => {
                    const forrige = angre[r.maskinId];
                    if (forrige) void skriv(angreInn(forrige), null);
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </SmartdokDialog>
  );
}

function KoblingsRad({
  rad,
  produkter,
  lagrer,
  feil,
  lagret,
  velgerAapen,
  onVelger,
  onLagre,
  angre,
  onAngre,
}: {
  rad: Koblingsrad;
  produkter: Produkt[];
  lagrer: boolean;
  feil: Feil | null;
  lagret: boolean;
  velgerAapen: boolean;
  onVelger: (aapen: boolean) => void;
  onLagre: (valg: { faktureres: false } | { produkt: Produkt }) => void;
  /** Koblingen før «Faktureres ikke», mens «Angre» vises. */
  angre: KoblingRad | null;
  onAngre: () => void;
}) {
  const l = rad.lagret;
  const faktureresIkke = !!l && !l.faktureres;
  const velgerId = `produktvelger-${rad.maskinId}`;

  return (
    <li className={`px-4 py-3 ${rad.mangler && rad.aktiv ? "bg-red-50/40" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-44 flex-1">
          <p className="text-sm font-semibold text-[#2b2b2b]">
            {rad.navn}
            {!rad.aktiv && (
              <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600">
                ikke aktiv
              </span>
            )}
          </p>
          {(rad.nummer || rad.kategori) && (
            <p className="text-xs text-neutral-500">{[rad.nummer, rad.kategori].filter(Boolean).join(" · ")}</p>
          )}
        </div>

        <div className="min-w-52 flex-[1.4] text-sm">
          {l && l.faktureres && l.produkt && (
            <p className="text-[#2b2b2b]">
              <span className="sr-only">Koblet til </span>→ {l.produkttekst}
              <span className="ml-2 whitespace-nowrap text-xs text-neutral-500">{l.produkt.pris ? fmtKr(l.produkt.pris) : "uten pris"}</span>
            </p>
          )}
          {faktureresIkke && <p className="font-medium text-neutral-600">Faktureres ikke</p>}
          {l?.produktBorte && (
            <p className="font-medium text-red-700">
              Produktet {l.produkttekst ? `«${l.produkttekst}» ` : ""}finnes ikke lenger i Tripletex. Velg et nytt.
            </p>
          )}
          {!l && (
            <p className="font-medium text-red-700">
              Mangler kobling <span className="font-normal text-neutral-600">(går som tekstlinje)</span>
            </p>
          )}
          <span role="status" className="mt-0.5 flex items-center gap-1.5 text-xs">
            {lagrer ? (
              <span className="flex items-center gap-1.5 text-[#4a4a4a]">
                <Spinner /> Lagrer…
              </span>
            ) : lagret && !feil ? (
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1 font-medium text-green-800">
                  <Check className="h-3.5 w-3.5" aria-hidden /> Lagret
                </span>
                {angre && (
                  <button
                    type="button"
                    onClick={onAngre}
                    className="rounded font-medium text-[#4a4a4a] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a4a4a]"
                    aria-label={`Angre: koble ${rad.navn} til ${[angre.produktnummer, angre.produktnavn].filter(Boolean).join(" ")} igjen`}
                  >
                    Angre
                  </button>
                )}
              </span>
            ) : null}
          </span>
          {rad.forslag && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-[#d9bf5c] bg-[#fff7d6] px-2.5 py-1.5">
              <span className="text-xs text-[#4a4a4a]">
                Forslag:{" "}
                <strong>
                  {"produkt" in rad.forslag ? `${rad.forslag.produkt.nummer} ${rad.forslag.produkt.navn}` : "Faktureres ikke"}
                </strong>
                {"produkt" in rad.forslag && (
                  <span className={`ml-1.5 whitespace-nowrap ${rad.forslag.produkt.pris ? "text-neutral-500" : "font-medium text-red-700"}`}>
                    {rad.forslag.produkt.pris ? fmtKr(rad.forslag.produkt.pris) : "uten pris"}
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={lagrer}
                onClick={() => rad.forslag && onLagre(rad.forslag)}
                className="rounded-md bg-[#4a4a4a] px-2.5 py-1 text-xs font-bold text-[#ffdc59] transition hover:bg-[#333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a4a4a] disabled:opacity-50"
                aria-label={`Godkjenn forslaget for ${rad.navn}`}
              >
                Godkjenn
              </button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${knappLys} py-1.5 text-xs`}
            aria-expanded={velgerAapen}
            aria-controls={velgerId}
            disabled={lagrer}
            onClick={() => onVelger(!velgerAapen)}
          >
            {l?.faktureres && l.produkt ? "Bytt produkt" : "Velg produkt"}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
          </button>
          <button
            type="button"
            aria-pressed={faktureresIkke}
            disabled={lagrer || faktureresIkke}
            title={faktureresIkke ? "Velg et produkt for å fakturere maskinen igjen" : undefined}
            onClick={() => onLagre({ faktureres: false })}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a4a4a] ${
              faktureresIkke
                ? "border-[#4a4a4a] bg-[#4a4a4a] text-white disabled:opacity-100"
                : "border-[#d9bf5c] bg-white text-[#4a4a4a] hover:bg-[#fff7d6] disabled:opacity-50"
            }`}
          >
            {faktureresIkke && <Check className="h-3.5 w-3.5" />}
            Faktureres ikke
          </button>
        </div>
      </div>

      {velgerAapen && (
        <div id={velgerId} className="mt-3 overflow-hidden rounded-lg border border-[#ecd27a] bg-white">
          <Command label={`Velg produkt for ${rad.navn}`}>
            <CommandInput placeholder="Søk etter produkt i Tripletex…" autoFocus />
            <CommandList className="max-h-64">
              <CommandEmpty>Ingen produkter funnet.</CommandEmpty>
              {produkter.map((p) => (
                <CommandItem key={p.id} value={`${p.nummer} ${p.navn} ${p.id}`} onSelect={() => onLagre({ produkt: p })}>
                  <span className="w-14 shrink-0 tabular-nums text-neutral-500">{p.nummer}</span>
                  <span className="flex-1 truncate">{p.navn}</span>
                  <span className={`ml-2 shrink-0 text-xs tabular-nums ${p.pris ? "text-neutral-500" : "text-red-700"}`}>
                    {p.pris ? fmtKr(p.pris) : "uten pris"}
                  </span>
                  {l?.produktId === p.id && l.faktureres && <Check className="ml-1 h-4 w-4 text-[#4a4a4a]" aria-label="valgt nå" />}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </div>
      )}

      {feil && (
        <div className="mt-2">
          <Feilmelding feil={feil.feil} loggInn={feil.loggInn} />
        </div>
      )}
    </li>
  );
}

