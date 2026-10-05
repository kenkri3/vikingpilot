/**
 * Cron: rydding.
 *
 * Rydder det som trygt kan ryddes, og rører ikke det som er bevis.
 *
 * DETTE RØRES ALDRI:
 *   - Revisjon       uforanderlig. Se docs/beslutninger.md B-007.
 *   - Sperreliste    en sperre er historie. Vi setter aktiv=false, aldri slett.
 *   - Utsending      dokumenterer hva som er forsøkt sendt.
 *   - Godkjenning    dokumenterer hvem som bestemte hva.
 *
 * DETTE RYDDES:
 *   - Utløpte sesjoner. De er ubrukelige når de har løpt ut.
 *   - Gamle RaHendelse som er behandlet. De er bare idempotensnøkler.
 *   - Gamle CronKjoering. Driftshistorikk, ikke forretningshistorikk.
 *
 * Alt har en grense i dager, og grensen kan settes med ?dager=N.
 *
 * Kjør med:
 *   GET /api/cron/rydding                       tørrkjøring
 *   GET /api/cron/rydding?torrkjoering=false    ekte kjøring
 *   GET /api/cron/rydding?dager=90              lengre oppbevaring
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { kjoerCronjobb } from "@/lib/cron/felles";

export const dynamic = "force-dynamic";

const NAVN = "rydding";

/** Standard oppbevaring for driftshistorikk. */
const STANDARD_DAGER = 90;

function dagerFraQuery(url: URL): number {
  const raa = url.searchParams.get("dager");
  if (!raa) return STANDARD_DAGER;

  const n = Number.parseInt(raa, 10);
  if (!Number.isFinite(n) || n < 1) return STANDARD_DAGER;

  // Minst sju dager. Å rydde bort gårsdagens historikk ville gjort feilsøking umulig.
  return Math.max(n, 7);
}

export async function POST(request: Request): Promise<Response> {
  const dager = dagerFraQuery(new URL(request.url));

  return kjoerCronjobb({
    navn: NAVN,
    hemmelighetNavn: "CRON_SECRET_RYDDING",
    request,
    rateGrense: 10,
    jobb: async ({ torrkjoering, naa }) => {
      const grense = new Date(naa.getTime() - dager * 86_400_000);

      // Tell først. Vi vil kunne rapportere hva som ville skjedd, og vi vil
      // aldri slette mer enn vi kan redegjøre for.
      const [utlopteSesjoner, gamleHendelser, gamleKjoeringer] = await Promise.all([
        prisma.sesjon.count({ where: { utloeper: { lt: naa } } }),
        prisma.raHendelse.count({ where: { behandlet: true, opprettet: { lt: grense } } }),
        prisma.cronKjoering.count({ where: { startet: { lt: grense } } }),
      ]);

      const sum = utlopteSesjoner + gamleHendelser + gamleKjoeringer;

      if (sum === 0) {
        return {
          antallUtfort: 0,
          melding: `Ingenting å rydde. Grensen er ${dager} dager.`,
          detaljer: { dager, utlopteSesjoner, gamleHendelser, gamleKjoeringer },
          svar: { dager, utlopteSesjoner, gamleHendelser, gamleKjoeringer },
        };
      }

      if (torrkjoering) {
        return {
          antallUtfort: 0,
          melding: `Tørrkjøring. Ville slettet ${utlopteSesjoner} utløpte sesjoner, ${gamleHendelser} behandlede hendelser og ${gamleKjoeringer} gamle cron-kjøringer. Ingenting er slettet. Revisjon, sperrelister, utsendinger og godkjenninger røres aldri.`,
          detaljer: { dager, utlopteSesjoner, gamleHendelser, gamleKjoeringer },
          svar: { dager, utlopteSesjoner, gamleHendelser, gamleKjoeringer },
        };
      }

      const [slettedeSesjoner, slettedeHendelser, slettedeKjoeringer] = await Promise.all([
        prisma.sesjon.deleteMany({ where: { utloeper: { lt: naa } } }),
        prisma.raHendelse.deleteMany({ where: { behandlet: true, opprettet: { lt: grense } } }),
        prisma.cronKjoering.deleteMany({ where: { startet: { lt: grense } } }),
      ]);

      const antall =
        slettedeSesjoner.count + slettedeHendelser.count + slettedeKjoeringer.count;

      return {
        antallUtfort: antall,
        melding: `Slettet ${slettedeSesjoner.count} utløpte sesjoner, ${slettedeHendelser.count} behandlede hendelser og ${slettedeKjoeringer.count} gamle cron-kjøringer. Revisjon, sperrelister, utsendinger og godkjenninger er urørt.`,
        detaljer: {
          dager,
          sesjoner: slettedeSesjoner.count,
          hendelser: slettedeHendelser.count,
          kjoeringer: slettedeKjoeringer.count,
        },
        svar: {
          dager,
          sesjoner: slettedeSesjoner.count,
          hendelser: slettedeHendelser.count,
          kjoeringer: slettedeKjoeringer.count,
        },
      };
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return POST(request);
}
