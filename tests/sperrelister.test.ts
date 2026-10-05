/**
 * Bruddforsøk mot guardrailsene.
 *
 * Dette er stoppkriterium 6: guardrailsene skal være testet med forsøk på å
 * bryte dem — og avvise.
 *
 * Hver test prøver aktivt å omgå et gjerde. Testene skal ikke bekrefte at
 * systemet virker når alt er riktig; de skal bekrefte at det sier nei når noen
 * prøver seg.
 *
 * VIKTIG om testdataene: hver test bruker sitt eget underdomene under
 * `brudd.invalid`, og alle adresser ligger under `@brudd.invalid`. En
 * domenesperre i én test ville ellers sperret mottakerne i alle de andre.
 * Det lærte jeg ved å kjøre dem første gang.
 */

import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { prisma, lukkDatabase } from "@/lib/db";
import {
  sjekkSperreliste,
  leggTilSperre,
  opphevSperre,
  normaliserEpost,
  normaliserDomene,
  epostDomene,
  erUgyldigSperre,
} from "@/lib/guards/sperreliste";
import {
  kanSende,
  sperrAvmelding,
  sperrBounce,
  sperrKlage,
  sjekkKanalApen,
} from "@/lib/guards/automatisk";
import { skrivRevisjon, lesRevisjoner, lesKjede, tellRevisjoner } from "@/lib/revisjon";

const harDatabase = Boolean(process.env.DATABASE_URL);

/** Alle testdata ligger under dette domenet, så de kan ryddes samlet. */
const TESTDOMENE = "brudd.invalid";
const KILDE = "test/brudd";

function adresse(lokal: string, underdomene: string): string {
  return `${lokal}@${underdomene}.${TESTDOMENE}`;
}

describe("sperrelister — bruddforsøk", { skip: !harDatabase ? "DATABASE_URL mangler" : false }, () => {
  const ORGNR = "999111222";

  let organisasjonId: string;

  before(async () => {
    await prisma.revisjon.deleteMany({ where: { kilde: KILDE } });
    await prisma.sperreliste.deleteMany({ where: { epost: { endsWith: TESTDOMENE } } });
    await prisma.sperreliste.deleteMany({ where: { epostDomene: { endsWith: TESTDOMENE } } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: ORGNR } });

    const org = await prisma.organisasjon.create({
      data: { orgnr: ORGNR, navn: "Sperretest AS", normalisertNavn: "sperretest as" },
    });
    organisasjonId = org.id;
  });

  beforeEach(async () => {
    // Hver test starter med blanke sperrer, slik at rekkefølgen ikke betyr noe.
    await prisma.sperreliste.deleteMany({ where: { epost: { endsWith: TESTDOMENE } } });
    await prisma.sperreliste.deleteMany({ where: { epostDomene: { endsWith: TESTDOMENE } } });
  });

  after(async () => {
    await prisma.revisjon.deleteMany({ where: { kilde: KILDE } });
    await prisma.sperreliste.deleteMany({ where: { epost: { endsWith: TESTDOMENE } } });
    await prisma.sperreliste.deleteMany({ where: { epostDomene: { endsWith: TESTDOMENE } } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: ORGNR } });
    await lukkDatabase();
  });

  // -------------------------------------------------------------------------
  // Normalisering
  // -------------------------------------------------------------------------

  test("BRUDD: store bokstaver og mellomrom omgår ikke sperren", async () => {
    const epost = adresse("normaliser", "a");

    await leggTilSperre({ type: "GLOBAL", grunn: "MANUELL", epost, kilde: KILDE });

    // Samme adresse, skrevet annerledes. Skal fortsatt treffe.
    const varianter = [
      epost.toUpperCase(),
      `  ${epost}  `,
      `Normaliser@A.${TESTDOMENE.toUpperCase()}`,
    ];

    for (const variant of varianter) {
      const svar = await sjekkSperreliste({ kanal: "EPOST", epost: variant });
      assert.equal(
        svar.tillatt,
        false,
        `varianten «${variant}» slapp gjennom — normaliseringen virker ikke`,
      );
    }
  });

  test("normaliserer e-post riktig", () => {
    assert.equal(normaliserEpost("  A@B.NO  "), "a@b.no");
    assert.equal(epostDomene("A@B.NO"), "b.no");
    assert.equal(epostDomene("ugyldig"), null);
  });

  test("normaliserer domene likt ved innlegging og oppslag", () => {
    // Dette var en ekte feil: `epost` ble normalisert ved innlegging, men
    // `epostDomene` ble lagret rå. En domenesperre med store bokstaver ble
    // liggende og gjorde ingenting, mens operatøren trodde den virket.
    assert.equal(normaliserDomene("EXAMPLE.NO"), "example.no");
    assert.equal(normaliserDomene("  Example.No  "), "example.no");
    assert.equal(normaliserDomene("www.example.no"), "example.no");
    assert.equal(normaliserDomene("example.no."), "example.no");
    assert.equal(normaliserDomene("https://example.no/stien/sin"), "example.no");
    assert.equal(normaliserDomene("noen@example.no"), "example.no");

    // Søppel skal avvises, ikke lagres som en sperre som ikke virker.
    assert.equal(normaliserDomene(""), null);
    assert.equal(normaliserDomene("   "), null);
    assert.equal(normaliserDomene("utenpunktum"), null);
  });

  test("BRUDD: domenesperre med store bokstaver virker", async () => {
    const { id } = await leggTilSperre({
      type: "EPOSTDOMENE",
      grunn: "MANUELL",
      epostDomene: "STORE-BOKSTAVER.brudd.invalid",
      kilde: KILDE,
    });

    const svar = await sjekkSperreliste({
      kanal: "EPOST",
      epost: "noen@store-bokstaver.brudd.invalid",
    });

    assert.equal(svar.tillatt, false, "domenesperren virket ikke — store bokstaver slapp gjennom");

    // Og den skal være lagret normalisert.
    const rad = await prisma.sperreliste.findUnique({ where: { id } });
    assert.equal(rad?.epostDomene, "store-bokstaver.brudd.invalid");
  });

  test("BRUDD: et ugyldig domene nektes i stedet for å lagres", async () => {
    await assert.rejects(
      () =>
        leggTilSperre({
          type: "EPOSTDOMENE",
          grunn: "MANUELL",
          epostDomene: "ikke-et-domene",
          kilde: KILDE,
        }),
      /ikke et gyldig domene/,
    );
  });

  // -------------------------------------------------------------------------
  // Global sperre
  // -------------------------------------------------------------------------

  test("BRUDD: global sperre stopper alle kanaler", async () => {
    const epost = adresse("global", "b");
    await leggTilSperre({ type: "GLOBAL", grunn: "MANUELL", epost, kilde: KILDE });

    const kanaler = ["EPOST", "TELEFON", "SMS", "LINKEDIN", "WEBHOOK", "MANUELL"] as const;

    for (const kanal of kanaler) {
      const svar = await sjekkSperreliste({ kanal, epost });
      assert.equal(svar.tillatt, false, `global sperre slapp gjennom på ${kanal}`);
      assert.equal(svar.type, "GLOBAL");
    }
  });

  test("en mottaker uten sperre slipper gjennom", async () => {
    // Kontrolltest: uten denne vet vi ikke om «nei»-ene over skyldtes sperren
    // eller noe annet.
    const svar = await sjekkSperreliste({ kanal: "EPOST", epost: adresse("fri", "c") });
    assert.equal(svar.tillatt, true, "en usperret adresse ble avvist");
    assert.equal(svar.sperreId, null);
  });

  test("BRUDD: en global sperre på én adresse sperrer IKKE alle andre", async () => {
    // Dette var en ekte feil. Treffregelen for GLOBAL ignorerte adressen, så én
    // global sperre sperret hver mottaker i hele systemet.
    const sperretAdresse = adresse("enperson", "globalavgrensning");
    const uskyldig = adresse("enheltannen", "globalavgrensning");

    await leggTilSperre({
      type: "GLOBAL",
      grunn: "AVMELDING",
      epost: sperretAdresse,
      kilde: KILDE,
    });

    const sperret = await sjekkSperreliste({ kanal: "EPOST", epost: sperretAdresse });
    assert.equal(sperret.tillatt, false, "den sperrede adressen slapp gjennom");

    const fri = await sjekkSperreliste({ kanal: "EPOST", epost: uskyldig });
    assert.equal(
      fri.tillatt,
      true,
      "en global sperre på én adresse sperret en helt annen mottaker",
    );
  });

  test("BRUDD: en sperre uten mottaker nektes", async () => {
    // En sperre uten noe å treffe ville stoppet all utgående trafikk.
    await assert.rejects(
      () => leggTilSperre({ type: "GLOBAL", grunn: "MANUELL", kilde: KILDE }),
      /må peke på minst én mottaker/,
      "en sperre uten mottaker ble godtatt",
    );

    await assert.rejects(
      () => leggTilSperre({ type: "EPOSTDOMENE", grunn: "MANUELL", kilde: KILDE }),
      /må peke på minst én mottaker/,
      "en domenesperre uten domene ble godtatt",
    );

    // En kanalsperre med kanal satt, men uten mottaker, skal ogsaa nektes —
    // den ville sperret hele kanalen gjennom en bakvei.
    await assert.rejects(
      () => leggTilSperre({ type: "KANAL", grunn: "MANUELL", kanal: "SMS", kilde: KILDE }),
      /må peke på minst én mottaker/,
    );
  });

  test("erUgyldigSperre kjenner igjen feilen uten instanceof", async () => {
    // `instanceof` er ikke til å stole på her. Next.js pakker ruter og delte
    // moduler hver for seg, og da kan to ulike klasse-identiteter av samme klasse
    // ligge i samme prosess. Da svarte ruten 500 i stedet for 400, selv om
    // feilen var riktig. Vi oppdaget det ved å kalle ruten på ekte.
    try {
      await leggTilSperre({ type: "GLOBAL", grunn: "MANUELL", kilde: KILDE });
      assert.fail("skulle kastet");
    } catch (feil) {
      assert.ok(erUgyldigSperre(feil), "erUgyldigSperre kjente ikke igjen sin egen feil");

      // Og den skal ikke godta en vilkårlig feil.
      assert.equal(erUgyldigSperre(new Error("noe annet")), false);
      assert.equal(erUgyldigSperre(null), false);
      assert.equal(erUgyldigSperre("streng"), false);
      assert.equal(erUgyldigSperre({ kode: "NOE_ANNET" }), false);
    }
  });

  // -------------------------------------------------------------------------
  // Kanalsperre
  // -------------------------------------------------------------------------

  test("BRUDD: kanalsperre stopper bare sin egen kanal", async () => {
    const epost = adresse("kanal", "d");
    await leggTilSperre({
      type: "KANAL",
      grunn: "BOUNCE",
      epost,
      kanal: "EPOST",
      kilde: KILDE,
    });

    const paEpost = await sjekkSperreliste({ kanal: "EPOST", epost });
    assert.equal(paEpost.tillatt, false, "kanalsperre for EPOST slapp gjennom EPOST");

    // Andre kanaler skal fortsatt være åpne. En kanalsperre er ikke en global sperre.
    const paSms = await sjekkSperreliste({ kanal: "SMS", epost });
    assert.equal(paSms.tillatt, true, "kanalsperre for EPOST sperret også SMS — for strengt");
  });

  test("BRUDD: sperre med kanal=null stopper alle kanaler", async () => {
    const epost = adresse("allekanaler", "e");
    await leggTilSperre({ type: "KANAL", grunn: "MANUELL", epost, kanal: null, kilde: KILDE });

    for (const kanal of ["EPOST", "SMS", "TELEFON"] as const) {
      const svar = await sjekkSperreliste({ kanal, epost });
      assert.equal(svar.tillatt, false, `kanal=null sperret ikke ${kanal}`);
    }
  });

  // -------------------------------------------------------------------------
  // Domenesperre
  // -------------------------------------------------------------------------

  test("BRUDD: domenesperre stopper enhver adresse i domenet", async () => {
    const domene = `domenesperre.${TESTDOMENE}`;
    await leggTilSperre({
      type: "EPOSTDOMENE",
      grunn: "MANUELL",
      epostDomene: domene,
      kilde: KILDE,
    });

    const adresser = [
      `noen@${domene}`,
      `annen@${domene}`,
      `TREDJE@${domene.toUpperCase()}`,
    ];

    for (const a of adresser) {
      const svar = await sjekkSperreliste({ kanal: "EPOST", epost: a });
      assert.equal(svar.tillatt, false, `domenesperre slapp gjennom ${a}`);
      assert.equal(svar.type, "EPOSTDOMENE");
    }

    // En annen adresse skal fortsatt slippe gjennom — sperren er ikke global.
    const utenfor = await sjekkSperreliste({ kanal: "EPOST", epost: adresse("utenfor", "f") });
    assert.equal(utenfor.tillatt, true, "domenesperren traff utenfor sitt eget domene");
  });

  // -------------------------------------------------------------------------
  // Kontakt og organisasjon
  // -------------------------------------------------------------------------

  test("BRUDD: sperret kontakt stopper selv uten e-postadresse", async () => {
    const kontakt = await prisma.kontakt.create({
      data: { organisasjonId, fornavn: "Uten", etternavn: "Epost" },
    });

    await leggTilSperre({
      type: "KONTAKT",
      grunn: "MANUELL",
      kontaktId: kontakt.id,
      kilde: KILDE,
    });

    // Ingen e-post oppgitt. Sperren skal treffe på kontaktId alene.
    const svar = await sjekkSperreliste({ kanal: "EPOST", kontaktId: kontakt.id });
    assert.equal(svar.tillatt, false, "kontaktsperre traff ikke uten e-postadresse");
    assert.equal(svar.type, "KONTAKT");

    await prisma.kontakt.delete({ where: { id: kontakt.id } });
  });

  test("BRUDD: sperret organisasjon stopper alle dens kontakter", async () => {
    const org2 = await prisma.organisasjon.create({
      data: { orgnr: "999333444", navn: "Sperret Org AS", normalisertNavn: "sperret org as" },
    });

    await leggTilSperre({
      type: "ORGANISASJON",
      grunn: "KONKURS",
      organisasjonId: org2.id,
      kilde: KILDE,
    });

    const svar = await sjekkSperreliste({
      kanal: "EPOST",
      epost: adresse("hvemsomhelst", "g"),
      organisasjonId: org2.id,
    });

    assert.equal(svar.tillatt, false, "organisasjonssperre traff ikke");
    assert.equal(svar.type, "ORGANISASJON");

    await prisma.sperreliste.deleteMany({ where: { organisasjonId: org2.id } });
    await prisma.organisasjon.delete({ where: { id: org2.id } });
  });

  // -------------------------------------------------------------------------
  // Utløp
  // -------------------------------------------------------------------------

  test("utløpt sperre slipper gjennom igjen", async () => {
    const epost = adresse("utlopt", "h");
    const { id } = await leggTilSperre({
      type: "GLOBAL",
      grunn: "MANUELL",
      epost,
      kilde: KILDE,
      utloeper: new Date(Date.now() - 60_000),
    });

    const svar = await sjekkSperreliste({ kanal: "EPOST", epost });
    assert.equal(svar.tillatt, true, "en utløpt sperre sperret fortsatt");

    await prisma.sperreliste.delete({ where: { id } });
  });

  test("sperre som ikke har utløpt sperrer fortsatt", async () => {
    const epost = adresse("fremtid", "i");
    const { id } = await leggTilSperre({
      type: "GLOBAL",
      grunn: "MANUELL",
      epost,
      kilde: KILDE,
      utloeper: new Date(Date.now() + 3_600_000),
    });

    const svar = await sjekkSperreliste({ kanal: "EPOST", epost });
    assert.equal(svar.tillatt, false, "en gyldig sperre slapp gjennom");

    await prisma.sperreliste.delete({ where: { id } });
  });

  // -------------------------------------------------------------------------
  // Oppheving
  // -------------------------------------------------------------------------

  test("opphevet sperre slipper gjennom, men slettes ikke", async () => {
    const epost = adresse("opphevet", "j");
    const { id } = await leggTilSperre({
      type: "GLOBAL",
      grunn: "MANUELL",
      epost,
      kilde: KILDE,
    });

    assert.equal((await sjekkSperreliste({ kanal: "EPOST", epost })).tillatt, false);

    const opphevet = await opphevSperre(id, "test");
    assert.equal(opphevet, true);

    assert.equal(
      (await sjekkSperreliste({ kanal: "EPOST", epost })).tillatt,
      true,
      "opphevet sperre sperret fortsatt",
    );

    // Raden skal fortsatt finnes — historien skal kunne leses.
    const rad = await prisma.sperreliste.findUnique({ where: { id } });
    assert.ok(rad, "sperreraden ble slettet — historikken er borte");
    assert.equal(rad.aktiv, false);
  });

  // -------------------------------------------------------------------------
  // Automatiske sperrer
  // -------------------------------------------------------------------------

  test("BRUDD: avmelding sperrer alle kanaler umiddelbart", async () => {
    const epost = adresse("avmeldt", "k");
    const resultat = await sperrAvmelding(epost, KILDE);
    assert.equal(resultat.opprettet, true);

    for (const kanal of ["EPOST", "SMS", "TELEFON"] as const) {
      const svar = await sjekkSperreliste({ kanal, epost });
      assert.equal(svar.tillatt, false, `avmelding sperret ikke ${kanal}`);
      assert.equal(svar.sperreGrunn, "AVMELDING");
    }
  });

  test("BRUDD: hard bounce sperrer adressen", async () => {
    const epost = adresse("hardbounce", "l");
    await sperrBounce(epost, true, KILDE);

    const svar = await sjekkSperreliste({ kanal: "EPOST", epost });
    assert.equal(svar.tillatt, false, "hard bounce sperret ikke adressen");
    assert.equal(svar.sperreGrunn, "BOUNCE");
  });

  test("myk bounce sperrer IKKE adressen", async () => {
    const epost = adresse("mykbounce", "m");
    const resultat = await sperrBounce(epost, false, KILDE);

    assert.equal(resultat.opprettet, false, "myk bounce opprettet en sperre");

    const svar = await sjekkSperreliste({ kanal: "EPOST", epost });
    assert.equal(svar.tillatt, true, "myk bounce sperret adressen — for strengt");
  });

  test("klage sperrer alle kanaler", async () => {
    const epost = adresse("klage", "n");
    await sperrKlage(epost, KILDE);

    const svar = await sjekkSperreliste({ kanal: "EPOST", epost });
    assert.equal(svar.tillatt, false);
    assert.equal(svar.sperreGrunn, "KLAGE");
  });

  test("avmelding to ganger gir bare én sperre", async () => {
    const epost = adresse("dobbelt", "o");
    const forste = await sperrAvmelding(epost, KILDE);
    const andre = await sperrAvmelding(epost, KILDE);

    assert.equal(forste.opprettet, true);
    assert.equal(andre.opprettet, false, "samme avmelding lagde to sperrer");
    assert.equal(forste.sperreId, andre.sperreId);
  });

  // -------------------------------------------------------------------------
  // Kanalen selv
  // -------------------------------------------------------------------------

  test("BRUDD: stengt kanal stopper alt, uansett mottaker", async () => {
    // Alle kanaler er av i frødataene. En helt fri mottaker skal likevel stoppes.
    const svar = await kanSende({
      kanal: "EPOST",
      epost: adresse("heltfri", "p"),
      avsenderId: "finnes-ikke",
    });

    assert.equal(svar.tillatt, false, "en stengt kanal slapp en melding gjennom");
    assert.match(svar.grunn, /AV|ikke satt opp/i);
  });

  test("BRUDD: uten avsender nektes sending", async () => {
    // Dette var en ekte feil. Var avsenderen valgfri, hoppet kanSende over både
    // kvote og oppvarming — og den eneste kalleren i produksjon oppga den ikke.
    //
    // Feltet er nå påkrevd i typen, så en kallere kan ikke lenger glemme det.
    // Men den kan fortsatt sende inn null eller undefined, og da skal vi nekte.
    const uten = await kanSende({
      kanal: "EPOST",
      epost: adresse("utenavsender", "r"),
      avsenderId: undefined,
    });
    assert.equal(uten.tillatt, false, "sending uten avsender slapp gjennom");
    assert.match(uten.grunn, /[Ii]ngen avsender/);

    const medNull = await kanSende({
      kanal: "EPOST",
      epost: adresse("utenavsender", "r"),
      avsenderId: null,
    });
    assert.equal(medNull.tillatt, false, "avsenderId = null slapp gjennom");

    // Kontroll: sjekkene som krever avsender, skal faktisk ha kjørt.
    assert.ok(
      !uten.sjekket.includes("volum"),
      "volum skal ikke sjekkes når vi alt har nektet for manglende avsender",
    );
  });

  test("sjekkKanalApen sier nei for alle kanaler nå", async () => {
    for (const kanal of ["EPOST", "SMS", "TELEFON", "LINKEDIN", "WEBHOOK", "MANUELL"] as const) {
      const svar = await sjekkKanalApen(kanal);
      assert.equal(svar.aapen, false, `kanalen ${kanal} var åpen — den skal være av`);
    }
  });

  test("kanSende sjekker kanalen FØR sperrelisten", async () => {
    // Rekkefølgen betyr noe: er kanalen stengt, skal svaret handle om det.
    const epost = adresse("rekkefolge", "q");
    await leggTilSperre({ type: "GLOBAL", grunn: "MANUELL", epost, kilde: KILDE });

    const svar = await kanSende({ kanal: "EPOST", epost, avsenderId: "finnes-ikke" });
    assert.equal(svar.tillatt, false);
    assert.match(svar.grunn, /AV for EPOST/, "kanalsjekken kom ikke først");
  });
});

// ---------------------------------------------------------------------------
// Revisjonsloggen
// ---------------------------------------------------------------------------

describe("revisjonslogg", { skip: !harDatabase ? "DATABASE_URL mangler" : false }, () => {
  const KILDE = "test/brudd-revisjon";

  after(async () => {
    await prisma.revisjon.deleteMany({ where: { kilde: KILDE } });
    await lukkDatabase();
  });

  test("skriver og leser en revisjon", async () => {
    const forfor = await tellRevisjoner({ kilde: KILDE });
    const entitetId = `test-${Date.now()}`;

    const id = await skrivRevisjon({
      handling: "TEST_HANDLING",
      aktor: "test@vikingnet.no",
      aktorType: "BRUKER",
      entitet: "Test",
      entitetId,
      grunnlag: "Fordi testen krever det",
      resultat: "Utført",
      resultatStatus: "ok",
      kilde: KILDE,
    });

    assert.ok(id, "revisjonen fikk ingen id");

    const etter = await tellRevisjoner({ kilde: KILDE });
    assert.equal(etter, forfor + 1, "revisjonen ble ikke lagret");

    const funnet = await lesRevisjoner({ entitetId, antall: 10 });
    const rad = funnet.find((r) => r.id === id);
    assert.ok(rad, "revisjonen kunne ikke leses tilbake");
    assert.equal(rad.grunnlag, "Fordi testen krever det");
    assert.equal(rad.resultat, "Utført");
  });

  test("vasker hemmeligheter ut av metadata", async () => {
    const id = await skrivRevisjon({
      handling: "TEST_METADATA",
      aktor: "SYSTEMET",
      kilde: KILDE,
      metadata: {
        apiKey: "hemmelig-nokkel-123",
        epost: "a@b.no",
        connectionString: "postgresql://bruker:passord123@vert/db",
      },
    });

    assert.ok(id);
    const rad = await prisma.revisjon.findUnique({ where: { id } });
    assert.ok(rad);

    const tekst = JSON.stringify(rad.metadata);
    assert.ok(!tekst.includes("hemmelig-nokkel-123"), "API-nøkkelen lekket til revisjonsloggen");
    assert.ok(!tekst.includes("passord123"), "passordet lekket til revisjonsloggen");
    assert.ok(tekst.includes("[skjult]"), "maskeringen skjedde ikke");
    assert.ok(tekst.includes("a@b.no"), "vanlige felter ble maskert — for strengt");
  });

  test("korrelasjonsid knytter en kjede sammen", async () => {
    const korr = `test-kjede-${Date.now()}`;

    await skrivRevisjon({
      handling: "UTKAST_LAGET",
      aktor: "SYSTEMET",
      kilde: KILDE,
      korrelasjonId: korr,
      grunnlag: "Steg 1 i sekvensen",
    });
    await skrivRevisjon({
      handling: "GODKJENT",
      aktor: "kenneth@vikingnet.no",
      kilde: KILDE,
      korrelasjonId: korr,
      grunnlag: "Godkjent i køen",
    });
    await skrivRevisjon({
      handling: "SENDT",
      aktor: "SYSTEMET",
      kilde: KILDE,
      korrelasjonId: korr,
      grunnlag: "Innenfor tidsvinduet",
    });

    const kjede = await lesKjede(korr);
    assert.equal(kjede.length, 3, "kjeden er ikke komplett");
    assert.equal(kjede[0]!.handling, "UTKAST_LAGET");
    assert.equal(kjede[2]!.handling, "SENDT");
  });

  test("BRUDD: revisjonsmodulen har ingen endrings- eller slettevei", async () => {
    // Strukturell test: vi bekrefter at modulen ikke eksporterer noen vei til å
    // endre eller slette. Se docs/beslutninger.md B-007.
    const modul = await import("@/lib/revisjon");
    const eksporterte = Object.keys(modul);

    assert.ok(eksporterte.includes("skrivRevisjon"), "skrivRevisjon mangler");

    for (const navn of eksporterte) {
      assert.ok(
        !/slett|delete|oppdater|update|endre/i.test(navn),
        `revisjonsmodulen eksporterer «${navn}», som ser ut som en endringsvei`,
      );
    }
  });
});
