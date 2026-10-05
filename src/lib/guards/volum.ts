/**
 * Volum per avsender.
 *
 * Modul 4, bøtte 1. Hvor mange meldinger en avsender får sende per dag og per
 * uke er data i databasen, ikke en regel i en prompt.
 *
 * Tellingen er knyttet til avsenderen, ikke til mottakeren, og den nullstilles
 * på dato — ikke etter 24 timer fra forrige sending. Det gjør at «per dag»
 * betyr det et menneske tror det betyr.
 */

import { prisma } from "@/lib/db";
import { logg } from "@/lib/logg";
import { norskTid } from "@/lib/tid/vinduer";

export type VolumSvar = {
  tillatt: boolean;
  grunn: string;
  /** Hvor mange som er sendt i dag, før denne. */
  sendtIDag: number;
  /** Hvor mange som er sendt denne uken, før denne. */
  sendtDenneUken: number;
  /** Taket som gjelder nå. */
  maksPerDag: number;
  maksPerUke: number;
};

/**
 * Nøkkelen til dagen og uken i norsk tid.
 *
 * Vi bruker norsk tid, ikke UTC. Railway kjører i UTC, og ved midnatt norsk tid
 * ville døgntelleren ellers nullstilt seg to timer feil.
 */
export function dognNokkel(tidspunkt: Date = new Date()): string {
  return norskTid(tidspunkt).dato;
}

/**
 * Ukentlig nøkkel: datoen for mandagen i den uken.
 *
 * ISO-uken begynner mandag. Vi regner oss bakover til mandag fra den norske
 * ukedagen, slik at ukenøkkelen er stabil innenfor samme uke.
 */
export function ukeNokkel(tidspunkt: Date = new Date()): string {
  const deler = norskTid(tidspunkt);
  const dagerSidenMandag = (deler.ukedag + 6) % 7;

  const mandag = new Date(Date.UTC(deler.aar, deler.maaned - 1, deler.dag));
  mandag.setUTCDate(mandag.getUTCDate() - dagerSidenMandag);

  return mandag.toISOString().slice(0, 10);
}

/**
 * Sjekker om avsenderen har plass til én melding til.
 *
 * Endrer ingenting. Kall `registrerUtsending` etter at meldingen faktisk er
 * sendt, slik at et forsøk som feiler ikke bruker opp kvoten.
 */
export async function sjekkVolum(
  avsenderId: string,
  tidspunkt: Date = new Date(),
): Promise<VolumSvar> {
  const avsender = await prisma.avsender.findUnique({ where: { id: avsenderId } });

  if (!avsender) {
    return {
      tillatt: false,
      grunn: `Avsenderen finnes ikke.`,
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
      sendtIDag: avsender.sendtIDag,
      sendtDenneUken: avsender.sendtDenneUken,
      maksPerDag: avsender.maksPerDag,
      maksPerUke: avsender.maksPerUke,
    };
  }

  if (avsender.status === "PAUSET") {
    return {
      tillatt: false,
      grunn: `Avsenderen ${avsender.epost} er pauset.`,
      sendtIDag: avsender.sendtIDag,
      sendtDenneUken: avsender.sendtDenneUken,
      maksPerDag: avsender.maksPerDag,
      maksPerUke: avsender.maksPerUke,
    };
  }

  // Tellerne gjelder bare hvis de hører til inneværende dag og uke. Ellers
  // regner vi dem som null uten å skrive til databasen — en lesing skal ikke
  // endre tilstand.
  const idag = dognNokkel(tidspunkt);
  const denneUken = ukeNokkel(tidspunkt);

  const avsenderDogn = avsender.dognDato ? dognNokkel(avsender.dognDato) : null;
  const avsenderUke = avsender.ukeDato ? ukeNokkel(avsender.ukeDato) : null;

  const sendtIDag = avsenderDogn === idag ? avsender.sendtIDag : 0;
  const sendtDenneUken = avsenderUke === denneUken ? avsender.sendtDenneUken : 0;

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
 * Registrerer at én melding er sendt.
 *
 * Nullstiller telleren hvis vi har skiftet dag eller uke. Kalles etter at
 * sendingen faktisk har lykkes.
 */
export async function registrerUtsending(
  avsenderId: string,
  tidspunkt: Date = new Date(),
): Promise<void> {
  const avsender = await prisma.avsender.findUnique({ where: { id: avsenderId } });
  if (!avsender) return;

  const idag = tidspunkt;
  const idagNokkel = dognNokkel(tidspunkt);
  const denneUkenNokkel = ukeNokkel(tidspunkt);

  const avsenderDogn = avsender.dognDato ? dognNokkel(avsender.dognDato) : null;
  const avsenderUke = avsender.ukeDato ? ukeNokkel(avsender.ukeDato) : null;

  const sendtIDag = avsenderDogn === idagNokkel ? avsender.sendtIDag + 1 : 1;
  const sendtDenneUken = avsenderUke === denneUkenNokkel ? avsender.sendtDenneUken + 1 : 1;

  await prisma.avsender.update({
    where: { id: avsenderId },
    data: {
      sendtIDag,
      sendtDenneUken,
      dognDato: idag,
      ukeDato: idag,
    },
  });
}

/**
 * Nullstiller tellere som hører til en dag eller uke som er over.
 *
 * Kjøres av en cron-jobb. Den er ikke nødvendig for riktigheten — `sjekkVolum`
 * regner uansett utløpte tellere som null — men den holder tallene i basen
 * forståelige for et menneske som leser dem.
 */
export async function nullstillUtlopteTellere(tidspunkt: Date = new Date()): Promise<number> {
  const idag = dognNokkel(tidspunkt);
  const denneUken = ukeNokkel(tidspunkt);

  const alle = await prisma.avsender.findMany({
    select: { id: true, dognDato: true, ukeDato: true, sendtIDag: true, sendtDenneUken: true },
  });

  let endret = 0;

  for (const a of alle) {
    const dognUtlopt = a.dognDato === null || dognNokkel(a.dognDato) !== idag;
    const ukeUtlopt = a.ukeDato === null || ukeNokkel(a.ukeDato) !== denneUken;

    if (!dognUtlopt && !ukeUtlopt) continue;

    await prisma.avsender.update({
      where: { id: a.id },
      data: {
        ...(dognUtlopt ? { sendtIDag: 0 } : {}),
        ...(ukeUtlopt ? { sendtDenneUken: 0 } : {}),
      },
    });

    endret += 1;
  }

  if (endret > 0) {
    logg.info("Nullstilte utløpte tellere", { antall: endret });
  }

  return endret;
}
