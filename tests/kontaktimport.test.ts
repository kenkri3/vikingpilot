/**
 * Import av kontakter.
 *
 * To slags tester her: rene CSV-tolkningstester som ikke rører databasen, og
 * importer som gjør det. De siste rydder etter seg.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { delCsvLinje, tolkCsv, importerKontakter, erImportFeil } from "@/lib/kontakter/import";
import { prisma, lukkDatabase } from "@/lib/db";

const TESTDOMENE = "kontaktimport.invalid";

async function rydd() {
  await prisma.kontakt.deleteMany({ where: { epost: { endsWith: `@${TESTDOMENE}` } } });
}

describe("CSV-tolkning", () => {
  test("deler enkle linjer", () => {
    assert.deepEqual(delCsvLinje("a,b,c"), ["a", "b", "c"]);
  });

  test("håndterer semikolon, som norsk Excel bruker", () => {
    assert.deepEqual(delCsvLinje("a;b;c"), ["a", "b", "c"]);
  });

  test("håndterer komma inne i hermetegn", () => {
    assert.deepEqual(delCsvLinje('"Nord, AS",Ola,Nord'), ["Nord, AS", "Ola", "Nord"]);
  });

  test("håndterer dobbelt hermetegn inne i et felt", () => {
    assert.deepEqual(delCsvLinje('"Han sa ""hei""",b'), ['Han sa "hei"', "b"]);
  });

  test("fjerner mellomrom rundt felt", () => {
    assert.deepEqual(delCsvLinje(" a , b "), ["a", "b"]);
  });
});

describe("tolkCsv", () => {
  test("BRUDD: manglende kolonner gir en tydelig feil", () => {
    assert.throws(
      () => tolkCsv("fornavn,etternavn\nOla,Nord"),
      (e: unknown) => erImportFeil(e) && /epost/.test((e as Error).message),
    );
  });

  test("godtar vanlige engelske kolonnenavn", () => {
    const { rader } = tolkCsv("First Name,Last Name,Email\nOla,Nord,ola@x.no");
    assert.equal(rader.length, 1);
    assert.equal(rader[0]?.fornavn, "Ola");
    assert.equal(rader[0]?.epost, "ola@x.no");
  });

  test("normaliserer e-post til små bokstaver", () => {
    const { rader } = tolkCsv("fornavn,etternavn,epost\nOla,Nord,OLA@X.NO");
    assert.equal(rader[0]?.epost, "ola@x.no");
  });

  test("BRUDD: rad uten e-post avvises", () => {
    // Uten e-postadresse kan vi ikke nå personen. Da lagrer vi den ikke — et
    // kontaktkort vi ikke kan bruke er bare en personopplysning uten nytte.
    const { rader, feil } = tolkCsv("fornavn,etternavn,epost\nOla,Nord,");
    assert.equal(rader.length, 0);
    assert.equal(feil.length, 1);
    assert.match(feil[0]!.grunn, /e-postadresse/);
  });

  test("BRUDD: ugyldig e-postadresse avvises", () => {
    const { rader, feil } = tolkCsv("fornavn,etternavn,epost\nOla,Nord,ikke-en-adresse");
    assert.equal(rader.length, 0);
    assert.equal(feil.length, 1);
  });

  test("BRUDD: ugyldig organisasjonsnummer avvises", () => {
    const { rader, feil } = tolkCsv("fornavn,etternavn,epost,orgnr\nOla,Nord,ola@x.no,12345");
    assert.equal(rader.length, 0);
    assert.match(feil[0]!.grunn, /ni siffer/);
  });

  test("godtar gyldig organisasjonsnummer med mellomrom", () => {
    const { rader } = tolkCsv('fornavn,etternavn,epost,orgnr\nOla,Nord,ola@x.no,"123 456 789"');
    assert.equal(rader[0]?.orgnr, "123456789");
  });

  test("BRUDD: duplikat i filen bruker den siste og sier fra", () => {
    const { rader, feil } = tolkCsv(
      "fornavn,etternavn,epost\nOla,Nord,ola@x.no\nOla,Nordesen,OLA@x.no",
    );
    assert.equal(rader.length, 1);
    assert.equal(rader[0]?.etternavn, "Nordesen");
    assert.equal(feil.length, 1);
    assert.match(feil[0]!.grunn, /Samme e-postadresse/);
  });

  test("leser beslutningstaker på flere måter", () => {
    const { rader } = tolkCsv(
      "fornavn,etternavn,epost,beslutningstaker\nA,B,a@x.no,ja\nC,D,c@x.no,nei\nE,F,e@x.no,true",
    );
    assert.equal(rader[0]?.beslutningstaker, true);
    assert.equal(rader[1]?.beslutningstaker, false);
    assert.equal(rader[2]?.beslutningstaker, true);
  });

  test("tåler BOM fra Excel", () => {
    const { rader } = tolkCsv("\uFEFFfornavn,etternavn,epost\nOla,Nord,ola@x.no");
    assert.equal(rader.length, 1);
  });

  test("hopper over tomme linjer", () => {
    const { rader } = tolkCsv("fornavn,etternavn,epost\nOla,Nord,ola@x.no\n\n\n");
    assert.equal(rader.length, 1);
  });
});

describe("importerKontakter", () => {
  before(async () => {
    await rydd();
  });

  after(async () => {
    await rydd();
    await lukkDatabase();
  });

  test("BRUDD: nekter å lagre uten samtykkegrunnlag", () => {
    // Personopplysninger skal ha et dokumentert formål. Vi gjetter ikke.
    return assert.rejects(
      () =>
        importerKontakter(`fornavn,etternavn,epost\nOla,Nord,ola@${TESTDOMENE}`, {
          torrkjoering: false,
        }),
      (e: unknown) => erImportFeil(e) && /grunnlag/.test((e as Error).message),
    );
  });

  test("godtar grunnlag fra filen", async () => {
    const csv = `fornavn,etternavn,epost,samtykke\nOla,Nord,ola@${TESTDOMENE},Meldt på webinar`;

    const r = await importerKontakter(csv, { torrkjoering: false });

    assert.equal(r.opprettet, 1);
    assert.equal(r.feil.length, 0);

    const rad = await prisma.kontakt.findUnique({ where: { epost: `ola@${TESTDOMENE}` } });
    assert.equal(rad?.fornavn, "Ola");
    assert.equal(rad?.samtykkeGrunnlag, "Meldt på webinar");
    assert.ok(rad?.samtykkeDato, "samtykkedato skal være satt");
  });

  test("godtar grunnlag fra operatøren", async () => {
    const csv = `fornavn,etternavn,epost\nKari,Nord,kari@${TESTDOMENE}`;

    const r = await importerKontakter(csv, {
      torrkjoering: false,
      samtykkeGrunnlag: "Eksisterende kunder",
    });

    assert.equal(r.opprettet, 1);

    const rad = await prisma.kontakt.findUnique({ where: { epost: `kari@${TESTDOMENE}` } });
    assert.equal(rad?.samtykkeGrunnlag, "Eksisterende kunder");
  });

  test("BRUDD: tørrkjøring skriver ingenting", async () => {
    const for_ = await prisma.kontakt.count({ where: { epost: { endsWith: `@${TESTDOMENE}` } } });

    const csv = `fornavn,etternavn,epost,samtykke\nTor,Tørr,tor@${TESTDOMENE},Test`;
    const r = await importerKontakter(csv, { torrkjoering: true });

    assert.equal(r.torrkjoering, true);
    assert.equal(r.opprettet, 1, "tørrkjøringen skal si hva den VILLE gjort");

    const etter = await prisma.kontakt.count({ where: { epost: { endsWith: `@${TESTDOMENE}` } } });
    assert.equal(etter, for_, "tørrkjøring skrev til databasen");
  });

  test("BRUDD: samme fil to ganger gir ikke duplikater", async () => {
    const csv = `fornavn,etternavn,epost,samtykke\nIda,Idempotent,ida@${TESTDOMENE},Test`;

    const første = await importerKontakter(csv, { torrkjoering: false });
    assert.equal(første.opprettet, 1);

    const andre = await importerKontakter(csv, { torrkjoering: false });
    assert.equal(andre.opprettet, 0, "andre kjøring opprettet en duplikat");
    assert.equal(andre.oppdatert, 1);

    const antall = await prisma.kontakt.count({ where: { epost: `ida@${TESTDOMENE}` } });
    assert.equal(antall, 1);
  });

  test("oppdaterer felter uten å nullstille samtykkedatoen", async () => {
    const csv1 = `fornavn,etternavn,epost,rolle,samtykke\nPer,Peterson,per@${TESTDOMENE},Selger,Test`;
    await importerKontakter(csv1, { torrkjoering: false });

    const før = await prisma.kontakt.findUnique({ where: { epost: `per@${TESTDOMENE}` } });

    const csv2 = `fornavn,etternavn,epost,rolle,samtykke\nPer,Peterson,per@${TESTDOMENE},Daglig leder,Test`;
    await importerKontakter(csv2, { torrkjoering: false });

    const etter = await prisma.kontakt.findUnique({ where: { epost: `per@${TESTDOMENE}` } });

    assert.equal(etter?.rolle, "Daglig leder", "rollen skal være oppdatert");
    assert.deepEqual(
      etter?.samtykkeDato?.toISOString(),
      før?.samtykkeDato?.toISOString(),
      "samtykkedatoen skal vise når grunnlaget ble registrert, ikke når filen sist ble lest",
    );
  });

  test("kobler kontakten til riktig organisasjon via orgnr", async () => {
    const org = await prisma.organisasjon.findFirst({ select: { id: true, orgnr: true } });

    if (!org) {
      // Ingen organisasjoner i basen — hopp over. Sjekkelisten dekker dette.
      return;
    }

    const csv = `fornavn,etternavn,epost,orgnr,samtykke\nOrg,Koblet,orgkoblet@${TESTDOMENE},${org.orgnr},Test`;
    await importerKontakter(csv, { torrkjoering: false });

    const rad = await prisma.kontakt.findUnique({ where: { epost: `orgkoblet@${TESTDOMENE}` } });
    assert.equal(rad?.organisasjonId, org.id, "kontakten ble ikke koblet til organisasjonen");
  });

  test("BRUDD: en kontakt vi ikke kan koble, lagres uten organisasjon — ikke feil organisasjon", async () => {
    const csv = `fornavn,etternavn,epost,organisasjon,samtykke\nUten,Selskap,uten@${TESTDOMENE},Firma Som Ikke Finnes AS,Test`;
    const r = await importerKontakter(csv, { torrkjoering: false });

    assert.equal(r.utenOrganisasjon, 1);

    const rad = await prisma.kontakt.findUnique({ where: { epost: `uten@${TESTDOMENE}` } });
    assert.equal(rad?.organisasjonId, null, "kontakten ble koblet til noe den ikke hørte til");
  });

  test("skriver importen til revisjonsloggen", async () => {
    const før = await prisma.revisjon.count({ where: { handling: "KONTAKTER_IMPORTERT" } });

    const csv = `fornavn,etternavn,epost,samtykke\nRev,Isjon,rev@${TESTDOMENE},Test`;
    await importerKontakter(csv, { torrkjoering: false });

    const etter = await prisma.revisjon.count({ where: { handling: "KONTAKTER_IMPORTERT" } });
    assert.equal(etter, før + 1, "importen ble ikke skrevet til revisjonsloggen");
  });
});
