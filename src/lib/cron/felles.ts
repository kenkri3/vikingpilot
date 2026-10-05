/**
 * Felles hjelpere for alle cron-ruter.
 *
 * Hver jobb har sin egen hemmelighet. Mister vi én, slutter bare den ene jobben
 * å virke — ikke hele tidsplanen.
 *
 * Den konstant-tids sammenligningen ligger i auth/hemmelighet.ts, så cron og
 * API-ruter bruker nøyaktig samme kode.
 *
 * `kjoerCronjobb` samler hele skjelettet: rate limiting, hemmelighet,
 * tørrkjøring, logging i CronKjoering, og oppdatering av CronJobb-status.
 * Uten den ville hver rute gjentatt den samme feilhåndteringen — og én av dem
 * ville til slutt glemt å logge feilen.
 */

import { NextResponse } from "next/server";

import { boolsk } from "@/lib/config";
import { prisma } from "@/lib/db";
import { feilmelding, logg } from "@/lib/logg";
import { forMangeForesporsler, klientNokkel, sjekkRateLimit } from "@/lib/ratelimit";
import { sjekkHemmelighetNavn, type HemmelighetResultat } from "@/lib/auth/hemmelighet";

export type HemmelighetSvar = HemmelighetResultat;

/**
 * Sjekker hemmeligheten for en cron-jobb.
 *
 * @param navnMiljoevariabel F.eks. «CRON_SECRET_ENHETSREGISTER». Vi leser
 *                          verdien fra miljøet — den ligger aldri i koden.
 */
export function sjekkHemmelighet(request: Request, navnMiljoevariabel: string): HemmelighetSvar {
  return sjekkHemmelighetNavn(request, navnMiljoevariabel, "Jobben");
}

/**
 * Skal jobben tørrkjøre?
 *
 * Tørrkjøring er standard. For å faktisk utføre noe må man eksplisitt be om det
 * med `?torrkjoering=false` — det er vanskelig å gjøre ved et uhell.
 */
export function vilTorrkjoere(request: Request, standard = true): boolean {
  const url = new URL(request.url);
  const raa = url.searchParams.get("torrkjoering");

  if (raa === null) {
    return standard && boolsk("STANDARD_TORRKJORING", true);
  }

  return raa.toLowerCase() !== "false";
}

export type CronUtfall = {
  /** Antall rader jobben faktisk utførte noe på. */
  antallUtfort?: number;
  antallFeil?: number;
  /** Én linje som forklarer hva som skjedde. Vises i dashbordet. */
  melding: string;
  /** Strukturert tilleggsinformasjon. Vises ikke i dashbordet. */
  detaljer?: Record<string, unknown>;
  /** Svar til den som kalte ruten. */
  svar?: Record<string, unknown>;
  /** HTTP-status. Standard 200. */
  status?: number;
};

/**
 * Kjører skjelettet rundt en cron-jobb.
 *
 * Håndterer i denne rekkefølgen:
 *   1. Rate limiting
 *   2. Hemmelighet
 *   3. Opprette CronKjoering
 *   4. Kalle jobben
 *   5. Logge resultatet, eller feilen — en jobb som feiler skal si det, ikke tie
 *
 * `jobb` får vite om det er tørrkjøring, og skal selv la være å skrive når det
 * er tilfelle. Denne funksjonen kan ikke håndheve det — den kan bare sørge for
 * at det blir sagt høyt at det var en tørrkjøring.
 */
export async function kjoerCronjobb(args: {
  navn: string;
  hemmelighetNavn: string;
  request: Request;
  /** Maks kall per minutt. */
  rateGrense?: number;
  jobb: (kontekst: { torrkjoering: boolean; naa: Date }) => Promise<CronUtfall>;
}): Promise<Response> {
  const startet = Date.now();
  const { navn, hemmelighetNavn, request } = args;

  const grense = sjekkRateLimit(
    klientNokkel(request.headers, `cron:${navn}`),
    args.rateGrense ?? 30,
    60_000,
  );

  if (!grense.tillatt) {
    return forMangeForesporsler(grense);
  }

  const hemmelighet = sjekkHemmelighet(request, hemmelighetNavn);
  if (!hemmelighet.ok) {
    logg.advarsel("Cron avvist", { jobb: navn, grunn: hemmelighet.grunn });
    return NextResponse.json(
      { feil: "uautorisert", melding: hemmelighet.grunn },
      { status: hemmelighet.status },
    );
  }

  const torrkjoering = vilTorrkjoere(request);
  const naa = new Date();

  const kjoering = await prisma.cronKjoering.create({
    data: { navn, status: "KJORER", torrkjoering },
  });

  try {
    const utfall = await args.jobb({ torrkjoering, naa });

    await prisma.cronKjoering.update({
      where: { id: kjoering.id },
      data: {
        status: torrkjoering ? "TORRKJORT" : utfall.antallFeil && utfall.antallFeil > 0 ? "FEILET" : "FULLFOERT",
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        antallUtfort: utfall.antallUtfort ?? 0,
        antallFeil: utfall.antallFeil ?? 0,
        melding: utfall.melding,
        detaljer: utfall.detaljer ? (utfall.detaljer as object) : undefined,
        feilmelding: utfall.antallFeil && utfall.antallFeil > 0 ? utfall.melding : null,
      },
    });

    await prisma.cronJobb.updateMany({
      where: { navn },
      data: {
        sisteKjoering: new Date(),
        sisteStatus: torrkjoering ? "TORRKJORT" : "FULLFOERT",
        sisteFeil: null,
      },
    });

    logg.info("Cron kjørte", { jobb: navn, torrkjoering, melding: utfall.melding });

    return NextResponse.json(
      {
        jobb: navn,
        torrkjoering,
        status: torrkjoering ? "torrkjoert" : "fullfoert",
        melding: utfall.melding,
        varighetMs: Date.now() - startet,
        ...(utfall.svar ?? {}),
      },
      { status: utfall.status ?? 200 },
    );
  } catch (feil) {
    const melding = feilmelding(feil);

    await prisma.cronKjoering.update({
      where: { id: kjoering.id },
      data: {
        status: "FEILET",
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        antallFeil: 1,
        feilmelding: melding,
      },
    });

    await prisma.cronJobb.updateMany({
      where: { navn },
      data: { sisteKjoering: new Date(), sisteStatus: "FEILET", sisteFeil: melding },
    });

    logg.feil("Cron feilet", { jobb: navn, feil });

    return NextResponse.json(
      { jobb: navn, status: "feilet", feilmelding: melding },
      { status: 500 },
    );
  }
}
