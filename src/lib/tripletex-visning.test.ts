import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ordreberegning, Produkt } from "./ordrelinjer.ts";
import type { ColMeta } from "./smartdok-parser.ts";
import { leggPaaOrdreInn, lagreKoblingInn } from "./tripletex.ts";
import {
  alleredeSendte,
  anbefaltAvklaring,
  angreInn,
  frigiTekst,
  sendingSperre,
  UAVKLART_SPERRE,
  byggLeggPaaOrdre,
  fmtDato,
  forklarInndatafeil,
  gjeldendeStatus,
  handlinger,
  koblingsrader,
  lagreInn,
  linjesum,
  sendbartFilnavn,
  skjulteFaktureringskolonner,
  statusTekst,
  tilBase64,
  totalsum,
  treffer,
  tripletexOrdreUrl,
  vurderForhandsvisning,
} from "./tripletex-visning.ts";

const tomBeregning = (o: Partial<Ordreberegning> = {}): Ordreberegning => ({
  linjer: [{ produktId: 1, produktnavn: "Grunnarbeider", antall: 7.5, tekst: "Grunnarbeider – arbeid utført iht. vedlegg", listepris: 800 }],
  timerIder: [10, 11],
  advarsler: { utenMaskin: 0, haandlagde: 0, utenKobling: [], utenPris: [], ukjentOvertid: [] },
  ...o,
});

/* ── base64 ── */

test("tilBase64 gir det samme som Buffer, også over bitgrensen", () => {
  for (const n of [0, 1, 2, 3, 0x8000 - 1, 0x8000, 0x8000 * 3 + 7]) {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) % 256;
    assert.equal(tilBase64(b), Buffer.from(b).toString("base64"), `lengde ${n}`);
    assert.equal(tilBase64(b.buffer), Buffer.from(b).toString("base64"), `ArrayBuffer ${n}`);
  }
});

test("tilBase64 tåler en fil på 3 MB uten å sprenge stakken", () => {
  const b = new Uint8Array(3 * 1024 * 1024).fill(200);
  assert.equal(tilBase64(b), Buffer.from(b).toString("base64"));
});

/* ── filnavn ── */

test("sendbartFilnavn fjerner farlige tegn, kapper og ender alltid på .pdf", () => {
  assert.equal(sendbartFilnavn("1234_Veien_-_November_2026.pdf"), "1234_Veien_-_November_2026.pdf");
  assert.equal(sendbartFilnavn('a"b\\c/d\ne.pdf'), "abcde.pdf");
  assert.equal(sendbartFilnavn(""), "timeliste.pdf");
  assert.equal(sendbartFilnavn(".pdf"), "timeliste.pdf");
  const lang = sendbartFilnavn("x".repeat(300) + ".pdf");
  assert.equal(lang.length, 120);
  assert.ok(lang.endsWith(".pdf"));
  assert.ok(leggPaaOrdreInn.shape.filnavn.safeParse(lang).success);
  assert.ok(leggPaaOrdreInn.shape.filnavn.safeParse(sendbartFilnavn('æ"\x01.PDF')).success);
});

/* ── summer og visning ── */

test("linjesum med og uten rabatt, rundet til øre", () => {
  assert.equal(linjesum(7.5, 800), 6000);
  assert.equal(linjesum(3, 999.99, 10), 2699.97);
  assert.equal(linjesum(0.1, 0.2), 0.02);
  assert.equal(totalsum([{ antall: 2, pris: 100 }, { antall: 1, pris: null }, { antall: 1, pris: 50, rabatt: 50 }]), 225);
});

test("fmtDato og ordrelenken", () => {
  assert.equal(fmtDato("2026-11-03"), "03.11.2026");
  assert.equal(fmtDato("rart"), "rart");
  assert.equal(tripletexOrdreUrl(12345), "https://tripletex.no/execute/orderMenu?orderId=12345");
});

/* ── statusord ── */

test("hvert statusord har en norsk forklaring", () => {
  for (const s of ["sendt", "sendt_uten_vedlegg", "sendt_uten_merke", "ukjent_utfall", "startet", "feilet", "angret"]) {
    const t = statusTekst(s);
    assert.notEqual(t.tittel, s, s);
    assert.ok(t.forklaring.length > 20, s);
  }
  assert.equal(statusTekst("noe_nytt").tittel, "noe_nytt");
  assert.match(statusTekst("ukjent_utfall").forklaring, /Ikke send/);
  assert.equal(statusTekst("ukjent_utfall").tone, "feil");
});

test("gjeldendeStatus: startet over ti minutter er ukjent utfall", () => {
  const naa = Date.parse("2026-11-26T12:00:00Z");
  assert.equal(gjeldendeStatus("startet", "2026-11-26T11:55:00Z", naa), "startet");
  assert.equal(gjeldendeStatus("startet", "2026-11-26T11:49:00Z", naa), "ukjent_utfall");
  assert.equal(gjeldendeStatus("startet", null, naa), "ukjent_utfall");
  assert.equal(gjeldendeStatus("sendt", null, naa), "sendt");
});

test("handlinger speiler adminbordets lovlige overganger", () => {
  assert.deepEqual(handlinger("sendt"), { fjernMerke: true, avklar: false, merk: false });
  assert.deepEqual(handlinger("sendt_uten_vedlegg"), { fjernMerke: true, avklar: false, merk: false });
  assert.deepEqual(handlinger("sendt_uten_merke", false), { fjernMerke: true, avklar: true, merk: true });
  assert.deepEqual(handlinger("ukjent_utfall", true), { fjernMerke: false, avklar: true, merk: true });
  for (const s of ["angret", "feilet", "startet"]) {
    assert.deepEqual(handlinger(s, true), { fjernMerke: false, avklar: false, merk: false });
  }
});

test("handlinger: «Merk som sendt» skjules etter ukjent utfall på en eksisterende ordre", () => {
  assert.equal(handlinger("ukjent_utfall", false).merk, false);
  assert.equal(handlinger("ukjent_utfall", null).merk, false);
  assert.equal(handlinger("ukjent_utfall", false).avklar, true);
});

test("frigiTekst: sendt uten merke sier at linjene står på ordren", () => {
  assert.equal(
    frigiTekst("sendt_uten_merke", "10240"),
    "Linjene står på ordre 10240 i Tripletex. Fjern dem der først, ellers blir timene fakturert to ganger.",
  );
  assert.match(frigiTekst("ukjent_utfall", null), /sendbare igjen/);
});

test("sendingSperre: uavklarte sendinger og feil ved henting sperrer", () => {
  const naa = Date.parse("2026-11-26T12:00:00Z");
  const s = (status: string, endret: string | null = "2026-11-26T11:59:00Z") => ({ status, endret });
  assert.equal(sendingSperre({ ok: true, sendinger: [] }, naa), null);
  assert.equal(sendingSperre({ ok: true, sendinger: [s("sendt"), s("angret"), s("feilet"), s("sendt_uten_vedlegg")] }, naa), null);
  for (const st of ["ukjent_utfall", "sendt_uten_merke", "startet"]) {
    assert.deepEqual(sendingSperre({ ok: true, sendinger: [s("sendt"), s(st)] }, naa), { id: "uavklart", tekst: UAVKLART_SPERRE }, st);
  }
  // En gammel «startet» er ukjent utfall: sperrer fortsatt.
  assert.equal(sendingSperre({ ok: true, sendinger: [s("startet", "2026-11-26T10:00:00Z")] }, naa)?.id, "uavklart");
  const feil = sendingSperre({ ok: false, feil: "Du er logget ut.", loggInn: true }, naa);
  assert.equal(feil?.id, "sendingerFeil");
  assert.equal(feil?.loggInn, true);
  assert.match(feil!.tekst, /logget ut/);
});

test("angreInn legger tilbake den forrige koblingen", () => {
  const forrige = { maskin_id: 2, maskinnavn: "Cat 324 E", faktureres: true, produkt_id: 102, produktnummer: "102", produktnavn: "25 t gravemaskin" };
  const inn = angreInn(forrige);
  assert.deepEqual(inn, { maskinId: 2, maskinnavn: "Cat 324 E", faktureres: true, produktId: 102, produktnummer: "102", produktnavn: "25 t gravemaskin" });
  assert.ok(lagreKoblingInn.safeParse(inn).success);
});

test("anbefaltAvklaring fremhever bare det adminbordet godtar", () => {
  const funnet = (nyOrdre: boolean, antallLinjer: number) => ({ funnet: true, nyOrdre, antallLinjer });
  assert.equal(anbefaltAvklaring("sendt_uten_merke", funnet(false, 3)), "merk");
  assert.equal(anbefaltAvklaring("ukjent_utfall", { funnet: false, nyOrdre: true, antallLinjer: 0 }), "frigi");
  assert.equal(anbefaltAvklaring("ukjent_utfall", funnet(true, 2)), "merk");
  assert.equal(anbefaltAvklaring("ukjent_utfall", funnet(true, 0)), "frigi");
  assert.equal(anbefaltAvklaring("ukjent_utfall", funnet(false, 5)), null);
});

/* ── forhåndsvisningen ── */

test("vurderForhandsvisning: uten kobling og uten pris sperrer, resten er advarsler", () => {
  const v = vurderForhandsvisning(
    tomBeregning({
      advarsler: { utenMaskin: 3.5, haandlagde: 2, utenKobling: ["Cat 324"], utenPris: ["Grunnarbeider"], ukjentOvertid: ["Overtid 70%"] },
    }),
    { alleredeSendt: [], skjulteKolonner: ["Maskintimer2"] },
  );
  assert.deepEqual(v.sperrer.map((m) => m.id), ["utenKobling", "utenPris"]);
  assert.deepEqual(v.advarsler.map((m) => m.id), ["utenMaskin", "haandlagde", "ukjentOvertid", "skjulteKolonner"]);
  assert.match(v.sperrer[0].tekst, /«Cat 324»/);
  assert.match(v.advarsler[0].tekst, /3,5 timer/);
});

test("vurderForhandsvisning: ingen linjer sperrer, og allerede sendte rader sperrer", () => {
  assert.deepEqual(
    vurderForhandsvisning(tomBeregning({ linjer: [], timerIder: [] }), { alleredeSendt: [], skjulteKolonner: [] }).sperrer.map((m) => m.id),
    ["ingenLinjer"],
  );
  const v = vurderForhandsvisning(tomBeregning(), { alleredeSendt: ["Ordre 1234"], skjulteKolonner: [] });
  assert.deepEqual(v.sperrer.map((m) => m.id), ["alleredeSendt"]);
  assert.match(v.sperrer[0].tekst, /Ordre 1234/);
  assert.deepEqual(vurderForhandsvisning(tomBeregning(), { alleredeSendt: [], skjulteKolonner: [] }), { sperrer: [], advarsler: [] });
});

test("alleredeSendte ser bare på rader som skal merkes", () => {
  const rows = [
    { __id: "10", tx: "Ordre 1234" },
    { __id: "11", tx: "Ikke sendt" },
    { __id: "12", tx: "Ordre 99" }, // ikke med i timerIder: blir ikke merket, sperrer ikke
    { __id: "", tx: "Ordre 5" },
  ];
  assert.deepEqual(alleredeSendte(rows, "tx", [10, 11]), ["Ordre 1234"]);
  assert.deepEqual(alleredeSendte(rows, undefined, [10]), []);
});

test("skjulteFaktureringskolonner: «Faktureres ikke» varsles ikke, skjult maskinnavn varsles", () => {
  const columns: ColMeta[] = [
    { key: "n1", label: "Maskinnavn1", defaultWidth: 1 },
    { key: "m1", label: "Maskintimer1", defaultWidth: 1 },
    { key: "n2", label: "Maskinnavn2", defaultWidth: 1 },
    { key: "m2", label: "Maskintimer2", defaultWidth: 1 },
  ];
  const rows = [
    { n1: "Ford Ranger", m1: "8", __maskin1: "13", n2: "Cat", m2: "2", __maskin2: "11" },
    { n1: "Ford Ranger", m1: "4", __maskin1: "13", n2: "", m2: "", __maskin2: "" },
  ];
  const koblinger = [
    { maskinId: 13, faktureres: false, produktId: null },
    { maskinId: 11, faktureres: true, produktId: 102 },
  ];
  // Alt i kolonne 1 er firmabil (faktureres ikke): ingen varsel selv om begge er skjult.
  assert.deepEqual(skjulteFaktureringskolonner(rows, columns, new Set(["m2"]), koblinger), ["Maskinnavn2"]);
  assert.deepEqual(skjulteFaktureringskolonner(rows, columns, new Set(), koblinger), ["Maskinnavn2", "Maskintimer2"]);
  // Uten koblinger vet vi ikke: alt med timer varsles.
  assert.deepEqual(skjulteFaktureringskolonner(rows, columns, new Set(["n1", "n2"]), []), ["Maskintimer1", "Maskintimer2"]);
});

test("skjulteFaktureringskolonner: bare skjulte maskin- og overtidskolonner med timer", () => {
  const columns: ColMeta[] = [
    { key: "timer", label: "Timer", defaultWidth: 1 },
    { key: "m1", label: "Maskintimer1", defaultWidth: 1 },
    { key: "m2", label: "Maskintimer2", defaultWidth: 1 },
    { key: "o50", label: "Overtid 50%", defaultWidth: 1 },
    { key: "o70", label: "Overtid 70%", defaultWidth: 1 },
  ];
  const rows = [{ timer: "8", m1: "7,5", m2: "", o50: "1", o70: "2" }];
  assert.deepEqual(skjulteFaktureringskolonner(rows, columns, new Set(["timer", "m1"])), ["Overtid 50%"]);
  assert.deepEqual(skjulteFaktureringskolonner(rows, columns, new Set(["m1", "o50"])), []);
});

test("byggLeggPaaOrdre lager en kropp som består skjemaet", () => {
  const pdf = Buffer.from("%PDF-1.3 test").toString("base64");
  const inn = byggLeggPaaOrdre({
    prosjekt: "1234",
    ordre: { ny: true },
    beregning: tomBeregning(),
    pdf,
    filnavn: "1234_Veien.pdf",
    periode: { fra: "2026-11-01", til: "2026-11-30" },
  });
  assert.deepEqual(inn.ordre, { ny: true });
  assert.deepEqual(inn.linjer, [{ produktId: 1, antall: 7.5, tekst: "Grunnarbeider – arbeid utført iht. vedlegg" }]);
  assert.deepEqual(inn.timerIder, [10, 11]);
  assert.ok(leggPaaOrdreInn.safeParse(inn).success);

  const eks = byggLeggPaaOrdre({
    prosjekt: "1234", ordre: { id: 77 }, beregning: tomBeregning(), pdf, filnavn: "x", periode: { fra: "2026-11-01", til: "2026-11-30" },
  });
  assert.deepEqual(eks.ordre, { id: 77 });
  assert.equal(eks.filnavn, "x.pdf");
  assert.ok(leggPaaOrdreInn.safeParse(eks).success);
});

test("forklarInndatafeil gir norske meldinger", () => {
  const lang = byggLeggPaaOrdre({
    prosjekt: "1234",
    ordre: { ny: true },
    beregning: tomBeregning({ linjer: [{ produktId: 1, produktnavn: "x", antall: 1, tekst: "x".repeat(201), listepris: 1 }] }),
    pdf: "AAAA",
    filnavn: "a.pdf",
    periode: { fra: "2026-11-01", til: "2026-11-30" },
  });
  const p = leggPaaOrdreInn.safeParse(lang);
  assert.ok(!p.success);
  assert.match(forklarInndatafeil(p.error.issues), /linjetekst er for lang/);

  const dobbel = leggPaaOrdreInn.safeParse({ ...lang, linjer: [{ produktId: 1, antall: 1, tekst: "ok" }], timerIder: [1, 1] });
  assert.ok(!dobbel.success);
  assert.equal(forklarInndatafeil(dobbel.error.issues), "Kan ikke sende: Samme time er med to ganger.");
});

/* ── koblingslisten ── */

const produkter: Produkt[] = [
  { id: 602, nummer: "602", navn: "Grunnarbeider", pris: 750 },
  { id: 1, nummer: "101", navn: "14 t gravemaskin", pris: 1100 },
  { id: 2, nummer: "102", navn: "25 t gravemaskin", pris: 1400 },
];

test("koblingsrader slår sammen maskiner og koblinger, og forslag er bare forslag", () => {
  const maskiner = [
    { id: 1, nummer: "H1", navn: "Håndarbeid", kategori: "Håndarbeid" },
    { id: 2, nummer: "G1", navn: "Cat 324 E", kategori: "Gravemaskiner" },
    { id: 3, nummer: "B1", navn: "Ford Ranger", kategori: "Firmabiler" },
    { id: 4, nummer: "G2", navn: "Volvo EC140", kategori: "Gravemaskiner" },
  ];
  const koblinger = [
    { maskin_id: 2, maskinnavn: "Cat 324 E", faktureres: true, produkt_id: 2, produktnummer: "102", produktnavn: "25 t gravemaskin" },
    { maskin_id: 4, maskinnavn: "Volvo EC140", faktureres: true, produkt_id: 999, produktnummer: "199", produktnavn: "Gammel" },
    { maskin_id: 50, maskinnavn: "Solgt maskin", faktureres: false, produkt_id: null, produktnummer: null, produktnavn: null },
  ];
  const rader = koblingsrader(maskiner, koblinger, produkter);
  const fra = (id: number) => rader.find((r) => r.maskinId === id)!;

  assert.equal(fra(2).mangler, false);
  assert.equal(fra(2).forslag, null);
  assert.equal(fra(2).lagret?.produkttekst, "102 25 t gravemaskin");

  assert.equal(fra(1).mangler, true);
  assert.equal(fra(1).lagret, null);
  assert.deepEqual(fra(1).forslag, { produkt: produkter[0] });

  assert.deepEqual(fra(3).forslag, { faktureres: false });

  // Produktet er borte i Tripletex: mangler, med forslag og gammel tekst.
  assert.equal(fra(4).mangler, true);
  assert.equal(fra(4).lagret?.produktBorte, true);
  assert.equal(fra(4).lagret?.produkttekst, "199 Gammel");
  assert.deepEqual(fra(4).forslag, { produkt: produkter[1] });

  // Inaktiv maskin med lagret kobling kommer sist.
  assert.equal(rader.at(-1)!.maskinId, 50);
  assert.equal(rader.at(-1)!.aktiv, false);
  assert.equal(rader.at(-1)!.mangler, false);
});

test("lagreInn lager gyldige kropper for produkt og «Faktureres ikke»", () => {
  const rad = { maskinId: 2, navn: "  Cat 324 E " };
  const medProdukt = lagreInn(rad, { produkt: produkter[1] });
  assert.deepEqual(medProdukt, {
    maskinId: 2, maskinnavn: "Cat 324 E", faktureres: true, produktId: 1, produktnummer: "101", produktnavn: "14 t gravemaskin",
  });
  assert.ok(lagreKoblingInn.safeParse(medProdukt).success);
  const ikke = lagreInn({ maskinId: 3, navn: "" }, { faktureres: false });
  assert.equal(ikke.maskinnavn, "Maskin 3");
  assert.equal(ikke.produktId, null);
  assert.ok(lagreKoblingInn.safeParse(ikke).success);
});

test("treffer søker i navn, nummer, kategori og produkt", () => {
  const [rad] = koblingsrader(
    [{ id: 2, nummer: "G1", navn: "Cat 324 E", kategori: "Gravemaskiner" }],
    [{ maskin_id: 2, maskinnavn: "Cat 324 E", faktureres: true, produkt_id: 2, produktnummer: "102", produktnavn: "25 t gravemaskin" }],
    produkter,
  );
  for (const s of ["", "cat", "g1", "grave", "25 t"]) assert.ok(treffer(rad, s), s);
  assert.ok(!treffer(rad, "dumper"));
});
