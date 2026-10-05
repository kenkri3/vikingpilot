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
import { sjekkVolum } from "@/lib/guards/volum";
import { sjekkOppvarming } from "@/lib/guards/oppvarming";
import { sjekkVindu } from "@/lib/tid/vinduer";
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
 * Rekkefølgen er ikke tilfeldig, og den er dokumentert her fordi den er hele
 * poenget: hver sjekk kan avvise, og vi stopper ved første nei.
 *
 *   1. Er kanalen åpen?              KanalInnstilling.utgaaendeAktivert
 *   2. Står mottakeren på en sperre? Sperreliste
 *   3. Er tidsvinduet åpent?         Hverdager, røde dager, klokkeslett
 *   4. Har avsenderen kvote igjen?   Døgnkvote, ukekvote og oppvarming
 *
 * Kanalen sjekkes først fordi en stengt kanal gjør resten irrelevant.
 * Sperrelisten før tidsvinduet fordi en sperre er varig, mens et vindu åpner seg.
 *
 * Det finnes ingen parameter for å hoppe over noen av disse. Det er med vilje.
 */
export async function kanSende(args: {
  kanal: Kanal;
  epost?: string | null;
  kontaktId?: string | null;
  organisasjonId?: string | null;
  /**
   * Avsenderen. PÅKREVD.
   *
   * Første versjon hadde denne valgfri, og hoppet over kvote og oppvarming når
   * den manglet. Den eneste kalleren i produksjon oppga den ikke — så
   * «porten alle utsendelser må gjennom» var tre sjekker, ikke fem.
   *
   * Å utelate avsenderen er ikke en måte å slippe unna på. Er den ukjent,
   * nekter vi. En guardrail som kan hoppes over ved å la være å oppgi et felt,
   * er ingen guardrail.
   */
  avsenderId: string | null | undefined;
  /** Tidspunktet som skal vurderes. Settes av testene. */
  naa?: Date;
  /** Hopper over tidsvinduet. Brukes bare av tester som ikke gjelder vinduet. */
  hoppOverTidsvindu?: boolean;
}): Promise<SperreSvar & { sjekket: string[] }> {
  const naa = args.naa ?? new Date();
  const sjekket: string[] = [];

  // 0. Vet vi hvem som sender? Uten det kan ikke kvotene håndheves, og da
  //    slipper vi ikke gjennom. Vi nekter heller enn å sende uten grense.
  sjekket.push("avsender");
  if (!args.avsenderId) {
    return {
      tillatt: false,
      grunn:
        "Ingen avsender er oppgitt. Uten avsender kan ikke døgnkvote, ukekvote og " +
        "oppvarming håndheves, og da sendes ingenting.",
      type: null,
      sperreGrunn: null,
      sperreId: null,
      sjekket,
    };
  }

  const avsenderId = args.avsenderId;

  // 1. Kanalen.
  sjekket.push("kanal");
  const kanalStatus = await sjekkKanalApen(args.kanal);

  if (!kanalStatus.aapen) {
    return {
      tillatt: false,
      grunn: kanalStatus.grunn,
      type: null,
      sperreGrunn: null,
      sperreId: null,
      sjekket,
    };
  }

  // 2. Sperrelisten.
  sjekket.push("sperreliste");
  const sperre = await sjekkSperreliste({
    kanal: args.kanal,
    epost: args.epost,
    kontaktId: args.kontaktId,
    organisasjonId: args.organisasjonId,
  });

  if (!sperre.tillatt) {
    return { ...sperre, sjekket };
  }

  // 3. Tidsvinduet.
  if (!args.hoppOverTidsvindu) {
    sjekket.push("tidsvindu");

    const innstilling = await prisma.kanalInnstilling.findUnique({
      where: { kanal: args.kanal },
      select: { tidsvinduStart: true, tidsvinduSlutt: true, kunHverdager: true },
    });

    if (innstilling) {
      const vindu = sjekkVindu(naa, {
        start: innstilling.tidsvinduStart,
        slutt: innstilling.tidsvinduSlutt,
        kunHverdager: innstilling.kunHverdager,
      });

      if (!vindu.aapen) {
        return {
          tillatt: false,
          grunn: vindu.grunn,
          type: null,
          sperreGrunn: null,
          sperreId: null,
          sjekket,
        };
      }
    }
  }

  // 4. Oppvarming og volum. Begge gjelder alltid, nå som avsenderen er påkrevd.
  sjekket.push("oppvarming");
  const oppvarming = await sjekkOppvarming(avsenderId, naa);

  if (!oppvarming.tillatt) {
    return {
      tillatt: false,
      grunn: oppvarming.grunn,
      type: null,
      sperreGrunn: null,
      sperreId: null,
      sjekket,
    };
  }

  sjekket.push("volum");
  const volum = await sjekkVolum(avsenderId, naa);

  if (!volum.tillatt) {
    return {
      tillatt: false,
      grunn: volum.grunn,
      type: null,
      sperreGrunn: null,
      sperreId: null,
      sjekket,
    };
  }

  // Oppvarmingskvoten kan være lavere enn døgnkvoten. Begge skal gjelde.
  if (!oppvarming.ferdigOppvarmet && volum.sendtIDag >= oppvarming.kvoteIDag) {
    return {
      tillatt: false,
      grunn: `Oppvarmingskvoten er brukt opp: ${volum.sendtIDag} av ${oppvarming.kvoteIDag} på dag ${oppvarming.dag}.`,
      type: null,
      sperreGrunn: null,
      sperreId: null,
      sjekket,
    };
  }

  return {
    tillatt: true,
    grunn: `Alle sjekker passerte: ${sjekket.join(", ")}.`,
    type: null,
    sperreGrunn: null,
    sperreId: null,
    sjekket,
  };
}
