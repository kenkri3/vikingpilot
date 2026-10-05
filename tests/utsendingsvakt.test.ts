/**
 * Utsendingsvakten: volum, oppvarming og idempotens.
 *
 * Dette er stoppkriterium 6 for modul 4. Testene prøver aktivt å bryte hvert
 * gjerde: sende over kvoten, sende utenfor oppvarmingsplanen, og sende samme
 * melding to ganger.
 */

import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { prisma, lukkDatabase } from "@/lib/db";
import {
  sjekkVolum,
  dognNokkel,
  ukeNokkel,
  norskMidnatt,
  gjenvaerendeKvote,
} from "@/lib/guards/volum";
import { norskTid } from "@/lib/tid/vinduer";
import {
  sjekkOppvarming,
  effektivDognkvote,
  dagerSiden,
  kvoteForDag,
} from "@/lib/guards/oppvarming";
import {
  byggIdempotensNokkel,
  provAaReservere,
  merkSendt,
  merkFeilet,
  erAlleredeSendt,
} from "@/lib/guards/idempotens";

const harDatabase = Boolean(process.env.DATABASE_URL);
const TESTDOMENE = "vakt.invalid";

/**
 * Fast tidspunkt for testene, slik at de er gjentakbare.
 *
 * NAA_TIDLIG er nøyaktig 14 døgn før NAA, med samme klokkeslett. Da blir
 * «dag 14» entydig, uansett sommertid.
 */
const NAA = new Date(Date.UTC(2026, 5, 15, 10, 0, 0));
const NAA_TIDLIG = new Date(Date.UTC(2026, 5, 1, 10, 0, 0));

describe("oppvarming — ren beregning", () => {
  test("regner dager i norske døgn", () => {
    // Januar er norsk vintertid (UTC+1). Vi velger klokkeslett midt på dagen,
    // slik at UTC-dato og norsk dato er den samme og testen er entydig.
    const start = new Date(Date.UTC(2026, 0, 1, 12));

    assert.equal(dagerSiden(start, new Date(Date.UTC(2026, 0, 1, 12))), 0);
    assert.equal(dagerSiden(start, new Date(Date.UTC(2026, 0, 1, 10))), 0, "samme norske dag");
    assert.equal(dagerSiden(start, new Date(Date.UTC(2026, 0, 2, 12))), 1);
    assert.equal(dagerSiden(start, new Date(Date.UTC(2026, 0, 31, 12))), 30);
  });

  test("døgnskiftet følger norsk midnatt, ikke UTC-midnatt", () => {
    // 1. januar 23:00 UTC er 2. januar 00:00 norsk tid. Da har døgnet skiftet,
    // selv om UTC fortsatt viser 1. januar. Det er derfor vi regner i norsk tid.
    const start = new Date(Date.UTC(2026, 0, 1, 12)); // 13:00 norsk, 1. jan
    const rettForMidnatt = new Date(Date.UTC(2026, 0, 1, 22, 30)); // 23:30 norsk, 1. jan
    const rettEtterMidnatt = new Date(Date.UTC(2026, 0, 1, 23, 30)); // 00:30 norsk, 2. jan

    assert.equal(dagerSiden(start, rettForMidnatt), 0, "23:30 norsk er fortsatt samme døgn");
    assert.equal(dagerSiden(start, rettEtterMidnatt), 1, "00:30 norsk er neste døgn");
    assert.equal(dagerSiden(rettForMidnatt, rettEtterMidnatt), 1, "døgnet skiftet ikke ved norsk midnatt");
    assert.equal(dagerSiden(rettEtterMidnatt, rettForMidnatt), -1);
  });

  test("finner riktig kvote for en dag", () => {
    const trinn = [
      { dagFraStart: 0, maksPerDag: 5 },
      { dagFraStart: 4, maksPerDag: 10 },
      { dagFraStart: 8, maksPerDag: 20 },
    ];

    assert.equal(kvoteForDag(0, trinn).kvote, 5);
    assert.equal(kvoteForDag(3, trinn).kvote, 5);
    assert.equal(kvoteForDag(4, trinn).kvote, 10);
    assert.equal(kvoteForDag(7, trinn).kvote, 10);
    assert.equal(kvoteForDag(8, trinn).kvote, 20);
    assert.equal(kvoteForDag(999, trinn).kvote, 20);
    assert.equal(kvoteForDag(999, trinn).neste, null, "siste trinn skal ikke ha noe neste");
    assert.equal(kvoteForDag(0, trinn).neste?.maksPerDag, 10);
  });

  test("trinnene trenger ikke komme i rekkefølge", () => {
    const usortert = [
      { dagFraStart: 8, maksPerDag: 20 },
      { dagFraStart: 0, maksPerDag: 5 },
      { dagFraStart: 4, maksPerDag: 10 },
    ];
    assert.equal(kvoteForDag(5, usortert).kvote, 10);
  });

  test("BRUDD: en tom oppvarmingsplan gir kvote 0, ikke fritt fram", () => {
    // Dette er den farligste feilen: å tolke «ingen plan» som «ingen grense».
    assert.equal(kvoteForDag(5, []).kvote, 0);
    assert.equal(kvoteForDag(500, []).kvote, 0);
  });

  test("dag før første trinn gir kvote 0", () => {
    const trinn = [{ dagFraStart: 10, maksPerDag: 5 }];
    assert.equal(kvoteForDag(0, trinn).kvote, 0);
    assert.equal(kvoteForDag(9, trinn).kvote, 0);
    assert.equal(kvoteForDag(10, trinn).kvote, 5);
  });
});

describe("utsendingsvakt — mot database", { skip: !harDatabase ? "DATABASE_URL mangler" : false }, () => {
  let avsenderId: string;
  let avsenderTomId: string;
  let avsenderSperretId: string;
  let kontaktId: string;
  let stegId: string;

  const NAA = new Date(Date.UTC(2026, 5, 15, 10, 0, 0));
  const ORGNR = "999555111";

  before(async () => {
    await prisma.utsending.deleteMany({ where: { idempotensNokkel: { startsWith: "epost:" } } });
    await prisma.avsender.deleteMany({ where: { epost: { endsWith: TESTDOMENE } } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: ORGNR } });

    // Én reell kontakt, slik at fremmednøklene i Utsending peker på noe som finnes.
    const org = await prisma.organisasjon.create({
      data: { orgnr: ORGNR, navn: "Vakt Test AS", normalisertNavn: "vakt test as" },
    });
    const kontakt = await prisma.kontakt.create({
      data: { organisasjonId: org.id, fornavn: "Vakt", etternavn: "Test" },
    });
    kontaktId = kontakt.id;

    // Ett reelt sekvenssteg. Uten det feiler reservasjonen på fremmednøkkel, ikke
    // på idempotens — og da tester vi ingenting. Det skjedde første gang.
    const sekvens = await prisma.sekvens.upsert({
      where: { navn: "Vakt-test-sekvens" },
      update: {},
      create: { navn: "Vakt-test-sekvens", beskrivelse: "Brukes av tester." },
    });
    const versjon = await prisma.sekvensVersjon.upsert({
      where: { sekvensId_versjon: { sekvensId: sekvens.id, versjon: 1 } },
      update: {},
      create: { sekvensId: sekvens.id, versjon: 1, aktiv: true },
    });
    const steg = await prisma.sekvensSteg.upsert({
      where: { versjonId_rekkefolge: { versjonId: versjon.id, rekkefolge: 999 } },
      update: {},
      create: {
        versjonId: versjon.id,
        rekkefolge: 999,
        navn: "Teststeg",
        type: "EPOST",
        kanal: "EPOST",
        ventetidTimer: 0,
      },
    });
    stegId = steg.id;

    const a = await prisma.avsender.create({
      data: {
        epost: `vakt@${TESTDOMENE}`,
        domene: TESTDOMENE,
        status: "OPPVARMING",
        maksPerDag: 100,
        maksPerUke: 500,
        oppvarmingStartDato: NAA_TIDLIG,
      },
    });
    avsenderId = a.id;

    const t = await prisma.avsender.create({
      data: {
        epost: `tom@${TESTDOMENE}`,
        domene: TESTDOMENE,
        status: "AKTIV",
        maksPerDag: 0,
        maksPerUke: 0,
      },
    });
    avsenderTomId = t.id;

    const s = await prisma.avsender.create({
      data: {
        epost: `sperret@${TESTDOMENE}`,
        domene: TESTDOMENE,
        status: "SPERRET",
        maksPerDag: 100,
        maksPerUke: 100,
      },
    });
    avsenderSperretId = s.id;
  });

  beforeEach(async () => {
    // Rydd bort sendte meldinger fra forrige test. Tellingen er avledet fra
    // Utsending-tabellen, så det er radene som er tilstanden — ikke en teller.
    await prisma.utsending.deleteMany({ where: { avsenderId } });
  });

  after(async () => {
    await prisma.utsending.deleteMany({
      where: { OR: [{ idempotensNokkel: { startsWith: "epost:" } }, { avsenderId }] },
    });
    await prisma.avsender.deleteMany({ where: { epost: { endsWith: TESTDOMENE } } });
    await prisma.sekvens.deleteMany({ where: { navn: "Vakt-test-sekvens" } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: ORGNR } });
    await lukkDatabase();
  });

  /**
   * Legger inn `antall` sendte meldinger for avsenderen på et tidspunkt.
   *
   * Dette er nøkkelen til at testene nå tester det virkelige systemet. Den
   * forrige utgaven skrev `Avsender.sendtIDag` direkte med Prisma, og da så alt
   * riktig ut selv om ingen produksjonskode noen gang økte telleren.
   */
  async function leggInnSendte(antall: number, naar: Date): Promise<void> {
    for (let i = 0; i < antall; i += 1) {
      await prisma.utsending.create({
        data: {
          idempotensNokkel: `epost:test-${avsenderId}-${naar.getTime()}-${i}`,
          kanal: "EPOST",
          avsenderId,
          status: "SENDT",
          sendtTid: naar,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Volum
  // -------------------------------------------------------------------------

  test("BRUDD: en avsender med kvote 0 slipper ingenting gjennom", async () => {
    const svar = await sjekkVolum(avsenderTomId, NAA);
    assert.equal(svar.tillatt, false, "en avsender med kvote 0 slapp gjennom");
    assert.match(svar.grunn, /kvoten .* er 0|0/);
  });

  test("BRUDD: en sperret avsender slipper ingenting gjennom", async () => {
    const svar = await sjekkVolum(avsenderSperretId, NAA);
    assert.equal(svar.tillatt, false);
    assert.match(svar.grunn, /sperret/);
  });

  test("en avsender med ledig kvote slipper gjennom", async () => {
    const svar = await sjekkVolum(avsenderId, NAA);
    assert.equal(svar.tillatt, true, svar.grunn);
    assert.equal(svar.maksPerDag, 100);
    assert.equal(svar.sendtIDag, 0, "ingen meldinger er sendt ennå");
  });

  test("BRUDD: tellingen ser faktisk sendte meldinger", async () => {
    // Denne testen ville feilet mot den forrige utgaven, der tellingen kom fra
    // en teller som ingen produksjonskode oppdaterte.
    await leggInnSendte(3, NAA);

    const svar = await sjekkVolum(avsenderId, NAA);
    assert.equal(svar.sendtIDag, 3, `telte ${svar.sendtIDag} i stedet for 3`);
    assert.equal(svar.sendtDenneUken, 3);
  });

  test("BRUDD: døgnkvoten stopper den ene meldingen for mye", async () => {
    await leggInnSendte(100, NAA);

    // Kvoten er nøyaktig brukt opp. Den neste skal stoppes.
    const oppbrukt = await sjekkVolum(avsenderId, NAA);
    assert.equal(oppbrukt.sendtIDag, 100, `telte ${oppbrukt.sendtIDag} i stedet for 100`);
    assert.equal(oppbrukt.tillatt, false, "melding nummer 101 slapp gjennom");
    assert.match(oppbrukt.grunn, /Døgnkvoten er brukt opp/);

    // Og med én færre skal den fortsatt slippe gjennom. Det er grensen vi tester.
    await prisma.utsending.deleteMany({ where: { avsenderId } });
    await leggInnSendte(99, NAA);

    const nestSiste = await sjekkVolum(avsenderId, NAA);
    assert.equal(nestSiste.tillatt, true, "den 100. meldingen skal fortsatt gå");
    assert.equal(nestSiste.sendtIDag, 99);
  });

  test("BRUDD: ukekvoten stopper selv når døgnkvoten er ledig", async () => {
    // 500 sendt tidligere i uken, men ingen i dag.
    const mandag = new Date(Date.UTC(2026, 5, 15, 10, 0, 0));
    await leggInnSendte(500, mandag);

    const svar = await sjekkVolum(avsenderId, new Date(Date.UTC(2026, 5, 17, 10, 0, 0)));
    assert.equal(svar.tillatt, false, "ukekvoten ble ikke håndhevet");
    assert.match(svar.grunn, /Ukekvoten er brukt opp/);
  });

  test("meldinger fra forrige uke teller verken i dag eller denne uken", async () => {
    // NAA er onsdag 17. juni. Uken begynte mandag 15. juni.
    // Søndag 14. juni ligger i UKEN FØR, altså utenfor begge vinduene.
    const forrigeUke = new Date(Date.UTC(2026, 5, 14, 10, 0, 0));
    await leggInnSendte(100, forrigeUke);

    const svar = await sjekkVolum(avsenderId, NAA);
    assert.equal(svar.tillatt, true, `forrige uke skal ikke telle: ${svar.grunn}`);
    assert.equal(svar.sendtIDag, 0, "døgntellingen skal starte på nytt");
    assert.equal(svar.sendtDenneUken, 0, "ukestellingen skal starte på nytt");
  });

  test("meldinger fra tidligere i samme uke teller i uken, men ikke i dag", async () => {
    // NAA er 15. juni kl. 10:00 UTC, altså 12:00 norsk tid.
    //
    // Vi legger meldingene sent på kvelden 15. juni UTC. Det er 16. juni i norsk
    // tid, altså en ANNEN norsk dag enn NAA — men fortsatt samme uke, som
    // begynte mandag 15. juni. Det er nettopp skillet vi vil teste.
    const senKveld = new Date(Date.UTC(2026, 5, 15, 22, 0, 0));
    assert.equal(norskTid(senKveld).dato, "2026-06-16", "skal være neste norske dag");

    await leggInnSendte(7, senKveld);

    const svar = await sjekkVolum(avsenderId, NAA);
    assert.equal(svar.sendtIDag, 0, "en annen norsk dag skal ikke telle som i dag");
    assert.equal(svar.sendtDenneUken, 7, "men den skal telle i uken");
  });

  test("døgn- og ukenøkkel er stabile og riktige", () => {
    const onsdag = new Date(Date.UTC(2026, 5, 17, 10, 0, 0));
    assert.equal(dognNokkel(onsdag), "2026-06-17");

    // Mandagen i samme uke er 15. juni.
    assert.equal(ukeNokkel(onsdag), "2026-06-15");
    assert.equal(ukeNokkel(new Date(Date.UTC(2026, 5, 21, 10))), "2026-06-15", "søndag hører til samme uke");
    assert.equal(ukeNokkel(new Date(Date.UTC(2026, 5, 22, 10))), "2026-06-22", "mandag starter ny uke");
  });

  test("norsk midnatt regnes riktig, også over sommertid", () => {
    // Vintertid: UTC+1. Sommertid: UTC+2.
    assert.equal(norskMidnatt("2026-01-15").toISOString(), "2026-01-14T23:00:00.000Z");
    assert.equal(norskMidnatt("2026-07-15").toISOString(), "2026-07-14T22:00:00.000Z");

    // Midnatt norsk tid skal gi datoen vi ba om, i norsk tid.
    const norsk = norskTid(norskMidnatt("2026-07-15"));
    assert.equal(norsk.dato, "2026-07-15");
    assert.equal(norsk.time, 0);
  });

  // -------------------------------------------------------------------------
  // Oppvarming
  // -------------------------------------------------------------------------

  test("BRUDD: oppvarmingsplanen begrenser en ny avsender", async () => {
    // Vi bruker trinnene som faktisk ligger i basen. Å sette inn og slette
    // globale trinn ville rørt delt tilstand, og det er nettopp det testen
    // skal unngå.
    const trinn = await prisma.oppvarmingssteg.findMany({
      where: { avsenderId: null },
      select: { dagFraStart: true, maksPerDag: true },
      orderBy: { dagFraStart: "asc" },
    });

    assert.ok(trinn.length > 0, "ingen oppvarmingsplan i basen — kjør npm run db:seed");

    const svar = await sjekkOppvarming(avsenderId, NAA);

    assert.equal(svar.tillatt, true, svar.grunn);
    assert.equal(svar.dag, 14, `feil dag: ${svar.dag}`);

    // Kvoten skal vaere den fra det hoyeste trinnet som er passert, ikke en
    // hardkodet verdi. Da holder testen selv om planen endres.
    const forventet = kvoteForDag(14, trinn);
    assert.equal(svar.kvoteIDag, forventet.kvote, `feil kvote: ${svar.kvoteIDag}`);
    assert.ok(svar.kvoteIDag > 0, "kvoten skal vaere over null paa dag 14");
  });

  test("BRUDD: avsender under oppvarming uten startdato nektes", async () => {
    const utenDato = await prisma.avsender.create({
      data: {
        epost: `utendato@${TESTDOMENE}`,
        domene: TESTDOMENE,
        status: "OPPVARMING",
        maksPerDag: 100,
      },
    });

    const svar = await sjekkOppvarming(utenDato.id, NAA);
    assert.equal(svar.tillatt, false, "oppvarming uten startdato slapp gjennom");
    assert.match(svar.grunn, /mangler startdato/);

    await prisma.avsender.delete({ where: { id: utenDato.id } });
  });

  test("BRUDD: oppstartsdato i fremtiden nektes", async () => {
    const fremtid = await prisma.avsender.create({
      data: {
        epost: `fremtid@${TESTDOMENE}`,
        domene: TESTDOMENE,
        status: "OPPVARMING",
        maksPerDag: 100,
        oppvarmingStartDato: new Date(Date.UTC(2030, 0, 1)),
      },
    });

    const svar = await sjekkOppvarming(fremtid.id, NAA);
    assert.equal(svar.tillatt, false, "fremtidig startdato slapp gjennom");
    assert.match(svar.grunn, /fremtiden/);

    await prisma.avsender.delete({ where: { id: fremtid.id } });
  });

  test("BRUDD: effektiv kvote er den LAVESTE av oppvarming og døgnkvote", async () => {
    // Avsenderen har maksPerDag 100. På dag 14 sier oppvarmingsplanen mindre.
    // Da skal den laveste gjelde — begge grensene virker samtidig.
    const avsender = await prisma.avsender.findUnique({ where: { id: avsenderId } });
    assert.ok(avsender);

    const { kvote, grunn } = await effektivDognkvote(avsenderId, NAA);

    const oppvarming = await sjekkOppvarming(avsenderId, NAA);
    const forventet = Math.min(oppvarming.kvoteIDag, avsender.maksPerDag);

    assert.equal(kvote, forventet, `feil kvote: ${kvote}. ${grunn}`);
    assert.ok(kvote < avsender.maksPerDag, "oppvarmingskvoten skal vaere lavere enn dognkvoten her");
  });

  test("en avsender merket AKTIV er ferdig oppvarmet", async () => {
    const svar = await sjekkOppvarming(avsenderTomId, NAA);
    assert.equal(svar.ferdigOppvarmet, true);
    assert.equal(svar.tillatt, true);
  });

  // -------------------------------------------------------------------------
  // Idempotens
  // -------------------------------------------------------------------------

  test("samme input gir samme nøkkel", () => {
    const del = { kanal: "EPOST" as const, kontaktId: "k1", sekvensStegId: "s1" };
    assert.equal(byggIdempotensNokkel(del), byggIdempotensNokkel(del));
  });

  test("ulik mottaker gir ulik nøkkel", () => {
    const a = byggIdempotensNokkel({ kanal: "EPOST", kontaktId: "k1" });
    const b = byggIdempotensNokkel({ kanal: "EPOST", kontaktId: "k2" });
    assert.notEqual(a, b);
  });

  test("tørrkjøring og ekte sending har ulike nøkler", () => {
    // Ellers ville en tørrkjøring blokkert den ekte sendingen etterpå.
    const torr = byggIdempotensNokkel({ kanal: "EPOST", kontaktId: "k1", torrkjoering: true });
    const ekte = byggIdempotensNokkel({ kanal: "EPOST", kontaktId: "k1", torrkjoering: false });
    assert.notEqual(torr, ekte);
  });

  test("BRUDD: samme melding kan ikke reserveres to ganger", async () => {
    const del = { kanal: "EPOST" as const, kontaktId, sekvensStegId: stegId };

    const forste = await provAaReservere(del, { avsenderId });
    assert.equal(forste.reservert, true, "første reservasjon ble avvist");

    const andre = await provAaReservere(del, { avsenderId });
    assert.equal(andre.reservert, false, "samme melding ble reservert to ganger");
    assert.match(andre.grunn, /allerede/);
    assert.equal(andre.utsendingId, forste.utsendingId, "andre reservasjon pekte på feil rad");
  });

  test("parallell reservasjon slipper bare én gjennom", async () => {
    // Dette er kappløpet den unike indeksen skal hindre: tre samtidige kall.
    const del = { kanal: "EPOST" as const, kontaktId, sekvensStegId: stegId, tillegg: `kapplop-${Date.now()}` };

    const resultater = await Promise.all([
      provAaReservere(del, { avsenderId }),
      provAaReservere(del, { avsenderId }),
      provAaReservere(del, { avsenderId }),
    ]);

    const tillatt = resultater.filter((r) => r.reservert).length;
    assert.equal(tillatt, 1, `forventet nøyaktig én reservasjon, fikk ${tillatt}`);
  });

  test("reservert melding kan merkes sendt, og blokkerer fortsatt", async () => {
    const del = {
      kanal: "EPOST" as const,
      kontaktId,
      sekvensStegId: stegId,
      tillegg: `sendt-${Date.now()}`,
    };

    const r = await provAaReservere(del, { avsenderId });
    assert.equal(r.reservert, true);
    assert.ok(r.reservert);

    await merkSendt(r.utsendingId, "ekstern-123");

    const igjen = await provAaReservere(del, { avsenderId });
    assert.equal(igjen.reservert, false, "en sendt melding kunne reserveres på nytt");
    assert.match(igjen.grunn, /allerede sendt/);

    assert.equal(await erAlleredeSendt(del), true);
  });

  test("feilet melding blokkerer også, så vi ikke spammer ved feil", async () => {
    const del = {
      kanal: "EPOST" as const,
      kontaktId,
      sekvensStegId: stegId,
      tillegg: `feilet-${Date.now()}`,
    };

    const r = await provAaReservere(del, { avsenderId });
    assert.equal(r.reservert, true);
    assert.ok(r.reservert);

    await merkFeilet(r.utsendingId, "SMTP avviste");

    const igjen = await provAaReservere(del, { avsenderId });
    assert.equal(igjen.reservert, false, "en feilet melding kunne sendes på nytt automatisk");
  });

  test("en melding uten mottaker får en nøkkel likevel", async () => {
    // Uten kontakt eller organisasjon skal nøkkelen fortsatt være deterministisk.
    const del = { kanal: "EPOST" as const, tillegg: `utennmottaker-${Date.now()}` };
    const a = await provAaReservere(del, { avsenderId });
    const b = await provAaReservere(del, { avsenderId });

    assert.equal(a.reservert, true);
    assert.equal(b.reservert, false, "to reservasjoner uten mottaker slapp gjennom");
  });

  test("gjenvaerendeKvote sier hvor mange som kan sendes nå", async () => {
    await leggInnSendte(97, NAA);

    const { antall, grunn } = await gjenvaerendeKvote(avsenderId, NAA);
    assert.equal(antall, 3, `forventet 3 igjen, fikk ${antall}. ${grunn}`);
  });

  test("gjenvaerendeKvote er null når kvoten er brukt opp", async () => {
    await leggInnSendte(100, NAA);

    const { antall } = await gjenvaerendeKvote(avsenderId, NAA);
    assert.equal(antall, 0);
  });

  test("en kansellert eller feilet utsending teller IKKE mot kvoten", async () => {
    // Bare det som beviselig er sendt, skal telle. Ellers ville en feilet
    // sending spist av kvoten uten at noen fikk noe.
    await prisma.utsending.create({
      data: {
        idempotensNokkel: `epost:feilet-${Date.now()}`,
        kanal: "EPOST",
        avsenderId,
        status: "FEILET",
        sendtTid: null,
      },
    });

    const svar = await sjekkVolum(avsenderId, NAA);
    assert.equal(svar.sendtIDag, 0, "en feilet utsending ble talt med");
    assert.equal(svar.tillatt, true);
  });
});
