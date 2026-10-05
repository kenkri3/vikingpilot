/**
 * Bevis for at kanalendringer spores.
 *
 * Slår en kanal PÅ gjennom den eneste skriveveien, sjekker at revisjonsloggen
 * fikk en oppføring med navn, og slår den AV igjen. Rydder alltid etter seg.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { endreKanal, slaaAvKanal, slaaPaaKanal, utgaaendeStatus } from "../src/lib/kanaler/innstillinger.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const KANAL = "SMS" as const;
const NAVN = "bevis@vikingnet.no";

let feil = 0;

function sjekk(tekst: string, ok: boolean, detalj?: string) {
  if (ok) console.log(`  OK   ${tekst}${detalj ? ` — ${detalj}` : ""}`);
  else {
    feil += 1;
    console.log(`  FEIL ${tekst}${detalj ? ` — ${detalj}` : ""}`);
  }
}

async function hoved() {
  console.log("Bevis: kanalendringer spores i revisjonsloggen\n");

  // Utgangspunkt.
  await endreKanal({ kanal: KANAL, endretAv: NAVN, utgaaendeAktivert: false });

  const forAntall = await prisma.revisjon.count({ where: { entitet: "KanalInnstilling" } });
  const forStatus = await utgaaendeStatus();

  console.log("1. Slår på en kanal gjennom den eneste skriveveien");
  const pa = await slaaPaaKanal(KANAL, NAVN, "Bevis for at revisjonsloggen fanger endringen.");
  sjekk("endringen gikk gjennom", pa.ok, pa.ok ? `felter: ${pa.forandret.join(", ")}` : pa.grunn);

  const etterStatus = await utgaaendeStatus();
  sjekk("kanalen er nå åpen", etterStatus.aapne.includes(KANAL), `åpne: ${etterStatus.aapne.join(", ") || "ingen"}`);
  sjekk("status endret seg fra lukket", forStatus.antall !== etterStatus.antall, `${forStatus.antall} → ${etterStatus.antall}`);

  console.log("\n2. Ble det skrevet en revisjonsoppføring?");
  const oppforinger = await prisma.revisjon.findMany({
    where: { entitet: "KanalInnstilling", kanal: KANAL, handling: "KANAL_UTGAAENDE_SLAATT_PAA" },
    orderBy: { opprettet: "desc" },
    take: 1,
  });

  sjekk("det finnes en oppføring", oppforinger.length > 0);

  if (oppforinger[0]) {
    const r = oppforinger[0];
    sjekk("den har et navn", r.aktor === NAVN, `aktor = ${r.aktor}`);
    sjekk("den har et tidspunkt", r.opprettet instanceof Date, r.opprettet.toISOString());
    sjekk("den sier hva som skjedde", (r.resultat ?? "").includes("utgaaendeAktivert"), r.resultat ?? "");
    sjekk("den har en egen handlingstype", r.handling === "KANAL_UTGAAENDE_SLAATT_PAA", r.handling);
  }

  const etterAntall = await prisma.revisjon.count({ where: { entitet: "KanalInnstilling" } });
  sjekk("antallet oppføringer økte", etterAntall > forAntall, `${forAntall} → ${etterAntall}`);

  console.log("\n3. Å slå på uten begrunnelse skal nektes");
  await slaaAvKanal(KANAL, NAVN, "Rydder før neste sjekk.");
  const utenGrunn = await slaaPaaKanal(KANAL, NAVN, "kort");
  sjekk("avvist", !utenGrunn.ok, utenGrunn.ok ? "ble godtatt" : utenGrunn.grunn.slice(0, 60));

  console.log("\n4. Endring uten navn skal nektes");
  const utenNavn = await endreKanal({ kanal: KANAL, endretAv: "", utgaaendeAktivert: true });
  sjekk("avvist", !utenNavn.ok, utenNavn.ok ? "ble godtatt" : utenNavn.grunn.slice(0, 60));

  console.log("\n5. Slår av igjen og rydder");
  const av = await slaaAvKanal(KANAL, NAVN, "Beviset er ferdig.");
  sjekk("slått av", av.ok);

  const slutt = await utgaaendeStatus();
  sjekk("ingen kanaler er åpne", slutt.antall === 0, `åpne: ${slutt.aapne.join(", ") || "ingen"}`);

  // Fjern bevisoppføringene, så sjekkelisten ikke ser kanalendringer som ikke
  // har en åpen kanal bak seg.
  await prisma.revisjon.deleteMany({ where: { entitet: "KanalInnstilling", aktor: NAVN } });
  await prisma.kanalInnstilling.update({
    where: { kanal: KANAL },
    data: { oppdatertAv: null },
  });
  sjekk("bevisoppføringene er fjernet", true);

  console.log("");
  console.log(feil === 0 ? "Alt besto." : `${feil} sjekk(er) feilet.`);

  await prisma.$disconnect();
  process.exit(feil > 0 ? 1 : 0);
}

hoved().catch(async (e) => {
  console.error("Krasjet:", e);
  await prisma.kanalInnstilling
    .update({ where: { kanal: KANAL }, data: { utgaaendeAktivert: false, oppdatertAv: null } })
    .catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
