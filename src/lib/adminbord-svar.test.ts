import { test } from "node:test";
import assert from "node:assert/strict";
import { feilSvar, normaliserAdminbordUrl, somSkrivefeil, TIDSAVBRUDD, UKJENT_UTFALL_FEIL, uventet, uventetSkriving, UTLOGGET, GENERELL_FEIL } from "./adminbord-svar.ts";
import { feilmelding } from "./innlogging.ts";

test("401 gir loggInn", () => {
  assert.deepEqual(feilSvar(401, "x"), UTLOGGET);
  assert.equal(UTLOGGET.loggInn, true);
});

test("403 gir ingen tilgang", () => {
  assert.deepEqual(feilSvar(403, "x"), { ok: false, feil: feilmelding("ingen-tilgang") });
});

test("andre feil sender adminbordets tekst videre, kuttet til 300 tegn", () => {
  assert.deepEqual(feilSvar(502, "Feil fra SmartDok."), { ok: false, feil: "Feil fra SmartDok." });
  assert.equal((feilSvar(400, "a".repeat(500)) as { feil: string }).feil.length, 300);
});

test("mangler tekst gir generell feil", () => {
  assert.deepEqual(feilSvar(500, null), { ok: false, feil: GENERELL_FEIL });
  assert.deepEqual(feilSvar(500, "  "), { ok: false, feil: GENERELL_FEIL });
});

test("504 gir tidsavbruddmelding, også når adminbordet sender tekst", () => {
  const forventet = { ok: false, feil: "Hentingen tok for lang tid. Prøv en kortere periode." };
  assert.deepEqual(feilSvar(504, null), forventet);
  assert.deepEqual(feilSvar(504, "noe annet"), forventet);
});

test("adminbord-URL må være https, eller http mot localhost", () => {
  assert.equal(normaliserAdminbordUrl("https://a.no/"), "https://a.no");
  assert.equal(normaliserAdminbordUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normaliserAdminbordUrl("http://127.0.0.1:3000/"), "http://127.0.0.1:3000");
  assert.equal(normaliserAdminbordUrl("http://a.no"), null);
  assert.equal(normaliserAdminbordUrl("http://localhost.evil.no"), null);
  assert.equal(normaliserAdminbordUrl(""), null);
  assert.equal(normaliserAdminbordUrl(undefined), null);
});

test("skriving uten svar gir ukjent utfall, ikke «prøv kortere periode»", () => {
  const e = uventetSkriving(Object.assign(new Error("t"), { name: "TimeoutError" }));
  assert.equal(e.feil, UKJENT_UTFALL_FEIL);
  assert.equal(e.ukjentUtfall, true);
  assert.ok(!e.feil.includes("kortere periode"));
  assert.deepEqual(somSkrivefeil(feilSvar(504, null)), e);
});

test("andre feil på skriving beholdes uendret og uten flagg", () => {
  assert.deepEqual(somSkrivefeil(feilSvar(409, "Ordren er stengt.")), { ok: false, feil: "Ordren er stengt." });
  assert.equal(somSkrivefeil(UTLOGGET), UTLOGGET);
});

test("lesing beholder tidsavbruddmeldingen", () => {
  const e = uventet(Object.assign(new Error("t"), { name: "TimeoutError" }));
  assert.equal(e.feil, TIDSAVBRUDD);
  assert.equal(e.ukjentUtfall, undefined);
});
