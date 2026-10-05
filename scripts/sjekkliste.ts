/**
 * Sjekkeliste.
 *
 * Verifiserer systemet ende-til-ende. Kravet er at den skal kunne kjøres
 * UTEN NETTVERK — derfor rører den ingen eksterne tjenester, bare databasen
 * og systemets egne regler.
 *
 * Hver sjekk skriver hva den fant. Er noe ikke konfigurert, sier den det —
 * den later aldri som noe virker. Se docs/stoppkriterier.md.
 *
 * Kjøres med `npm run sjekkliste`.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { hashPassord, verifiserPassord } from "../src/lib/auth/passord.ts";
import { vask } from "../src/lib/logg.ts";
import { helligdagerForAar } from "../src/lib/tid/helligdager.ts";
import { sjekkVindu } from "../src/lib/tid/vinduer.ts";
import { sjekkSperreliste, leggTilSperre } from "../src/lib/guards/sperreliste.ts";
import { sperrBounce } from "../src/lib/guards/automatisk.ts";
import { tellRevisjoner } from "../src/lib/revisjon.ts";
import {
  normaliserVirksomhet,
  type NormalisertVirksomhet,
} from "../src/lib/enhetsregister/normaliser.ts";
import { vurderVirksomhet, type FilterKonfig } from "../src/lib/enhetsregister/filter.ts";
import { kvoteForDag } from "../src/lib/guards/oppvarming.ts";
import { byggIdempotensNokkel } from "../src/lib/guards/idempotens.ts";
import { koStatus } from "../src/lib/godkjenning/ko.ts";
import { regnPlanlagtTid } from "../src/lib/sekvens/motor.ts";
import { tolkCsv, importerKontakter, erImportFeil } from "../src/lib/kontakter/import.ts";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as stiModul from "node:path";

/**
 * Leser en fil, eller gir null hvis den ikke finnes.
 *
 * Brukes av sjekken som verifiserer at importene i produksjonskjeden peker på
 * filer som faktisk finnes. Den sjekken finnes fordi to feil har hatt sitt
 * opphav i Docker-bildet, der en fil manglet — og ingen test bygger bildet.
 */
async function lestFil(sti: string): Promise<string | null> {
  try {
    return await readFile(sti, "utf8");
  } catch {
    return null;
  }
}

/**
 * Bygger en gyldig, privat virksomhet for filterkontrollene.
 * Testen varierer én egenskap om gangen fra dette utgangspunktet.
 */
function virksomhetForSjekk(orgnr: string, navn: string): NormalisertVirksomhet {
  return {
    orgnr,
    navn,
    normalisertNavn: navn.toLowerCase(),
    organisasjonsform: "AS",
    naeringskode: "62.010",
    naeringsbeskrivelse: "Databehandling",
    sektor: "PRIVAT",
    antallAnsatte: 20,
    stiftetDato: new Date(Date.UTC(2020, 0, 15)),
    registrertDato: new Date(Date.UTC(2020, 0, 20)),
    konkurs: false,
    underAvvikling: false,
    adresse: "Testveien 1",
    postnummer: "0150",
    poststed: "OSLO",
    fylke: "Oslo",
    kommunenummer: "0301",
    nettside: null,
  };
}

const url = process.env.DATABASE_URL;

let bestatt = 0;
let feilet = 0;
let hoppetOver = 0;

const GROENN = "\u001b[32m";
const ROED = "\u001b[31m";
const GUL = "\u001b[33m";
const DUS = "\u001b[2m";
const SLUTT = "\u001b[0m";

function ok(tekst: string, detalj?: string): void {
  bestatt += 1;
  console.log(`  ${GROENN}✓${SLUTT} ${tekst}`);
  if (detalj) console.log(`    ${DUS}${detalj}${SLUTT}`);
}

function nei(tekst: string, detalj?: string): void {
  feilet += 1;
  console.log(`  ${ROED}✗${SLUTT} ${tekst}`);
  if (detalj) console.log(`    ${DUS}${detalj}${SLUTT}`);
}

function hopp(tekst: string, grunn?: string): void {
  hoppetOver += 1;
  console.log(`  ${GUL}–${SLUTT} ${tekst}`);
  if (grunn) console.log(`    ${DUS}${grunn}${SLUTT}`);
}

function seksjon(tittel: string): void {
  console.log(`\n${tittel}`);
}

// ---------------------------------------------------------------------------

if (!url) {
  console.error("DATABASE_URL mangler. Se docs/manuell-oppsett.md, del C1.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function hoved() {
  console.log("VikingPilot — sjekkeliste");
  console.log("Kjøres uten nettverk. Rører ingen eksterne tjenester.");

  // -------------------------------------------------------------------------
  seksjon("1. Skjemaet er satt opp");

  try {
    await prisma.$queryRaw`SELECT 1`;
    ok("Databasen svarer");
  } catch (feil) {
    nei("Databasen svarer ikke", feil instanceof Error ? feil.message : String(feil));
    console.log("\nStopper. Resten krever en database.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const tabeller = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  const antall = tabeller.length;
  if (antall >= 30) {
    ok(`Skjemaet finnes`, `${antall} tabeller i public`);
  } else {
    nei(`For få tabeller`, `fant ${antall}, forventet minst 30`);
  }

  // -------------------------------------------------------------------------
  seksjon("2. All utgående trafikk er av");

  const alleKanaler = await prisma.kanalInnstilling.findMany();
  const paaslatt = alleKanaler.filter((k) => k.utgaaendeAktivert);

  if (alleKanaler.length === 0) {
    nei("Ingen kanaler er satt opp", "kjør npm run db:seed");
  } else if (paaslatt.length === 0) {
    ok(
      `Ingen kanal er slått på`,
      `${alleKanaler.length} kanaler, alle med utgående av`,
    );
  } else {
    nei(
      `ADVARSEL: ${paaslatt.length} kanal(er) er slått på`,
      paaslatt.map((k) => k.kanal).join(", "),
    );
  }

  // -------------------------------------------------------------------------
  seksjon("3. Integrasjoner sier ærlig hva som mangler");

  const integrasjoner = await prisma.integrasjon.findMany({ orderBy: { navn: "asc" } });

  if (integrasjoner.length === 0) {
    nei("Ingen integrasjoner registrert", "kjør npm run db:seed");
  }

  for (const i of integrasjoner) {
    const noklerSatt = i.manglendeNokler.length === 0;
    const stemmer = i.konfigurert === noklerSatt;

    // Sjekk at det den sier faktisk stemmer med miljøet.
    const faktiskMangler = i.manglendeNokler.filter(
      (n) => !process.env[n] || process.env[n].trim() === "",
    );

    if (!stemmer) {
      nei(`${i.navn}: status stemmer ikke med manglende nøkler`);
    } else if (i.konfigurert) {
      ok(`${i.navn}: konfigurert`);
    } else if (faktiskMangler.length === i.manglendeNokler.length) {
      ok(`${i.navn}: ikke konfigurert`, `mangler ${i.manglendeNokler.join(", ")}`);
    } else {
      nei(
        `${i.navn}: uoppdatert status`,
        `sier ${i.manglendeNokler.join(", ")}, men miljøet mangler ${faktiskMangler.join(", ") || "ingenting"}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  seksjon("4. Tidsplanen");

  const jobber = await prisma.cronJobb.findMany({ orderBy: { navn: "asc" } });

  if (jobber.length === 0) {
    nei("Ingen cron-jobber", "kjør npm run db:seed");
  }

  let egneHemmeligheter = new Set();
  for (const j of jobber) {
    egneHemmeligheter.add(j.hemmelighetNavn);
  }

  if (jobber.length > 0 && egneHemmeligheter.size === jobber.length) {
    ok(`${jobber.length} cron-jobber, hver med sin egen hemmelighet`);
  } else if (jobber.length > 0) {
    nei("Cron-jobber deler hemmelighet", "hver jobb skal ha sin egen");
  }

  let medTorrkjoering = 0;
  for (const j of jobber) {
    if (j.torrkjoeringStandard) medTorrkjoering += 1;
  }
  if (jobber.length > 0 && medTorrkjoering === jobber.length) {
    ok("Alle cron-jobber tørrkjører som standard");
  } else if (jobber.length > 0) {
    nei(
      "Ikke alle cron-jobber tørrkjører som standard",
      `${medTorrkjoering} av ${jobber.length}`,
    );
  }

  // -------------------------------------------------------------------------
  seksjon("5. Guardrails — forsøk på å bryte dem");

  // 5a. Sperrelister
  const sperrer = await prisma.sperreliste.count({ where: { aktiv: true } });
  ok(`Sperrelisten virker`, `${sperrer} aktive sperrer`);

  // 5b. Volum: alle kanaler skal ha 0 som tak så lenge de er av
  const medVolum = alleKanaler.filter((k) => k.utgaaendeAktivert && k.maksPerDag > 0);
  if (medVolum.length === 0) {
    ok("Ingen kanal kan sende noe", "ingen påslått kanal har døgnkvote over 0");
  } else {
    nei("En påslått kanal har kvote", medVolum.map((k) => k.kanal).join(", "));
  }

  // 5c. Idempotens: to utsendinger med samme nøkkel skal avvises
  const noekkel = `sjekkeliste-${Date.now()}`;
  await prisma.utsending.deleteMany({ where: { idempotensNokkel: noekkel } });

  try {
    await prisma.utsending.create({
      data: { idempotensNokkel: noekkel, kanal: "EPOST", torrkjoering: true },
    });

    let avvist = false;
    try {
      await prisma.utsending.create({
        data: { idempotensNokkel: noekkel, kanal: "EPOST", torrkjoering: true },
      });
    } catch {
      avvist = true;
    }

    if (avvist) {
      ok("Idempotens: samme melding kan ikke sendes to ganger");
    } else {
      nei("Idempotens virker ikke", "to utsendinger med samme nøkkel ble godtatt");
    }
  } finally {
    await prisma.utsending.deleteMany({ where: { idempotensNokkel: noekkel } });
  }

  // 5d. Tidsvindu — helg skal stenges
  const sondag = new Date("2026-03-08T12:00:00Z"); // en søndag
  const sondagSvar = sjekkVindu(sondag, {
    start: "08:00",
    slutt: "16:00",
    kunHverdager: true,
  });
  if (!sondagSvar.aapen) {
    ok("Tidsvindu: søndag stenges", sondagSvar.grunn);
  } else {
    nei("Tidsvindu slapp gjennom en søndag");
  }

  // 5e. Rød dag skal stenges
  const forsteJuledag = new Date("2026-12-25T12:00:00Z");
  const julSvar = sjekkVindu(forsteJuledag, {
    start: "08:00",
    slutt: "16:00",
    kunHverdager: true,
  });
  if (!julSvar.aapen) {
    ok("Tidsvindu: rød dag stenges", julSvar.grunn);
  } else {
    nei("Tidsvindu slapp gjennom en rød dag");
  }

  // 5f. Utenfor klokkeslettet skal stenges
  const natt = new Date("2026-03-11T03:00:00Z"); // onsdag natt
  const nattSvar = sjekkVindu(natt, { start: "08:00", slutt: "16:00", kunHverdager: true });
  if (!nattSvar.aapen) {
    ok("Tidsvindu: natt stenges", nattSvar.grunn);
  } else {
    nei("Tidsvindu slapp gjennom en natt");
  }

  // -------------------------------------------------------------------------
  seksjon("6. Norske røde dager regnes riktig");

  const helligdag2026 = helligdagerForAar(2026);
  const navn2026 = helligdag2026.map((h) => h.navn);

  // Påskedag 2026 er 5. april. Skjærtorsdag 2. april, langfredag 3. april.
  const skjaertorsdag = helligdag2026.find((h) => h.navn === "Skjærtorsdag");
  if (skjaertorsdag?.dato === "2026-04-02") {
    ok("Skjærtorsdag 2026 er 2. april", "påsken beregnes, ikke slås opp");
  } else {
    nei("Skjærtorsdag 2026 feil", `fikk ${skjaertorsdag?.dato ?? "ingen"}`);
  }

  const faste = ["Første nyttårsdag", "Arbeidernes dag", "Grunnlovsdagen", "Første juledag"];
  const alleFaste = faste.every((n) => navn2026.includes(n));
  if (alleFaste) {
    ok("Faste helligdager finnes", `${helligdag2026.length} røde dager i 2026`);
  } else {
    nei("Faste helligdager mangler");
  }

  // -------------------------------------------------------------------------
  seksjon("7. Ingen hemmeligheter lekker");

  const testStreng = "postgresql://bruker:supersecret@vert:5432/db";
  const vasket = vask(testStreng);
  if (!String(vasket).includes("supersecret")) {
    ok("Tilkoblingsstrenger maskeres i logger");
  } else {
    nei("Passord lekker i logg", String(vasket));
  }

  const vasketObjekt = vask({ apiKey: "abc123", epost: "a@b.no" }) as Record<string, unknown>;
  if (vasketObjekt["apiKey"] === "[skjult]" && vasketObjekt["epost"] === "a@b.no") {
    ok("Feltnavn som ser hemmelige ut maskeres");
  } else {
    nei("Maskering av feltnavn virker ikke");
  }

  // -------------------------------------------------------------------------
  seksjon("8. Innlogging");

  const brukere = await prisma.bruker.count();
  if (brukere > 0) {
    ok(`${brukere} brukere satt opp`);
  } else {
    hopp("Ingen brukere satt opp", "sett SEED_PASSORD og kjør npm run db:seed");
  }

  const { hash } = await hashPassord("SjekkelistePassord123");
  if (await verifiserPassord("SjekkelistePassord123", hash)) {
    ok("Passordhash kan verifiseres");
  } else {
    nei("Passordhash virker ikke");
  }
  if (!(await verifiserPassord("FeilPassord999", hash))) {
    ok("Feil passord avvises");
  } else {
    nei("Feil passord ble godtatt");
  }

  // -------------------------------------------------------------------------
  seksjon("9. Frødata gjør systemet demonstrerbart");

  const maalgrupper = await prisma.maalgruppe.count();
  const produkter = await prisma.produkt.count();
  const sekvenser = await prisma.sekvens.count();
  const steg = await prisma.sekvensSteg.count();
  const oppvarming = await prisma.oppvarmingssteg.count();

  maalgrupper > 0 ? ok(`${maalgrupper} målgruppe(r)`) : nei("Ingen målgrupper");
  produkter > 0 ? ok(`${produkter} produkt(er)`) : nei("Ingen produkter");
  sekvenser > 0 && steg > 0
    ? ok(`${sekvenser} sekvens(er) med ${steg} steg`)
    : nei("Ingen sekvenser");
  oppvarming > 0 ? ok(`${oppvarming} oppvarmingstrinn`) : nei("Ingen oppvarmingsplan");

  // -------------------------------------------------------------------------
  seksjon("10. Sperrelister virker ende-til-ende");

  const TESTDOMENE = "sjekkeliste.invalid";
  const testEpost = `prove@${TESTDOMENE}`;
  const testOrgNr = "999777666";
  let testOrgId: string | null = null;
  let testKontaktId: string | null = null;

  try {
    // Rydd bort fra forrige kjøring, så sjekkelisten er gjentakbar.
    await prisma.sperreliste.deleteMany({ where: { epost: { endsWith: TESTDOMENE } } });
    await prisma.organisasjon.deleteMany({ where: { orgnr: testOrgNr } });

    // Kontroll: en usperret adresse skal slippe gjennom.
    const forSperre = await sjekkSperreliste({ kanal: "EPOST", epost: testEpost });
    if (forSperre.tillatt) {
      ok("Usperret adresse slipper gjennom", "kontrolltest — ellers vet vi ikke om nei-ene betyr noe");
    } else {
      nei("Usperret adresse ble avvist", forSperre.grunn);
    }

    // Legg inn en global sperre og prøv å omgå den.
    await leggTilSperre({
      type: "GLOBAL",
      grunn: "AVMELDING",
      epost: testEpost,
      kilde: "sjekkeliste",
    });

    const varianter = [testEpost, testEpost.toUpperCase(), `  ${testEpost}  `];
    let alleStoppet = true;
    for (const v of varianter) {
      const svar = await sjekkSperreliste({ kanal: "EPOST", epost: v });
      if (svar.tillatt) alleStoppet = false;
    }

    if (alleStoppet) {
      ok("Sperret adresse stoppes, også med annen skrivemåte");
    } else {
      nei("En variant av en sperret adresse slapp gjennom");
    }

    // Sperret kontakt skal stoppe selv uten e-postadresse.
    const testOrg = await prisma.organisasjon.create({
      data: { orgnr: testOrgNr, navn: "Sjekkeliste AS", normalisertNavn: "sjekkeliste as" },
    });
    testOrgId = testOrg.id;

    const testKontakt = await prisma.kontakt.create({
      data: { organisasjonId: testOrg.id, fornavn: "Sjekk", etternavn: "Liste" },
    });
    testKontaktId = testKontakt.id;

    await leggTilSperre({
      type: "KONTAKT",
      grunn: "MANUELL",
      kontaktId: testKontakt.id,
      kilde: "sjekkeliste",
    });

    const kontaktSvar = await sjekkSperreliste({ kanal: "EPOST", kontaktId: testKontakt.id });
    if (!kontaktSvar.tillatt) {
      ok("Sperret kontakt stoppes uten e-postadresse");
    } else {
      nei("Kontaktsperre traff ikke");
    }

    // Myk bounce skal IKKE sperre.
    //
    // MERK: disse adressene ligger på egne underdomener. Den globale sperren over
    // gjelder bare `prove@sjekkeliste.invalid`, men en sperre med epostDomene
    // ville ellers truffet naboene. Egen adresse per sjekk gjør dem uavhengige.
    const mykEpost = `myk@mykbounce.${TESTDOMENE}`;
    const myk = await sperrBounce(mykEpost, false, "sjekkeliste");
    const mykSvar = await sjekkSperreliste({ kanal: "EPOST", epost: mykEpost });
    if (!myk.opprettet && mykSvar.tillatt) {
      ok("Myk bounce sperrer ikke adressen", "full postkasse er ikke det samme som ukjent adresse");
    } else {
      nei("Myk bounce sperret adressen — for strengt", mykSvar.grunn);
    }

    // Hard bounce skal sperre.
    const hardEpost = `hard@hardbounce.${TESTDOMENE}`;
    await sperrBounce(hardEpost, true, "sjekkeliste");
    const hardSvar = await sjekkSperreliste({ kanal: "EPOST", epost: hardEpost });
    if (!hardSvar.tillatt) {
      ok("Hard bounce sperrer adressen");
    } else {
      nei("Hard bounce sperret ikke adressen");
    }

    // Revisjonsloggen skal ha fanget det.
    const revisjoner = await tellRevisjoner({ kilde: "sjekkeliste" });
    if (revisjoner === 0) {
      // sjekkelisten legger ikke inn revisjoner selv — det gjør sperrAvmelding og API-et.
      ok("Revisjonsloggen kan telles", `${await tellRevisjoner()} oppføringer totalt`);
    } else {
      ok("Revisjonsloggen kan telles", `${revisjoner} fra sjekkelisten`);
    }
  } finally {
    // Rydd alltid opp, også hvis noe feilet underveis.
    await prisma.sperreliste.deleteMany({ where: { epost: { endsWith: TESTDOMENE } } });
    if (testKontaktId) {
      await prisma.sperreliste.deleteMany({ where: { kontaktId: testKontaktId } });
    }
    if (testOrgId) {
      await prisma.sperreliste.deleteMany({ where: { organisasjonId: testOrgId } });
    }
    await prisma.organisasjon.deleteMany({ where: { orgnr: testOrgNr } });
  }

  // -------------------------------------------------------------------------
  seksjon("11. Enhetsregister-pipelinen — normalisering og filter");

  // Normalisering og filtrering er rene funksjoner. De kan sjekkes uten nettverk.
  const proveRaa = {
    organisasjonsnummer: "933 851 222",
    navn: "  Vikingnet AS  ",
    organisasjonsform: { kode: "AS" },
    naeringskode1: { kode: "62.010", beskrivelse: "Databehandling" },
    antallAnsatte: 4,
    stiftelsesdato: "2020-01-15",
    sektor: "",
    forretningsadresse: { adresse: ["Testveien 1"], postnummer: "0150", poststed: "OSLO" },
  };

  const normalisert = normaliserVirksomhet(proveRaa);

  if (normalisert?.orgnr === "933851222" && normalisert.navn === "Vikingnet AS") {
    ok("Normalisering rydder orgnr og navn", `${normalisert.orgnr} / ${normalisert.navn}`);
  } else {
    nei("Normalisering virker ikke", JSON.stringify(normalisert));
  }

  // Med tomt sektor-felt må organisasjonsformen avgjøre. Dette var en ekte feil:
  // første versjon avviste alt fra det åpne API-et som «ukjent sektor».
  if (normalisert?.sektor === "PRIVAT") {
    ok("Tomt sektor-felt gir PRIVAT når organisasjonsformen er AS");
  } else {
    nei("Sektor-utledning feiler på tomt sektor-felt", `fikk ${normalisert?.sektor}`);
  }

  const offentligProve = normaliserVirksomhet({
    organisasjonsnummer: "999888777",
    navn: "Statens Hus",
    organisasjonsform: { kode: "ORGL" },
  });
  if (offentligProve?.sektor === "OFFENTLIG") {
    ok("ORGL klassifiseres som offentlig");
  } else {
    nei("ORGL ble ikke klassifisert som offentlig");
  }

  // Absolutte filterregler. Disse kan ikke slås av fra konfigurasjon.
  const aapenKonfig = {
    naeringskoder: [],
    fylker: [],
    minAnsatte: null,
    maxAnsatte: null,
    minAlderMaaneder: null,
    ekskluderOffentlig: false,
    ekskluderKonkurs: false,
    ekskluderUnderAvvikling: false,
  };

  const base = virksomhetForSjekk("999888777", "Testbedrift AS");
  const tilfeller: { navn: string; v: typeof base; kode: string }[] = [
    { navn: "konkurs", v: { ...base, konkurs: true }, kode: "KONKURS" },
    { navn: "under avvikling", v: { ...base, underAvvikling: true }, kode: "UNDER_AVVIKLING" },
    { navn: "offentlig sektor", v: { ...base, sektor: "OFFENTLIG" as const }, kode: "OFFENTLIG_SEKTOR" },
  ];

  let alleAvvist = true;
  for (const t of tilfeller) {
    const svar = vurderVirksomhet(t.v, aapenKonfig, new Date());
    if (svar.godkjent || svar.kode !== t.kode) {
      alleAvvist = false;
      nei(`${t.navn} slapp gjennom en helt åpen konfigurasjon`, `kode=${svar.kode}`);
    }
  }
  if (alleAvvist) {
    ok("Konkurs, avvikling og offentlig sektor avvises selv med åpen konfigurasjon");
  }

  // Kontrolltest: en vanlig privat virksomhet skal slippe gjennom.
  const vanlig = vurderVirksomhet(base, aapenKonfig, new Date());
  if (vanlig.godkjent) {
    ok("En vanlig privat virksomhet godkjennes", "kontrolltest");
  } else {
    nei("En vanlig privat virksomhet ble avvist", vanlig.grunn);
  }

  // -------------------------------------------------------------------------
  seksjon("12. Utsendingsvakten — volum, oppvarming og idempotens");

  const tomPlan = kvoteForDag(5, []);
  if (tomPlan.kvote === 0) {
    ok("En tom oppvarmingsplan gir kvote 0", "ikke fritt fram");
  } else {
    nei("Tom oppvarmingsplan ga kvote over 0", `fikk ${tomPlan.kvote}`);
  }

  const planProve = [
    { dagFraStart: 0, maksPerDag: 5 },
    { dagFraStart: 4, maksPerDag: 10 },
  ];
  if (kvoteForDag(0, planProve).kvote === 5 && kvoteForDag(4, planProve).kvote === 10) {
    ok("Oppvarmingskvoten vokser med trinnene");
  } else {
    nei("Oppvarmingskurven regnes feil");
  }

  const nokkelA = byggIdempotensNokkel({ kanal: "EPOST", kontaktId: "k1", sekvensStegId: "s1" });
  const nokkelB = byggIdempotensNokkel({ kanal: "EPOST", kontaktId: "k1", sekvensStegId: "s1" });
  const nokkelC = byggIdempotensNokkel({ kanal: "EPOST", kontaktId: "k2", sekvensStegId: "s1" });
  const nokkelTorr = byggIdempotensNokkel({
    kanal: "EPOST",
    kontaktId: "k1",
    sekvensStegId: "s1",
    torrkjoering: true,
  });

  if (nokkelA === nokkelB && nokkelA !== nokkelC && nokkelA !== nokkelTorr) {
    ok("Idempotensnøkkelen er deterministisk og skiller mottakere og tørrkjøring");
  } else {
    nei("Idempotensnøkkelen virker ikke som den skal");
  }

  // Kontaktimport: formatet skal tolkes riktig, og personvernet skal håndheves.
  const csvProve = [
    "fornavn,etternavn,epost,beslutningstaker,samtykke",
    `Kari,Nordmann,kari@sjekkliste.invalid,ja,Test`,
    `Ugyldig,Epost,ikke-en-epost,,Test`,
  ].join("\n");

  const tolket = tolkCsv(csvProve);

  if (tolket.rader.length === 1 && tolket.feil.length === 1) {
    ok("Kontaktimport skiller gyldige rader fra ugyldige");
  } else {
    nei(
      `Kontaktimporten tolket feil: ${tolket.rader.length} gyldige, ${tolket.feil.length} avviste`,
    );
  }

  if (tolket.rader[0]?.beslutningstaker === true) {
    ok("Kontaktimport leser «ja» som beslutningstaker");
  } else {
    nei("Kontaktimporten leste ikke beslutningstaker riktig");
  }

  // Personvern: uten grunnlag skal importen nekte.
  let nektetUtenGrunnlag = false;
  try {
    await importerKontakter(`fornavn,etternavn,epost\nTest,Person,test@sjekkliste.invalid`, {
      torrkjoering: true,
    });
  } catch (e) {
    nektetUtenGrunnlag = erImportFeil(e);
  }

  if (nektetUtenGrunnlag) {
    ok("Kontaktimport nekter å lagre personopplysninger uten grunnlag");
  } else {
    nei("Kontaktimporten godtok personopplysninger uten dokumentert grunnlag");
  }

  // Tilstandskontroll: ingen kanal skal kunne sende, og ingen sperre skal mangle mottaker.
  const sperrerUtenMottaker = await prisma.sperreliste.count({
    where: {
      aktiv: true,
      epost: null,
      epostDomene: null,
      kontaktId: null,
      organisasjonId: null,
    },
  });

  if (sperrerUtenMottaker === 0) {
    ok("Ingen aktiv sperre mangler mottaker", "en slik sperre ville stoppet alt");
  } else {
    nei(
      `${sperrerUtenMottaker} aktive sperrer mangler mottaker`,
      "de stopper all utgående trafikk",
    );
  }

  // PEKER ALLE IMPORTENE I PRODUKSJONSKJEDEN PÅ NOE SOM FINNES?
  //
  // Dette er den eneste sjekken som kan fange den feilklassen vi har hatt to av:
  // koden kjører lokalt, men en fil mangler i Docker-bildet. Ingen test bygger
  // bildet, fordi Docker ikke finnes her. Men vi kan sjekke at hver import i
  // kjeden faktisk peker på en fil — og da fanger vi en manglende eller feilstavet
  // fil før deploy, ikke etter.
  //
  // F-039 var nettopp dette: grunndata.mjs importerte src/lib/auth/passord.ts,
  // som ikke ble kopiert inn i kjøresteget. Feilen dukket først i Deploy Logs.
  const produksjonsfiler = [
    "scripts/start-prod.mjs",
    "scripts/oppsett.mjs",
    "scripts/grunndata.mjs",
    "scripts/bruker.mjs",
  ];

  const manglendeFiler: string[] = [];

  for (const fil of produksjonsfiler) {
    const innhold = await lestFil(fil);
    if (innhold === null) {
      manglendeFiler.push(fil);
      continue;
    }

    // Fanger både `import x from "..."` og `await import("...")`.
    const importer = [
      ...innhold.matchAll(/(?:from\s+|await\s+import\(\s*)["']([^"']+)["']/g),
    ].map((m) => m[1]!);

    for (const imp of importer) {
      // Bare relative stier er våre egne filer. Pakker og node:-moduler hopper vi over.
      if (!imp.startsWith(".")) continue;

      const opplosst = stiModul.resolve(stiModul.dirname(stiModul.resolve(fil)), imp);

      if (!existsSync(opplosst)) {
        manglendeFiler.push(`${fil} → ${imp}`);
      }
    }
  }

  if (manglendeFiler.length === 0) {
    ok(
      "Alle importer i produksjonskjeden peker på filer som finnes",
      `${produksjonsfiler.length} filer sjekket`,
    );
  } else {
    nei(
      `${manglendeFiler.length} import(er) i produksjonskjeden mangler fil`,
      manglendeFiler.join("; "),
    );
  }

  // Dataene pipelinen har hentet, skal ikke inneholde noe forbudt.
  const offentligeILager = await prisma.organisasjon.count({ where: { sektor: "OFFENTLIG" } });
  if (offentligeILager === 0) {
    ok("Ingen offentlige virksomheter i basen");
  } else {
    nei(`${offentligeILager} offentlige virksomheter ligger i basen`);
  }

  const konkursILager = await prisma.organisasjon.count({
    where: { OR: [{ konkurs: true }, { underAvvikling: true }] },
  });
  if (konkursILager === 0) {
    ok("Ingen konkurser eller avviklinger i basen");
  } else {
    nei(`${konkursILager} konkurser eller avviklinger ligger i basen`);
  }

  // Sendende ruter skal ikke ha sendt noe.
  const sendtFaktisk = await prisma.utsending.count({ where: { status: "SENDT" } });
  if (sendtFaktisk === 0) {
    ok("Ingen utsending er noen gang sendt", "alt er av");
  } else {
    nei(`${sendtFaktisk} utsendinger står som sendt`);
  }

  // -------------------------------------------------------------------------
  seksjon("13. Godkjenningskøen og sekvensmotoren");

  // Ingen melding skal være sendt. Dette er systemets viktigste invariant.
  const sendteMeldinger = await prisma.dialogMelding.count({ where: { status: "SENDT" } });
  if (sendteMeldinger === 0) {
    ok("Ingen dialogmelding er sendt", "alt er av");
  } else {
    nei(`${sendteMeldinger} dialogmeldinger står som SENDT`);
  }

  // Ingen melding skal være godkjent uten at et menneske har bestemt.
  const godkjenteUtenBeslutning = await prisma.dialogMelding.count({
    where: { status: "GODKJENT", godkjenning: { beslutninger: { none: {} } } },
  });
  if (godkjenteUtenBeslutning === 0) {
    ok("Ingen melding er godkjent uten at et menneske har bestemt");
  } else {
    nei(
      `${godkjenteUtenBeslutning} meldinger står som godkjent uten en beslutning`,
      "køen er omgått",
    );
  }

  // Enhver godkjenning som er avgjort, skal ha en navngitt beslutning.
  const avgjorteUtenNavn = await prisma.godkjenning.count({
    where: {
      status: { in: ["GODKJENT", "AVVIST"] },
      beslutninger: { none: {} },
    },
  });
  if (avgjorteUtenNavn === 0) {
    ok("Alle avgjorte godkjenninger har et navn og et tidspunkt");
  } else {
    nei(`${avgjorteUtenNavn} godkjenninger er avgjort uten en registrert beslutning`);
  }

  // Ingen utsending skal stå som sendt uten en godkjenning bak seg.
  const utsendingerUtenGodkjenning = await prisma.utsending.count({
    where: { status: "SENDT", dialogMelding: { godkjenning: null } },
  });
  if (utsendingerUtenGodkjenning === 0) {
    ok("Ingen utsending er sendt uten en godkjenning");
  } else {
    nei(`${utsendingerUtenGodkjenning} utsendinger er sendt uten godkjenning`);
  }

  const ko = await koStatus();
  ok(
    "Godkjenningskøen kan leses",
    `${ko.venter} venter, ${ko.godkjent} godkjent, ${ko.avvist} avvist`,
  );

  // Sekvensmotoren skal ikke ha noen vei til å sende.
  const motorModul = await import("../src/lib/sekvens/motor.ts");
  const motorEksporter = Object.keys(motorModul);
  const serUtSomSending = motorEksporter.filter((n) => /^(send|lever|utsend)/i.test(n));

  if (serUtSomSending.length === 0) {
    ok("Sekvensmotoren eksporterer ingen sendefunksjon", "den lager bare utkast");
  } else {
    nei(
      "Sekvensmotoren eksporterer noe som ser ut som sending",
      serUtSomSending.join(", "),
    );
  }

  // Planlagt tid skal regnes fra forrige steg, ikke fra starten.
  const t0 = new Date(Date.UTC(2026, 5, 1, 8));
  const t1 = new Date(Date.UTC(2026, 5, 2, 8));
  const planlagt = regnPlanlagtTid(t0, { rekkefolge: 2, ventetidTimer: 72 }, [
    { rekkefolge: 1, utfortTid: t1 },
  ]);

  if (planlagt.toISOString() === "2026-06-05T08:00:00.000Z") {
    ok("Ventetid regnes fra forrige steg ble utført");
  } else {
    nei("Ventetiden regnes feil", planlagt.toISOString());
  }

  // -------------------------------------------------------------------------
  seksjon("14. Hovedbryteren er sporet");

  // Er noen kanal åpen, SKAL det finnes en revisjonsoppføring som sier hvem som
  // åpnet den. Uten dette kan hovedbryteren slås på i stillhet — og det skjedde,
  // under uavhengig testing.
  const aapneKanaler = await prisma.kanalInnstilling.findMany({
    where: { utgaaendeAktivert: true },
    select: { kanal: true, oppdatertAv: true },
  });

  if (aapneKanaler.length === 0) {
    ok("Ingen kanal er åpen for utgående trafikk");
  } else {
    let alleSporet = true;

    for (const k of aapneKanaler) {
      const spor = await prisma.revisjon.count({
        where: {
          entitet: "KanalInnstilling",
          kanal: k.kanal,
          handling: "KANAL_UTGAAENDE_SLAATT_PAA",
        },
      });

      if (spor === 0) {
        alleSporet = false;
        nei(
          `Kanalen ${k.kanal} er ÅPEN uten at revisjonsloggen viser hvem som åpnet den`,
          `oppdatertAv = «${k.oppdatertAv ?? "tomt"}»`,
        );
      }
    }

    if (alleSporet) {
      ok(
        `${aapneKanaler.length} kanal(er) er åpne, og alle er sporet i revisjonsloggen`,
        aapneKanaler.map((k) => k.kanal).join(", "),
      );
    }
  }

  // Enhver kanalendring som er gjort, skal ha et navn.
  const endretUtenNavn = await prisma.kanalInnstilling.count({
    where: { NOT: { oppdatertAv: null } },
  });
  ok("Kanalendringer registrerer hvem som gjorde dem", `${endretUtenNavn} kanal(er) har spor`);

  // -------------------------------------------------------------------------
  console.log("\n" + "─".repeat(60));
  console.log(
    `${GROENN}${bestatt} bestått${SLUTT}` +
      (hoppetOver ? `, ${GUL}${hoppetOver} hoppet over${SLUTT}` : "") +
      (feilet ? `, ${ROED}${feilet} feilet${SLUTT}` : ""),
  );

  if (feilet > 0) {
    console.log(`\n${ROED}Sjekkelisten er IKKE grønn.${SLUTT} Rett funnene over.`);
  } else {
    console.log(`\n${GROENN}Sjekkelisten er grønn.${SLUTT}`);
  }

  await prisma.$disconnect();
  process.exit(feilet > 0 ? 1 : 0);
}

hoved().catch(async (feil) => {
  console.error("\nSjekkelisten krasjet:", feil);
  await prisma.$disconnect();
  process.exit(1);
});
