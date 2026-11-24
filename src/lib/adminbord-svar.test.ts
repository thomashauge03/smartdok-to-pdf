import { test } from "node:test";
import assert from "node:assert/strict";
import { feilSvar, normaliserAdminbordUrl, UTLOGGET, GENERELL_FEIL } from "./adminbord-svar.ts";
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

test("adminbord-URL må være https, eller http mot localhost", () => {
  assert.equal(normaliserAdminbordUrl("https://a.no/"), "https://a.no");
  assert.equal(normaliserAdminbordUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normaliserAdminbordUrl("http://127.0.0.1:3000/"), "http://127.0.0.1:3000");
  assert.equal(normaliserAdminbordUrl("http://a.no"), null);
  assert.equal(normaliserAdminbordUrl("http://localhost.evil.no"), null);
  assert.equal(normaliserAdminbordUrl(""), null);
  assert.equal(normaliserAdminbordUrl(undefined), null);
});
