/**
 * Utsending.
 *
 * Dette er den eneste kodeveien i systemet som fører til en mottaker. Derfor er
 * den også den mest forsiktige.
 *
 * Rekkefølgen er ikke tilfeldig:
 *
 *   1. Er meldingen godkjent av et menneske?   Godkjenningskøen
 *   2. Er kanalen konfigurert?                 EPOST_KANAL
 *   3. Passerer den alle guardrails?           kanSende()
 *   4. Er idempotensnøkkelen ledig?            Unik indeks i databasen
 *   5. Send.
 *
 * Sjekk 4 kommer rett før sending, ikke tidligere. Det er den siste porten, og
 * den eneste som er atomisk.
 *
 * Er e-postkanalen ikke konfigurert, sier vi det tydelig og gjør ingenting.
 * Vi later aldri som vi har sendt noe.
 */

import { prisma } from "@/lib/db";
import { feilmelding, logg } from "@/lib/logg";
import { integrasjon } from "@/lib/config";
import { kanSende } from "@/lib/guards/automatisk";
import {
  byggIdempotensNokkel,
  provAaReservere,
  merkAvvist,
  merkFeilet,
  merkSendt,
} from "@/lib/guards/idempotens";
import { erKlarTilSending } from "@/lib/godkjenning/ko";
import { skrivRevisjon } from "@/lib/revisjon";

export type SendUtfall =
  | "SENDT"
  | "IKKE_GODKJENT"
  | "IKKE_KONFIGURERT"
  | "AVVIST_AV_GUARDRAIL"
  | "ALLEREDE_SENDT"
  | "FEILET";

export type SendResultat = {
  dialogMeldingId: string;
  utfall: SendUtfall;
  grunn: string;
  utsendingId?: string;
};

/**
 * Forsøker å sende én godkjent melding.
 *
 * Kalles av utsendingsjobben. Gjør ingenting hvis noe ikke stemmer.
 */
export async function sendMelding(
  dialogMeldingId: string,
  valg: { torrkjoering: boolean; naa?: Date; avsenderId?: string | null },
): Promise<SendResultat> {
  const naa = valg.naa ?? new Date();

  const melding = await prisma.dialogMelding.findUnique({
    where: { id: dialogMeldingId },
    include: {
      godkjenning: true,
      dialog: { include: { kontakt: true } },
    },
  });

  if (!melding) {
    return {
      dialogMeldingId,
      utfall: "FEILET",
      grunn: `Fant ingen dialogmelding med id ${dialogMeldingId}.`,
    };
  }

  // 1. Er den godkjent av et menneske?
  if (!melding.godkjenning) {
    return {
      dialogMeldingId,
      utfall: "IKKE_GODKJENT",
      grunn: "Meldingen har ingen godkjenning. Alt med ekstern konsekvens går gjennom køen.",
    };
  }

  const klar = await erKlarTilSending(melding.godkjenning.id);

  if (!klar.klar) {
    return { dialogMeldingId, utfall: "IKKE_GODKJENT", grunn: klar.grunn };
  }

  // 2. Er kanalen konfigurert? Dette er ikke det samme som at den er slått på.
  const epostStatus = integrasjon("epost");
  const kanal = (process.env.EPOST_KANAL ?? "").trim().toLowerCase();

  if (!epostStatus.konfigurert || kanal === "") {
    const mangler = epostStatus.manglendeNokler.join(", ") || "EPOST_KANAL";
    return {
      dialogMeldingId,
      utfall: "IKKE_KONFIGURERT",
      grunn: `E-postkanalen er ikke konfigurert. Mangler: ${mangler}. Ingenting er sendt. Se docs/manuell-oppsett.md, del C3.`,
    };
  }

  const kontakt = melding.dialog.kontakt;

  if (!kontakt?.epost) {
    return {
      dialogMeldingId,
      utfall: "FEILET",
      grunn: "Kontakten har ingen e-postadresse.",
    };
  }

  // 3. Guardrails.
  const lov = await kanSende({
    kanal: "EPOST",
    epost: kontakt.epost,
    kontaktId: kontakt.id,
    organisasjonId: kontakt.organisasjonId,
    avsenderId: valg.avsenderId ?? null,
    naa,
  });

  if (!lov.tillatt) {
    await skrivRevisjon({
      handling: "UTSENDING_AVVIST",
      aktor: "SYSTEMET",
      aktorType: "SYSTEMET",
      entitet: "DialogMelding",
      entitetId: dialogMeldingId,
      kanal: "EPOST",
      grunnlag: lov.grunn,
      resultat: "Avvist av guardrail",
      resultatStatus: "avvist",
      kilde: "sekvens/utsending",
      metadata: { sjekket: lov.sjekket },
    });

    return { dialogMeldingId, utfall: "AVVIST_AV_GUARDRAIL", grunn: lov.grunn };
  }

  // 4. Idempotens — den siste, atomiske porten.
  const nokkelDel = {
    kanal: "EPOST" as const,
    kontaktId: kontakt.id,
    organisasjonId: kontakt.organisasjonId,
    dialogMeldingId,
    torrkjoering: valg.torrkjoering,
  };

  // Tørrkjøring skal ikke reservere den ekte nøkkelen. Vi sjekker derfor om den
  // ekte nøkkelen allerede finnes, uten å ta den.
  if (valg.torrkjoering) {
    const ekteNokkel = byggIdempotensNokkel({ ...nokkelDel, torrkjoering: false });
    const finnes = await prisma.utsending.findUnique({
      where: { idempotensNokkel: ekteNokkel },
      select: { id: true, status: true },
    });

    if (finnes) {
      return {
        dialogMeldingId,
        utfall: "ALLEREDE_SENDT",
        grunn: `Tørrkjøring: meldingen er allerede registrert med status ${finnes.status}. Ville ikke sendt.`,
      };
    }

    return {
      dialogMeldingId,
      utfall: "SENDT",
      grunn: `Tørrkjøring: ville sendt «${melding.emne ?? "(uten emne)"}» til ${kontakt.epost}. Ingenting er sendt.`,
    };
  }

  const reservasjon = await provAaReservere(nokkelDel, {
    avsenderId: valg.avsenderId ?? null,
  });

  if (!reservasjon.reservert) {
    return {
      dialogMeldingId,
      utfall: "ALLEREDE_SENDT",
      grunn: reservasjon.grunn,
      utsendingId: reservasjon.utsendingId ?? undefined,
    };
  }

  const utsendingId = reservasjon.utsendingId;

  // 5. Send.
  try {
    const resultat = await leverTilKanal({
      kanal,
      til: kontakt.epost,
      emne: melding.emne ?? "",
      tekst: melding.tekst,
    });

    if (!resultat.ok) {
      await merkFeilet(utsendingId, resultat.feil);
      await prisma.dialogMelding.update({
        where: { id: dialogMeldingId },
        data: { status: "FEILET", feilmelding: resultat.feil },
      });

      await skrivRevisjon({
        handling: "UTSENDING_FEILET",
        aktor: "SYSTEMET",
        entitet: "DialogMelding",
        entitetId: dialogMeldingId,
        kanal: "EPOST",
        grunnlag: resultat.feil,
        resultat: "Feilet",
        resultatStatus: "feilet",
        kilde: "sekvens/utsending",
      });

      return { dialogMeldingId, utfall: "FEILET", grunn: resultat.feil, utsendingId };
    }

    await merkSendt(utsendingId, resultat.eksternId ?? null);
    await prisma.dialogMelding.update({
      where: { id: dialogMeldingId },
      data: { status: "SENDT", sendtTid: new Date(), eksternId: resultat.eksternId ?? null },
    });

    await skrivRevisjon({
      handling: "UTSENDING_SENDT",
      aktor: "SYSTEMET",
      entitet: "DialogMelding",
      entitetId: dialogMeldingId,
      kanal: "EPOST",
      grunnlag: `Godkjent av ${melding.godkjenning.status}. Alle guardrails passerte.`,
      resultat: `Sendt til ${kontakt.epost}`,
      resultatStatus: "ok",
      kilde: "sekvens/utsending",
      metadata: { utsendingId, eksternId: resultat.eksternId ?? null },
    });

    logg.info("Utsending sendt", { dialogMeldingId, utsendingId });

    return { dialogMeldingId, utfall: "SENDT", grunn: "Sendt.", utsendingId };
  } catch (feil) {
    const melding2 = feilmelding(feil);
    await merkFeilet(utsendingId, melding2);
    logg.feil("Utsending kastet", { dialogMeldingId, feil });
    return { dialogMeldingId, utfall: "FEILET", grunn: melding2, utsendingId };
  }
}

/**
 * Leverer til selve kanalen.
 *
 * Denne funksjonen er med vilje en stubbe så lenge `EPOST_KANAL` ikke er satt.
 * Vi finner ikke på en levering. Er kanalen satt, men vi ennå ikke har bygget
 * selve integrasjonen, sier vi det også tydelig.
 */
async function leverTilKanal(args: {
  kanal: string;
  til: string;
  emne: string;
  tekst: string;
}): Promise<{ ok: true; eksternId?: string } | { ok: false; feil: string }> {
  void args;
  return {
    ok: false,
    feil:
      "Selve e-postutsendingen er ikke bygget ennå. Kanalen er konfigurert, men " +
      "integrasjonen mangler. Se docs/plan.md, fase 4. Ingenting er sendt.",
  };
}

/**
 * Kjører utsendingsjobben: finn godkjente meldinger og send dem.
 *
 * Tørrkjøring er standard. Den rapporterer hva den ville gjort.
 */
export async function kjoerUtsending(valg: {
  torrkjoering: boolean;
  maks?: number;
  naa?: Date;
  avsenderId?: string | null;
}): Promise<{
  vurdert: number;
  sendt: number;
  avvist: number;
  ikkeKonfigurert: number;
  feilet: number;
  resultater: SendResultat[];
}> {
  const maks = Math.min(valg.maks ?? 50, 200);

  // Bare meldinger som står i kø som godkjent og ikke er sendt.
  const klare = await prisma.dialogMelding.findMany({
    where: {
      status: "GODKJENT",
      godkjenning: { status: "GODKJENT" },
    },
    orderBy: { oppdatert: "asc" },
    take: maks,
    select: { id: true },
  });

  const resultater: SendResultat[] = [];
  let sendt = 0;
  let avvist = 0;
  let ikkeKonfigurert = 0;
  let feilet = 0;

  for (const m of klare) {
    const resultat = await sendMelding(m.id, {
      torrkjoering: valg.torrkjoering,
      naa: valg.naa,
      avsenderId: valg.avsenderId ?? null,
    });

    resultater.push(resultat);

    switch (resultat.utfall) {
      case "SENDT":
        sendt += 1;
        break;
      case "AVVIST_AV_GUARDRAIL":
        avvist += 1;
        break;
      case "IKKE_KONFIGURERT":
        ikkeKonfigurert += 1;
        break;
      case "FEILET":
        feilet += 1;
        break;
      default:
        break;
    }
  }

  return { vurdert: klare.length, sendt, avvist, ikkeKonfigurert, feilet, resultater };
}
