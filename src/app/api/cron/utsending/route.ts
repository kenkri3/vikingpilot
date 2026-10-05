/**
 * Cron: utsending.
 *
 * DENNE JOBBEN SENDER. Den er den eneste i systemet som kan føre noe ut til en
 * mottaker. Alt den gjør går gjennom `sendMelding`, som har fem sjekker:
 * avsender, kanal, sperreliste, tidsvindu, oppvarming og volum.
 *
 * Tørrkjøring er standard. `?torrkjoering=false` kreves for ekte sending, og det
 * er vanskelig å gjøre ved et uhell.
 *
 * Skjelettet — rate limiting, hemmelighet, global sikring mot gjetting og
 * logging — ligger i `kjoerCronjobb`. Den globale sikringen er ekstra viktig
 * nettopp her: før denne filen ble flyttet dit, var denne ruten det ene stedet
 * i systemet som kunne sendt e-post, og den hadde ikke den beskyttelsen.
 *
 * Kjør med:
 *   GET /api/cron/utsending                       tørrkjøring
 *   GET /api/cron/utsending?torrkjoering=false    ekte kjøring
 */

import { NextResponse } from "next/server";

import { kjoerCronjobb } from "@/lib/cron/felles";
import { kjoerUtsending } from "@/lib/sekvens/utsending";
import { skrivRevisjon } from "@/lib/revisjon";

export const dynamic = "force-dynamic";

const NAVN = "utsending";
const HEMMELIGHET = "CRON_SECRET_UTSENDING";

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
      const resultat = await kjoerUtsending({ torrkjoering, naa });

      const melding =
        resultat.vurdert === 0
          ? "Ingen godkjente meldinger venter på sending."
          : resultat.avsenderId === null
            ? `Vurderte ${resultat.vurdert} godkjente meldinger, men ingen avsender er satt opp. Uten avsender kan ikke kvotene håndheves, og da sendes ingenting.`
            : torrkjoering
              ? `Tørrkjøring. Vurderte ${resultat.vurdert} godkjente meldinger, ville sendt ${resultat.sendt}. Ingenting er sendt.`
              : `Vurderte ${resultat.vurdert}. Sendt ${resultat.sendt}, avvist ${resultat.avvist}, ikke konfigurert ${resultat.ikkeKonfigurert}, feilet ${resultat.feilet}.`;

      await skrivRevisjon({
        handling: "UTSENDING_KJORT",
        aktor: "SYSTEMET",
        aktorType: "SYSTEMET",
        entitet: "CronKjoering",
        kanal: "EPOST",
        grunnlag: `Cron-jobb ${NAVN}, ${torrkjoering ? "tørrkjøring" : "ekte kjøring"}.`,
        resultat: melding,
        resultatStatus: torrkjoering ? "torrkjoert" : "ok",
        kilde: `api/cron/${NAVN}`,
        metadata: {
          vurdert: resultat.vurdert,
          sendt: resultat.sendt,
          avvist: resultat.avvist,
          ikkeKonfigurert: resultat.ikkeKonfigurert,
        },
      });

      return {
        // I tørrkjøring er ingenting sendt, uansett hva motoren sier. Vi teller
        // derfor null utførte, så driftshistorikken ikke påstår noe annet.
        antallUtfort: torrkjoering ? 0 : resultat.sendt,
        antallFeil: resultat.feilet,
        melding,
        detaljer: {
          vurdert: resultat.vurdert,
          sendt: resultat.sendt,
          avvist: resultat.avvist,
          ikkeKonfigurert: resultat.ikkeKonfigurert,
          feilet: resultat.feilet,
          avsenderId: resultat.avsenderId,
        },
        svar: {
          vurdert: resultat.vurdert,
          avsenderId: resultat.avsenderId,
          sendt: resultat.sendt,
          avvist: resultat.avvist,
          ikkeKonfigurert: resultat.ikkeKonfigurert,
          feilet: resultat.feilet,
          resultater: resultat.resultater.slice(0, 20),
        },
      };
    },
  });
}
