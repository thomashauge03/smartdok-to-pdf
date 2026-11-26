import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avklarInn,
  dekodetStorrelse,
  erSkriving,
  fjernMerkeInn,
  lagreKoblingInn,
  leggPaaOrdreInn,
  leggPaaOrdreSvar,
  MAKS_PDF_BYTE,
  pdfForStor,
} from "./tripletex.ts";

const base64Av = (byte: number) => Buffer.alloc(byte, 1).toString("base64");

test("dekodet størrelse stemmer med Buffer", () => {
  for (const n of [0, 1, 2, 3, 4, 100, 1001]) {
    assert.equal(dekodetStorrelse(base64Av(n)), n);
  }
});

test("3 MB passerer, én byte over avvises", () => {
  assert.equal(pdfForStor(base64Av(MAKS_PDF_BYTE)), false);
  assert.equal(pdfForStor(base64Av(MAKS_PDF_BYTE + 1)), true);
});

const gyldig = {
  prosjekt: "2026118",
  ordre: { ny: true as const },
  linjer: [{ produktId: 5, antall: 7.5, tekst: "Gravemaskin" }],
  timerIder: [1, 2],
  pdf: "JVBERg==",
  filnavn: "timer.pdf",
  periode: { fra: "2026-11-01", til: "2026-11-30" },
};

test("leggPaaOrdre godtar gyldig kropp, med ny eller eksisterende ordre", () => {
  assert.ok(leggPaaOrdreInn.safeParse(gyldig).success);
  assert.ok(leggPaaOrdreInn.safeParse({ ...gyldig, ordre: { id: 12 } }).success);
});

test("leggPaaOrdre avviser tomme lister, ugyldige datoer og tall", () => {
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, linjer: [] }).success);
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, timerIder: [] }).success);
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, timerIder: [1.5] }).success);
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, periode: { fra: "01.11.2026", til: "2026-11-30" } }).success);
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, ordre: { id: 0 } }).success);
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, ordre: { ny: true, id: 1 } }).success);
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, linjer: [{ produktId: 5, antall: 0, tekst: "x" }] }).success);
});

test("leggPaaOrdre: produktId null er en tekstlinje; 0, negativ og desimal avvises", () => {
  const p = leggPaaOrdreInn.safeParse({ ...gyldig, linjer: [{ produktId: null, antall: 5, tekst: "Volvo L180G – arbeid utført iht. vedlegg" }] });
  assert.ok(p.success);
  assert.equal(p.data.linjer[0].produktId, null);
  for (const produktId of [0, -1, 1.5, "5", undefined]) {
    assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, linjer: [{ produktId, antall: 1, tekst: "x" }] }).success, String(produktId));
  }
});

test("leggPaaOrdreSvar godtar tekstlinjer (produktId null) og 0 kr", () => {
  const svar = {
    status: "sendt", kode: "ab12cd", ordrenummer: "10240", ordreId: 77,
    linjer: [
      { produktId: 5, antall: 7.5, pris: 0, rabatt: 0 },
      { produktId: null, antall: 5, pris: 0, rabatt: 0 },
    ],
  };
  const p = leggPaaOrdreSvar.safeParse(svar);
  assert.ok(p.success);
  assert.equal(p.data.linjer[1].produktId, null);
  assert.ok(!leggPaaOrdreSvar.safeParse({ ...svar, linjer: [{ antall: 1, pris: 0, rabatt: 0 }] }).success);
});

test("kode må være seks tegn a-z og 0-9", () => {
  assert.ok(fjernMerkeInn.safeParse({ kode: "ab12cd" }).success);
  for (const kode of ["ABCDEF", "abc12", "abc1234", "abc-12", ""]) {
    assert.ok(!fjernMerkeInn.safeParse({ kode }).success, kode);
  }
  assert.ok(avklarInn.safeParse({ kode: "ab12cd", valg: "frigi" }).success);
  assert.ok(!avklarInn.safeParse({ kode: "ab12cd", valg: "slett" }).success);
  // Bekreftelsen er valgfri, men må være en ekte boolean når den er med.
  assert.deepEqual(avklarInn.parse({ kode: "ab12cd", valg: "merk", bekreftetLinjer: true }), {
    kode: "ab12cd", valg: "merk", bekreftetLinjer: true,
  });
  assert.ok(!avklarInn.safeParse({ kode: "ab12cd", valg: "merk", bekreftetLinjer: "true" }).success);
});

test("en maskin som faktureres må ha produkt", () => {
  const k = { maskinId: 3, maskinnavn: "Cat", faktureres: true, produktId: null, produktnummer: null, produktnavn: null };
  assert.ok(!lagreKoblingInn.safeParse(k).success);
  assert.ok(lagreKoblingInn.safeParse({ ...k, faktureres: false }).success);
  assert.ok(lagreKoblingInn.safeParse({ ...k, produktId: 9, produktnummer: "100", produktnavn: "Gravemaskin" }).success);
});

test("leggPaaOrdre speiler adminbordets sjekker: desimaler, doble timer, filnavn", () => {
  assert.ok(leggPaaOrdreInn.safeParse({ ...gyldig, linjer: [{ produktId: 5, antall: 7.25, tekst: "x" }] }).success);
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, linjer: [{ produktId: 5, antall: 7.255, tekst: "x" }] }).success);
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, timerIder: [1, 1] }).success);
  for (const filnavn of ["timer.txt", 'a"b.pdf', "a/b.pdf", "a\b.pdf", "a\nb.pdf"]) {
    assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, filnavn }).success, filnavn);
  }
});

test("filnavn: xpdf avvises, navn med mellomrom godtas", () => {
  assert.ok(!leggPaaOrdreInn.safeParse({ ...gyldig, filnavn: "xpdf" }).success);
  assert.ok(leggPaaOrdreInn.safeParse({ ...gyldig, filnavn: "Timeliste juni.pdf" }).success);
});

test("bare frigi og merk regnes som skriving", () => {
  assert.equal(erSkriving("sjekk"), false);
  assert.equal(erSkriving("frigi"), true);
  assert.equal(erSkriving("merk"), true);
});
