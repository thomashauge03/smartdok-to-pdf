import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Tone } from "@/lib/tripletex-visning";

// Felles ramme for Tripletex-dialogene, i SmartDok-panelets farger: gult
// #FFDC59, grått #4A4A4A og lysegult #FFF7D6.

export const knappMork =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#4a4a4a] px-4 py-2 text-sm font-bold text-[#ffdc59] shadow-sm transition hover:bg-[#333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a4a4a] disabled:cursor-not-allowed disabled:opacity-50";
export const knappLys =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-[#d9bf5c] bg-white px-3 py-2 text-sm font-medium text-[#4a4a4a] transition hover:bg-[#fff7d6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a4a4a] disabled:cursor-not-allowed disabled:opacity-50";
export const knappFare =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50";
export const etikett = "text-[11px] font-bold uppercase tracking-widest text-[#4a4a4a]/70";

export function Spinner({ lys = false }: { lys?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 motion-reduce:animate-none ${
        lys ? "border-[#ffdc59]/30 border-t-[#ffdc59]" : "border-[#4a4a4a]/25 border-t-[#4a4a4a]"
      }`}
    />
  );
}

const TONE: Record<Tone, string> = {
  ok: "border-green-300 bg-green-50 text-green-900",
  advarsel: "border-amber-300 bg-amber-50 text-amber-900",
  feil: "border-red-300 bg-red-50 text-red-800",
  noytral: "border-neutral-200 bg-neutral-50 text-neutral-800",
};

export function Varsel({
  tone,
  tittel,
  children,
  alert = false,
}: {
  tone: Tone;
  tittel?: ReactNode;
  children?: ReactNode;
  alert?: boolean;
}) {
  return (
    <div role={alert ? "alert" : undefined} className={`rounded-lg border px-4 py-3 text-sm ${TONE[tone]}`}>
      {tittel && <p className="font-bold">{tittel}</p>}
      {children && <div className={tittel ? "mt-1 space-y-2" : "space-y-2"}>{children}</div>}
    </div>
  );
}

/** Feilmelding fra et Svar, med lenke til innlogging når økta er ute. */
export function Feilmelding({ feil, loggInn, tone = "feil" }: { feil: string; loggInn?: boolean; tone?: Tone }) {
  return (
    <Varsel tone={tone} alert={tone === "feil"}>
      <p>
        {feil}
        {loggInn && (
          <>
            {" "}
            <Link to="/logg-inn" className="font-medium underline underline-offset-2">
              Gå til innlogging
            </Link>
          </>
        )}
      </p>
    </Varsel>
  );
}

export function SmartdokDialog({
  open,
  onOpenChange,
  tittel,
  beskrivelse,
  children,
  bunn,
  laast = false,
  onEscape,
  bredde = "max-w-3xl",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tittel: string;
  beskrivelse?: ReactNode;
  children: ReactNode;
  bunn?: ReactNode;
  /** Mens noe sendes: dialogen kan ikke lukkes, så svaret ikke går tapt. */
  laast?: boolean;
  /** Returnerer true når Escape ble brukt til noe annet enn å lukke dialogen. */
  onEscape?: () => boolean;
  bredde?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (laast && !o ? undefined : onOpenChange(o))}>
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (laast || onEscape?.()) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (laast) e.preventDefault();
        }}
        className={`flex max-h-[min(92vh,56rem)] w-[calc(100%-2rem)] ${bredde} flex-col gap-0 overflow-hidden rounded-xl border-[#e6c24a] bg-white p-0 text-[#2b2b2b] sm:rounded-xl`}
      >
        <div className="border-b border-[#e6c24a] bg-[#ffdc59] py-4 pl-6 pr-12 text-[#4a4a4a]">
          <DialogTitle className="text-base font-bold tracking-tight">{tittel}</DialogTitle>
          {beskrivelse ? (
            <DialogDescription className="mt-1 text-xs text-[#4a4a4a]/80">{beskrivelse}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{tittel}</DialogDescription>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">{children}</div>
        {bunn && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#e6c24a] bg-[#fff7d6] px-6 py-3">
            {bunn}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
