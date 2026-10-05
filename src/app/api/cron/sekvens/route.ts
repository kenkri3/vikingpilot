/**
 * Cron: sekvensmotoren.
 *
 * Starter sekvenser for prospekter som er klare for det, og kjører neste steg
 * for alle aktive. Legger utkast i godkjenningskøen.
 *
 * DENNE JOBBEN SENDER INGENTING. Den fyller køen. Ingenting går ut før et
 * menneske har godkjent det, og en egen jobb sender det.
 *
 * Skjelettet — rate limiting, hemmelighet, global sikring mot gjetting,
 * tørrkjøring og logging — ligger i `kjoerCronjobb`.
 *
 * Kjør med:
 *   GET /api/cron/sekvens                       tørrkjøring
 *   GET /api/cron/sekvens?torrkjoering=false    ekte kjøring
 */

import { NextResponse } from "next/server";

import { kjoerCronjobb } from "@/lib/cron/felles";
import { kjoerAlle, startSekvenser } from "@/lib/sekvens/motor";
import { koStatus } from "@/lib/godkjenning/ko";
import { skrivRevisjon } from "@/lib/revisjon";

export const dynamic = "force-dynamic";

const NAVN = "sekvens";
const HEMMELIGHET = "CRON_SECRET_SEKVENS";

export async function POST(request: Request): Promise<Response> {
  return handter(request);
}

export async function GET(request: Request): Promise<Response> {
  return handter(request);
}

async function handter(request: Request): Promise<Response> {
  return kjoerCronjobb({
    navn: NAVN,
    hemmelighetNavn: HEMMELIGHET,
    request,
    jobb: async ({ torrkjoering, naa }) => {
      // Først: start sekvenser for prospekter som er klare for det.
      const oppstart = await startSekvenser({ torrkjoering, naa });

      // Deretter: kjør neste steg for alle aktive sekvenser.
      const resultat = await kjoerAlle({ torrkjoering, naa });
      const ko = await koStatus();

      const melding = torrkjoering
        ? `Tørrkjøring. Ville startet ${oppstart.vurdert} nye sekvenser, og vurdert ${resultat.vurdert} aktive. Ville laget ${resultat.utkast} utkast. Ingenting er skrevet.`
        : `Startet ${oppstart.startet} nye sekvenser. Vurderte ${resultat.vurdert} aktive, laget ${resultat.utkast} utkast i køen, ${resultat.venter} venter på tur.`;

      await skrivRevisjon({
        handling: "SEKVENS_KJORT",
        aktor: "SYSTEMET",
        aktorType: "SYSTEMET",
        entitet: "CronJobb",
        grunnlag: `Cron-jobb ${NAVN}, ${torrkjoering ? "tørrkjøring" : "ekte kjøring"}.`,
        resultat: melding,
        resultatStatus: torrkjoering ? "torrkjoert" : "ok",
        kilde: `api/cron/${NAVN}`,
        metadata: {
          oppstart: oppstart.startet,
          vurdert: resultat.vurdert,
          utkast: resultat.utkast,
          venter: resultat.venter,
        },
      });

      return {
        antallUtfort: torrkjoering ? 0 : resultat.utkast,
        melding,
        detaljer: {
          oppstart,
          vurdert: resultat.vurdert,
          utkast: resultat.utkast,
          venter: resultat.venter,
          andre: resultat.andre,
          ko,
        },
        svar: {
          oppstart,
          vurdert: resultat.vurdert,
          utkast: resultat.utkast,
          venter: resultat.venter,
          andre: resultat.andre,
          ko,
          resultater: resultat.resultater.slice(0, 20),
        },
      };
    },
  });
}
