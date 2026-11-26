import { test } from "node:test";
import assert from "node:assert/strict";
import { byggTabell, type SmartdokTime } from "./smartdok-timer.ts";
import { beregnOrdrelinjer, foreslåProdukt, type Kobling, type Ordrelinje, type Produkt } from "./ordrelinjer.ts";

const prosjekt = { nummer: "1234", navn: "Testveien" };
const periode = { fra: "2026-11-01", til: "2026-11-30" };

function arbeid(o: Partial<SmartdokTime> & { id: number }): SmartdokTime {
  return {
    maskinradId: null, type: "arbeid", dato: "2026-11-03", fra: 7.5, til: 15,
    navn: "Ola Test", aktivitet: "Graving", lonnsart: "Normal", kommentar: "",
    mengde: 7.5, fakturert: false, underprosjekt: "", maskin: "", maskinId: null, eksterntMerke: null, ...o,
  };
}
const tillegg = (o: Partial<SmartdokTime> & { id: number }) =>
  arbeid({ type: "tillegg", fra: null, til: null, lonnsart: "Overtid 50%", mengde: 2, ...o });
const maskin = (o: Partial<SmartdokTime> & { id: number }) =>
  arbeid({ type: "maskin", fra: null, til: null, lonnsart: "", maskin: "Cat 324 E", maskinId: 11, mengde: 5, ...o });

// Ekte Tripletex-produkter (nummer, navn); pris 1000 med mindre noe annet er sagt.
const rå: [string, string][] = [
  ["1", "8 t gravemaskin"], ["2", "16t gravemaskin"], ["5", "25 t gravemaskin m/ GPS"],
  ["6", "27 t gravemaskin m/ GPS"], ["7", "28 t gravemaskin m/GPS"], ["9", "32 t gravemaskin m/GPS"],
  ["10", "2.2 t gravemaskin"], ["602", "Grunnarbeider"], ["608", "50 % overtidsarbeid"],
  ["609", "100 % overtidsarbeid"], ["400", "Hjullaster L 90 G"], ["401", "Hjullaster L 150 E"],
  ["402", "Hjullaster L 110F"], ["405", "Hjullaster Cat 906"], ["", "Hjullaster L180G"],
  ["200", "Volvo A 25 dumper 17 m3"], ["201", "Dumper Volvo A 30G 20 m3"],
  ["202", "Dumper belte Yammar C50"], ["203", "Dumper Volvo A20"], ["1600-111430", "Mobil Univis N 32"],
];
const produkter: Produkt[] = rå.map(([nummer, navn], i) => ({ id: 100 + i, nummer, navn, pris: 1000 }));
const pid = (nummer: string) => produkter.find((p) => p.nummer === nummer)!.id;

const kob = (maskinId: number, produktNr: string | null, faktureres = true): Kobling =>
  ({ maskinId, faktureres, produktId: produktNr === null ? null : pid(produktNr) });

function kjør(timer: SmartdokTime[], koblinger: Kobling[], prod = produkter) {
  const t = byggTabell(timer, prosjekt, periode);
  return beregnOrdrelinjer(t.rows, t.columns, koblinger, prod);
}

// [produktId, antall] for produktlinjer, [navn, antall] for tekstlinjer: kort å sammenligne.
const kort = (linjer: Ordrelinje[]) => linjer.map((l) => [l.produktId ?? l.produktnavn, l.antall]);

test("8 t + 7 t på samme maskin gir én linje med 15 og riktig tekst", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 }), arbeid({ id: 2 }), maskin({ id: 2, mengde: 7 })],
    [kob(11, "5")],
  );
  assert.equal(r.linjer.length, 1);
  assert.equal(r.linjer[0].antall, 15);
  assert.equal(r.linjer[0].produktId, pid("5"));
  assert.equal(r.linjer[0].tekst, "25 t gravemaskin m/ GPS – arbeid utført iht. vedlegg");
  assert.equal(r.linjer[0].listepris, 1000);
  assert.deepEqual(r.timerIder, [1, 2]);
});

test("to maskiner på én rad, én uten fakturering: én linje, raden er med i timerIder", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 6, maskin: "Cat 324 E", maskinId: 11 }),
      maskin({ id: 1, mengde: 3, maskin: "Opel Combo", maskinId: 12 })],
    [kob(11, "5"), kob(12, null, false)],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 6]]);
  assert.deepEqual(r.timerIder, [1]);
  assert.deepEqual(r.advarsler.utenKobling, []);
  assert.equal(r.advarsler.somGrunnarbeider, 0); // raden har fakturert maskin: personens timer legges ikke i tillegg
});

test("overtid 2 t gir linje på 608 og maskintimene er uendret", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 }), tillegg({ id: 1, mengde: 2 })],
    [kob(11, "5")],
  );
  assert.equal(r.linjer.length, 2);
  assert.equal(r.linjer.find((l) => l.produktId === pid("608"))!.antall, 2);
  assert.equal(r.linjer.find((l) => l.produktId === pid("5"))!.antall, 8);
});

test("overtid 100 % går til 609, og sorteringen er etter produktnummer (tallmessig)", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 4 }), tillegg({ id: 1, lonnsart: "Overtid 100%", mengde: 1.5 })],
    [kob(11, "5")],
  );
  assert.deepEqual(r.linjer.map((l) => l.produktId), [pid("5"), pid("609")]);
  assert.equal(r.linjer[1].antall, 1.5);
});

test("overtid uten produkt 608 blir tekstlinje «50 % overtidsarbeid» og står i manglerProdukt", () => {
  const uten608 = produkter.filter((p) => p.nummer !== "608");
  const r = kjør([arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 }), tillegg({ id: 1, mengde: 2 })], [kob(11, "5")], uten608);
  assert.deepEqual(r.linjer, [
    { produktId: pid("5"), produktnavn: "25 t gravemaskin m/ GPS", antall: 8, tekst: "25 t gravemaskin m/ GPS – arbeid utført iht. vedlegg", listepris: 1000 },
    { produktId: null, produktnavn: "50 % overtidsarbeid", antall: 2, tekst: "50 % overtidsarbeid – arbeid utført iht. vedlegg", listepris: null },
  ]);
  assert.deepEqual(r.advarsler.utenPris, []);
  assert.equal(r.advarsler.manglerProdukt.length, 1);
  assert.match(r.advarsler.manglerProdukt[0], /608/);
  assert.deepEqual(r.timerIder, [1]);
});

test("mangler 602, 608 og 609 i Tripletex: tekstlinjer med samme navn, etter produktlinjene", () => {
  const uten = produkter.filter((p) => !["602", "608", "609"].includes(p.nummer));
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 }), tillegg({ id: 1, lonnsart: "Overtid 100%", mengde: 1 }),
      arbeid({ id: 2, mengde: 6 }), tillegg({ id: 2, mengde: 2 })],
    [kob(11, "5")],
    uten,
  );
  assert.deepEqual(kort(r.linjer), [
    [pid("5"), 8], ["50 % overtidsarbeid", 2], ["100 % overtidsarbeid", 1], ["Grunnarbeider", 6],
  ]);
  for (const l of r.linjer.slice(1)) {
    assert.equal(l.produktId, null);
    assert.equal(l.listepris, null);
    assert.equal(l.tekst, `${l.produktnavn} – arbeid utført iht. vedlegg`);
  }
  assert.equal(r.advarsler.manglerProdukt.length, 3);
  assert.deepEqual(r.timerIder, [1, 2]);
});

test("redigert celle «Maskintimer1» = 6 brukes", () => {
  const t = byggTabell([arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 })], prosjekt, periode);
  const nokkel = t.columns.find((c) => c.label === "Maskintimer1")!.key;
  t.rows[0][nokkel] = "6";
  const r = beregnOrdrelinjer(t.rows, t.columns, [kob(11, "5")], produkter);
  assert.equal(r.linjer[0].antall, 6);
});

test("komma-desimaler leses riktig og summen rundes til 2 desimaler", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 7.5 }), arbeid({ id: 2 }), maskin({ id: 2, mengde: 0.25 })],
    [kob(11, "5")],
  );
  assert.equal(r.linjer[0].antall, 7.75);
});

test("rad uten __id teller i haandlagde og ikke i timerIder", () => {
  const t = byggTabell([arbeid({ id: 1 }), maskin({ id: 1, mengde: 4 })], prosjekt, periode);
  const hand = { ...t.rows[0] };
  delete hand["__id"];
  const r = beregnOrdrelinjer([...t.rows, hand], t.columns, [kob(11, "5")], produkter);
  assert.equal(r.advarsler.haandlagde, 1);
  assert.deepEqual(r.timerIder, [1]);
  assert.equal(r.linjer[0].antall, 4); // håndlagde rader vises som advarsel og blir ikke linjer
});

test("håndlagd rad med bare overtid gir ingen linje, bare haandlagde", () => {
  const t = byggTabell([arbeid({ id: 1 }), tillegg({ id: 1, mengde: 2 })], prosjekt, periode);
  delete t.rows[0]["__id"];
  const r = beregnOrdrelinjer(t.rows, t.columns, [], produkter);
  assert.equal(r.linjer.length, 0);
  assert.equal(r.advarsler.haandlagde, 1);
  assert.equal(r.advarsler.somGrunnarbeider, 0);
  assert.deepEqual(r.timerIder, []);
});

test("håndlagd rad med ukoblet maskin gir ikke utenKobling og ingen linje", () => {
  const t = byggTabell([arbeid({ id: 1 }), maskin({ id: 1 })], prosjekt, periode);
  delete t.rows[0]["__id"];
  const r = beregnOrdrelinjer(t.rows, t.columns, [], produkter);
  assert.deepEqual(r.advarsler.utenKobling, []);
  assert.deepEqual(r.linjer, []);
  assert.equal(r.advarsler.haandlagde, 1);
});

/* ── Tilfelle 1: maskin uten kobling blir tekstlinje ─────── */

test("maskin uten kobling blir tekstlinje uten produkt med maskinnavnet, og raden merkes", () => {
  const r = kjør([arbeid({ id: 1 }), maskin({ id: 1, maskin: "Volvo L180G", maskinId: 99, mengde: 6 })], [kob(11, "5")]);
  assert.deepEqual(r.linjer, [
    { produktId: null, produktnavn: "Volvo L180G", antall: 6, tekst: "Volvo L180G – arbeid utført iht. vedlegg", listepris: null },
  ]);
  assert.deepEqual(r.advarsler.utenKobling, ["Volvo L180G"]);
  assert.deepEqual(r.timerIder, [1]);
});

test("ukoblet maskin: timene summeres per maskinnavn over flere rader", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, maskin: "Volvo L180G", maskinId: 99, mengde: 6 }),
      arbeid({ id: 2 }), maskin({ id: 2, maskin: "Volvo L180G", maskinId: 99, mengde: 2.5 }),
      arbeid({ id: 3 }), maskin({ id: 3, maskin: "Hitachi ZX85", maskinId: 98, mengde: 4 })],
    [],
  );
  assert.deepEqual(kort(r.linjer), [["Hitachi ZX85", 4], ["Volvo L180G", 8.5]]);
  assert.deepEqual(r.advarsler.utenKobling, ["Volvo L180G", "Hitachi ZX85"]);
  assert.deepEqual(r.timerIder, [1, 2, 3]);
});

test("rad med ukoblet maskin får ingen Grunnarbeider-linje for personens timer", () => {
  const r = kjør([arbeid({ id: 1, mengde: 8 }), maskin({ id: 1, maskin: "Volvo L180G", maskinId: 99, mengde: 5 })], []);
  assert.deepEqual(kort(r.linjer), [["Volvo L180G", 5]]);
  assert.equal(r.advarsler.somGrunnarbeider, 0);
});

test("ukoblet maskin ved siden av en «faktureres ikke»-maskin: ingen Grunnarbeider-linje", () => {
  const r = kjør(
    [arbeid({ id: 1, mengde: 8 }), maskin({ id: 1, maskin: "Opel Combo", maskinId: 12, mengde: 2 }),
      maskin({ id: 1, maskin: "Volvo L180G", maskinId: 99, mengde: 5 })],
    [kob(12, null, false)],
  );
  assert.deepEqual(kort(r.linjer), [["Volvo L180G", 5]]);
  assert.equal(r.advarsler.somGrunnarbeider, 0);
});

test("__maskin<i> tom gir tekstlinje og utenKobling", () => {
  const r = kjør([arbeid({ id: 1 }), maskin({ id: 1, maskin: "Ukjent", maskinId: null })], [kob(11, "5")]);
  assert.deepEqual(r.advarsler.utenKobling, ["Ukjent"]);
  assert.deepEqual(kort(r.linjer), [["Ukjent", 5]]);
});

test("kobling til produkt som ikke finnes lenger blir tekstlinje, med forklaring i utenKobling", () => {
  const r = kjør([arbeid({ id: 1 }), maskin({ id: 1, maskin: "Cat 324 E" })], [{ maskinId: 11, faktureres: true, produktId: 99999 }]);
  assert.deepEqual(r.advarsler.utenKobling, ["Cat 324 E (produktet finnes ikke lenger i Tripletex)"]);
  assert.deepEqual(r.linjer, [
    { produktId: null, produktnavn: "Cat 324 E", antall: 5, tekst: "Cat 324 E – arbeid utført iht. vedlegg", listepris: null },
  ]);
  assert.deepEqual(r.timerIder, [1]);
});

test("kobling uten produkt regnes som ukoblet; maskin med 0 timer ignoreres", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, maskin: "A", maskinId: 11 }), maskin({ id: 1, maskin: "B", maskinId: 12, mengde: 0 })],
    [kob(11, null)],
  );
  assert.deepEqual(r.advarsler.utenKobling, ["A"]);
  assert.deepEqual(kort(r.linjer), [["A", 5]]);
});

/* ── Tilfelle 2: produkt uten pris blir 0 kr-linje ───────── */

test("produkt med pris null gir vanlig produktlinje og står i utenPris", () => {
  const medNullpris = produkter.map((p) => (p.nummer === "5" ? { ...p, pris: null } : p));
  const r = kjør([arbeid({ id: 1 }), maskin({ id: 1 })], [kob(11, "5")], medNullpris);
  assert.deepEqual(kort(r.linjer), [[pid("5"), 5]]);
  assert.equal(r.linjer[0].listepris, null);
  assert.deepEqual(r.advarsler.utenPris, ["25 t gravemaskin m/ GPS"]);
  assert.deepEqual(r.timerIder, [1]);
});

test("produkt med pris 0 gir vanlig produktlinje og står i utenPris", () => {
  const medNullpris = produkter.map((p) => (p.nummer === "602" ? { ...p, pris: 0 } : p));
  const r = kjør([arbeid({ id: 1, mengde: 7 })], [], medNullpris);
  assert.deepEqual(kort(r.linjer), [[pid("602"), 7]]);
  assert.equal(r.linjer[0].listepris, 0);
  assert.deepEqual(r.advarsler.utenPris, ["Grunnarbeider"]);
});

/* ── Tilfelle 3: allerede fakturert i SmartDok tas med ───── */

test("fakturert maskin tas med som vanlig linje og teller i alleredeFakturert", () => {
  const r = kjør([arbeid({ id: 1, mengde: 8 }), maskin({ id: 1, mengde: 8, fakturert: true })], [kob(11, "5")]);
  assert.deepEqual(kort(r.linjer), [[pid("5"), 8]]);
  assert.deepEqual(r.timerIder, [1]);
  assert.equal(r.advarsler.alleredeFakturert, 8);
  assert.equal(r.advarsler.somGrunnarbeider, 0);
});

test("fakturert og ukoblet maskin blir tekstlinje og teller i alleredeFakturert", () => {
  const r = kjør([arbeid({ id: 1, mengde: 8 }), maskin({ id: 1, mengde: 8, maskinId: 99, fakturert: true })], []);
  assert.deepEqual(kort(r.linjer), [["Cat 324 E", 8]]);
  assert.deepEqual(r.timerIder, [1]);
  assert.equal(r.advarsler.alleredeFakturert, 8);
  assert.equal(r.advarsler.somGrunnarbeider, 0);
  assert.deepEqual(r.advarsler.utenKobling, ["Cat 324 E"]);
});

test("to maskiner der én er fakturert: begge blir linjer, raden merkes", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 5, fakturert: true }), maskin({ id: 1, mengde: 3, maskinId: 13, maskin: "Volvo A30G" })],
    [kob(11, "5"), kob(13, "201")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 5], [pid("201"), 3]]);
  assert.deepEqual(r.timerIder, [1]);
  assert.equal(r.advarsler.alleredeFakturert, 5);
});

test("fakturert overtid tas med som linje og teller i alleredeFakturert", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 }), tillegg({ id: 1, mengde: 2, fakturert: true })],
    [kob(11, "5")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 8], [pid("608"), 2]]);
  assert.deepEqual(r.timerIder, [1]);
  assert.equal(r.advarsler.alleredeFakturert, 2);
});

test("alt fakturert på raden: alt blir linjer og raden merkes", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 8, fakturert: true }), tillegg({ id: 1, mengde: 2, fakturert: true })],
    [kob(11, "5")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 8], [pid("608"), 2]]);
  assert.deepEqual(r.timerIder, [1]);
  assert.equal(r.advarsler.alleredeFakturert, 10);
});

test("ett av to overtidstillegg fakturert: hele cellen tas med og regnes som fakturert", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 }), tillegg({ id: 1, mengde: 1, fakturert: true }), tillegg({ id: 1, mengde: 1 })],
    [kob(11, "5")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 8], [pid("608"), 2]]);
  assert.equal(r.advarsler.alleredeFakturert, 2);
});

test("fakturert maskin som er «faktureres ikke» gir ingen linje og teller ikke i alleredeFakturert", () => {
  const r = kjør([arbeid({ id: 1, mengde: 6 }), maskin({ id: 1, maskinId: 12, fakturert: true })], [kob(12, null, false)]);
  assert.deepEqual(kort(r.linjer), [[pid("602"), 6]]);
  assert.equal(r.advarsler.alleredeFakturert, 0);
});

/* ── Tilfelle 4: overtid blir alltid linje ───────────────── */

test("overtid uten maskin blir 608-linje, og personens timer blir Grunnarbeider", () => {
  const r = kjør([arbeid({ id: 1, mengde: 8 }), tillegg({ id: 1, mengde: 2 })], []);
  assert.deepEqual(kort(r.linjer), [[pid("602"), 8], [pid("608"), 2]]);
  assert.equal(r.advarsler.somGrunnarbeider, 8);
  assert.deepEqual(r.timerIder, [1]);
  assert.equal("overtidUtenMaskin" in r.advarsler, false);
});

test("overtid på rad med ukoblet maskin blir 609-linje ved siden av tekstlinjen", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, maskin: "Volvo L180G", maskinId: 99 }), tillegg({ id: 1, lonnsart: "Overtid 100%", mengde: 1.5 })],
    [],
  );
  assert.deepEqual(kort(r.linjer), [[pid("609"), 1.5], ["Volvo L180G", 5]]);
  assert.deepEqual(r.advarsler.utenKobling, ["Volvo L180G"]);
  assert.deepEqual(r.timerIder, [1]);
});

test("overtid summeres over rader med og uten maskin", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 }), tillegg({ id: 1, mengde: 2 }),
      arbeid({ id: 2 }), tillegg({ id: 2, mengde: 3 })],
    [kob(11, "5")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 8], [pid("602"), 7.5], [pid("608"), 5]]);
  assert.deepEqual(r.timerIder, [1, 2]);
});

test("faktureres:false-maskin + overtid: Grunnarbeider og 608, raden merkes", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, maskinId: 12 }), tillegg({ id: 1, mengde: 2 })],
    [kob(12, null, false)],
  );
  assert.deepEqual(kort(r.linjer), [[pid("602"), 7.5], [pid("608"), 2]]);
  assert.deepEqual(r.timerIder, [1]);
});

test("fakturert maskin + overtid gir 608-linje og raden i timerIder", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 }), maskin({ id: 1, maskinId: 12, maskin: "Opel Combo", mengde: 2 }),
      tillegg({ id: 1, mengde: 2 })],
    [kob(11, "5"), kob(12, null, false)],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 8], [pid("608"), 2]]);
  assert.deepEqual(r.timerIder, [1]);
});

/* ── Tilfelle 5: timer uten maskin blir Grunnarbeider ────── */

test("rader uten maskin: Timer-kolonnen summeres på Grunnarbeider (602)", () => {
  const r = kjør(
    [arbeid({ id: 1, mengde: 7.5 }), arbeid({ id: 2, mengde: 4 }), maskin({ id: 2, mengde: 4 }),
      arbeid({ id: 3, mengde: 2 })],
    [kob(11, "5")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 4], [pid("602"), 9.5]]);
  assert.equal(r.linjer[1].tekst, "Grunnarbeider – arbeid utført iht. vedlegg");
  assert.equal(r.advarsler.somGrunnarbeider, 9.5);
  assert.deepEqual(r.timerIder, [1, 2, 3]);
});

test("rad der alle maskiner er faktureres:false: personens timer blir Grunnarbeider", () => {
  const r = kjør([arbeid({ id: 1, mengde: 6 }), maskin({ id: 1, maskinId: 12 })], [kob(12, null, false)]);
  assert.deepEqual(kort(r.linjer), [[pid("602"), 6]]);
  assert.equal(r.advarsler.somGrunnarbeider, 6);
  assert.deepEqual(r.timerIder, [1]);
});

test("Grunnarbeider fra maskinkobling og fra rader uten maskin legges sammen i én linje", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, maskin: "Håndarbeid", maskinId: 30, mengde: 4 }),
      arbeid({ id: 2, mengde: 3 }),
      arbeid({ id: 3, mengde: 2.25 })],
    [kob(30, "602")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("602"), 9.25]]);
  assert.equal(r.advarsler.somGrunnarbeider, 5.25);
  assert.deepEqual(r.timerIder, [1, 2, 3]);
});

test("samme produkt fra flere maskiner og rader summeres riktig", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, mengde: 3.5 }), maskin({ id: 1, maskinId: 14, maskin: "Cat 325", mengde: 2 }),
      arbeid({ id: 2 }), maskin({ id: 2, mengde: 1.25 }),
      arbeid({ id: 3 }), maskin({ id: 3, maskinId: 14, maskin: "Cat 325", mengde: 0.5 }), tillegg({ id: 3, mengde: 1 }),
      arbeid({ id: 4 }), tillegg({ id: 4, mengde: 0.5 })],
    [kob(11, "5"), kob(14, "5")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 7.25], [pid("602"), 7.5], [pid("608"), 1.5]]);
  assert.deepEqual(r.timerIder, [1, 2, 3, 4]);
});

test("rad med __id uten timer gir ingen linje og merkes ikke", () => {
  const r = kjør([arbeid({ id: 1, mengde: 0 }), arbeid({ id: 2, mengde: 3 })], []);
  assert.deepEqual(kort(r.linjer), [[pid("602"), 3]]);
  assert.deepEqual(r.timerIder, [2]);
});

test("sortering: produktlinjer etter nummer, så tekstlinjer etter navn", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1, maskin: "Zeppelin", maskinId: 90, mengde: 1 }),
      arbeid({ id: 2 }), maskin({ id: 2, maskin: "Atlas", maskinId: 91, mengde: 1 }),
      arbeid({ id: 3 }), maskin({ id: 3, mengde: 1, maskinId: 13, maskin: "Volvo A30G" }),
      arbeid({ id: 4 }), maskin({ id: 4, mengde: 1 })],
    [kob(11, "5"), kob(13, "201")],
  );
  assert.deepEqual(kort(r.linjer), [[pid("5"), 1], [pid("201"), 1], ["Atlas", 1], ["Zeppelin", 1]]);
});

/* ── Feil i tabellen stopper beregningen ─────────────────── */

test("negativt tall i fakturert celle kaster med rad og kolonne", () => {
  const t = byggTabell([arbeid({ id: 1 }), maskin({ id: 1 })], prosjekt, periode);
  const nokkel = t.columns.find((c) => c.label === "Maskintimer1")!.key;
  t.rows[0][nokkel] = "-3";
  assert.throws(() => beregnOrdrelinjer(t.rows, t.columns, [kob(11, "5")], produkter), /rad 1.*Maskintimer1/);
});

test("ugyldig tall i Timer på rad uten maskin kaster", () => {
  const t = byggTabell([arbeid({ id: 1 })], prosjekt, periode);
  const nokkel = t.columns.find((c) => c.label === "Timer")!.key;
  t.rows[0][nokkel] = "sju";
  assert.throws(() => beregnOrdrelinjer(t.rows, t.columns, [], produkter), /rad 1.*Timer/);
});

test("ugyldig __id kaster", () => {
  const t = byggTabell([arbeid({ id: 1 }), maskin({ id: 1 })], prosjekt, periode);
  t.rows[0]["__id"] = "abc";
  assert.throws(() => beregnOrdrelinjer(t.rows, t.columns, [kob(11, "5")], produkter), /__id/);
  t.rows[0]["__id"] = "1.5";
  assert.throws(() => beregnOrdrelinjer(t.rows, t.columns, [kob(11, "5")], produkter), /__id/);
});

test("ukjent overtidskolonne med timer gir ukjentOvertid og ingen linje", () => {
  const r = kjør(
    [arbeid({ id: 1 }), maskin({ id: 1 }), tillegg({ id: 1, lonnsart: "Overtid 70%", mengde: 1 })],
    [kob(11, "5")],
  );
  assert.deepEqual(r.advarsler.ukjentOvertid, ["Overtid 70%"]);
  assert.equal(r.linjer.length, 1);
});

test("ikke-numerisk celle i en fakturert kolonne stopper beregningen i stedet for å bli 0", () => {
  const t = byggTabell([arbeid({ id: 1 }), maskin({ id: 1, mengde: 8 })], prosjekt, periode);
  const nokkel = t.columns.find((c) => c.label === "Maskintimer1")!.key;
  t.rows[0][nokkel] = "8t";
  assert.throws(() => beregnOrdrelinjer(t.rows, t.columns, [kob(11, "5")], produkter), /8t/);
});

// ---------- foreslåProdukt ----------

const f = (navn: string, kategori: string) => foreslåProdukt({ navn, kategori }, produkter);
const navnet = (r: ReturnType<typeof f>) =>
  r && "produktId" in r ? produkter.find((p) => p.id === r.produktId)!.navn : r;

test("forslag: gravemaskiner etter tonn", () => {
  assert.equal(navnet(f("Cat 324 E", "Gravemaskiner")), "25 t gravemaskin m/ GPS");
  assert.equal(navnet(f("Kobelco SK140 SRLC 7", "Gravemaskiner")), "16t gravemaskin");
  assert.equal(navnet(f("Kobelco SK75 SRLC 7", "Gravemaskiner")), "8 t gravemaskin");
  assert.equal(navnet(f("Cat 1.8 tonn minigraver", "Gravemaskiner")), "2.2 t gravemaskin");
  assert.equal(navnet(f("Cat 320EL RR", "Gravemaskiner")), "16t gravemaskin"); // 20 t: 16 (4) er nærmere enn 25 (5)
  assert.equal(navnet(f("Volvo ECR 145 EL", "Gravemaskiner")), "16t gravemaskin"); // 14,5 t
  assert.equal(navnet(f("Volvo 220 D", "Gravemaskiner")), "25 t gravemaskin m/ GPS"); // 22 t
});

test("forslag: hjullastere og dumpere etter modellkode", () => {
  assert.equal(navnet(f("Volvo L180G", "Traktor-hjullastere")), "Hjullaster L180G");
  assert.equal(navnet(f("Volvo L 90 G", "Traktor-hjullastere")), "Hjullaster L 90 G");
  assert.equal(navnet(f("Volvo L 110G", "Traktor-hjullastere")), "Hjullaster L 110F");
  assert.equal(navnet(f("Cat 906", "Traktor-hjullastere")), "Hjullaster Cat 906");
  assert.equal(navnet(f("Volvo A 30G", "Dumperer")), "Dumper Volvo A 30G 20 m3");
  assert.equal(navnet(f("Volvo A20 6x6", "Dumperer")), "Dumper Volvo A20");
  assert.equal(navnet(f("Yanmar C 50 R", "Dumperer")), "Dumper belte Yammar C50");
});

test("forslag: håndarbeid, ikke-fakturerbare og ukjente", () => {
  assert.equal(navnet(f("Håndarbeid", "Håndarbeid")), "Grunnarbeider");
  assert.deepEqual(f("Opel Combo 1.3 DTJ", "Firmabiler"), { faktureres: false });
  assert.deepEqual(f("Engcon 20 rotortilt Volvo 145", "Tilleggsutstyr"), { faktureres: false });
  assert.equal(f("Innleid Henger", "Lastebiler"), null);
  assert.equal(f("Ukjent maskin", "Gravemaskiner"), null);
});
