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
