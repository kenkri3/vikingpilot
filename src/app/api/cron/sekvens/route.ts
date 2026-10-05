/**
 * Cron: sekvensmotoren.
 *
 * Kjører aktive sekvenser og legger utkast i godkjenningskøen.
 *
 * DENNE JOBBEN SENDER INGENTING. Den fyller køen. Ingenting går ut før et
 * menneske har godkjent det, og en egen jobb sender det.
 *
 * Kjør med:
 *   GET /api/cron/sekvens                       tørrkjøring
 *   GET /api/cron/sekvens?torrkjoering=false    ekte kjøring
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { feilmelding, logg } from "@/lib/logg";
import { forMangeForesporsler, klientNokkel, sjekkRateLimit } from "@/lib/ratelimit";
import { sjekkHemmelighet, vilTorrkjoere } from "@/lib/cron/felles";
import { kjoerAlle, startSekvenser } from "@/lib/sekvens/motor";
import { koStatus } from "@/lib/godkjenning/ko";
import { skrivRevisjon } from "@/lib/revisjon";

export const dynamic = "force-dynamic";

const NAVN = "sekvens";

export async function POST(request: Request): Promise<Response> {
  return handter(request);
}

export async function GET(request: Request): Promise<Response> {
  return handter(request);
}

async function handter(request: Request): Promise<Response> {
  const startet = Date.now();

  const grense = sjekkRateLimit(klientNokkel(request.headers, `cron:${NAVN}`), 30, 60_000);
  if (!grense.tillatt) return forMangeForesporsler(grense);

  const hemmelighet = sjekkHemmelighet(request, "CRON_SECRET_SEKVENS");
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
    // Først: start sekvenser for prospekter som er klare for det.
    const oppstart = await startSekvenser({ torrkjoering, naa: new Date() });

    // Deretter: kjør neste steg for alle aktive sekvenser.
    const resultat = await kjoerAlle({ torrkjoering, naa: new Date() });
    const ko = await koStatus();

    const melding = torrkjoering
      ? `Tørrkjøring. Ville startet ${oppstart.vurdert} nye sekvenser, og vurdert ${resultat.vurdert} aktive. Ville laget ${resultat.utkast} utkast. Ingenting er skrevet.`
      : `Startet ${oppstart.startet} nye sekvenser. Vurderte ${resultat.vurdert} aktive, laget ${resultat.utkast} utkast i køen, ${resultat.venter} venter på tur.`;

    await prisma.cronKjoering.update({
      where: { id: kjoering.id },
      data: {
        status: torrkjoering ? "TORRKJORT" : "FULLFOERT",
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        antallUtfort: torrkjoering ? 0 : resultat.utkast,
        melding,
        detaljer: {
          oppstart,
          vurdert: resultat.vurdert,
          utkast: resultat.utkast,
          venter: resultat.venter,
          andre: resultat.andre,
          ko,
        },
      },
    });

    await prisma.cronJobb.updateMany({
      where: { navn: NAVN },
      data: { sisteKjoering: new Date(), sisteStatus: "FULLFOERT", sisteFeil: null },
    });

    await skrivRevisjon({
      handling: "SEKVENS_KJORT",
      aktor: "SYSTEMET",
      aktorType: "SYSTEMET",
      entitet: "CronKjoering",
      entitetId: kjoering.id,
      grunnlag: `Cron-jobb ${NAVN}, ${torrkjoering ? "tørrkjøring" : "ekte kjøring"}.`,
      resultat: melding,
      resultatStatus: torrkjoering ? "torrkjoert" : "ok",
      kilde: `api/cron/${NAVN}`,
      metadata: { ...resultat, resultater: undefined },
    });

    logg.info("Sekvensjobb kjørte", { jobb: NAVN, torrkjoering, ...resultat, resultater: undefined });

    return NextResponse.json({
      jobb: NAVN,
      torrkjoering,
      status: torrkjoering ? "torrkjoert" : "fullfoert",
      melding,
      oppstart,
      vurdert: resultat.vurdert,
      utkast: resultat.utkast,
      venter: resultat.venter,
      andre: resultat.andre,
      ko,
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

    logg.feil("Sekvensjobb feilet", { jobb: NAVN, feil });

    return NextResponse.json({ jobb: NAVN, status: "feilet", feilmelding: melding }, { status: 500 });
  }
}
