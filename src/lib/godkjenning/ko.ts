/**
 * Godkjenningskøen.
 *
 * Modul 6, bøtte 1. Alt med ekstern konsekvens går gjennom denne køen. Det
 * finnes ingen omvei, og det er med vilje.
 *
 * Tre regler som håndheves her, ikke i en prompt:
 *
 *   1. Agenten kan legge inn forslag, men ALDRI godkjenne. En godkjenning
 *      krever et menneske. Se docs/beslutninger.md B-012.
 *   2. En avgjørelse tas én gang. En godkjenning kan ikke angres ved et uhell,
 *      og to samtidige godkjenninger kan ikke begge vinne.
 *   3. Hvem godkjente hva, og når, registreres — både i køen og i
 *      revisjonsloggen.
 */

import type { GodkjenningStatus, GodkjenningType, Kanal } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { logg } from "@/lib/logg";
import { skrivRevisjon } from "@/lib/revisjon";

/** Aktørtypene som kan legge noe i køen. */
export type AktorType = "SYSTEMET" | "AGENT" | "BRUKER";

export type ForslagInn = {
  type?: GodkjenningType;
  tittel: string;
  begrunnelse?: string | null;
  gjelder?: string | null;
  kanal?: Kanal | null;
  kontaktId?: string | null;
  organisasjonId?: string | null;
  /** Kobler forslaget til et konkret utkast. Unik — ett utkast, én godkjenning. */
  dialogMeldingId?: string | null;
  risiko?: string | null;
  /** Hvem foreslo dette. «AGENT» eller «SYSTEMET». Aldri et menneske. */
  forslagFra?: string;
  /** Navnet på agenten, hvis forslaget kom derfra. Aldri plattformnavnet. */
  brukerAgent?: string | null;
  korrelasjonId?: string | null;
};

export type GodkjenningSvar = {
  id: string;
  status: GodkjenningStatus;
  tittel: string;
};

/**
 * Legger et forslag i køen.
 *
 * Kaster hvis et menneske oppgis som forslagsstiller. Et menneske skal ikke
 * kunne legge noe i køen «på vegne av seg selv» og så godkjenne det — det ville
 * gjort fire-øyne-prinsippet til en formalitet.
 */
export async function leggIForslag(inn: ForslagInn): Promise<GodkjenningSvar> {
  const forslagFra = (inn.forslagFra ?? "SYSTEMET").toUpperCase();

  if (forslagFra !== "SYSTEMET" && forslagFra !== "AGENT") {
    throw new Error(
      `Ugyldig forslagsstiller: «${forslagFra}». Bare SYSTEMET eller AGENT kan legge ` +
        `noe i køen. Et menneske skal godkjenne, ikke foreslå og godkjenne sitt eget.`,
    );
  }

  const opprettet = await prisma.godkjenning.create({
    data: {
      type: inn.type ?? "UTKAST",
      status: "VENTER",
      tittel: inn.tittel,
      begrunnelse: inn.begrunnelse ?? null,
      gjelder: inn.gjelder ?? null,
      kanal: inn.kanal ?? null,
      kontaktId: inn.kontaktId ?? null,
      organisasjonId: inn.organisasjonId ?? null,
      dialogMeldingId: inn.dialogMeldingId ?? null,
      risiko: inn.risiko ?? null,
      forslagFra: forslagFra,
    },
    select: { id: true, status: true, tittel: true },
  });

  await skrivRevisjon({
    handling: "GODKJENNING_FORESLATT",
    aktor: forslagFra === "AGENT" ? (inn.brukerAgent ?? "agenten") : "SYSTEMET",
    aktorType: forslagFra,
    entitet: "Godkjenning",
    entitetId: opprettet.id,
    kanal: inn.kanal ?? null,
    grunnlag: inn.begrunnelse ?? inn.tittel,
    resultat: "Lagt i kø for godkjenning",
    resultatStatus: "venter",
    kilde: "godkjenning/ko",
    brukerAgent: inn.brukerAgent ?? null,
    korrelasjonId: inn.korrelasjonId ?? null,
    metadata: { type: inn.type ?? "UTKAST", risiko: inn.risiko ?? null },
  });

  logg.info("Forslag lagt i godkjenningskøen", {
    godkjenningId: opprettet.id,
    forslagFra,
    kanal: inn.kanal ?? null,
  });

  return opprettet;
}

export type BeslutningInn = {
  godkjenningId: string;
  /** Hvem som bestemte. Påkrevd — en godkjenning uten navn er ikke en godkjenning. */
  brukerEpost: string;
  brukerId?: string | null;
  kommentar?: string | null;
  korrelasjonId?: string | null;
};

export type BeslutningSvar =
  | { ok: true; status: GodkjenningStatus }
  | { ok: false; grunn: string };

/**
 * Setter dialogmeldingen i riktig tilstand etter en avgjørelse.
 *
 * Dette må skje sammen med avgjørelsen. Godkjenningen og meldingen er to rader,
 * og utsendingsjobben ser på meldingens status. Glemmer vi dette, blir en
 * godkjent melding liggende usendt for alltid — og det så ut som om alt virket.
 * Vi fant det ved å kjøre hele kjeden ende-til-ende i stedet for å lese koden.
 */
async function settMeldingstilstand(
  dialogMeldingId: string | null,
  status: "GODKJENT" | "AVVIST",
): Promise<void> {
  if (!dialogMeldingId) return;

  await prisma.dialogMelding.updateMany({
    where: { id: dialogMeldingId, status: "VENTER_GODKJENNING" },
    data: { status },
  });
}

/**
 * Godkjenner et forslag.
 *
 * Vi oppdaterer bare rader som fortsatt står i VENTER. Det gjør avgjørelsen
 * atomisk: to samtidige godkjenninger kan ikke begge lykkes, og et allerede
 * avvist forslag kan ikke godkjennes i ettertid.
 */
export async function godkjenn(inn: BeslutningInn): Promise<BeslutningSvar> {
  if (!inn.brukerEpost || inn.brukerEpost.trim() === "") {
    return { ok: false, grunn: "En godkjenning krever navn på hvem som godkjente." };
  }

  const oppdatert = await prisma.godkjenning.updateMany({
    where: { id: inn.godkjenningId, status: "VENTER" },
    data: { status: "GODKJENT" },
  });

  if (oppdatert.count === 0) {
    return await forklarAvslag(inn.godkjenningId, "godkjenne");
  }

  const rad = await prisma.godkjenning.findUnique({
    where: { id: inn.godkjenningId },
    select: { dialogMeldingId: true },
  });

  await settMeldingstilstand(rad?.dialogMeldingId ?? null, "GODKJENT");

  await prisma.godkjenningsbeslutning.create({
    data: {
      godkjenningId: inn.godkjenningId,
      brukerId: inn.brukerId ?? null,
      brukerEpost: inn.brukerEpost,
      status: "GODKJENT",
      kommentar: inn.kommentar ?? null,
    },
  });

  await skrivRevisjon({
    handling: "GODKJENNING_GODKJENT",
    aktor: inn.brukerEpost,
    aktorType: "BRUKER",
    entitet: "Godkjenning",
    entitetId: inn.godkjenningId,
    grunnlag: inn.kommentar ?? "Godkjent i køen.",
    resultat: "Godkjent",
    resultatStatus: "ok",
    kilde: "godkjenning/ko",
    korrelasjonId: inn.korrelasjonId ?? null,
  });

  logg.info("Forslag godkjent", { godkjenningId: inn.godkjenningId, av: inn.brukerEpost });

  return { ok: true, status: "GODKJENT" };
}

/** Avviser et forslag. */
export async function avvis(inn: BeslutningInn): Promise<BeslutningSvar> {
  if (!inn.brukerEpost || inn.brukerEpost.trim() === "") {
    return { ok: false, grunn: "En avgjørelse krever navn på hvem som bestemte." };
  }

  const oppdatert = await prisma.godkjenning.updateMany({
    where: { id: inn.godkjenningId, status: "VENTER" },
    data: { status: "AVVIST" },
  });

  if (oppdatert.count === 0) {
    return await forklarAvslag(inn.godkjenningId, "avvise");
  }

  const rad = await prisma.godkjenning.findUnique({
    where: { id: inn.godkjenningId },
    select: { dialogMeldingId: true },
  });

  await settMeldingstilstand(rad?.dialogMeldingId ?? null, "AVVIST");

  await prisma.godkjenningsbeslutning.create({
    data: {
      godkjenningId: inn.godkjenningId,
      brukerId: inn.brukerId ?? null,
      brukerEpost: inn.brukerEpost,
      status: "AVVIST",
      kommentar: inn.kommentar ?? null,
    },
  });

  await skrivRevisjon({
    handling: "GODKJENNING_AVVIST",
    aktor: inn.brukerEpost,
    aktorType: "BRUKER",
    entitet: "Godkjenning",
    entitetId: inn.godkjenningId,
    grunnlag: inn.kommentar ?? "Avvist i køen.",
    resultat: "Avvist",
    resultatStatus: "avvist",
    kilde: "godkjenning/ko",
    korrelasjonId: inn.korrelasjonId ?? null,
  });

  logg.info("Forslag avvist", { godkjenningId: inn.godkjenningId, av: inn.brukerEpost });

  return { ok: true, status: "AVVIST" };
}

/** Forklarer hvorfor en avgjørelse ikke gikk gjennom. */
async function forklarAvslag(
  godkjenningId: string,
  handling: string,
): Promise<BeslutningSvar> {
  const finnes = await prisma.godkjenning.findUnique({
    where: { id: godkjenningId },
    select: { status: true, tittel: true },
  });

  if (!finnes) {
    return { ok: false, grunn: `Fant ingen godkjenning med id ${godkjenningId}.` };
  }

  return {
    ok: false,
    grunn: `Kan ikke ${handling} «${finnes.tittel}»: den står allerede som ${finnes.status}. En avgjørelse tas én gang.`,
  };
}

/**
 * Henter det som venter på et menneske.
 */
export async function ventende(antall = 50) {
  return prisma.godkjenning.findMany({
    where: { status: "VENTER" },
    orderBy: { opprettet: "asc" },
    take: Math.min(antall, 200),
  });
}

/** Henter én godkjenning med hele beslutningshistorikken. */
export async function hentMedHistorikk(godkjenningId: string) {
  return prisma.godkjenning.findUnique({
    where: { id: godkjenningId },
    include: {
      beslutninger: { orderBy: { opprettet: "asc" } },
      dialogMelding: true,
    },
  });
}

/**
 * Er denne godkjenningen klar til å sendes?
 *
 * Denne funksjonen er den eneste porten utsendingen skal bruke. Den svarer nei
 * med mindre status er nøyaktig GODKJENT.
 */
export async function erKlarTilSending(godkjenningId: string): Promise<{
  klar: boolean;
  grunn: string;
}> {
  const g = await prisma.godkjenning.findUnique({
    where: { id: godkjenningId },
    select: { status: true, tittel: true },
  });

  if (!g) {
    return { klar: false, grunn: `Fant ingen godkjenning med id ${godkjenningId}.` };
  }

  if (g.status !== "GODKJENT") {
    return {
      klar: false,
      grunn: `«${g.tittel}» står som ${g.status}. Bare GODKJENT kan sendes.`,
    };
  }

  return { klar: true, grunn: "Godkjent av et menneske." };
}

/** Teller køen. Brukes av dashbordet. */
export async function koStatus(): Promise<{
  venter: number;
  godkjent: number;
  avvist: number;
  totalt: number;
}> {
  const [venter, godkjent, avvist, totalt] = await Promise.all([
    prisma.godkjenning.count({ where: { status: "VENTER" } }),
    prisma.godkjenning.count({ where: { status: "GODKJENT" } }),
    prisma.godkjenning.count({ where: { status: "AVVIST" } }),
    prisma.godkjenning.count(),
  ]);

  return { venter, godkjent, avvist, totalt };
}
