/**
 * Sekvensmotoren.
 *
 * Modul 5, bøtte 1. Sekvensene er data, ikke kode. Motoren velger neste steg,
 * regner ut når det skal skje, og legger et utkast i godkjenningskøen.
 *
 * DET VIKTIGSTE DESIGNVALGET: motoren sender aldri noe. Den lager et utkast og
 * legger det i køen. Ingen vei herfra fører til en mottaker. Det er den
 * ufravikelige arkitekturregelen: alt med ekstern konsekvens går gjennom køen.
 *
 * Ventetiden er deterministisk. Den ligger i `SekvensSteg.ventetidTimer`, og
 * agenten kan ikke velge å vente kortere.
 */

import { prisma } from "@/lib/db";
import { logg } from "@/lib/logg";
import { leggIForslag } from "@/lib/godkjenning/ko";

export type StegPlan = {
  stegKjoeringId: string;
  stegId: string;
  rekkefolge: number;
  navn: string;
  type: string;
  kanal: string;
  /** Når steget tidligst skal kjøres. */
  planlagtTid: Date;
  /** Er det på tide? */
  klar: boolean;
  /** Forklaring i klartekst. */
  grunn: string;
};

export type SekvensPlan = {
  prospektSekvensId: string;
  prospektId: string;
  versjonId: string;
  nesteSteg: StegPlan | null;
  antallSteg: number;
  antallUtfort: number;
  grunn: string;
};

const TIMER_MS = 3_600_000;

/**
 * Steg som er FERDIG BEHANDLET av motoren.
 *
 * MERK: `VENTER_GODKJENNING` teller som ferdig her. Det er et bevisst valg.
 * Steget er utført i den forstand at motoren har laget utkastet og lagt det i
 * køen. Om et menneske godkjenner det eller ikke, er en egen sak — og et utkast
 * som blir liggende i køen skal ikke stoppe resten av sekvensen for alltid.
 * Ventetiden regnes uansett fra `utfortTid`, altså fra steget faktisk kjørte.
 */
const FERDIG_BEHANDLET = ["SENDT", "HOPPET_OVER", "AVBRUTT", "VENTER_GODKJENNING"];

/**
 * Regner ut når et steg tidligst skal kjøres.
 *
 * Stegene er kjedet: steg N venter `ventetidTimer` etter at steg N-1 faktisk
 * ble utført. Har forrige steg ikke kjørt ennå, venter vi på det. Det gjør at
 * en forsinket kjøring ikke komprimerer hele sekvensen.
 *
 * Er ingen steg utført ennå, regnes ventetiden fra sekvensen startet.
 */
export function regnPlanlagtTid(
  start: Date,
  steg: { rekkefolge: number; ventetidTimer: number },
  utforteSteg: { rekkefolge: number; utfortTid: Date | null }[],
): Date {
  const tidligereUtfort = utforteSteg
    .filter((u) => u.rekkefolge < steg.rekkefolge && u.utfortTid !== null)
    .sort((a, b) => b.rekkefolge - a.rekkefolge);

  const siste = tidligereUtfort[0];

  if (siste?.utfortTid) {
    return new Date(siste.utfortTid.getTime() + steg.ventetidTimer * TIMER_MS);
  }

  return new Date(start.getTime() + steg.ventetidTimer * TIMER_MS);
}

/**
 * Bygger en plan for én sekvenskjøring: hva er neste steg, og når?
 *
 * Leser, endrer ingenting. Er neste steg klart, sier vi det. Er det ikke klart,
 * sier vi hvor lenge det er igjen.
 */
export async function planlegg(
  prospektSekvensId: string,
  naa: Date = new Date(),
): Promise<SekvensPlan | null> {
  const kjoring = await prisma.prospektSekvens.findUnique({
    where: { id: prospektSekvensId },
    include: {
      steg: { orderBy: { steg: { rekkefolge: "asc" } } },
      versjon: { include: { steg: { orderBy: { rekkefolge: "asc" } } } },
    },
  });

  if (!kjoring) return null;

  const alleSteg = kjoring.versjon.steg;

  if (kjoring.status !== "AKTIV") {
    return {
      prospektSekvensId,
      prospektId: kjoring.prospektId,
      versjonId: kjoring.versjonId,
      nesteSteg: null,
      antallSteg: alleSteg.length,
      antallUtfort: kjoring.steg.filter((s) => FERDIG_BEHANDLET.includes(s.status)).length,
      grunn: `Sekvensen står som ${kjoring.status}.`,
    };
  }

  const utforte = kjoring.steg
    .map((k) => ({
      rekkefolge: alleSteg.find((s) => s.id === k.stegId)?.rekkefolge ?? 0,
      utfortTid: k.utfortTid,
      status: k.status,
    }))
    .filter((u) => u.utfortTid !== null);

  const ferdige = new Set(
    kjoring.steg.filter((k) => FERDIG_BEHANDLET.includes(k.status)).map((k) => k.stegId),
  );

  const neste = alleSteg.find((s) => !ferdige.has(s.id));

  if (!neste) {
    return {
      prospektSekvensId,
      prospektId: kjoring.prospektId,
      versjonId: kjoring.versjonId,
      nesteSteg: null,
      antallSteg: alleSteg.length,
      antallUtfort: kjoring.steg.filter((s) => s.status === "SENDT").length,
      grunn: "Alle steg er utført.",
    };
  }

  const planlagtTid = regnPlanlagtTid(kjoring.startet, neste, utforte);
  const klar = planlagtTid.getTime() <= naa.getTime();

  const minutterIgjen = Math.round((planlagtTid.getTime() - naa.getTime()) / 60_000);

  return {
    prospektSekvensId,
    prospektId: kjoring.prospektId,
    versjonId: kjoring.versjonId,
    nesteSteg: {
      stegKjoeringId: "",
      stegId: neste.id,
      rekkefolge: neste.rekkefolge,
      navn: neste.navn,
      type: neste.type,
      kanal: neste.kanal,
      planlagtTid,
      klar,
      grunn: klar
        ? `Steg ${neste.rekkefolge} «${neste.navn}» er klart.`
        : `Steg ${neste.rekkefolge} «${neste.navn}» er klart om ${minutterIgjen} minutter.`,
    },
    antallSteg: alleSteg.length,
    antallUtfort: kjoring.steg.filter((s) => s.status === "SENDT").length,
    grunn: klar ? "Neste steg er klart." : `Venter ${minutterIgjen} minutter.`,
  };
}

export type KjoerResultat = {
  prospektSekvensId: string;
  prospektId: string;
  utfall: "UTKAST_LAGET" | "VENTER" | "AVSLUTTET" | "INGEN_MOTTAKER" | "FEILET" | "IKKE_AKTIV";
  grunn: string;
  godkjenningId?: string;
  dialogMeldingId?: string;
};

/**
 * Kjører neste steg for én sekvenskjøring.
 *
 * LAGER UTKAST OG LEGGER I KØ. Sender ingenting.
 *
 * Er `torrkjoering` sann, gjør vi ingenting annet enn å rapportere hva vi ville
 * gjort. Ingen rader skrives.
 */
export async function kjoerSteg(
  prospektSekvensId: string,
  valg: { torrkjoering: boolean; naa?: Date },
): Promise<KjoerResultat> {
  const naa = valg.naa ?? new Date();
  const plan = await planlegg(prospektSekvensId, naa);

  if (!plan) {
    return {
      prospektSekvensId,
      prospektId: "",
      utfall: "FEILET",
      grunn: "Fant ingen sekvenskjøring med den id-en.",
    };
  }

  if (!plan.nesteSteg) {
    return {
      prospektSekvensId,
      prospektId: plan.prospektId,
      utfall: plan.antallUtfort === plan.antallSteg ? "AVSLUTTET" : "IKKE_AKTIV",
      grunn: plan.grunn,
    };
  }

  if (!plan.nesteSteg.klar) {
    return {
      prospektSekvensId,
      prospektId: plan.prospektId,
      utfall: "VENTER",
      grunn: plan.nesteSteg.grunn,
    };
  }

  const steg = plan.nesteSteg;
  const kjoring = await prisma.prospektSekvens.findUnique({
    where: { id: prospektSekvensId },
    include: { prospekt: { include: { kontakt: true, organisasjon: true } } },
  });

  if (!kjoring) {
    return {
      prospektSekvensId,
      prospektId: plan.prospektId,
      utfall: "FEILET",
      grunn: "Sekvenskjøringen forsvant underveis.",
    };
  }

  // Uten en kontakt å sende til, er det ingenting å lage utkast for.
  const kontakt = kjoring.prospekt.kontakt;

  if (!kontakt) {
    if (!valg.torrkjoering) {
      await prisma.stegKjoering.upsert({
        where: { prospektSekvensId_stegId: { prospektSekvensId, stegId: steg.stegId } },
        update: { status: "HOPPET_OVER", utfortTid: naa, resultat: "Ingen kontakt på prospektet." },
        create: {
          prospektSekvensId,
          stegId: steg.stegId,
          status: "HOPPET_OVER",
          planlagtTid: steg.planlagtTid,
          utfortTid: naa,
          resultat: "Ingen kontakt på prospektet.",
        },
      });
    }

    return {
      prospektSekvensId,
      prospektId: plan.prospektId,
      utfall: "INGEN_MOTTAKER",
      grunn: "Prospektet har ingen kontakt med e-postadresse. Steget hoppes over.",
    };
  }

  // Steg som ikke er e-post: vi lager en oppgave i stedet for et utkast.
  if (steg.type !== "EPOST") {
    if (valg.torrkjoering) {
      return {
        prospektSekvensId,
        prospektId: plan.prospektId,
        utfall: "UTKAST_LAGET",
        grunn: `Tørrkjøring: ville opprettet en ${steg.type}-oppgave for «${steg.navn}».`,
      };
    }

    await prisma.oppgave.create({
      data: {
        tittel: `${steg.navn} — ${kjoring.prospekt.organisasjon?.navn ?? "ukjent"}`,
        beskrivelse: `Opprettet av sekvenssteget «${steg.navn}».`,
        kontaktId: kontakt.id,
        prospektId: plan.prospektId,
      },
    });

    await prisma.stegKjoering.upsert({
      where: { prospektSekvensId_stegId: { prospektSekvensId, stegId: steg.stegId } },
      update: { status: "SENDT", utfortTid: naa, resultat: "Oppgave opprettet." },
      create: {
        prospektSekvensId,
        stegId: steg.stegId,
        status: "SENDT",
        planlagtTid: steg.planlagtTid,
        utfortTid: naa,
        resultat: "Oppgave opprettet.",
      },
    });

    return {
      prospektSekvensId,
      prospektId: plan.prospektId,
      utfall: "UTKAST_LAGET",
      grunn: `Oppgave opprettet for steget «${steg.navn}».`,
    };
  }

  // E-poststeget. Her lages utkastet.
  const versjonSteg = await prisma.sekvensSteg.findUnique({ where: { id: steg.stegId } });

  const emne = versjonSteg?.emneMal ?? `Oppfølging: ${versjonSteg?.navn ?? steg.navn}`;
  const tekst =
    versjonSteg?.innholdMal ??
    "Mal mangler. Agenten skriver innholdet innenfor rammene systemet setter.";

  if (valg.torrkjoering) {
    return {
      prospektSekvensId,
      prospektId: plan.prospektId,
      utfall: "UTKAST_LAGET",
      grunn: `Tørrkjøring: ville laget utkast til ${kontakt.epost ?? "kontakten"} på steg ${steg.rekkefolge} «${steg.navn}», og lagt det i godkjenningskøen.`,
    };
  }

  // Funn eller opprett dialog.
  const dialog =
    (await prisma.dialog.findFirst({
      where: { kontaktId: kontakt.id, kanal: "EPOST", aktiv: true },
      orderBy: { opprettet: "desc" },
    })) ??
    (await prisma.dialog.create({
      data: { kontaktId: kontakt.id, emne, kanal: "EPOST", aktiv: true },
    }));

  const melding = await prisma.dialogMelding.create({
    data: {
      dialogId: dialog.id,
      retning: "UT",
      kanal: "EPOST",
      emne,
      tekst,
      status: "VENTER_GODKJENNING",
    },
  });

  const forslag = await leggIForslag({
    type: "UTKAST",
    tittel: `Utkast: ${emne}`,
    begrunnelse: `Sekvenssteg ${steg.rekkefolge} «${steg.navn}» for ${kjoring.prospekt.organisasjon?.navn ?? "ukjent virksomhet"}.`,
    gjelder: `DialogMelding ${melding.id}`,
    kanal: "EPOST",
    kontaktId: kontakt.id,
    organisasjonId: kjoring.prospekt.organisasjonId,
    dialogMeldingId: melding.id,
    risiko: "Ingen — dette er et internt utkast som ikke er sendt.",
    forslagFra: "SYSTEMET",
  });

  await prisma.stegKjoering.upsert({
    where: { prospektSekvensId_stegId: { prospektSekvensId, stegId: steg.stegId } },
    update: {
      status: "VENTER_GODKJENNING",
      planlagtTid: steg.planlagtTid,
      utfortTid: naa,
      resultat: `Utkast lagt i kø som ${forslag.id}.`,
    },
    create: {
      prospektSekvensId,
      stegId: steg.stegId,
      status: "VENTER_GODKJENNING",
      planlagtTid: steg.planlagtTid,
      utfortTid: naa,
      resultat: `Utkast lagt i kø som ${forslag.id}.`,
    },
  });

  logg.info("Sekvenssteg kjørte og la utkast i køen", {
    prospektSekvensId,
    steg: steg.rekkefolge,
    godkjenningId: forslag.id,
  });

  return {
    prospektSekvensId,
    prospektId: plan.prospektId,
    utfall: "UTKAST_LAGET",
    grunn: `Utkast lagt i godkjenningskøen.`,
    godkjenningId: forslag.id,
    dialogMeldingId: melding.id,
  };
}

/**
 * Starter sekvenser for prospekter som er klare for det.
 *
 * En sekvenskjøring opprettes bare hvis:
 *   - prospektet har status NY eller KVALIFISERT
 *   - prospektet har en kontakt med e-postadresse
 *   - det ikke allerede løper en aktiv sekvens for prospektet
 *
 * Uten en kontakt å sende til er det ingenting å starte. Enhetsregisteret
 * oppgir virksomheter, ikke e-postadresser — så kontaktene må komme fra en
 * annen kilde. Inntil videre sier vi det som det er.
 */
export async function startSekvenser(valg: {
  torrkjoering: boolean;
  maks?: number;
  naa?: Date;
}): Promise<{
  vurdert: number;
  startet: number;
  utenKontakt: number;
  alleredeAktiv: number;
  utenVersjon: boolean;
}> {
  const maks = Math.min(valg.maks ?? 50, 200);

  // Den aktive versjonen. Uten den kan vi ikke starte noe.
  const versjon = await prisma.sekvensVersjon.findFirst({
    where: { aktiv: true, sekvens: { aktiv: true } },
    orderBy: { versjon: "desc" },
    select: { id: true },
  });

  if (!versjon) {
    return { vurdert: 0, startet: 0, utenKontakt: 0, alleredeAktiv: 0, utenVersjon: true };
  }

  const kandidater = await prisma.prospekt.findMany({
    where: {
      status: { in: ["NY", "KVALIFISERT"] },
      kontaktId: { not: null },
      sekvenser: { none: { status: "AKTIV" } },
    },
    take: maks,
    select: { id: true, kontaktId: true },
  });

  // Prospekter som mangler kontakt, telles separat — det er den vanligste grunnen.
  const utenKontakt = await prisma.prospekt.count({
    where: { status: { in: ["NY", "KVALIFISERT"] }, kontaktId: null },
  });

  const alleredeAktiv = await prisma.prospektSekvens.count({ where: { status: "AKTIV" } });

  if (valg.torrkjoering) {
    return {
      vurdert: kandidater.length,
      startet: 0,
      utenKontakt,
      alleredeAktiv,
      utenVersjon: false,
    };
  }

  let startet = 0;

  for (const kandidat of kandidater) {
    try {
      await prisma.prospektSekvens.create({
        data: {
          prospektId: kandidat.id,
          versjonId: versjon.id,
          status: "AKTIV",
        },
      });

      await prisma.prospekt.update({
        where: { id: kandidat.id },
        data: { status: "I_SEKVENS" },
      });

      startet += 1;
    } catch {
      // Én dårlig rad skal ikke velte hele kjøringen.
    }
  }

  return { vurdert: kandidater.length, startet, utenKontakt, alleredeAktiv, utenVersjon: false };
}

/**
 * Kjører alle aktive sekvenser som har et steg klart.
 *
 * Dette er jobben cron kaller. Den sender ingenting — den fyller køen.
 */
export async function kjoerAlle(valg: {
  torrkjoering: boolean;
  maks?: number;
  naa?: Date;
}): Promise<{
  vurdert: number;
  utkast: number;
  venter: number;
  andre: number;
  resultater: KjoerResultat[];
}> {
  const naa = valg.naa ?? new Date();
  const maks = Math.min(valg.maks ?? 50, 500);

  const aktive = await prisma.prospektSekvens.findMany({
    where: { status: "AKTIV" },
    orderBy: { startet: "asc" },
    take: maks,
    select: { id: true },
  });

  const resultater: KjoerResultat[] = [];
  let utkast = 0;
  let venter = 0;
  let andre = 0;

  for (const k of aktive) {
    try {
      const resultat = await kjoerSteg(k.id, { torrkjoering: valg.torrkjoering, naa });
      resultater.push(resultat);

      if (resultat.utfall === "UTKAST_LAGET") utkast += 1;
      else if (resultat.utfall === "VENTER") venter += 1;
      else andre += 1;
    } catch (feil) {
      // Én dårlig sekvens skal ikke velte hele kjøringen.
      resultater.push({
        prospektSekvensId: k.id,
        prospektId: "",
        utfall: "FEILET",
        grunn: feil instanceof Error ? feil.message : String(feil),
      });
      andre += 1;
    }
  }

  return { vurdert: aktive.length, utkast, venter, andre, resultater };
}
