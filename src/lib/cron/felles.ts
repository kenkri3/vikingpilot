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

// ---------------------------------------------------------------------------
// Global sikring mot gjetting på hemmelighetene
// ---------------------------------------------------------------------------

/**
 * Teller mislykkede hemmelighetsforsøk på tvers av alle IP-er.
 *
 * HVORFOR DETTE FINNES: rate limiting per IP nøkler på `x-forwarded-for`, og den
 * verdien kan kalleren selv sette. Et script som sender et tilfeldig
 * X-Forwarded-For for hver forespørsel får dermed ubegrenset antall forsøk mot en
 * cron-hemmelighet. Per-IP-grensen er altså ikke et reelt gjerde mot gjetting.
 *
 * Denne telleren kan ikke lures på samme måte, fordi den ikke ser på hvem som
 * spør — bare på hvor mange som har gjettet feil. Hemmelighetene er 48 tilfeldige
 * tegn, så sannsynligheten for et treff er i praksis null. Poenget er å gjøre
 * gjetting meningsløst og synlig, ikke å gjøre det umulig.
 *
 * Telleren er i minnet. Kjører tjenesten på flere instanser, må den flyttes til
 * databasen — det står i docs/status.md.
 */
const FEIL_VINDU_MS = 60_000;
const MAKS_FEIL_PER_MINUTT = 20;

let feilIVinduet = 0;
let vinduStart = 0;

/** Registrerer et mislykket forsøk. */
export function registrerFeilHemmelighet(): void {
  const naa = Date.now();

  if (naa - vinduStart > FEIL_VINDU_MS) {
    vinduStart = naa;
    feilIVinduet = 0;
  }

  feilIVinduet += 1;

  if (feilIVinduet === MAKS_FEIL_PER_MINUTT) {
    logg.advarsel("Mange mislykkede hemmelighetsforsøk", {
      antall: feilIVinduet,
      vinduMs: FEIL_VINDU_MS,
      merknad: "Videre forsøk avvises til vinduet er over.",
    });
  }
}

/** Er for mange feil registrert i dette vinduet? */
export function forMangeFeilHemmelighet(): { sperret: boolean; feil: number } {
  const naa = Date.now();

  if (naa - vinduStart > FEIL_VINDU_MS) {
    vinduStart = naa;
    feilIVinduet = 0;
  }

  return { sperret: feilIVinduet >= MAKS_FEIL_PER_MINUTT, feil: feilIVinduet };
}

/** Nullstiller telleren. Brukes av tester. */
export function nullstillFeilHemmelighet(): void {
  feilIVinduet = 0;
  vinduStart = 0;
}

/**
 * Kjører skjelettet rundt en cron-jobb.
 *
 * Håndterer i denne rekkefølgen:
 *   1. Global sikring mot gjetting
 *   2. Rate limiting per IP
 *   3. Hemmelighet
 *   4. Opprette CronKjoering
 *   5. Kalle jobben
 *   6. Logge resultatet, eller feilen — en jobb som feiler skal si det, ikke tie
 *
 * `jobb` får vite om det er tørrkjøring, og skal selv la være å skrive når det
 * er tilfelle. Denne funksjonen kan ikke håndheve det — den kan bare sørge for
 * at det blir sagt høyt at det var en tørrkjøring.
 */
export async function kjoerCronjobb(args: {
  navn: string;
  hemmelighetNavn: string;
  request: Request;
  /** Maks kall per minutt per IP. */
  rateGrense?: number;
  jobb: (kontekst: { torrkjoering: boolean; naa: Date }) => Promise<CronUtfall>;
}): Promise<Response> {
  const startet = Date.now();
  const { navn, hemmelighetNavn, request } = args;

  // 1. Den globale sikringen. Denne kan ikke omgås med en falsk IP.
  const global = forMangeFeilHemmelighet();

  if (global.sperret) {
    logg.advarsel("Cron avvist av global sikring", { jobb: navn, feil: global.feil });

    return NextResponse.json(
      {
        feil: "for_mange_feil",
        melding:
          `For mange mislykkede hemmelighetsforsøk (${global.feil} det siste minuttet). ` +
          `Alle cron-kall avvises til vinduet er over. Sjekk om noen gjetter på nøklene.`,
      },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  // 2. Rate limiting per IP. Svakere enn den over, men billig.
  const grense = sjekkRateLimit(
    klientNokkel(request.headers, `cron:${navn}`),
    args.rateGrense ?? 30,
    60_000,
  );

  if (!grense.tillatt) {
    return forMangeForesporsler(grense);
  }

  // 3. Hemmeligheten.
  const hemmelighet = sjekkHemmelighet(request, hemmelighetNavn);

  if (!hemmelighet.ok) {
    // Bare tell når noen faktisk prøvde, ikke når nøkkelen mangler på serveren.
    if (hemmelighet.status === 401) {
      registrerFeilHemmelighet();
    }

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
