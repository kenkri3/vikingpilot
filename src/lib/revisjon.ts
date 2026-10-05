/**
 * Revisjonslogg.
 *
 * Modul 7. Hver utgående handling skal kunne spores: med grunnlag, tidspunkt,
 * resultat og kilde.
 *
 * UFRAVIKELIG: det finnes ingen oppdaterings- eller slettefunksjon her, og det
 * skal det ikke lages noen. En logg som kan endres er ikke et bevis.
 * Se docs/beslutninger.md B-007 og docs/status.md F-003 for hva det betyr i
 * praksis — håndhevelsen ligger i applikasjonslaget, ikke i databasen.
 *
 * All metadata går gjennom vask() fra logg.ts, slik at hemmeligheter aldri
 * havner i loggen.
 */

import type { Kanal } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { feilmelding, logg, vask } from "@/lib/logg";

export type RevisjonInn = {
  /** Hva som skjedde. Bruk store bokstaver, f.eks. «UTSENDING_SENDT». */
  handling: string;
  /** Hvem eller hva som gjorde det. E-post for mennesker, «SYSTEMET» for kode. */
  aktor: string;
  /** «BRUKER», «SYSTEMET» eller «AGENT». */
  aktorType?: string;
  /** Hva det gjelder, f.eks. «Kontakt». */
  entitet?: string | null;
  entitetId?: string | null;
  kanal?: Kanal | null;
  /** Hvorfor. Dette er det viktigste feltet — det gjør loggen etterprøvbar. */
  grunnlag?: string | null;
  /** Hva som ble resultatet, i klartekst. */
  resultat?: string | null;
  /** Kort statuskode, f.eks. «ok», «avvist», «feilet». */
  resultatStatus?: string | null;
  /** Hvor opplysningen kommer fra. */
  kilde?: string | null;
  ip?: string | null;
  /** Navnet på agenten, hvis handlingen kom derfra. Aldri plattformnavnet. */
  brukerAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Knytter sammen flere oppføringer fra samme hendelse. */
  korrelasjonId?: string | null;
  dialogMeldingId?: string | null;
};

/**
 * Skriver én revisjonsoppføring.
 *
 * Returnerer id-en, eller null hvis skrivingen feilet. Vi kaster ikke videre:
 * en feilende logg skal ikke velte selve handlingen den beskriver, men den skal
 * rope høyt i loggen.
 */
export async function skrivRevisjon(inn: RevisjonInn): Promise<string | null> {
  try {
    const opprettet = await prisma.revisjon.create({
      data: {
        handling: inn.handling,
        aktor: inn.aktor,
        aktorType: inn.aktorType ?? "SYSTEMET",
        entitet: inn.entitet ?? null,
        entitetId: inn.entitetId ?? null,
        kanal: inn.kanal ?? null,
        grunnlag: inn.grunnlag ?? null,
        resultat: inn.resultat ?? null,
        resultatStatus: inn.resultatStatus ?? null,
        kilde: inn.kilde ?? null,
        ip: inn.ip ?? null,
        brukerAgent: inn.brukerAgent ?? null,
        metadata: inn.metadata ? (vask(inn.metadata) as object) : undefined,
        korrelasjonId: inn.korrelasjonId ?? null,
        dialogMeldingId: inn.dialogMeldingId ?? null,
      },
      select: { id: true },
    });

    return opprettet.id;
  } catch (feil) {
    logg.feil("Kunne ikke skrive revisjon", {
      handling: inn.handling,
      entitet: inn.entitet,
      feil: feilmelding(feil),
    });
    return null;
  }
}

/**
 * Skriver en revisjon for en utgående handling som ble AVVIST.
 *
 * Avvisninger er like viktige som gjennomføringer. De viser at gjerdene virker.
 */
export async function revisjonAvvist(
  handling: string,
  grunn: string,
  inn: Omit<RevisjonInn, "handling" | "grunnlag" | "resultat" | "resultatStatus">,
): Promise<string | null> {
  return skrivRevisjon({
    ...inn,
    handling,
    grunnlag: grunn,
    resultat: "Avvist",
    resultatStatus: "avvist",
  });
}

/**
 * Skriver en revisjon for en utgående handling som ble GJENNOMFØRT.
 */
export async function revisjonUtfort(
  handling: string,
  grunnlag: string,
  resultat: string,
  inn: Omit<RevisjonInn, "handling" | "grunnlag" | "resultat" | "resultatStatus">,
): Promise<string | null> {
  return skrivRevisjon({
    ...inn,
    handling,
    grunnlag,
    resultat,
    resultatStatus: "ok",
  });
}

// ---------------------------------------------------------------------------
// Lesing
// ---------------------------------------------------------------------------

export type RevisjonFilter = {
  handling?: string;
  aktor?: string;
  entitet?: string;
  entitetId?: string;
  korrelasjonId?: string;
  /** Hvor oppføringen kom fra, f.eks. «test/brudd». */
  kilde?: string;
  fra?: Date;
  til?: Date;
  antall?: number;
  side?: number;
};

/** Bygger hvor-klausulen på ett sted, slik at lesing og telling ikke spriker. */
function hvorFraFilter(filter: RevisjonFilter) {
  return {
    ...(filter.handling ? { handling: filter.handling } : {}),
    ...(filter.aktor ? { aktor: filter.aktor } : {}),
    ...(filter.entitet ? { entitet: filter.entitet } : {}),
    ...(filter.entitetId ? { entitetId: filter.entitetId } : {}),
    ...(filter.korrelasjonId ? { korrelasjonId: filter.korrelasjonId } : {}),
    ...(filter.kilde ? { kilde: filter.kilde } : {}),
    ...(filter.fra || filter.til
      ? {
          opprettet: {
            ...(filter.fra ? { gte: filter.fra } : {}),
            ...(filter.til ? { lte: filter.til } : {}),
          },
        }
      : {}),
  };
}

/**
 * Leser revisjonsloggen. Bare lesing — det finnes ingen skrive- eller
 * slettevei utenom skrivRevisjon over.
 */
export async function lesRevisjoner(filter: RevisjonFilter = {}) {
  const antall = Math.min(filter.antall ?? 50, 500);
  const side = Math.max(filter.side ?? 0, 0);

  return prisma.revisjon.findMany({
    where: hvorFraFilter(filter),
    orderBy: { opprettet: "desc" },
    take: antall,
    skip: side * antall,
  });
}

/** Teller revisjonsoppføringer for et filter. */
export async function tellRevisjoner(filter: RevisjonFilter = {}): Promise<number> {
  return prisma.revisjon.count({ where: hvorFraFilter(filter) });
}

/**
 * Henter hele kjeden for én korrelasjonsid.
 *
 * Dette er hvordan en utgående handling kan etterprøves fra ende til annen:
 * hva som ble foreslått, hva som ble godkjent, hva som ble sendt, og hva som kom
 * tilbake.
 */
export async function lesKjede(korrelasjonId: string) {
  return prisma.revisjon.findMany({
    where: { korrelasjonId },
    orderBy: { opprettet: "asc" },
  });
}
