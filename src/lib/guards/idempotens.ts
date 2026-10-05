/**
 * Idempotens.
 *
 * Modul 4, bøtte 1. Den viktigste garantien i hele utsendingssystemet:
 * samme melding skal aldri kunne sendes to ganger.
 *
 * Vi bruker en unik nøkkel i databasen i stedet for en sjekk-og-send-sekvens.
 * Grunnen er kappløpet: to cron-kjøringer som starter samtidig ville begge
 * kunnet lese «ikke sendt», og begge sendt. En unik indeks kan ikke lures —
 * den andre skrivingen feiler, uansett hvor samtidig den er.
 *
 * Det er derfor `provAaReservere` bruker `create` og fanger unikhetsfeilen,
 * i stedet for å lese først og skrive etterpå.
 */

import { createHash } from "node:crypto";

import type { Kanal } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { logg } from "@/lib/logg";

export type IdempotensDel = {
  kanal: Kanal;
  /** Mottakeren. */
  kontaktId?: string | null;
  organisasjonId?: string | null;
  /** Steget i sekvensen, hvis dette er en sekvensutsending. */
  sekvensStegId?: string | null;
  /** Dialogmeldingen, hvis den finnes. */
  dialogMeldingId?: string | null;
  /**
   * Er dette en tørrkjøring? Den inngår i nøkkelen, slik at en tørrkjøring ikke
   * blokkerer den ekte sendingen etterpå.
   */
  torrkjoering?: boolean;
  /**
   * Valgfritt tillegg. Brukes når samme mottaker skal kunne få flere meldinger
   * i samme sekvens, for eksempel ved en manuell engangsutsending.
   */
  tillegg?: string | null;
};

/**
 * Bygger en deterministisk idempotensnøkkel.
 *
 * Deterministisk betyr at samme input alltid gir samme nøkkel. Da trenger vi
 * ingen tilfeldighet, og en gjentatt kjøring treffer nøyaktig samme rad.
 *
 * Vi hasher innholdet for å holde nøkkelen kort og lesbar, uansett hvor mange
 * felt som inngår.
 */
export function byggIdempotensNokkel(del: IdempotensDel): string {
  const mottaker = del.kontaktId ?? del.organisasjonId ?? "ukjent";

  const raa = [
    del.kanal,
    mottaker,
    del.sekvensStegId ?? "-",
    del.dialogMeldingId ?? "-",
    del.torrkjoering ? "torr" : "ekte",
    del.tillegg ?? "-",
  ].join("|");

  const hash = createHash("sha256").update(raa).digest("hex").slice(0, 32);

  // Prefiks med kanalen gjør nøkkelen lesbar når den dukker opp i en logg.
  return `${del.kanal.toLowerCase()}:${hash}`;
}

export type Reservasjon =
  | { reservert: true; utsendingId: string }
  | { reservert: false; grunn: string; utsendingId: string | null };

/**
 * Reserverer retten til å sende én melding.
 *
 * Lykkes den, har denne kalleren enerett på å sende. Feiler den fordi nøkkelen
 * finnes, har noen andre allerede tatt den — og da skal vi ikke sende.
 *
 * Dette er den eneste veien inn i en utsending.
 */
export async function provAaReservere(
  del: IdempotensDel,
  ekstra: { avsenderId?: string | null; planlagtTid?: Date | null } = {},
): Promise<Reservasjon> {
  const nokkel = byggIdempotensNokkel(del);

  try {
    const opprettet = await prisma.utsending.create({
      data: {
        idempotensNokkel: nokkel,
        kanal: del.kanal,
        kontaktId: del.kontaktId ?? null,
        organisasjonId: del.organisasjonId ?? null,
        sekvensStegId: del.sekvensStegId ?? null,
        dialogMeldingId: del.dialogMeldingId ?? null,
        torrkjoering: del.torrkjoering ?? false,
        avsenderId: ekstra.avsenderId ?? null,
        planlagtTid: ekstra.planlagtTid ?? null,
        status: "UTKAST",
      },
      select: { id: true },
    });

    return { reservert: true, utsendingId: opprettet.id };
  } catch (feil) {
    // Unikhetsbrudd betyr at noen andre har tatt nøkkelen. Det er ikke en feil
    // — det er hele poenget.
    if (erUnikhetsbrudd(feil)) {
      const eksisterende = await prisma.utsending.findUnique({
        where: { idempotensNokkel: nokkel },
        select: { id: true, status: true, sendtTid: true },
      });

      const beskrivelse = eksisterende?.sendtTid
        ? `allerede sendt ${eksisterende.sendtTid.toISOString()}`
        : `allerede reservert med status ${eksisterende?.status ?? "ukjent"}`;

      logg.info("Utsending blokkert av idempotens", {
        nokkel,
        utsendingId: eksisterende?.id,
        status: eksisterende?.status,
      });

      return {
        reservert: false,
        grunn: `Meldingen er ${beskrivelse}. Sender ikke på nytt.`,
        utsendingId: eksisterende?.id ?? null,
      };
    }

    throw feil;
  }
}

/**
 * Kjenner igjen Prismas unikhetsbrudd.
 *
 * Vi sjekker koden og ikke `instanceof`, fordi klasse-identiteter ikke er
 * pålitelige på tvers av modulgrenser i Next.js. Se B-019.
 */
function erUnikhetsbrudd(feil: unknown): boolean {
  if (typeof feil !== "object" || feil === null) return false;

  const kode = (feil as { code?: unknown }).code;
  return kode === "P2002";
}

/** Marker at en utsending faktisk er sendt. */
export async function merkSendt(
  utsendingId: string,
  eksternId?: string | null,
): Promise<void> {
  await prisma.utsending.update({
    where: { id: utsendingId },
    data: {
      status: "SENDT",
      sendtTid: new Date(),
      eksternId: eksternId ?? null,
      feilmelding: null,
    },
  });
}

/** Marker at en utsending feilet. Nøkkelen beholdes, så den ikke prøves igjen i det uendelige. */
export async function merkFeilet(utsendingId: string, feilmelding: string): Promise<void> {
  await prisma.utsending.update({
    where: { id: utsendingId },
    data: {
      status: "FEILET",
      feilmelding,
      forsok: { increment: 1 },
    },
  });
}

/** Marker at en utsending ble stoppet av en guardrail, med grunnen. */
export async function merkAvvist(utsendingId: string, grunn: string): Promise<void> {
  await prisma.utsending.update({
    where: { id: utsendingId },
    data: { status: "AVVIST", feilmelding: grunn },
  });
}

/** Er denne meldingen allerede sendt eller reservert? */
export async function erAlleredeSendt(del: IdempotensDel): Promise<boolean> {
  const nokkel = byggIdempotensNokkel(del);
  const funnet = await prisma.utsending.findUnique({
    where: { idempotensNokkel: nokkel },
    select: { id: true },
  });

  return funnet !== null;
}
