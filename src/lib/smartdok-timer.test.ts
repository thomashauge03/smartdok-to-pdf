import { test } from "node:test";
import assert from "node:assert/strict";
import { byggTabell, type SmartdokTime } from "./smartdok-timer.ts";
import { vedleggFraMaaneder } from "./smartdok-parser.ts";

const prosjekt = { nummer: "1234", navn: "Testveien" };
const periode = { fra: "2026-11-01", til: "2026-11-30" };

function arbeid(o: Partial<SmartdokTime> & { id: number }): SmartdokTime {
  return {
    maskinradId: null, type: "arbeid", dato: "2026-11-03", fra: 7.5, til: 15,
    navn: "Ola Test", aktivitet: "Graving", lonnsart: "Normal", kommentar: "",
    mengde: 7.5, fakturert: false, underprosjekt: "", maskin: "", ...o,
  };
}
const tillegg = (o: Partial<SmartdokTime> & { id: number }) =>
  arbeid({ type: "tillegg", fra: null, til: null, lonnsart: "Overtid 50%", mengde: 2, ...o });
const maskin = (o: Partial<SmartdokTime> & { id: number }) =>
  arbeid({ type: "maskin", fra: null, til: null, lonnsart: "", maskin: "Gravemaskin", mengde: 5, ...o });

const labels = (t: ReturnType<typeof byggTabell>) => t.columns.map((c) => c.label);

test("kolonnerekkefølge og Tid/Dato/Timer-format", () => {
  const t = byggTabell([arbeid({ id: 1 }), tillegg({ id: 1 }), maskin({ id: 1 })], prosjekt, periode);
  assert.deepEqual(labels(t), [
    "Dato", "Tid", "Navn", "Aktivitet", "Lønnsart", "Kommentar", "Timer",
    "Overtid 50%", "Fakturert", "Maskinnavn1", "Maskintimer1",
  ]);
  assert.equal(t.rows.length, 1);
  const r = t.rows[0];
  assert.equal(r["dato"], "03.11.2026");
  assert.equal(r["tid"], "07:30–15:00");
  assert.equal(r["timer"], "7,5");
  assert.equal(r["overtid_50%"], "2");
  assert.equal(r["maskinnavn1"], "Gravemaskin");
  assert.equal(r["maskin1_timer"], "5");
  assert.equal(t.prosjekt, "1234 Testveien");
});

test("tilleggskolonner er alltid sum og høyrejustert, også ukjente", () => {
  const t = byggTabell([arbeid({ id: 1 }), tillegg({ id: 1, lonnsart: "Ukjent tillegg", mengde: 60 })], prosjekt, periode);
  const c = t.columns.find((x) => x.label === "Ukjent tillegg")!;
  assert.equal(c.sum, true);
  assert.equal(c.align, "right");
});

test("to like tillegg på samme time summeres", () => {
  const t = byggTabell([arbeid({ id: 1 }), tillegg({ id: 1, mengde: 1.5 }), tillegg({ id: 1, mengde: 2 })], prosjekt, periode);
  assert.equal(t.rows[0]["overtid_50%"], "3,5");
});

test("maskin 1 og 2 på samme rad", () => {
  const t = byggTabell([
    arbeid({ id: 1 }),
    maskin({ id: 1, maskin: "A", mengde: 1 }),
    maskin({ id: 1, maskin: "B", mengde: 2.5 }),
  ], prosjekt, periode);
  assert.ok(labels(t).includes("Maskinnavn2") && labels(t).includes("Maskintimer2"));
  assert.equal(t.rows[0]["maskinnavn2"], "B");
  assert.equal(t.rows[0]["maskin2_timer"], "2,5");
});

test("foreldreløst tillegg og maskin blir egne rader", () => {
  const t = byggTabell([
    arbeid({ id: 1 }),
    tillegg({ id: 2, navn: "Kari Test", dato: "2026-11-04" }),
    maskin({ id: 3, navn: "Per Test", dato: "2026-11-05" }),
  ], prosjekt, periode);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[1]["navn"], "Kari Test");
  assert.equal(t.rows[1]["overtid_50%"], "2");
  assert.equal(t.rows[1]["timer"], "");
  assert.equal(t.rows[2]["maskinnavn1"], "Gravemaskin");
  assert.equal(t.rows[2]["aktivitet"], "Graving");
});

test("Fakturert er Ja, Nei eller Delvis", () => {
  const f = (a: boolean, b: boolean) =>
    byggTabell([arbeid({ id: 1, fakturert: a }), tillegg({ id: 1, fakturert: b })], prosjekt, periode).rows[0]["fakturert"];
  assert.equal(f(true, true), "Ja");
  assert.equal(f(false, false), "Nei");
  assert.equal(f(true, false), "Delvis");
});

test("Tid er tom uten fra/til", () => {
  const t = byggTabell([arbeid({ id: 1, fra: null, til: null })], prosjekt, periode);
  assert.equal(t.rows[0]["tid"], "");
});

test("Underprosjekt-kolonne bare når noen har det", () => {
  assert.ok(!labels(byggTabell([arbeid({ id: 1 })], prosjekt, periode)).includes("Underprosjekt"));
  const t = byggTabell([arbeid({ id: 1, underprosjekt: "Del A" })], prosjekt, periode);
  assert.ok(labels(t).includes("Underprosjekt"));
  assert.equal(t.rows[0]["underprosjekt"], "Del A");
});

test("sortert på dato, tid, navn", () => {
  const t = byggTabell([
    arbeid({ id: 1, dato: "2026-11-05", navn: "A" }),
    arbeid({ id: 2, dato: "2026-11-03", fra: 8, navn: "B" }),
    arbeid({ id: 3, dato: "2026-11-03", fra: 7, navn: "Z" }),
    arbeid({ id: 4, dato: "2026-11-03", fra: 7, navn: "C" }),
  ], prosjekt, periode);
  assert.deepEqual(t.rows.map((r) => r["navn"]), ["C", "Z", "B", "A"]);
});

test("Kommentar renses som i Excel", () => {
  const t = byggTabell([arbeid({ id: 1, kommentar: "- Hei<br>- Du" })], prosjekt, periode);
  assert.equal(t.rows[0]["kommentar"], "Hei\nDu");
});

test("populatedCols hopper over tomme og nullkolonner", () => {
  const t = byggTabell([arbeid({ id: 1 })], prosjekt, periode);
  assert.ok(t.populatedCols.includes("dato"));
  assert.ok(!t.populatedCols.includes("kommentar"));
});

test("vedlegg for én og flere måneder", () => {
  const v = (fra: string, til: string) => byggTabell([], prosjekt, { fra, til }).vedlegg;
  assert.equal(v("2026-11-01", "2026-11-30"), "November 2026");
  assert.equal(v("2026-01-01", "2026-03-31"), "Januar - Mars 2026");
  assert.equal(v("2025-11-15", "2026-02-10"), "November 2025 - Februar 2026");
});

test("vedleggFraMaaneder gir samme tekst som Excel-banen", () => {
  assert.equal(vedleggFraMaaneder([]), "");
  assert.equal(vedleggFraMaaneder([{ year: 2026, month: 10 }]), "November 2026");
  assert.equal(
    vedleggFraMaaneder([{ year: 2026, month: 2 }, { year: 2026, month: 0 }]),
    "Januar - Mars 2026",
  );
});

test("tillegg som heter det samme som en basiskolonne får egen kolonne", () => {
  const t = byggTabell([
    arbeid({ id: 1, fakturert: true }),
    tillegg({ id: 1, lonnsart: "Timer", mengde: 3, fakturert: true }),
    tillegg({ id: 1, lonnsart: "Fakturert", mengde: 4, fakturert: true }),
  ], prosjekt, periode);
  const nokler = t.columns.map((c) => c.key);
  assert.equal(new Set(nokler).size, nokler.length);
  const r = t.rows[0];
  const verdier = Object.values(r);
  assert.ok(verdier.includes("7,5") && verdier.includes("3") && verdier.includes("4") && verdier.includes("Ja"));
  const timerBasis = t.columns.findIndex((c) => c.label === "Timer");
  assert.equal(r[t.columns[timerBasis].key], "7,5");
  const timerTillegg = t.columns.findIndex((c, i) => c.label === "Timer" && i !== timerBasis);
  assert.equal(r[t.columns[timerTillegg].key], "3");
  const faktBasis = t.columns.findIndex((c) => c.label === "Fakturert" && !c.sum);
  assert.equal(r[t.columns[faktBasis].key], "Ja");
  const faktTillegg = t.columns.findIndex((c) => c.label === "Fakturert" && c.sum);
  assert.equal(r[t.columns[faktTillegg].key], "4");
});

test("to arbeidsrader med samme id gir feil", () => {
  assert.throws(() => byggTabell([arbeid({ id: 1 }), arbeid({ id: 1 })], prosjekt, periode), /samme id/);
});

test("to foreldreløse rader med samme id havner på én rad", () => {
  const t = byggTabell([tillegg({ id: 9 }), maskin({ id: 9 })], prosjekt, periode);
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0]["overtid_50%"], "2");
  assert.equal(t.rows[0]["maskinnavn1"], "Gravemaskin");
});

test("Tid for kvarter og rett før midnatt", () => {
  assert.equal(byggTabell([arbeid({ id: 1, fra: 7.25, til: 23.99 })], prosjekt, periode).rows[0]["tid"], "07:15–23:59");
});

test("rad uten tid kommer først på datoen", () => {
  const t = byggTabell([
    arbeid({ id: 1, navn: "A", fra: 7 }),
    tillegg({ id: 2, navn: "B" }),
  ], prosjekt, periode);
  assert.deepEqual(t.rows.map((r) => r["navn"]), ["B", "A"]);
});
