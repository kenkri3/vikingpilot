/**
 * Cron: utsending.
 *
 * DEN ENESTE ruten som kan føre til at noe når en mottaker.
 *
 * Den henter bare meldinger som allerede er godkjent av et menneske, og sender
 * dem gjennom hele guardrail-kjeden. Er e-postkanalen ikke konfigurert, sier den
 * det tydelig og gjør ingenting.
 *
 * Kjør med:
 *   GET /api/cron/utsending                       tørrkjøring
 *   GET /api/cron/utsending?torrkjoering=false    ekte kjøring
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { feilmelding, logg } from "@/lib/logg";
import { forMangeForesporsler, klientNokkel, sjekkRateLimit } from "@/lib/ratelimit";
import { sjekkHemmelighet, vilTorrkjoere } from "@/lib/cron/felles";
import { kjoerUtsending } from "@/lib/sekvens/utsending";
import { skrivRevisjon } from "@/lib/revisjon";

export const dynamic = "force-dynamic";

const NAVN = "utsending";

export async function POST(request: Request): Promise<Response> {
  return handter(request);
}

export async function GET(request: Request): Promise<Response> {
  return handter(request);
}

async function handter(request: Request): Promise<Response> {
  const startet = Date.now();

  const grense = sjekkRateLimit(klientNokkel(request.headers, `cron:${NAVN}`), 60, 60_000);
  if (!grense.tillatt) return forMangeForesporsler(grense);

  const hemmelighet = sjekkHemmelighet(request, "CRON_SECRET_UTSENDING");
  if (!hemmelighet.ok) {
    logg.advarsel("Cron avvist", { jobb: NAVN, grunn: hemmelighet.grunn });
    return NextResponse.json(
      { feil: "uautorisert", melding: hemmelighet.grunn },
      { status: hemmelighet.status },
    );
  }

  const torrkjoering = vilTorrkjoere(request);

  const kjoering = await prisma.cronKjoering.create({
    data: { navn: NAVN, status: "KJORER", torrkjoering },
  });

  try {
    const resultat = await kjoerUtsending({ torrkjoering, naa: new Date() });

    const melding =
      resultat.vurdert === 0
        ? "Ingen godkjente meldinger venter på sending."
        : resultat.avsenderId === null
          ? `Vurderte ${resultat.vurdert} godkjente meldinger, men ingen avsender er satt opp. Uten avsender kan ikke kvotene håndheves, og da sendes ingenting.`
          : torrkjoering
            ? `Tørrkjøring. Vurderte ${resultat.vurdert} godkjente meldinger, ville sendt ${resultat.sendt}. Ingenting er sendt.`
            : `Vurderte ${resultat.vurdert}. Sendt ${resultat.sendt}, avvist ${resultat.avvist}, ikke konfigurert ${resultat.ikkeKonfigurert}, feilet ${resultat.feilet}.`;

    await prisma.cronKjoering.update({
      where: { id: kjoering.id },
      data: {
        status: torrkjoering ? "TORRKJORT" : "FULLFOERT",
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        antallUtfort: resultat.sendt,
        antallFeil: resultat.feilet,
        melding,
        detaljer: {
          vurdert: resultat.vurdert,
          sendt: resultat.sendt,
          avvist: resultat.avvist,
          ikkeKonfigurert: resultat.ikkeKonfigurert,
          feilet: resultat.feilet,
        },
      },
    });

    await prisma.cronJobb.updateMany({
      where: { navn: NAVN },
      data: { sisteKjoering: new Date(), sisteStatus: "FULLFOERT", sisteFeil: null },
    });

    await skrivRevisjon({
      handling: "UTSENDING_KJORT",
      aktor: "SYSTEMET",
      aktorType: "SYSTEMET",
      entitet: "CronKjoering",
      entitetId: kjoering.id,
      kanal: "EPOST",
      grunnlag: `Cron-jobb ${NAVN}, ${torrkjoering ? "tørrkjøring" : "ekte kjøring"}.`,
      resultat: melding,
      resultatStatus: torrkjoering ? "torrkjoert" : "ok",
      kilde: `api/cron/${NAVN}`,
      metadata: {
        vurdert: resultat.vurdert,
        sendt: resultat.sendt,
        avvist: resultat.avvist,
        ikkeKonfigurert: resultat.ikkeKonfigurert,
      },
    });

    logg.info("Utsendingsjobb kjørte", { jobb: NAVN, torrkjoering, ...resultat, resultater: undefined });

    return NextResponse.json({
      jobb: NAVN,
      torrkjoering,
      status: torrkjoering ? "torrkjoert" : "fullfoert",
      melding,
      vurdert: resultat.vurdert,
      avsenderId: resultat.avsenderId,
      sendt: resultat.sendt,
      avvist: resultat.avvist,
      ikkeKonfigurert: resultat.ikkeKonfigurert,
      feilet: resultat.feilet,
      varighetMs: Date.now() - startet,
      resultater: resultat.resultater.slice(0, 20),
    });
  } catch (feil) {
    const melding = feilmelding(feil);

    await prisma.cronKjoering.update({
      where: { id: kjoering.id },
      data: {
        status: "FEILET",
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        antallFeil: 1,
        feilmelding: melding,
      },
    });

    await prisma.cronJobb.updateMany({
      where: { navn: NAVN },
      data: { sisteKjoering: new Date(), sisteStatus: "FEILET", sisteFeil: melding },
    });

    logg.feil("Utsendingsjobb feilet", { jobb: NAVN, feil });

    return NextResponse.json({ jobb: NAVN, status: "feilet", feilmelding: melding }, { status: 500 });
  }
}
