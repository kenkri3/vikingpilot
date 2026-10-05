/**
 * Automatiske sperrer.
 *
 * En sperre skal ikke være noe noen husker å legge inn. Den skal oppstå av seg
 * selv når tilstanden tilsier det:
 *
 *   - en avmelding kommer inn        → sperre for all e-post, for alltid
 *   - en adresse bouncer hardt       → sperre adressen
 *   - noen blir kunde                → sperre for utsending, men ikke for dialog
 *   - en dialog blir aktiv           → sperre for nye utsendelser i sekvens
 *   - en virksomhet går konkurs      → sperre virksomheten
 *   - offentlig sektor dukker opp    → sperre virksomheten
 *
 * Alt her er deterministisk. Ingen skjønn, ingen prompt.
 */

import type { Kanal } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  leggTilSperre,
  normaliserEpost,
  sjekkSperreliste,
  type SperreSvar,
} from "@/lib/guards/sperreliste";
import { logg } from "@/lib/logg";
import { skrivRevisjon } from "@/lib/revisjon";

export type AutomatiskResultat = {
  opprettet: boolean;
  sperreId: string | null;
  melding: string;
};

/**
 * Avmelding. Dette er den strengeste sperren vi har: den gjelder alle kanaler,
 * for alltid, og kan bare oppheves manuelt av et menneske.
 */
export async function sperrAvmelding(
  epost: string,
  kilde: string,
  notat?: string,
): Promise<AutomatiskResultat> {
  const adresse = normaliserEpost(epost);

  const { id, ny } = await leggTilSperre({
    type: "GLOBAL",
    grunn: "AVMELDING",
    epost: adresse,
    notat: notat ?? "Avmelding mottatt.",
    kilde,
  });

  if (ny) {
    await skrivRevisjon({
      handling: "SPERRE_OPPRETTET",
      aktor: "SYSTEMET",
      aktorType: "SYSTEMET",
      entitet: "Sperreliste",
      entitetId: id,
      kanal: "EPOST",
      grunnlag: `Avmelding fra ${adresse}`,
      resultat: "Sperret for alle kanaler",
      resultatStatus: "ok",
      kilde,
      metadata: { epost: adresse, sperreGrunn: "AVMELDING" },
    });
  }

  return {
    opprettet: ny,
    sperreId: id,
    melding: ny
      ? `${adresse} er sperret for alle kanaler.`
      : `${adresse} var allerede sperret.`,
  };
}

/**
 * Bounce.
 *
 * Vi skiller hard og myk bounce. En hard bounce betyr at adressen ikke finnes,
 * og skal sperres. En myk bounce kan være full postkasse, og skal ikke sperres
 * — den skal bare telles, slik at avsenderens feilrate stiger.
 */
export async function sperrBounce(
  epost: string,
  hard: boolean,
  kilde: string,
  notat?: string,
): Promise<AutomatiskResultat> {
  const adresse = normaliserEpost(epost);

  if (!hard) {
    logg.info("Myk bounce registrert, ingen sperre", { epost: adresse, kilde });
    return {
      opprettet: false,
      sperreId: null,
      melding: `Myk bounce på ${adresse}. Ingen sperre — adressen kan virke senere.`,
    };
  }

  const { id, ny } = await leggTilSperre({
    type: "KANAL",
    grunn: "BOUNCE",
    epost: adresse,
    kanal: "EPOST",
    notat: notat ?? "Hard bounce.",
    kilde,
  });

  if (ny) {
    await skrivRevisjon({
      handling: "SPERRE_OPPRETTET",
      aktor: "SYSTEMET",
      aktorType: "SYSTEMET",
      entitet: "Sperreliste",
      entitetId: id,
      kanal: "EPOST",
      grunnlag: `Hard bounce på ${adresse}`,
      resultat: "Sperret for e-post",
      resultatStatus: "ok",
      kilde,
      metadata: { epost: adresse, sperreGrunn: "BOUNCE", hard: true },
    });
  }

  return {
    opprettet: ny,
    sperreId: id,
    melding: ny ? `${adresse} er sperret etter hard bounce.` : `${adresse} var allerede sperret.`,
  };
}

/**
 * Klage. Alvorligere enn en avmelding — noen har trykket «søppelpost».
 * Sperren gjelder alle kanaler.
 */
export async function sperrKlage(
  epost: string,
  kilde: string,
  notat?: string,
): Promise<AutomatiskResultat> {
  const adresse = normaliserEpost(epost);

  const { id, ny } = await leggTilSperre({
    type: "GLOBAL",
    grunn: "KLAGE",
    epost: adresse,
    notat: notat ?? "Klage mottatt.",
    kilde,
  });

  if (ny) {
    await skrivRevisjon({
      handling: "SPERRE_OPPRETTET",
      aktor: "SYSTEMET",
      aktorType: "SYSTEMET",
      entitet: "Sperreliste",
      entitetId: id,
      kanal: "EPOST",
      grunnlag: `Klage fra ${adresse}`,
      resultat: "Sperret for alle kanaler",
      resultatStatus: "ok",
      kilde,
      metadata: { epost: adresse, sperreGrunn: "KLAGE" },
    });
  }

  return {
    opprettet: ny,
    sperreId: id,
    melding: ny ? `${adresse} er sperret etter klage.` : `${adresse} var allerede sperret.`,
  };
}

/**
 * Legger inn standard-sperrene som følger av en tilstand.
 *
 * Denne er tenkt kalt etter at en kunde er opprettet, eller når en dialog blir
 * aktiv. Den er idempotent: å kalle den to ganger gir samme resultat.
 */
export async function oppdaterSperrerForKontakt(
  kontaktId: string,
  kilde: string,
): Promise<string[]> {
  const kontakt = await prisma.kontakt.findUnique({
    where: { id: kontaktId },
    include: {
      organisasjon: { include: { kunder: true } },
      dialoger: { where: { aktiv: true } },
    },
  });

  if (!kontakt) {
    return [];
  }

  const meldinger: string[] = [];

  // Eksisterende kunde: vi skal ikke sende kald utsending til våre egne kunder.
  const erKunde = (kontakt.organisasjon?.kunder ?? []).some((k) =>
    ["AKTIV", "PAUSET"].includes(k.kundeStatus),
  );

  if (erKunde) {
    const { ny } = await leggTilSperre({
      type: "ORGANISASJON",
      grunn: "EKSISTERENDE_KUNDE",
      organisasjonId: kontakt.organisasjonId,
      notat: "Automatisk: virksomheten er kunde.",
      kilde,
    });
    if (ny) meldinger.push("Sperret: eksisterende kunde.");
  }

  // Aktiv dialog: ingen nye kalde utsendelser mens vi snakker med dem.
  if (kontakt.dialoger.length > 0) {
    const { ny } = await leggTilSperre({
      type: "KONTAKT",
      grunn: "AKTIV_DIALOG",
      kontaktId: kontakt.id,
      notat: "Automatisk: aktiv dialog løper.",
      kilde,
    });
    if (ny) meldinger.push("Sperret: aktiv dialog.");
  }

  // Konkurs eller offentlig sektor på virksomheten.
  const org = kontakt.organisasjon;
  if (org?.konkurs) {
    const { ny } = await leggTilSperre({
      type: "ORGANISASJON",
      grunn: "KONKURS",
      organisasjonId: org.id,
      notat: "Automatisk: virksomheten er konkurs.",
      kilde,
    });
    if (ny) meldinger.push("Sperret: konkurs.");
  }

  if (org?.sektor === "OFFENTLIG") {
    const { ny } = await leggTilSperre({
      type: "ORGANISASJON",
      grunn: "OFFENTLIG_SEKTOR",
      organisasjonId: org.id,
      notat: "Automatisk: offentlig sektor skal ikke kontaktes.",
      kilde,
    });
    if (ny) meldinger.push("Sperret: offentlig sektor.");
  }

  return meldinger;
}

/**
 * Sjekker om en kanal i det hele tatt er åpen for utgående trafikk.
 *
 * Dette er det første gjerdet, og det står foran alle andre. Er kanalen av,
 * kommer vi ikke til å vurdere mottakeren engang.
 */
export async function sjekkKanalApen(kanal: Kanal): Promise<{
  aapen: boolean;
  grunn: string;
}> {
  const innstilling = await prisma.kanalInnstilling.findUnique({ where: { kanal } });

  if (!innstilling) {
    return {
      aapen: false,
      grunn: `Kanalen ${kanal} er ikke satt opp. Kjør npm run db:seed.`,
    };
  }

  if (!innstilling.utgaaendeAktivert) {
    return {
      aapen: false,
      grunn: `Utgående trafikk er AV for ${kanal}. Den slås på av et menneske, per kanal.`,
    };
  }

  return { aapen: true, grunn: `Kanalen ${kanal} er åpen.` };
}

/**
 * Den samlede porten alle utsendelser må gjennom.
 *
 * Rekkefølgen er ikke tilfeldig: kanalen sjekkes først, fordi en stengt kanal
 * gjør resten irrelevant. Deretter sperrelisten.
 *
 * Det finnes ingen parameter for å hoppe over dette.
 */
export async function kanSende(args: {
  kanal: Kanal;
  epost?: string | null;
  kontaktId?: string | null;
  organisasjonId?: string | null;
}): Promise<SperreSvar> {
  const kanalStatus = await sjekkKanalApen(args.kanal);

  if (!kanalStatus.aapen) {
    return {
      tillatt: false,
      grunn: kanalStatus.grunn,
      type: null,
      sperreGrunn: null,
      sperreId: null,
    };
  }

  return sjekkSperreliste(args);
}
