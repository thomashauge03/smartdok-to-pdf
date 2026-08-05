import { test } from "node:test";
import assert from "node:assert/strict";
import { computeColumnWidths, type TextMeasurer } from "./pdf-layout.ts";

/** Stand-in for jsPDF: 1.5mm per character, bold slightly wider. */
const measure: TextMeasurer = {
  body: (t) => t.length * 1.5,
  head: (t) => t.length * 1.6,
};

const LANDSCAPE = 269; // A4 landscape minus margins
const PORTRAIT = 182;
const PAD = 3;

/** What a string needs to sit on one line, in the units of `measure`. */
const needs = (t: string) => t.length * 1.5 + PAD;

const HEAD = ["Dato", "Navn", "Kommentar", "Timer"];
const SHORT = "Kort kommentar";
const LONG =
  "Utfort graving og planering av grofta langs veien, matte vente pa at kabelpaviser kom for vi kunne fortsette forbi krysset. Fylte tilbake med subbus og komprimerte i lag pa 20 cm.";

function rows(
  n: number,
  kommentar: (i: number) => string,
  navn = () => "Ola Nordmann",
): string[][] {
  return Array.from({ length: n }, (_, i) => ["01.03.2026", navn(), kommentar(i), "7,5"]);
}

const sum = (ws: number[]) => ws.reduce((s, w) => s + w, 0);

test("widths always fill the printable width exactly", () => {
  for (const width of [LANDSCAPE, PORTRAIT, 100]) {
    const ws = computeColumnWidths(
      HEAD,
      rows(20, () => LONG),
      width,
      measure,
    );
    assert.ok(Math.abs(sum(ws) - width) < 0.02, `sum ${sum(ws)} != ${width}`);
  }
});

test("the wrapping column absorbs the space the others do not need", () => {
  const ws = computeColumnWidths(
    HEAD,
    rows(20, (i) => (i % 5 === 0 ? LONG : SHORT)),
    LANDSCAPE,
    measure,
  );
  const [dato, navn, kommentar, timer] = ws;

  assert.ok(kommentar > LANDSCAPE * 0.5, `kommentar ${kommentar} should exceed half the page`);
  // This is the whole point of the change: a short column gets what it needs
  // and not a millimetre more, instead of being stretched to fill the page.
  assert.ok(dato < needs("01.03.2026") + 1, `dato ${dato} should not be padded out`);
  assert.ok(timer < needs("Timer") + 3, `timer ${timer} should not be padded out`);
  assert.ok(navn < needs("Ola Nordmann") + 1, `navn ${navn} should not be padded out`);
});

test("sustained long text outranks columns that are long in a single row", () => {
  // Five columns hold one long value each; Kommentar is long in every row.
  // Kommentar is the column that actually wraps, so it must win the space.
  const head = ["Kommentar", "A", "B", "C", "D", "E"];
  const spike = "en svaert lang engangsverdi som bare forekommer i en eneste rad her";
  const body = Array.from({ length: 30 }, (_, i) => [
    LONG,
    ...["A", "B", "C", "D", "E"].map((c, j) => (i === j ? spike : `kort ${c}`)),
  ]);
  const ws = computeColumnWidths(head, body, LANDSCAPE, measure);

  assert.ok(Math.abs(sum(ws) - LANDSCAPE) < 0.02);
  const others = ws.slice(1);
  assert.ok(
    ws[0] > sum(others),
    `kommentar ${ws[0]} lost to the one-row spikes (${others.map((w) => w.toFixed(1)).join(", ")})`,
  );
});

test("no column is squeezed below its content while another column wraps", () => {
  // Kommentar alone wants more than the whole page, but the short columns
  // must still keep the width their own content needs.
  const ws = computeColumnWidths(
    HEAD,
    rows(20, () => LONG),
    LANDSCAPE,
    measure,
  );

  assert.ok(ws[0] >= needs("01.03.2026") - 0.05, `dato ${ws[0]} < ${needs("01.03.2026")}`);
  assert.ok(ws[1] >= needs("Ola Nordmann") - 0.05, `navn ${ws[1]} < ${needs("Ola Nordmann")}`);
  assert.ok(ws[3] >= needs("Timer") - 0.05, `timer ${ws[3]} < ${needs("Timer")}`);
  assert.ok(ws[2] > LANDSCAPE * 0.6, `kommentar ${ws[2]} should still take the bulk`);
});

test("columns are not shrunk below their longest word when the page has room", () => {
  const head = ["Dato", "Navn", "Kommentar", "Timer", "AktA", "AktB", "AktC"];
  const word = "kabelpaviserkoordinator";
  const body = Array.from({ length: 12 }, () => [
    "01.03.2026",
    "Ola Nordmann",
    `Ventet lenge pa ${word} og fortsatte etterpa med graving`,
    "7,5",
    "Graving grofta langs vei",
    "Transport av masser bort",
    "Planering av hele omradet",
  ]);
  const ws = computeColumnWidths(head, body, PORTRAIT, measure);

  assert.ok(Math.abs(sum(ws) - PORTRAIT) < 0.02);
  // Total demand exceeds the page, so this exercises the shrink path.
  assert.ok(
    ws[2] >= needs(word) - 0.05,
    `kommentar ${ws[2]} fell below its longest word ${needs(word)}`,
  );
  assert.ok(ws[0] >= needs("01.03.2026") - 0.05, `dato ${ws[0]} was shrunk below its content`);
  assert.ok(ws[3] >= needs("Timer") - 0.05, `timer ${ws[3]} was shrunk below its header`);
});

test("a single enormous cell does not starve the other columns", () => {
  const head = ["Dato", "Navn", "Kommentar", "Timer", "Aktivitet"];
  const body = Array.from({ length: 30 }, (_, i) => [
    "01.03.2026",
    "Ola Nordmann",
    i === 7 ? "x".repeat(4000) : SHORT,
    "7,5",
    "Graving grofta",
  ]);
  const ws = computeColumnWidths(head, body, LANDSCAPE, measure);

  assert.ok(Math.abs(sum(ws) - LANDSCAPE) < 0.02);
  assert.ok(ws.every((w) => w > 0 && Number.isFinite(w)));
  // Kommentar may take the leftover space, but only after everyone else has
  // the width their own content needs.
  assert.ok(ws[0] >= needs("01.03.2026") - 0.05, `dato ${ws[0]} was starved`);
  assert.ok(ws[1] >= needs("Ola Nordmann") - 0.05, `navn ${ws[1]} was starved`);
  assert.ok(ws[4] >= needs("Graving grofta") - 0.05, `aktivitet ${ws[4]} was starved`);
});

test("embedded newlines are measured per line, not as one long line", () => {
  const wrapped = computeColumnWidths(
    HEAD,
    rows(10, () => "kort\nkort\nkort"),
    LANDSCAPE,
    measure,
  );
  const single = computeColumnWidths(
    HEAD,
    rows(10, () => "kort kort kort"),
    LANDSCAPE,
    measure,
  );
  assert.ok(wrapped[2] < single[2], "newline-separated text should ask for less width");
});

test("too many columns for the page still yields a valid, in-bounds table", () => {
  const head = Array.from({ length: 18 }, (_, i) => `Kolonne${i}`);
  const body = [head.map(() => "en ganske lang verdi her")];
  const ws = computeColumnWidths(head, body, PORTRAIT, measure);
  assert.equal(ws.length, 18);
  assert.ok(ws.every((w) => w > 0 && Number.isFinite(w)));
  assert.ok(Math.abs(sum(ws) - PORTRAIT) < 0.02);
});

test("degenerate input does not produce invalid widths", () => {
  assert.deepEqual(computeColumnWidths([], [], LANDSCAPE, measure), []);
  for (const ws of [
    computeColumnWidths(HEAD, [], LANDSCAPE, measure),
    computeColumnWidths(HEAD, [["", "", "", ""]], LANDSCAPE, measure),
    computeColumnWidths(["Kommentar"], [[LONG]], LANDSCAPE, measure),
  ]) {
    assert.ok(
      ws.every((w) => w > 0 && Number.isFinite(w)),
      `bad widths: ${ws}`,
    );
    assert.ok(Math.abs(sum(ws) - LANDSCAPE) < 0.02);
  }
  // A zero-width page must not yield NaN or negative widths.
  assert.ok(
    computeColumnWidths(
      HEAD,
      rows(3, () => SHORT),
      0,
      measure,
    ).every((w) => w === 0),
  );
});

test("ragged rows with missing cells are tolerated", () => {
  const ws = computeColumnWidths(HEAD, [["01.03.2026"], ["01.03.2026", "Ola"]], LANDSCAPE, measure);
  assert.equal(ws.length, 4);
  assert.ok(Math.abs(sum(ws) - LANDSCAPE) < 0.02);
});
