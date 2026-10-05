/**
 * Setter opp grunndata i databasen. Trygt å kjøre flere ganger.
 *
 * Kalles av scripts/start-prod.mjs ved oppstart, og kan kjøres manuelt:
 *   node scripts/oppsett.mjs
 *
 * HVORFOR DETTE KJØRES VED OPPSTART:
 * På Railway kjøres `prisma migrate deploy`, men ikke seeding — `prisma db seed`
 * krever tsx, som er en utvikleravhengighet og ikke finnes i produksjonsbildet.
 * Første oppstart ga derfor et tomt system: null kanaler, null cron-jobber, null
 * målgruppe. Dashbordet sa «kjør npm run db:seed», og det går ikke på Railway.
 *
 * Brukere opprettes IKKE her. Et passord skal velges av et menneske, ikke
 * genereres i en oppstartsjobb og havne i en logg. Bruk `npm run bruker:lag`.
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";

import { åpneKlient, settOppGrunndata } from "./grunndata.mjs";

export async function kjørOppsett() {
  const prisma = await åpneKlient();

  try {
    return await settOppGrunndata(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// Kjørt direkte fra kommandolinjen, i stedet for importert?
const denneFilen = fileURLToPath(import.meta.url);
const kjørtDirekte = process.argv[1] && fileURLToPath(`file://${process.argv[1].replace(/\\/g, "/")}`) === denneFilen;

if (kjørtDirekte || process.argv[1]?.endsWith("oppsett.mjs")) {
  kjørOppsett()
    .then((gjort) => {
      console.log("Grunndata er satt opp:");
      for (const g of gjort) console.log(`  - ${g}`);
      console.log("\nIngen bruker er opprettet. Kjør `npm run bruker:lag` for å lage en.");
    })
    .catch((feil) => {
      console.error("Oppsett feilet:", feil instanceof Error ? feil.message : feil);
      process.exit(1);
    });
}
