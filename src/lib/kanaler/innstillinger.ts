/**
 * Kanalinnstillinger — den eneste skriveveien.
 *
 * Hovedbryteren for all utgående trafikk ligger i `KanalInnstilling`. Den er
 * det viktigste enkeltfeltet i hele systemet: slår den til, kan noe nå en
 * mottaker.
 *
 * DERFOR LIGGER ALL SKRIVING HER.
 *
 * Bakgrunnen er en ekte hendelse: under uavhengig testing ble
 * `EPOST.utgaaendeAktivert` satt til `true` direkte i databasen. Endringen var
 * usynlig i revisjonsloggen — det fantes ingen oppføring, og `oppdatertAv` var
 * tom. Vi kunne ikke si hvem, hva eller når ut fra systemet selv. Det er ikke
 * godt nok for en bryter med så store konsekvenser.
 *
 * Regelen er derfor: ingen kode skriver til `KanalInnstilling` utenom denne
 * filen, og hver endring havner i revisjonsloggen med navn og tidspunkt.
 */

import type { Kanal } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { logg } from "@/lib/logg";
import { skrivRevisjon } from "@/lib/revisjon";

export type KanalEndring = {
  kanal: Kanal;
  /** Hvem som gjør endringen. Påkrevd — en endring uten navn er ikke sporb ar. */
  endretAv: string;
  utgaaendeAktivert?: boolean;
  maksPerDag?: number;
  maksPerUke?: number;
  maksPerMinutt?: number;
  tidsvinduStart?: string;
  tidsvinduSlutt?: string;
  kunHverdager?: boolean;
  notat?: string | null;
  /** Hvorfor. Frivillig, men sterkt anbefalt for et felt som dette. */
  grunnlag?: string | null;
};

export type KanalEndringSvar =
  | { ok: true; forandret: string[] }
  | { ok: false; grunn: string };

/** Feltene vi sammenligner for å avgjøre hva som faktisk endret seg. */
const SAMMENLIGNES = [
  "utgaaendeAktivert",
  "maksPerDag",
  "maksPerUke",
  "maksPerMinutt",
  "tidsvinduStart",
  "tidsvinduSlutt",
  "kunHverdager",
] as const;

/**
 * Endrer en kanalinnstilling og skriver det til revisjonsloggen.
 *
 * Er ingenting faktisk endret, skriver vi ingen revisjon. En logg full av
 * «ingen endring» er vanskeligere å lese enn en logg med bare endringer.
 */
export async function endreKanal(inn: KanalEndring): Promise<KanalEndringSvar> {
  if (!inn.endretAv || inn.endretAv.trim() === "") {
    return {
      ok: false,
      grunn:
        "En kanalendring krever navn på hvem som gjorde den. Uten det kan vi ikke " +
        "svare på hvem som slo på utgående trafikk.",
    };
  }

  const foer = await prisma.kanalInnstilling.findUnique({ where: { kanal: inn.kanal } });

  if (!foer) {
    return { ok: false, grunn: `Kanalen ${inn.kanal} er ikke satt opp.` };
  }

  // Bare felter som faktisk er oppgitt, skal røres.
  const data: Record<string, unknown> = { oppdatertAv: inn.endretAv };

  for (const felt of SAMMENLIGNES) {
    const verdi = inn[felt];
    if (verdi !== undefined) data[felt] = verdi;
  }

  if (inn.notat !== undefined) data.notat = inn.notat;

  // Hva endret seg? Vi sammenligner før og etter, slik at loggen sier noe
  // konkret i stedet for bare «oppdatert».
  const forandret: { felt: string; fra: unknown; til: unknown }[] = [];

  for (const felt of SAMMENLIGNES) {
    if (inn[felt] === undefined) continue;

    const gammel = (foer as unknown as Record<string, unknown>)[felt];
    const ny = inn[felt];

    if (gammel !== ny) {
      forandret.push({ felt, fra: gammel, til: ny });
    }
  }

  if (forandret.length === 0 && inn.notat === undefined) {
    return { ok: true, forandret: [] };
  }

  await prisma.kanalInnstilling.update({ where: { kanal: inn.kanal }, data });

  const oppsummering = forandret
    .map((f) => `${f.felt}: ${String(f.fra)} → ${String(f.til)}`)
    .join(", ");

  // Slås utgående trafikk PÅ, er det en hendelse av en helt annen vekt enn å
  // justere et tidsvindu. Vi markerer det tydelig i loggen.
  const sloPaa = forandret.some((f) => f.felt === "utgaaendeAktivert" && f.til === true);
  const sloAv = forandret.some((f) => f.felt === "utgaaendeAktivert" && f.til === false);

  await skrivRevisjon({
    handling: sloPaa
      ? "KANAL_UTGAAENDE_SLAATT_PAA"
      : sloAv
        ? "KANAL_UTGAAENDE_SLAATT_AV"
        : "KANAL_ENDRET",
    aktor: inn.endretAv,
    aktorType: "BRUKER",
    entitet: "KanalInnstilling",
    entitetId: foer.id,
    kanal: inn.kanal,
    grunnlag: inn.grunnlag ?? `Endret av ${inn.endretAv}.`,
    resultat: oppsummering === "" ? "Bare notat endret." : oppsummering,
    resultatStatus: sloPaa ? "utgaaende-pa" : "ok",
    kilde: "kanaler/innstillinger",
    metadata: { forandret },
  });

  logg.info("Kanalinnstilling endret", {
    kanal: inn.kanal,
    av: inn.endretAv,
    forandret: forandret.map((f) => f.felt),
    utgaaendeAktivert: inn.utgaaendeAktivert,
  });

  return { ok: true, forandret: forandret.map((f) => f.felt) };
}

/**
 * Slår utgående trafikk av for en kanal.
 *
 * Å slå AV er alltid trygt, og krever derfor ikke like mye seremoni som å slå
 * på — men det logges like fullt.
 */
export async function slaaAvKanal(
  kanal: Kanal,
  endretAv: string,
  grunnlag?: string,
): Promise<KanalEndringSvar> {
  return endreKanal({ kanal, endretAv, utgaaendeAktivert: false, grunnlag });
}

/**
 * Slår utgående trafikk på for en kanal.
 *
 * Dette er den mest konsekvensrike handlingen i systemet. Den krever et navn og
 * en begrunnelse, og den havner i revisjonsloggen med en egen handlingstype.
 */
export async function slaaPaaKanal(
  kanal: Kanal,
  endretAv: string,
  grunnlag: string,
): Promise<KanalEndringSvar> {
  if (!grunnlag || grunnlag.trim().length < 10) {
    return {
      ok: false,
      grunn:
        "Å slå på utgående trafikk krever en begrunnelse på minst ti tegn. " +
        "Det er den mest konsekvensrike handlingen i systemet.",
    };
  }

  return endreKanal({ kanal, endretAv, utgaaendeAktivert: true, grunnlag });
}

/** Leser kanalinnstillingene. Endrer ingenting. */
export async function lesKanaler() {
  return prisma.kanalInnstilling.findMany({ orderBy: { kanal: "asc" } });
}

/**
 * Er noen kanal åpen for utgående trafikk?
 *
 * Brukes av helsesjekken, som skal svare sannheten fra databasen i stedet for å
 * påstå at alt er av.
 */
export async function utgaaendeStatus(): Promise<{
  noenAapne: boolean;
  aapne: Kanal[];
  antall: number;
}> {
  const aapne = await prisma.kanalInnstilling.findMany({
    where: { utgaaendeAktivert: true },
    select: { kanal: true },
    orderBy: { kanal: "asc" },
  });

  return {
    noenAapne: aapne.length > 0,
    aapne: aapne.map((k) => k.kanal),
    antall: aapne.length,
  };
}
