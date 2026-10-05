/**
 * Ende-til-ende-verifisering av fase 4.
 *
 * Denne kjører den faktiske kjeden og skriver ut hva som skjer i hvert ledd:
 *
 *   prospekt -> sekvens startet -> utkast laget -> i koen -> godkjent -> ikke sendt
 *
 * Poenget er aa bevise to ting:
 *   1. Kjeden virker ende-til-ende.
 *   2. Ingenting naar en mottaker, selv etter godkjenning, saa lenge kanalen
 *      ikke er konfigurert.
 *
 * Rydder opp etter seg.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { startSekvenser, kjoerAlle } from "../src/lib/sekvens/motor.ts";
import { godkjenn, koStatus } from "../src/lib/godkjenning/ko.ts";
import { kjoerUtsending } from "../src/lib/sekvens/utsending.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ORGNR = "999123456";
const EPOST = "e2e-test@e2e.invalid";

let feil = 0;

function sjekk(tekst: string, ok: boolean, detalj?: string) {
  if (ok) {
    console.log(`  OK   ${tekst}${detalj ? ` — ${detalj}` : ""}`);
  } else {
    feil += 1;
    console.log(`  FEIL ${tekst}${detalj ? ` — ${detalj}` : ""}`);
  }
}

async function rydd() {
  const org = await prisma.organisasjon.findUnique({ where: { orgnr: ORGNR } });
  if (org) {
    await prisma.prospektSekvens.deleteMany({
      where: { prospekt: { organisasjonId: org.id } },
    });
    await prisma.prospekt.deleteMany({ where: { organisasjonId: org.id } });
    await prisma.organisasjon.delete({ where: { id: org.id } });
  }
  await prisma.kontakt.deleteMany({ where: { epost: EPOST } });
  await prisma.godkjenning.deleteMany({ where: { tittel: { contains: "E2E" } } });
}

async function hoved() {
  console.log("Ende-til-ende: fase 4\n");
  await rydd();

  // --- Sett opp ---
  const org = await prisma.organisasjon.create({
    data: {
      orgnr: ORGNR,
      navn: "E2E Testbedrift AS",
      normalisertNavn: "e2e testbedrift as",
      sektor: "PRIVAT",
      naeringskode: "62.010",
      antallAnsatte: 20,
      fylke: "Oslo",
      stiftetDato: new Date(Date.UTC(2020, 0, 1)),
    },
  });

  const kontakt = await prisma.kontakt.create({
    data: {
      organisasjonId: org.id,
      fornavn: "E2E",
      etternavn: "Test",
      epost: EPOST,
    },
  });

  const prospekt = await prisma.prospekt.create({
    data: { organisasjonId: org.id, kontaktId: kontakt.id, status: "KVALIFISERT" },
  });

  console.log("1. Start sekvenser");
  const oppstart = await startSekvenser({ torrkjoering: false });
  sjekk("minst én sekvens startet", oppstart.startet >= 1, `startet=${oppstart.startet} utenKontakt=${oppstart.utenKontakt}`);

  const etter = await prisma.prospekt.findUnique({ where: { id: prospekt.id } });
  sjekk("prospektet fikk status I_SEKVENS", etter?.status === "I_SEKVENS", `status=${etter?.status}`);

  console.log("\n2. Kjør sekvensmotoren");
  const koFor = await koStatus();
  const kjoert = await kjoerAlle({ torrkjoering: false });
  sjekk("minst ett utkast laget", kjoert.utkast >= 1, `utkast=${kjoert.utkast} vurdert=${kjoert.vurdert}`);

  const koEtter = await koStatus();
  sjekk("køen vokste", koEtter.venter > koFor.venter, `${koFor.venter} -> ${koEtter.venter}`);

  console.log("\n3. Ingenting er sendt");
  const sendte = await prisma.utsending.count({ where: { status: "SENDT" } });
  sjekk("null utsendinger sendt", sendte === 0, `sendt=${sendte}`);

  const melding = await prisma.dialogMelding.findFirst({
    where: { dialog: { kontaktId: kontakt.id } },
    orderBy: { opprettet: "desc" },
  });
  sjekk(
    "meldingen venter på godkjenning",
    melding?.status === "VENTER_GODKJENNING",
    `status=${melding?.status}`,
  );

  console.log("\n4. Utsendingsjobben nekter før godkjenning");
  const forGodkjenning = await kjoerUtsending({ torrkjoering: false });
  sjekk(
    "ingenting sendt før godkjenning",
    forGodkjenning.sendt === 0,
    `vurdert=${forGodkjenning.vurdert} sendt=${forGodkjenning.sendt}`,
  );

  console.log("\n5. Godkjenn som menneske");
  const ventende = await prisma.godkjenning.findFirst({
    where: { status: "VENTER", dialogMeldingId: melding?.id },
  });
  sjekk("fant godkjenningen", ventende !== null, ventende?.tittel ?? "ingen");

  if (ventende) {
    const svar = await godkjenn({
      godkjenningId: ventende.id,
      brukerEpost: "kenneth@vikingnet.no",
      kommentar: "E2E-test",
    });
    sjekk("godkjenningen gikk gjennom", svar.ok, svar.ok ? "ok" : svar.grunn);

    const igjen = await godkjenn({
      godkjenningId: ventende.id,
      brukerEpost: "fredrik@vikingnet.no",
    });
    sjekk("kan ikke godkjennes to ganger", !igjen.ok, igjen.ok ? "ble godkjent igjen" : "avvist");
  }

  console.log("\n6. Utsendingsjobben etter godkjenning — fortsatt ingen sending");
  const etterGodkjenning = await kjoerUtsending({ torrkjoering: false });
  sjekk(
    "vurderte den godkjente meldingen",
    etterGodkjenning.vurdert >= 1,
    `vurdert=${etterGodkjenning.vurdert}`,
  );
  sjekk(
    "ingenting sendt — kanalen er ikke konfigurert",
    etterGodkjenning.sendt === 0,
    `sendt=${etterGodkjenning.sendt} ikkeKonfigurert=${etterGodkjenning.ikkeKonfigurert}`,
  );

  const fortsattSendte = await prisma.utsending.count({ where: { status: "SENDT" } });
  sjekk("null utsendinger i basen", fortsattSendte === 0, `sendt=${fortsattSendte}`);

  if (etterGodkjenning.resultater[0]) {
    console.log(`       grunn: ${etterGodkjenning.resultater[0].grunn}`);
  }

  console.log("\n7. Rydder opp");
  await rydd();
  sjekk("testdata fjernet", true);

  console.log("");
  if (feil === 0) {
    console.log("Alt besto.");
  } else {
    console.log(`${feil} sjekk(er) feilet.`);
  }

  await prisma.$disconnect();
  process.exit(feil > 0 ? 1 : 0);
}

hoved().catch(async (e) => {
  console.error("Krasjet:", e);
  await rydd().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
