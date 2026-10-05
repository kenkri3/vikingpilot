/**
 * Diagnose av en kjørende VikingPilot-database.
 *
 * HVORFOR DENNE FINNES:
 * «Feil e-post eller passord» er med vilje upresist — det skal ikke være mulig å
 * bruke innloggingsskjemaet til å finne ut hvilke adresser som finnes. Men det
 * gjør også feilen vond å feilsøke. Denne kommandoen svarer på det skjemaet ikke
 * kan svare på, uten å røre noe.
 *
 * DEN SKRIVER INGENTING. Bare SELECT.
 * DEN VISER ALDRI PASSORDHASER. Bare om de ser riktige ut.
 *
 * BRUK — mot Railway sin database:
 *   $env:DATABASE_URL = "postgresql://…"      # fra Railway, Postgres-tjenesten
 *   npm run diagnose
 *
 * Kjør den lokalt mot din egen base ved å utelate linjen over.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

/** Skjuler vertsnavnet, så utskriften kan limes inn uten å røpe noe. */
function masker(raa: string): string {
  try {
    const u = new URL(raa);
    const vert = u.hostname.replace(/^[^.]+/, "***");
    return `${u.protocol}//…@${vert}:${u.port || "5432"}/${u.pathname.slice(1)}`;
  } catch {
    return "(kunne ikke tolkes)";
  }
}

function melding(feil: unknown): string {
  if (feil instanceof Error) return feil.message.split("\n")[0] ?? feil.message;
  return String(feil);
}

async function hoved(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error("DATABASE_URL mangler.");
    console.error("Hent den fra Railway: Postgres-tjenesten → Variables → DATABASE_URL.");
    console.error("Merk: bruk den OFFENTLIGE adressen når du kjører herfra, ikke den interne.");
    process.exit(2);
  }

  const { PrismaClient } = await import("../src/generated/prisma/client.ts");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log("VikingPilot — diagnose");
  console.log(`Database: ${masker(url)}`);
  console.log("Leser bare. Skriver ingenting.\n");

  try {
    // 1. Svarer databasen?
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log("✓ Databasen svarer");
    } catch (e) {
      console.log(`✗ Databasen svarer ikke: ${melding(e)}`);
      console.log("\nSjekk at du bruker den OFFENTLIGE adressen. Railway sine interne");
      console.log("adresser (postgres.railway.internal) virker bare inne i Railway.");
      return;
    }

    // 2. Er skjemaet satt opp?
    const tabeller = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const antallTabeller = tabeller[0]?.n ?? 0;

    if (antallTabeller === 0) {
      console.log("✗ Databasen er tom — migreringene har ikke kjørt");
      return;
    }

    console.log(
      antallTabeller >= 30
        ? `✓ Skjemaet er satt opp (${antallTabeller} tabeller)`
        : `✗ Skjemaet ser ufullstendig ut (${antallTabeller} tabeller, forventet 30+)`,
    );

    const migreringer = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    console.log(`✓ Migreringer anvendt: ${migreringer[0]?.n ?? 0}`);

    // 3. Grunndata.
    const [kanaler, cronjobber, maalgrupper] = await Promise.all([
      prisma.kanalInnstilling.count(),
      prisma.cronJobb.count(),
      prisma.maalgruppe.count(),
    ]);

    console.log(
      kanaler > 0 ? `✓ Kanaler: ${kanaler}` : "✗ Ingen kanaler — grunndata kjørte ikke",
    );
    console.log(`  Cron-jobber: ${cronjobber}, målgrupper: ${maalgrupper}`);

    // 4. Brukere. Dette er det egentlige spørsmålet.
    const brukere = await prisma.bruker.findMany({
      select: { epost: true, navn: true, aktiv: true, rolle: true, passordHash: true },
      orderBy: { opprettet: "asc" },
    });

    console.log(`\nBrukere i basen: ${brukere.length}`);

    for (const b of brukere) {
      const formatOk = b.passordHash?.startsWith("scrypt$") ?? false;
      const lengde = b.passordHash?.length ?? 0;
      console.log(
        `  ${b.epost}  (${b.navn})  aktiv=${b.aktiv}  rolle=${b.rolle}  ` +
          `hash=${formatOk ? `scrypt, ${lengde} tegn` : "UGYLDIG FORMAT"}`,
      );
    }

    // 5. Sammenlign med miljøvariabelen, hvis den er satt her.
    const adminEpost = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

    if (adminEpost) {
      const finnes = brukere.some((b) => b.epost.toLowerCase() === adminEpost);
      console.log(
        finnes
          ? `\n✓ ADMIN_EMAIL (${adminEpost}) finnes i basen`
          : `\n✗ ADMIN_EMAIL (${adminEpost}) finnes IKKE i basen`,
      );
    } else {
      console.log("\n(ADMIN_EMAIL er ikke satt her, så jeg kan ikke sammenligne.)");
    }

    // 6. Har noe gått ut?
    const [aapne, sendt] = await Promise.all([
      prisma.kanalInnstilling.count({ where: { utgaaendeAktivert: true } }),
      prisma.utsending.count({ where: { status: "SENDT" } }),
    ]);

    console.log(`\nKanaler åpne: ${aapne}   Utsendinger sendt: ${sendt}`);

    if (aapne === 0 && sendt === 0) {
      console.log("✓ All utgående trafikk er av, og ingenting er sendt");
    }
  } finally {
    await prisma.$disconnect();
  }
}

hoved().catch((e) => {
  console.error("\nDiagnosen feilet:", melding(e));
  process.exit(1);
});
