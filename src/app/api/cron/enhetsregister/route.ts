/**
 * Cron: Enhetsregister-pipeline.
 *
 * Tre ting oppdraget krever av hver cron-rute:
 *
 *   1. Egen hemmelighet. Mister vi denne, slutter bare denne jobben å virke.
 *   2. Tørrkjøringsmodus. Skal kunne kjøres uten å endre noe.
 *   3. Logging. Feiler jobben, skal den si det — ikke tie.
 *
 * Denne ruten henter foreløpig ingenting. Den sier ærlig at integrasjonen ikke
 * er konfigurert, og finner ikke på data. Selve hentingen bygges i fase 3.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { feilmelding, logg } from "@/lib/logg";
import { integrasjon } from "@/lib/config";
import { forMangeForesporsler, klientNokkel, sjekkRateLimit } from "@/lib/ratelimit";
import { sjekkHemmelighet, vilTorrkjoere } from "@/lib/cron/felles";

export const dynamic = "force-dynamic";

/** Navnet på jobben. Brukes i logg, revisjon og dashbord. */
const NAVN = "enhetsregister";

export async function POST(request: Request): Promise<Response> {
  return håndter(request);
}

/** GET støttes for enkel kjøring fra nettleser ved tørrkjøring. */
export async function GET(request: Request): Promise<Response> {
  return håndter(request);
}

async function håndter(request: Request): Promise<Response> {
  const startet = Date.now();

  // Rate limiting, også på cron. Hemmeligheten er ikke et frikort mot hamring.
  const grense = sjekkRateLimit(klientNokkel(request.headers, `cron:${NAVN}`), 30, 60_000);
  if (!grense.tillatt) {
    return forMangeForesporsler(grense);
  }

  const hemmelighet = sjekkHemmelighet(request, "CRON_SECRET_ENHETSREGISTER");
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
    const status = integrasjon("enhetsregisteret");

    if (!status.konfigurert) {
      // Dette er ikke en feil. Det er en ærlig tilstand.
      const melding = `Enhetsregisteret er ikke konfigurert. Mangler: ${status.manglendeNokler.join(", ")}. Ingenting hentet, og ingen data er funnet på.`;

      await prisma.cronKjoering.update({
        where: { id: kjoering.id },
        data: {
          status: torrkjoering ? "TORRKJORT" : "FULLFOERT",
          avsluttet: new Date(),
          varighetMs: Date.now() - startet,
          melding,
          antallUtfort: 0,
        },
      });

      await prisma.cronJobb.updateMany({
        where: { navn: NAVN },
        data: { sisteKjoering: new Date(), sisteStatus: "FULLFOERT" },
      });

      logg.info("Cron kjørte uten konfigurert integrasjon", { jobb: NAVN, mangler: status.manglendeNokler });

      return NextResponse.json({
        jobb: NAVN,
        torrkjoering,
        status: "ikke_konfigurert",
        melding,
        manglendeNokler: status.manglendeNokler,
        villeGjort: torrkjoering ? "Hentet nye selskaper og filtrert dem deterministisk." : null,
      });
    }

    // Konfigurert. Selve hentingen bygges i fase 3 — til da sier vi det som det er.
    const melding =
      "Integrasjonen er konfigurert, men hentingen er ikke bygget ennå. Se docs/plan.md, fase 3.";

    await prisma.cronKjoering.update({
      where: { id: kjoering.id },
      data: {
        status: torrkjoering ? "TORRKJORT" : "FULLFOERT",
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        melding,
      },
    });

    logg.info("Cron kjørte", { jobb: NAVN, torrkjoering });

    return NextResponse.json({ jobb: NAVN, torrkjoering, status: "ikke_bygget", melding });
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

    logg.feil("Cron feilet", { jobb: NAVN, feil });

    return NextResponse.json({ jobb: NAVN, status: "feilet", feilmelding: melding }, { status: 500 });
  }
}
