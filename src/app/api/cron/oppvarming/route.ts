/**
 * Cron: oppvarming og tellere.
 *
 * To oppgaver:
 *
 *   1. Nullstille døgn- og uketellere som har løpt ut. Sjekkingen i seg selv
 *      regner utløpte tellere som null, så dette er for at tallene i basen skal
 *      være forståelige for et menneske som leser dem.
 *   2. Rapportere hvor hver avsender står i oppvarmingsplanen, slik at dashbordet
 *      kan vise det uten å regne selv.
 *
 * Denne jobben sender ingenting og endrer ingen kvoter. Oppvarmingsplanen er
 * data som Kenneth og Fredrik styrer.
 *
 * Kjør med:
 *   GET /api/cron/oppvarming                       tørrkjøring
 *   GET /api/cron/oppvarming?torrkjoering=false    ekte kjøring
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { kjoerCronjobb } from "@/lib/cron/felles";
import { sjekkVolum } from "@/lib/guards/volum";
import { sjekkOppvarming } from "@/lib/guards/oppvarming";

export const dynamic = "force-dynamic";

const NAVN = "oppvarming";

export async function POST(request: Request): Promise<Response> {
  return kjoerCronjobb({
    navn: NAVN,
    hemmelighetNavn: "CRON_SECRET_OPPVARMING",
    request,
    jobb: async ({ torrkjoering, naa }) => {
      const avsendere = await prisma.avsender.findMany({
        orderBy: { epost: "asc" },
        select: { id: true, epost: true, status: true, maksPerDag: true },
      });

      // Vi regner ut hvor hver avsender staar. Tellingen er avledet fra
      // Utsending-tabellen, saa det finnes ingen teller aa nullstille — den
      // kunne gaa ut av synk, og det gjorde den.
      const status = [];
      for (const a of avsendere) {
        const oppvarming = await sjekkOppvarming(a.id, naa);
        const volum = await sjekkVolum(a.id, naa);

        status.push({
          epost: a.epost,
          avsenderStatus: a.status,
          dag: oppvarming.dag,
          kvoteIDag: oppvarming.kvoteIDag,
          sendtIDag: volum.sendtIDag,
          sendtDenneUken: volum.sendtDenneUken,
          tillatt: oppvarming.tillatt && volum.tillatt,
          grunn: oppvarming.tillatt ? volum.grunn : oppvarming.grunn,
        });
      }

      if (avsendere.length === 0) {
        return {
          antallUtfort: 0,
          melding:
            "Ingen avsendere er satt opp. Legg inn avsendere før noe skal sendes. " +
            "Uten avsender nekter utsendingsvakten all sending.",
          detaljer: { avsendere: 0 },
          svar: { avsendere: [] },
        };
      }

      const klare = status.filter((s) => s.tillatt).length;

      const melding = torrkjoering
        ? `Tørrkjøring. Gjennomgikk ${avsendere.length} avsendere. ${klare} har ledig kvote. Ingenting er endret.`
        : `Gjennomgikk ${avsendere.length} avsendere. ${klare} har ledig kvote. Tellingen er avledet fra sendte meldinger, så det finnes ingen teller å nullstille.`;

      return {
        antallUtfort: 0,
        melding,
        detaljer: { avsendere: avsendere.length, klare, status },
        svar: { avsendere: status, klare },
      };
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return POST(request);
}
