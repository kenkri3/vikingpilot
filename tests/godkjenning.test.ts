/**
 * Godkjenningskøen og sekvensmotoren.
 *
 * Stoppkriterium 6 for modul 5 og 6. Testene prøver aktivt å omgå køen, å
 * godkjenne to ganger, og å la agenten godkjenne sitt eget forslag.
 *
 * Dette er den viktigste testfilen i systemet. Køen er det eneste som står
 * mellom et utkast og en mottaker.
 */

import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { prisma, lukkDatabase } from "@/lib/db";
import {
  leggIForslag,
  godkjenn,
  avvis,
  ventende,
  erKlarTilSending,
  koStatus,
  hentMedHistorikk,
} from "@/lib/godkjenning/ko";
import { planlegg, kjoerSteg, kjoerAlle, regnPlanlagtTid } from "@/lib/sekvens/motor";

const harDatabase = Boolean(process.env.DATABASE_URL);
const ORGNR = "999444222";
const KILDE = "test/fase4";

describe("beregning av planlagt tid — ren funksjon", () => {
  const start = new Date(Date.UTC(2026, 5, 1, 8, 0, 0));

  test("første steg venter fra sekvensen startet", () => {
    const tid = regnPlanlagtTid(start, { rekkefolge: 1, ventetidTimer: 0 }, []);
    assert.equal(tid.getTime(), start.getTime());
  });

  test("steg 2 venter fra steg 1 ble utført, ikke fra start", () => {
    const utfort = new Date(Date.UTC(2026, 5, 2, 8, 0, 0));
    const tid = regnPlanlagtTid(
      start,
      { rekkefolge: 2, ventetidTimer: 72 },
      [{ rekkefolge: 1, utfortTid: utfort }],
    );

    // 72 timer etter 2. juni 08:00 er 5. juni 08:00 — ikke 4. juni.
    assert.equal(tid.toISOString(), "2026-06-05T08:00:00.000Z");
  });

  test("BRUDD: en forsinket kjøring komprimerer ikke resten av sekvensen", () => {
    // Steg 1 skulle kjørt 1. juni, men kjørte 10. juni. Steg 2 skal fortsatt
    // vente sine 72 timer — ikke fyres av umiddelbart.
    const sentUtfort = new Date(Date.UTC(2026, 5, 10, 8, 0, 0));
    const tid = regnPlanlagtTid(
      start,
      { rekkefolge: 2, ventetidTimer: 72 },
      [{ rekkefolge: 1, utfortTid: sentUtfort }],
    );

    assert.equal(tid.toISOString(), "2026-06-13T08:00:00.000Z");
    assert.ok(tid.getTime() > sentUtfort.getTime(), "steg 2 må ligge etter steg 1");
  });

  test("hopp over utførte steg når vi leter bakover", () => {
    const tid = regnPlanlagtTid(
      start,
      { rekkefolge: 3, ventetidTimer: 24 },
      [
        { rekkefolge: 1, utfortTid: new Date(Date.UTC(2026, 5, 2, 8)) },
        { rekkefolge: 2, utfortTid: null },
      ],
    );

    // Steg 2 er ikke utført, så vi faller tilbake til steg 1 + 24 timer.
    assert.equal(tid.toISOString(), "2026-06-03T08:00:00.000Z");
  });
});

describe("godkjenningskøen", { skip: !harDatabase ? "DATABASE_URL mangler" : false }, () => {
  let orgId: string;
  let kontaktId: string;

  before(async () => {
    await prisma.godkjenning.deleteMany({ where: { tittel: { startsWith: "[test]" } } });
    await prisma.revisjon.deleteMany({ where: { kilde: KILDE } });
    // Kontakter må ryddes eksplisitt. Organisasjonen har onDelete: SetNull på
    // kontakt, så en slettet organisasjon etterlater kontakten — og e-posten er
    // unik. Det felte denne testen én gang.
    await prisma.kontakt.deleteMany({ where: { epost: { endsWith: ".invalid" } } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: ORGNR } });

    const org = await prisma.organisasjon.create({
      data: { orgnr: ORGNR, navn: "Ko Test AS", normalisertNavn: "ko test as", sektor: "PRIVAT" },
    });
    orgId = org.id;

    const kontakt = await prisma.kontakt.create({
      data: { organisasjonId: org.id, fornavn: "Ko", etternavn: "Test", epost: "ko@ko.invalid" },
    });
    kontaktId = kontakt.id;
  });

  beforeEach(async () => {
    await prisma.godkjenning.deleteMany({ where: { tittel: { startsWith: "[test]" } } });
  });

  after(async () => {
    await prisma.godkjenning.deleteMany({ where: { tittel: { startsWith: "[test]" } } });
    await prisma.revisjon.deleteMany({ where: { kilde: KILDE } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: ORGNR } });
    await lukkDatabase();
  });

  test("et forslag havner i køen med status VENTER", async () => {
    const f = await leggIForslag({ tittel: "[test] Enkelt forslag", kanal: "EPOST" });
    assert.equal(f.status, "VENTER");

    const iKo = await ventende();
    assert.ok(
      iKo.some((g) => g.id === f.id),
      "forslaget ligger ikke i køen",
    );
  });

  test("BRUDD: et menneske kan ikke legge inn et forslag", async () => {
    // Ellers kunne noen foreslått og godkjent sitt eget, og fire-øyne-prinsippet
    // ville vært en formalitet.
    await assert.rejects(
      () =>
        leggIForslag({
          tittel: "[test] Selvlaget",
          forslagFra: "kenneth@vikingnet.no",
        }),
      /Ugyldig forslagsstiller/,
    );
  });

  test("BRUDD: bare SYSTEMET og AGENT kan foreslå", async () => {
    const a = await leggIForslag({ tittel: "[test] Fra systemet", forslagFra: "SYSTEMET" });
    const b = await leggIForslag({ tittel: "[test] Fra agenten", forslagFra: "AGENT" });

    assert.equal(a.status, "VENTER");
    assert.equal(b.status, "VENTER");
  });

  test("BRUDD: et forslag kan ikke godkjennes to ganger", async () => {
    const f = await leggIForslag({ tittel: "[test] Dobbeltgodkjenning" });

    const forste = await godkjenn({ godkjenningId: f.id, brukerEpost: "kenneth@vikingnet.no" });
    assert.equal(forste.ok, true);

    const andre = await godkjenn({ godkjenningId: f.id, brukerEpost: "fredrik@vikingnet.no" });
    assert.equal(andre.ok, false, "samme forslag ble godkjent to ganger");
    assert.match(andre.grunn, /allerede som GODKJENT/);
  });

  test("BRUDD: et avvist forslag kan ikke godkjennes etterpå", async () => {
    const f = await leggIForslag({ tittel: "[test] Avvist så godkjent" });

    const avvist = await avvis({ godkjenningId: f.id, brukerEpost: "kenneth@vikingnet.no" });
    assert.equal(avvist.ok, true);

    const forsok = await godkjenn({ godkjenningId: f.id, brukerEpost: "kenneth@vikingnet.no" });
    assert.equal(forsok.ok, false, "et avvist forslag ble godkjent");
    assert.match(forsok.grunn, /allerede som AVVIST/);
  });

  test("BRUDD: parallell godkjenning slipper bare én gjennom", async () => {
    const f = await leggIForslag({ tittel: "[test] Parallell" });

    const resultater = await Promise.all([
      godkjenn({ godkjenningId: f.id, brukerEpost: "a@vikingnet.no" }),
      godkjenn({ godkjenningId: f.id, brukerEpost: "b@vikingnet.no" }),
      godkjenn({ godkjenningId: f.id, brukerEpost: "c@vikingnet.no" }),
    ]);

    const vellykkede = resultater.filter((r) => r.ok).length;
    assert.equal(vellykkede, 1, `forventet én vellykket godkjenning, fikk ${vellykkede}`);

    const beslutninger = await prisma.godkjenningsbeslutning.count({
      where: { godkjenningId: f.id },
    });
    assert.equal(beslutninger, 1, "flere beslutninger ble registrert på samme forslag");
  });

  test("BRUDD: en godkjenning uten navn avvises", async () => {
    const f = await leggIForslag({ tittel: "[test] Uten navn" });

    const utenNavn = await godkjenn({ godkjenningId: f.id, brukerEpost: "" });
    assert.equal(utenNavn.ok, false, "en godkjenning uten navn ble godtatt");

    const fortsatt = await prisma.godkjenning.findUnique({ where: { id: f.id } });
    assert.equal(fortsatt?.status, "VENTER", "forslaget endret status uten gyldig godkjenner");
  });

  test("BRUDD: erKlarTilSending sier nei for alt unntatt GODKJENT", async () => {
    const venter = await leggIForslag({ tittel: "[test] Klarsjekk venter" });
    const neiVenter = await erKlarTilSending(venter.id);
    assert.equal(neiVenter.klar, false, "et forslag som VENTER ble ansett klart");

    const avvist = await leggIForslag({ tittel: "[test] Klarsjekk avvist" });
    await avvis({ godkjenningId: avvist.id, brukerEpost: "k@vikingnet.no" });
    const neiAvvist = await erKlarTilSending(avvist.id);
    assert.equal(neiAvvist.klar, false, "et AVVIST forslag ble ansett klart");

    const godkjent = await leggIForslag({ tittel: "[test] Klarsjekk godkjent" });
    await godkjenn({ godkjenningId: godkjent.id, brukerEpost: "k@vikingnet.no" });
    const jaGodkjent = await erKlarTilSending(godkjent.id);
    assert.equal(jaGodkjent.klar, true, "et GODKJENT forslag ble ikke ansett klart");

    // Og en id som ikke finnes skal gi nei, ikke kaste.
    const ukjent = await erKlarTilSending("finnes-ikke");
    assert.equal(ukjent.klar, false);
  });

  test("beslutningen registrerer hvem og når", async () => {
    const f = await leggIForslag({ tittel: "[test] Sporbarhet" });
    await godkjenn({
      godkjenningId: f.id,
      brukerEpost: "fredrik@vikingnet.no",
      kommentar: "Ser grei ut.",
    });

    const medHistorikk = await hentMedHistorikk(f.id);
    assert.ok(medHistorikk);
    assert.equal(medHistorikk.beslutninger.length, 1);
    assert.equal(medHistorikk.beslutninger[0]!.brukerEpost, "fredrik@vikingnet.no");
    assert.equal(medHistorikk.beslutninger[0]!.kommentar, "Ser grei ut.");
    assert.ok(medHistorikk.beslutninger[0]!.opprettet instanceof Date);
  });

  test("køen teller riktig", async () => {
    const forfor = await koStatus();

    await leggIForslag({ tittel: "[test] Teller 1" });
    await leggIForslag({ tittel: "[test] Teller 2" });

    const etter = await koStatus();
    assert.equal(etter.venter, forfor.venter + 2);
    assert.equal(etter.totalt, forfor.totalt + 2);
  });

  test("BRUDD: køen har ingen rute som hopper over en avgjørelse", async () => {
    // Strukturell test: modulen skal ikke eksportere noe som setter en
    // godkjenning til GODKJENT uten å registrere hvem som gjorde det.
    const modul = await import("@/lib/godkjenning/ko");
    const eksporterte = Object.keys(modul);

    assert.ok(eksporterte.includes("godkjenn"));
    assert.ok(eksporterte.includes("avvis"));

    for (const navn of eksporterte) {
      assert.ok(
        !/auto|tving|force|skip|hoppover/i.test(navn),
        `kømodulen eksporterer «${navn}», som ser ut som en omvei`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Sekvensmotoren
// ---------------------------------------------------------------------------

describe("sekvensmotoren", { skip: !harDatabase ? "DATABASE_URL mangler" : false }, () => {
  let orgId: string;
  let kontaktId: string;
  let versjonId: string;
  let sekvensId: string;

  const SEQNAVN = "Fase4-test-sekvens";

  before(async () => {
    await prisma.prospektSekvens.deleteMany({
      where: { prospekt: { organisasjon: { orgnr: ORGNR } } },
    });
    await prisma.godkjenning.deleteMany({ where: { tittel: { startsWith: "Utkast: " } } });
    await prisma.sekvens.deleteMany({ where: { navn: SEQNAVN } });
    await prisma.kontakt.deleteMany({ where: { epost: { endsWith: ".invalid" } } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: ORGNR } });

    const org = await prisma.organisasjon.create({
      data: { orgnr: ORGNR, navn: "Sekvens Test AS", normalisertNavn: "sekvens test as", sektor: "PRIVAT" },
    });
    orgId = org.id;

    const kontakt = await prisma.kontakt.create({
      data: {
        organisasjonId: org.id,
        fornavn: "Sekvens",
        etternavn: "Test",
        epost: "sekvens@sekvens.invalid",
      },
    });
    kontaktId = kontakt.id;

    const sekvens = await prisma.sekvens.create({
      data: { navn: SEQNAVN, beskrivelse: "Brukes av testene." },
    });
    sekvensId = sekvens.id;

    const versjon = await prisma.sekvensVersjon.create({
      data: { sekvensId: sekvens.id, versjon: 1, aktiv: true },
    });
    versjonId = versjon.id;

    await prisma.sekvensSteg.createMany({
      data: [
        {
          versjonId: versjon.id,
          rekkefolge: 1,
          navn: "Første",
          type: "EPOST",
          kanal: "EPOST",
          ventetidTimer: 0,
          emneMal: "Første henvendelse",
        },
        {
          versjonId: versjon.id,
          rekkefolge: 2,
          navn: "Andre",
          type: "EPOST",
          kanal: "EPOST",
          ventetidTimer: 72,
          emneMal: "Oppfølging",
        },
        {
          versjonId: versjon.id,
          rekkefolge: 3,
          navn: "Tredje",
          type: "EPOST",
          kanal: "EPOST",
          ventetidTimer: 120,
          emneMal: "Siste",
        },
      ],
    });
  });

  after(async () => {
    await prisma.prospektSekvens.deleteMany({
      where: { prospekt: { organisasjon: { orgnr: ORGNR } } },
    });
    await prisma.godkjenning.deleteMany({ where: { tittel: { startsWith: "Utkast: " } } });
    await prisma.sekvens.deleteMany({ where: { navn: SEQNAVN } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: ORGNR } });
    await lukkDatabase();
  });

  /** Oppretter et prospekt med en aktiv sekvenskjøring. */
  async function lagSekvenskjoering(startet: Date): Promise<string> {
    const prospekt = await prisma.prospekt.create({
      data: { organisasjonId: orgId, kontaktId, status: "I_SEKVENS" },
    });

    const kjoering = await prisma.prospektSekvens.create({
      data: { prospektId: prospekt.id, versjonId, status: "AKTIV", startet },
    });

    return kjoering.id;
  }

  test("planlegg finner første steg og sier det er klart med en gang", async () => {
    const id = await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));
    const plan = await planlegg(id, new Date(Date.UTC(2026, 5, 1, 9)));

    assert.ok(plan);
    assert.ok(plan.nesteSteg);
    assert.equal(plan.nesteSteg.rekkefolge, 1);
    assert.equal(plan.nesteSteg.klar, true);
    assert.equal(plan.antallSteg, 3);
  });

  test("planlegg sier nei når det ikke er på tide ennå", async () => {
    const id = await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));

    // Kjør steg 1, slik at steg 2 blir neste.
    await kjoerSteg(id, { torrkjoering: false, naa: new Date(Date.UTC(2026, 5, 1, 9)) });

    const plan = await planlegg(id, new Date(Date.UTC(2026, 5, 1, 10)));
    assert.ok(plan?.nesteSteg);
    assert.equal(plan.nesteSteg.rekkefolge, 2);
    assert.equal(plan.nesteSteg.klar, false, "steg 2 ble ansett klart for tidlig");
  });

  test("BRUDD: tørrkjøring skriver ingenting", async () => {
    const id = await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));

    const forGodkjenninger = await prisma.godkjenning.count();
    const forMeldinger = await prisma.dialogMelding.count();
    const forSteg = await prisma.stegKjoering.count();

    const resultat = await kjoerSteg(id, { torrkjoering: true, naa: new Date(Date.UTC(2026, 5, 1, 9)) });

    assert.equal(resultat.utfall, "UTKAST_LAGET");
    assert.match(resultat.grunn, /Tørrkjøring/);

    assert.equal(await prisma.godkjenning.count(), forGodkjenninger, "tørrkjøring skrev en godkjenning");
    assert.equal(await prisma.dialogMelding.count(), forMeldinger, "tørrkjøring skrev en melding");
    assert.equal(await prisma.stegKjoering.count(), forSteg, "tørrkjøring skrev et steg");
  });

  test("BRUDD: motoren SENDER ingenting — den lager et utkast i køen", async () => {
    const id = await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));

    const resultat = await kjoerSteg(id, {
      torrkjoering: false,
      naa: new Date(Date.UTC(2026, 5, 1, 9)),
    });

    assert.equal(resultat.utfall, "UTKAST_LAGET");
    assert.ok(resultat.godkjenningId, "ingen godkjenning ble opprettet");
    assert.ok(resultat.dialogMeldingId, "ingen dialogmelding ble opprettet");

    // Meldingen skal stå som VENTER_GODKJENNING, aldri SENDT.
    const melding = await prisma.dialogMelding.findUnique({
      where: { id: resultat.dialogMeldingId },
    });
    assert.equal(melding?.status, "VENTER_GODKJENNING", `meldingen står som ${melding?.status}`);

    // Og den skal IKKE være klar til sending før et menneske har godkjent.
    const klar = await erKlarTilSending(resultat.godkjenningId);
    assert.equal(klar.klar, false, "et ferskt utkast ble ansett klart til sending");

    // Ingen utsending skal være opprettet i det hele tatt.
    const utsendinger = await prisma.utsending.count({
      where: { dialogMeldingId: resultat.dialogMeldingId },
    });
    assert.equal(utsendinger, 0, "motoren opprettet en utsending — den skal bare lage utkast");
  });

  test("BRUDD: godkjenning flytter OGSÅ selve meldingen til GODKJENT", async () => {
    // Dette var en ekte feil. Godkjenningen ble satt til GODKJENT, men
    // dialogmeldingen ble stående i VENTER_GODKJENNING. Utsendingsjobben ser på
    // meldingens status, så en godkjent melding ble liggende usendt for alltid —
    // og alt så riktig ut. Vi fant det bare ved å kjøre hele kjeden ende-til-ende.
    const id = await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));
    const resultat = await kjoerSteg(id, {
      torrkjoering: false,
      naa: new Date(Date.UTC(2026, 5, 1, 9)),
    });

    const forStatus = await prisma.dialogMelding.findUnique({
      where: { id: resultat.dialogMeldingId! },
      select: { status: true },
    });
    assert.equal(forStatus?.status, "VENTER_GODKJENNING");

    await godkjenn({
      godkjenningId: resultat.godkjenningId!,
      brukerEpost: "kenneth@vikingnet.no",
    });

    const etterStatus = await prisma.dialogMelding.findUnique({
      where: { id: resultat.dialogMeldingId! },
      select: { status: true },
    });
    assert.equal(
      etterStatus?.status,
      "GODKJENT",
      "meldingen ble ikke flyttet til GODKJENT — utsendingsjobben ville aldri funnet den",
    );

    // Og utsendingsjobben skal nå finne den.
    const { kjoerUtsending } = await import("@/lib/sekvens/utsending");
    const kjoert = await kjoerUtsending({ torrkjoering: true, naa: new Date(Date.UTC(2026, 5, 6, 9)) });

    assert.ok(kjoert.vurdert >= 1, "utsendingsjobben fant ikke den godkjente meldingen");
  });

  test("avvisning flytter meldingen til AVVIST", async () => {
    const id = await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));
    const resultat = await kjoerSteg(id, {
      torrkjoering: false,
      naa: new Date(Date.UTC(2026, 5, 1, 9)),
    });

    await avvis({
      godkjenningId: resultat.godkjenningId!,
      brukerEpost: "kenneth@vikingnet.no",
    });

    const melding = await prisma.dialogMelding.findUnique({
      where: { id: resultat.dialogMeldingId! },
      select: { status: true },
    });
    assert.equal(melding?.status, "AVVIST");
  });

  test("etter godkjenning er utkastet klart, men fortsatt ikke sendt", async () => {
    const id = await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));
    const resultat = await kjoerSteg(id, {
      torrkjoering: false,
      naa: new Date(Date.UTC(2026, 5, 1, 9)),
    });

    await godkjenn({
      godkjenningId: resultat.godkjenningId!,
      brukerEpost: "kenneth@vikingnet.no",
    });

    const klar = await erKlarTilSending(resultat.godkjenningId!);
    assert.equal(klar.klar, true, "godkjent utkast ble ikke ansett klart");

    // Men fortsatt ingen utsending — den lages av utsendingsjobben, og bare
    // hvis kanalen er åpen.
    const utsendinger = await prisma.utsending.count({
      where: { dialogMeldingId: resultat.dialogMeldingId },
    });
    assert.equal(utsendinger, 0, "godkjenning alene opprettet en utsending");
  });

  test("BRUDD: kanalen er stengt, så ingenting kan gå ut uansett", async () => {
    const { kanSende } = await import("@/lib/guards/automatisk");
    const svar = await kanSende({
      kanal: "EPOST",
      epost: "sekvens@sekvens.invalid",
      kontaktId,
      avsenderId: "finnes-ikke",
    });

    assert.equal(svar.tillatt, false, "EPOST-kanalen var åpen — den skal være av");
  });

  test("planlegg sier AVSLUTTET når alle steg er utført", async () => {
    const id = await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));

    // Kjør alle tre stegene med god margin.
    await kjoerSteg(id, { torrkjoering: false, naa: new Date(Date.UTC(2026, 5, 1, 9)) });
    await kjoerSteg(id, { torrkjoering: false, naa: new Date(Date.UTC(2026, 5, 10, 9)) });
    await kjoerSteg(id, { torrkjoering: false, naa: new Date(Date.UTC(2026, 5, 20, 9)) });

    const plan = await planlegg(id, new Date(Date.UTC(2026, 5, 25, 9)));
    assert.ok(plan);
    assert.equal(plan.nesteSteg, null, "det finnes fortsatt et neste steg");
    assert.match(plan.grunn, /Alle steg er utført/);
  });

  test("kjoerAlle teller riktig og skriver bare utkast", async () => {
    // Rydd bort tidligere kjøringer for denne organisasjonen.
    await prisma.prospektSekvens.deleteMany({
      where: { prospekt: { organisasjonId: orgId } },
    });

    // Rydd også bort utsendinger som henger på denne organisasjonens kontakter,
    // slik at vi måler våre egne rader og ikke naboens. Testfilene kjører
    // samtidig, og et globalt antall ville vært et kappløp.
    await prisma.utsending.deleteMany({ where: { organisasjonId: orgId } });

    await prisma.prospekt.deleteMany({ where: { organisasjonId: orgId } });

    await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));
    await lagSekvenskjoering(new Date(Date.UTC(2026, 5, 1, 8)));

    const forMeldinger = await prisma.dialogMelding.count();

    const resultat = await kjoerAlle({
      torrkjoering: false,
      naa: new Date(Date.UTC(2026, 5, 1, 9)),
    });

    assert.ok(resultat.vurdert >= 2, `vurderte bare ${resultat.vurdert} sekvenser`);
    assert.ok(resultat.utkast >= 2, `lagde bare ${resultat.utkast} utkast`);

    const etterMeldinger = await prisma.dialogMelding.count();
    assert.equal(
      etterMeldinger,
      forMeldinger + resultat.utkast,
      "antall meldinger stemmer ikke med antall utkast",
    );

    // Sekvensmotoren skal ikke ha sendt noe for DENNE organisasjonen.
    const sendte = await prisma.utsending.count({
      where: { status: "SENDT", organisasjonId: orgId },
    });
    assert.equal(sendte, 0, "sekvensmotoren sendte noe — den skal bare lage utkast");
  });

  test("sekvensen hopper over prospekt uten kontakt", async () => {
    const prospekt = await prisma.prospekt.create({
      data: { organisasjonId: orgId, status: "I_SEKVENS" },
    });
    const kjoering = await prisma.prospektSekvens.create({
      data: {
        prospektId: prospekt.id,
        versjonId,
        status: "AKTIV",
        startet: new Date(Date.UTC(2026, 5, 1, 8)),
      },
    });

    const resultat = await kjoerSteg(kjoering.id, {
      torrkjoering: false,
      naa: new Date(Date.UTC(2026, 5, 1, 9)),
    });

    assert.equal(resultat.utfall, "INGEN_MOTTAKER");
  });
});
