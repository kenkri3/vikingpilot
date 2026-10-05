/**
 * Volum per avsender.
 *
 * Modul 4, bøtte 1. Hvor mange meldinger en avsender får sende per dag og per
 * uke er data i databasen, ikke en regel i en prompt.
 *
 * VIKTIG — hvorfor vi teller fra `Utsending` og ikke fra en teller:
 *
 * Første versjon holdt orden på `Avsender.sendtIDag` og `sendtDenneUken`.
 * `sjekkVolum` leste dem, og alt så riktig ut i testene. Men den eneste
 * funksjonen som økte telleren, `registrerUtsending`, ble aldri kalt fra
 * sendestien. Telleren sto derfor på 0 for alltid, og `sjekkVolum` svarte
 * «innenfor kvoten» til evig tid. Døgnkvote, ukekvote og oppvarmingstak var
 * alle død kode — uten at én eneste test feilet, fordi testene skrev telleren
 * direkte med Prisma.
 *
 * En avledet telling kan ikke komme ut av synk. Den koster én indeksert
 * spørring, og til gjengjeld kan tallet ikke lyve.
 *
 * En annen fordel: telleren overlever et krasj mellom sending og opptelling.
 * Det gjorde den gamle ikke.
 */

import { prisma } from "@/lib/db";
import { norskTid } from "@/lib/tid/vinduer";

export type VolumSvar = {
  tillatt: boolean;
  grunn: string;
  /** Hvor mange som er sendt i dag. */
  sendtIDag: number;
  /** Hvor mange som er sendt denne uken. */
  sendtDenneUken: number;
  maksPerDag: number;
  maksPerUke: number;
};

/**
 * Nøkkelen til dagen i norsk tid.
 *
 * Vi bruker norsk tid, ikke UTC. Railway kjører i UTC, og ved midnatt norsk tid
 * ville døgnet ellers skiftet to timer feil.
 */
export function dognNokkel(tidspunkt: Date = new Date()): string {
  return norskTid(tidspunkt).dato;
}

/** Ukentlig nøkkel: datoen for mandagen i den uken. */
export function ukeNokkel(tidspunkt: Date = new Date()): string {
  const deler = norskTid(tidspunkt);
  const dagerSidenMandag = (deler.ukedag + 6) % 7;

  const mandag = new Date(Date.UTC(deler.aar, deler.maaned - 1, deler.dag));
  mandag.setUTCDate(mandag.getUTCDate() - dagerSidenMandag);

  return mandag.toISOString().slice(0, 10);
}

/**
 * Finner UTC-tidspunktet for norsk midnatt på en gitt norsk dato.
 *
 * Vi kan ikke bare trekke fra to timer, fordi Norge skifter mellom UTC+1 og
 * UTC+2. Vi prøver oss fram med Intl, som kjenner reglene.
 */
export function norskMidnatt(datoNokkel: string): Date {
  const [aar, maaned, dag] = datoNokkel.split("-").map((d) => Number.parseInt(d, 10));

  // Start med midnatt UTC og juster til norsk tid stemmer.
  let kandidat = new Date(Date.UTC(aar!, maaned! - 1, dag!));

  for (let i = 0; i < 3; i += 1) {
    const norsk = norskTid(kandidat);
    const avvikMs =
      Date.UTC(norsk.aar, norsk.maaned - 1, norsk.dag, norsk.time, norsk.minutt) -
      Date.UTC(aar!, maaned! - 1, dag!, 0, 0);

    if (avvikMs === 0) break;
    kandidat = new Date(kandidat.getTime() - avvikMs);
  }

  return kandidat;
}

/** Legger til et antall dager på en datonøkkel. */
function leggTilDager(datoNokkel: string, dager: number): string {
  const [aar, maaned, dag] = datoNokkel.split("-").map((d) => Number.parseInt(d, 10));
  const d = new Date(Date.UTC(aar!, maaned! - 1, dag!));
  d.setUTCDate(d.getUTCDate() + dager);
  return d.toISOString().slice(0, 10);
}

/**
 * Teller hvor mange meldinger en avsender faktisk har sendt i et tidsrom.
 *
 * Vi teller rader med status SENDT. Det er det eneste som beviselig har gått ut.
 */
async function tellSendte(
  avsenderId: string,
  fra: Date,
  til: Date,
): Promise<number> {
  return prisma.utsending.count({
    where: {
      avsenderId,
      status: "SENDT",
      sendtTid: { gte: fra, lt: til },
    },
  });
}

/**
 * Sjekker om avsenderen har plass til én melding til.
 *
 * Endrer ingenting. Tellingen er avledet, så det finnes ingen teller å oppdatere.
 */
export async function sjekkVolum(
  avsenderId: string,
  tidspunkt: Date = new Date(),
): Promise<VolumSvar> {
  const avsender = await prisma.avsender.findUnique({ where: { id: avsenderId } });

  if (!avsender) {
    return {
      tillatt: false,
      grunn: "Avsenderen finnes ikke.",
      sendtIDag: 0,
      sendtDenneUken: 0,
      maksPerDag: 0,
      maksPerUke: 0,
    };
  }

  if (avsender.status === "SPERRET") {
    return {
      tillatt: false,
      grunn: `Avsenderen ${avsender.epost} er sperret.`,
      sendtIDag: 0,
      sendtDenneUken: 0,
      maksPerDag: avsender.maksPerDag,
      maksPerUke: avsender.maksPerUke,
    };
  }

  if (avsender.status === "PAUSET") {
    return {
      tillatt: false,
      grunn: `Avsenderen ${avsender.epost} er pauset.`,
      sendtIDag: 0,
      sendtDenneUken: 0,
      maksPerDag: avsender.maksPerDag,
      maksPerUke: avsender.maksPerUke,
    };
  }

  const idag = dognNokkel(tidspunkt);
  const ukeStart = ukeNokkel(tidspunkt);

  const dagStart = norskMidnatt(idag);
  const dagSlutt = norskMidnatt(leggTilDager(idag, 1));
  const ukeSlutt = norskMidnatt(leggTilDager(ukeStart, 7));

  const [sendtIDag, sendtDenneUken] = await Promise.all([
    tellSendte(avsenderId, dagStart, dagSlutt),
    tellSendte(avsenderId, norskMidnatt(ukeStart), ukeSlutt),
  ]);

  if (avsender.maksPerDag <= 0) {
    return {
      tillatt: false,
      grunn: `Døgnkvoten for ${avsender.epost} er 0. Ingen utsending er tillatt.`,
      sendtIDag,
      sendtDenneUken,
      maksPerDag: avsender.maksPerDag,
      maksPerUke: avsender.maksPerUke,
    };
  }

  if (sendtIDag >= avsender.maksPerDag) {
    return {
      tillatt: false,
      grunn: `Døgnkvoten er brukt opp: ${sendtIDag} av ${avsender.maksPerDag} sendt i dag.`,
      sendtIDag,
      sendtDenneUken,
      maksPerDag: avsender.maksPerDag,
      maksPerUke: avsender.maksPerUke,
    };
  }

  if (avsender.maksPerUke > 0 && sendtDenneUken >= avsender.maksPerUke) {
    return {
      tillatt: false,
      grunn: `Ukekvoten er brukt opp: ${sendtDenneUken} av ${avsender.maksPerUke} sendt denne uken.`,
      sendtIDag,
      sendtDenneUken,
      maksPerDag: avsender.maksPerDag,
      maksPerUke: avsender.maksPerUke,
    };
  }

  return {
    tillatt: true,
    grunn: `Innenfor kvoten: ${sendtIDag} av ${avsender.maksPerDag} i dag, ${sendtDenneUken} av ${avsender.maksPerUke} denne uken.`,
    sendtIDag,
    sendtDenneUken,
    maksPerDag: avsender.maksPerDag,
    maksPerUke: avsender.maksPerUke,
  };
}

/**
 * Hvor mange meldinger avsenderen kan sende nå, gitt begge kvotene.
 *
 * Nyttig for cron-jobber som vil fylle opp til kvoten i stedet for å prøve én
 * om gangen.
 */
export async function gjenvaerendeKvote(
  avsenderId: string,
  tidspunkt: Date = new Date(),
): Promise<{ antall: number; grunn: string }> {
  const volum = await sjekkVolum(avsenderId, tidspunkt);

  if (!volum.tillatt) {
    return { antall: 0, grunn: volum.grunn };
  }

  const dagIgjen = volum.maksPerDag - volum.sendtIDag;
  const ukeIgjen =
    volum.maksPerUke > 0 ? volum.maksPerUke - volum.sendtDenneUken : Number.MAX_SAFE_INTEGER;

  const antall = Math.max(0, Math.min(dagIgjen, ukeIgjen));

  return {
    antall,
    grunn: `${antall} igjen: ${dagIgjen} på døgnet, ${ukeIgjen === Number.MAX_SAFE_INTEGER ? "ubegrenset" : ukeIgjen} i uken.`,
  };
}
