import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { hentInnlogging, loggInn } from "@/lib/innlogging.functions";
import { feilmelding } from "@/lib/innlogging";

export const Route = createFileRoute("/logg-inn")({
  validateSearch: (search: Record<string, unknown>): { "ingen-tilgang"?: 1 } =>
    search["ingen-tilgang"] === 1 || search["ingen-tilgang"] === "1" ? { "ingen-tilgang": 1 } : {},
  beforeLoad: async () => {
    const innlogging = await hentInnlogging();
    if (innlogging.status === "inne") throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [{ title: "Logg inn | SmartDok → PDF" }],
  }),
  component: LoggInn,
});

function LoggInn() {
  const router = useRouter();
  const search = Route.useSearch();
  const [feil, setFeil] = useState<string | null>(
    search["ingen-tilgang"] ? feilmelding("ingen-tilgang") : null,
  );
  const [venter, setVenter] = useState(false);

  // Verdiene leses fra skjemaet, ikke fra state, fordi nøkkelknappen fyller
  // feltene direkte i DOM-en.
  const sendInn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setVenter(true);
    setFeil(null);
    try {
      const svar = await loggInn({
        data: { epost: String(data.get("epost") ?? ""), passord: String(data.get("passord") ?? "") },
      });
      if (svar.ok) {
        // Invalider først, slik at beforeLoad på «/» kjører på nytt med den nye økta.
        await router.invalidate();
        await router.navigate({ to: "/" });
        return;
      }
      setFeil(feilmelding(svar.feil));
    } catch {
      setFeil(feilmelding("ukjent"));
    }
    setVenter(false);
  };

  return (
    <div className="min-h-screen" style={{ background: "#f0f0f0" }}>
      <header className="border-b-4 border-red-600" style={{ background: "#1a1a1a" }}>
        <div className="mx-auto flex max-w-full items-center gap-4 px-6 py-3">
          <div className="rounded-lg bg-white px-2 py-1">
            <img src="/hmLogo.png" alt="Hauge Maskin" className="h-8 w-auto" />
          </div>
          <div className="h-6 w-px bg-neutral-700" />
          <p className="text-sm font-bold tracking-tight text-white">Timeliste → PDF</p>
        </div>
      </header>

      <main className="mx-auto flex max-w-md justify-center px-6 py-16">
        <form
          onSubmit={sendInn}
          className="w-full space-y-4 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm"
        >
          <h1 className="text-lg font-bold text-neutral-900">Logg inn</h1>

          <div className="space-y-1">
            <label htmlFor="epost" className="text-sm font-medium text-neutral-700">
              E-post
            </label>
            <input
              id="epost"
              name="epost"
              type="email"
              autoComplete="username"
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-500"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="passord" className="text-sm font-medium text-neutral-700">
              Passord
            </label>
            <input
              id="passord"
              name="passord"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-500"
            />
          </div>

          {feil && (
            <p role="alert" className="text-sm text-red-600">
              {feil}
            </p>
          )}

          <button
            type="submit"
            disabled={venter}
            className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {venter ? "Logger inn…" : "Logg inn"}
          </button>
        </form>
      </main>
    </div>
  );
}
