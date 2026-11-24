import { test } from "node:test";
import assert from "node:assert/strict";
import { vurderTilgang, feilmelding } from "./innlogging.ts";

test("ingen bruker gir ute", () => {
  assert.deepEqual(vurderTilgang(null, null), { status: "ute" });
});

test("innlogget bruker uten tilgang gir ingen-tilgang", () => {
  assert.deepEqual(vurderTilgang({ email: "a@b.no" }, false), {
    status: "ingen-tilgang",
  });
});

test("feil i tilgangssjekken slipper aldri inn", () => {
  assert.deepEqual(vurderTilgang({ email: "a@b.no" }, null), {
    status: "ingen-tilgang",
  });
});

test("innlogget bruker med tilgang gir inne med e-post", () => {
  assert.deepEqual(vurderTilgang({ email: "a@b.no" }, true), {
    status: "inne",
    epost: "a@b.no",
  });
});

test("feilmeldinger er faste norske tekster", () => {
  assert.equal(feilmelding("feil-passord"), "Feil e-post eller passord.");
  assert.equal(
    feilmelding("ingen-tilgang"),
    "Du har ikke tilgang til denne siden. Spør Thomas.",
  );
  assert.equal(feilmelding("ukjent"), "Noe gikk galt. Prøv igjen.");
});
