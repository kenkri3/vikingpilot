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
import { nullstillUtlopteTellere } from "@/lib/guards/volum";
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
        select: { id: true, epost: true, status: true },
      });

      // Hvor mange tellere ville løpt ut? Vi regner det ut uten å skrive.
      const status = [];
      for (const a of avsendere) {
        const oppvarming = await sjekkOppvarming(a.id, naa);
        status.push({
          epost: a.epost,
          status: a.status,
          dag: oppvarming.dag,
          kvoteIDag: oppvarming.kvoteIDag,
          tillatt: oppvarming.tillatt,
          grunn: oppvarming.grunn,
        });
      }

      if (torrkjoering) {
        return {
          antallUtfort: 0,
          melding:
            avsendere.length === 0
              ? "Tørrkjøring. Ingen avsendere er satt opp, så det er ingenting å nullstille."
              : `Tørrkjøring. Ville gjennomgått ${avsendere.length} avsendere og nullstilt utløpte tellere. Ingenting er skrevet.`,
          detaljer: { avsendere: status.length, status },
          svar: { avsendere: status },
        };
      }

      const nullstilt = await nullstillUtlopteTellere(naa);

      return {
        antallUtfort: nullstilt,
        melding:
          avsendere.length === 0
            ? "Ingen avsendere er satt opp. Legg inn avsendere før noe skal sendes."
            : `Nullstilte ${nullstilt} av ${avsendere.length} avsendere.`,
        detaljer: { avsendere: avsendere.length, nullstilt, status },
        svar: { avsendere: status, nullstilt },
      };
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return POST(request);
}
