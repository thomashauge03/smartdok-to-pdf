import { test } from "node:test";
import assert from "node:assert/strict";
import type { ColMeta, Parsed } from "./smartdok-parser.ts";
import { behold, forhandsfiltre } from "./tabelloppsett.ts";

const kol = (key: string, o: Partial<ColMeta> = {}): ColMeta => ({ key, label: key, defaultWidth: 100, ...o });

const ny = (columns: ColMeta[], populatedCols: string[]): Parsed => ({
  rows: [],
  columns,
  prosjekt: "1234 Veien",
  vedlegg: "November 2026",
  populatedCols,
  fakturertKey: "fakturert",
  tripletexKey: "tripletex",
});

test("forhandsfiltre: Fakturert Nei/Delvis og Tripletex Ikke sendt", () => {
  const f = forhandsfiltre({ fakturertKey: "fakturert", tripletexKey: "tripletex" });
  assert.deepEqual([...f.fakturert], ["Nei", "Delvis"]);
  assert.deepEqual([...f.tripletex], ["Ikke sendt"]);
  assert.deepEqual(forhandsfiltre({}), {});
});

test("behold: valg for kolonner som finnes fortsatt, nye kolonner som ved ny henting", () => {
  const gamle = [kol("navn", { filter: true }), kol("tripletex", { filter: true }), kol("timer"), kol("borte", { filter: true })];
  const gammelt = {
    columns: gamle,
    // Brukeren har tatt bort Tripletex-filteret og filtrert på navn.
    filters: { navn: new Set(["Ola"]), tripletex: new Set<string>(), borte: new Set(["x"]) },
    visibleCols: new Set(["navn", "tripletex"]), // timer skjult av brukeren
    colWidths: { navn: 222, tripletex: 90, timer: 50, borte: 10 },
  };
  const p = ny(
    [kol("navn", { filter: true }), kol("tripletex", { filter: true }), kol("timer"), kol("fakturert", { filter: true }), kol("maskin2", { defaultWidth: 77 }), kol("tom")],
    ["navn", "timer", "maskin2"],
  );
  const r = behold(gammelt, p);

  assert.deepEqual([...r.filters.navn], ["Ola"]);
  assert.deepEqual([...r.filters.tripletex], [], "brukerens valg vinner over forhåndsfilteret");
  assert.deepEqual([...r.filters.fakturert], ["Nei", "Delvis"], "ny kolonne får forhåndsfilteret");
  assert.ok(!("borte" in r.filters));

  assert.deepEqual([...r.visibleCols].sort(), ["maskin2", "navn", "tripletex"]);
  assert.deepEqual(r.colWidths, { navn: 222, tripletex: 90, timer: 50, fakturert: 100, maskin2: 77, tom: 100 });
});

test("behold kopierer filtersettene, så den gamle tabellen ikke endres", () => {
  const settet = new Set(["Ola"]);
  const r = behold(
    { columns: [kol("navn", { filter: true })], filters: { navn: settet }, visibleCols: new Set(), colWidths: {} },
    ny([kol("navn", { filter: true })], []),
  );
  r.filters.navn.add("Kari");
  assert.deepEqual([...settet], ["Ola"]);
});
