/**
 * Bevis for at avsenderspesifikke oppvarmingsplaner virker, og at de globale
 * fortsatt er beskyttet mot duplikater.
 *
 * Dette var F-025: `dagFraStart` var globalt unik, så et avsenderspesifikt trinn
 * kunne ikke opprettes på en dag de globale trinnene alt eide. Koden som
 * foretrekker egne trinn var derfor aldri nåbar, og konfigurasjonen så ut til å
 * finnes uten å kunne brukes.
 *
 * Rydder etter seg.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { sjekkOppvarming, effektivDognkvote } from "../src/lib/guards/oppvarming.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const EPOST = "bevis-oppvarming@bevis.invalid";
const NAA = new Date(Date.UTC(2026, 5, 15, 10, 0, 0));
const START = new Date(Date.UTC(2026, 5, 1, 10, 0, 0));

let feil = 0;

function sjekk(tekst: string, ok: boolean, detalj?: string) {
  if (ok) console.log(`  OK   ${tekst}${detalj ? ` — ${detalj}` : ""}`);
  else {
    feil += 1;
    console.log(`  FEIL ${tekst}${detalj ? ` — ${detalj}` : ""}`);
  }
}

async function rydd() {
  const avsender = await prisma.avsender.findUnique({ where: { epost: EPOST } });
  if (avsender) {
    await prisma.oppvarmingssteg.deleteMany({ where: { avsenderId: avsender.id } });
    await prisma.avsender.delete({ where: { id: avsender.id } });
  }
  await prisma.oppvarmingssteg.deleteMany({ where: { beskrivelse: { startsWith: "ZZ-bevis" } } });
}

async function hoved() {
  console.log("Bevis: oppvarmingsplan per avsender\n");
  await rydd();

  const avsender = await prisma.avsender.create({
    data: {
      epost: EPOST,
      domene: "bevis.invalid",
      status: "OPPVARMING",
      maksPerDag: 100,
      maksPerUke: 500,
      oppvarmingStartDato: START,
    },
  });

  console.log("1. Den globale planen gjelder når avsenderen ikke har egen");
  const globalt = await sjekkOppvarming(avsender.id, NAA);
  sjekk("dag 14 gir en kvote", globalt.kvoteIDag > 0, `kvote = ${globalt.kvoteIDag}`);

  console.log("\n2. Kan et avsenderspesifikt trinn på dag 0 opprettes nå?");
  // Dag 0 eies av den globale planen. Før F-025 feilet dette med
  // «Unique constraint failed on Oppvarmingssteg_dagFraStart_key».
  let opprettet = false;
  try {
    await prisma.oppvarmingssteg.create({
      data: {
        avsenderId: avsender.id,
        dagFraStart: 0,
        maksPerDag: 1,
        beskrivelse: "ZZ-bevis: svært forsiktig start for denne avsenderen",
      },
    });
    opprettet = true;
  } catch (e) {
    sjekk("oppretting feilet", false, (e as Error).message.slice(0, 120));
  }

  sjekk("avsenderspesifikt trinn på dag 0 ble opprettet", opprettet);

  console.log("\n3. Overstyrer det avsenderspesifikke trinnet det globale?");
  const medEget = await sjekkOppvarming(avsender.id, NAA);
  sjekk(
    "kvoten kommer nå fra avsenderens egen plan",
    medEget.kvoteIDag === 1,
    `kvote = ${medEget.kvoteIDag} (globalt var ${globalt.kvoteIDag})`,
  );

  console.log("\n4. En annen avsender er upåvirket");
  const annen = await prisma.avsender.create({
    data: {
      epost: `annen-${EPOST}`,
      domene: "bevis.invalid",
      status: "OPPVARMING",
      maksPerDag: 100,
      oppvarmingStartDato: START,
    },
  });

  const annenSvar = await sjekkOppvarming(annen.id, NAA);
  sjekk(
    "den andre avsenderen følger fortsatt den globale planen",
    annenSvar.kvoteIDag === globalt.kvoteIDag,
    `kvote = ${annenSvar.kvoteIDag}`,
  );

  console.log("\n5. Beskyttelsen mot duplikater i den globale planen består");
  // PostgreSQL behandler NULL som forskjellig fra NULL, så kompositt-indeksen
  // alene ville sluppet dette gjennom. Det er derfor den partielle indeksen finnes.
  let duplikatAvvist = false;
  try {
    await prisma.oppvarmingssteg.create({
      data: { avsenderId: null, dagFraStart: 0, maksPerDag: 999, beskrivelse: "ZZ-bevis duplikat" },
    });
  } catch {
    duplikatAvvist = true;
  }

  sjekk("et duplikat globalt trinn ble avvist", duplikatAvvist);

  console.log("\n6. Samme avsender kan heller ikke ha to trinn på samme dag");
  let egetDuplikatAvvist = false;
  try {
    await prisma.oppvarmingssteg.create({
      data: { avsenderId: avsender.id, dagFraStart: 0, maksPerDag: 5, beskrivelse: "ZZ-bevis duplikat" },
    });
  } catch {
    egetDuplikatAvvist = true;
  }

  sjekk("et duplikat for samme avsender ble avvist", egetDuplikatAvvist);

  console.log("\n7. Effektiv kvote tar den laveste av de to");
  const egneSteg = await prisma.oppvarmingssteg.findMany({
    where: { avsenderId: avsender.id },
    select: { dagFraStart: true, maksPerDag: true },
  });
  console.log(`     avsenderens egne trinn: ${JSON.stringify(egneSteg)}`);

  const oppvarmingNaa = await sjekkOppvarming(avsender.id, NAA);
  console.log(
    `     sjekkOppvarming: kvoteIDag=${oppvarmingNaa.kvoteIDag} ferdigOppvarmet=${oppvarmingNaa.ferdigOppvarmet} dag=${oppvarmingNaa.dag}`,
  );

  const effektiv = await effektivDognkvote(avsender.id, NAA);
  sjekk(
    "effektiv kvote er oppvarmingens, ikke døgnkvoten",
    effektiv.kvote === oppvarmingNaa.kvoteIDag,
    `effektiv = ${effektiv.kvote}, oppvarming = ${oppvarmingNaa.kvoteIDag}`,
  );

  console.log("\n8. Rydder opp");
  await prisma.oppvarmingssteg.deleteMany({ where: { avsenderId: { in: [avsender.id, annen.id] } } });
  await prisma.avsender.deleteMany({ where: { epost: { endsWith: "bevis.invalid" } } });
  const igjen = await prisma.oppvarmingssteg.count({ where: { avsenderId: { not: null } } });
  sjekk("ingen avsenderspesifikke trinn står igjen", igjen === 0, `igjen = ${igjen}`);

  console.log("");
  console.log(feil === 0 ? "Alt besto." : `${feil} sjekk(er) feilet.`);

  await prisma.$disconnect();
  process.exit(feil > 0 ? 1 : 0);
}

hoved().catch(async (e) => {
  console.error("Krasjet:", e);
  await rydd().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
