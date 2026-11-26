import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avklarInn,
  dekodetStorrelse,
  fjernMerkeInn,
  lagreKoblingInn,
  leggPaaOrdreInn,
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

test("kode må være seks tegn a-z og 0-9", () => {
  assert.ok(fjernMerkeInn.safeParse({ kode: "ab12cd" }).success);
  for (const kode of ["ABCDEF", "abc12", "abc1234", "abc-12", ""]) {
    assert.ok(!fjernMerkeInn.safeParse({ kode }).success, kode);
  }
  assert.ok(avklarInn.safeParse({ kode: "ab12cd", valg: "frigi" }).success);
  assert.ok(!avklarInn.safeParse({ kode: "ab12cd", valg: "slett" }).success);
});

test("en maskin som faktureres må ha produkt", () => {
  const k = { maskinId: 3, maskinnavn: "Cat", faktureres: true, produktId: null, produktnummer: null, produktnavn: null };
  assert.ok(!lagreKoblingInn.safeParse(k).success);
  assert.ok(lagreKoblingInn.safeParse({ ...k, faktureres: false }).success);
  assert.ok(lagreKoblingInn.safeParse({ ...k, produktId: 9, produktnummer: "100", produktnavn: "Gravemaskin" }).success);
});
