/**
 * Helsesjekk.
 *
 * Åpent endepunkt, derfor rate limiting.
 *
 * Svarer 200 når systemet virker, 503 når databasen ikke svarer. Den sier alltid
 * sannheten om hva som er konfigurert — den later aldri som noe virker.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { integrasjonsstatus } from "@/lib/config";
import { forMangeForesporsler, klientNokkel, rateLimitAktiv, sjekkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (rateLimitAktiv()) {
    const grense = sjekkRateLimit(klientNokkel(request.headers, "helse"), 60, 60_000);
    if (!grense.tillatt) {
      return forMangeForesporsler(grense);
    }
  }

  let database = "ok";
  let databaseFeil: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (feil) {
    database = "feil";
    // Vi viser meldingen, men den inneholder aldri tilkoblingsadressen —
    // Prisma oppgir vert og database, ikke passord.
    databaseFeil = feil instanceof Error ? feil.message : String(feil);
  }

  const integrasjoner = integrasjonsstatus();

  const svar = {
    status: database === "ok" ? "ok" : "degradert",
    tid: new Date().toISOString(),
    database: {
      status: database,
      feil: databaseFeil,
    },
    integrasjoner: integrasjoner.map((i) => ({
      navn: i.navn,
      konfigurert: i.konfigurert,
      manglendeNokler: i.manglendeNokler,
    })),
    utgaaende: {
      // Systemet sier alltid sannheten om dette. Standard er av.
      standard: "av",
      merknad:
        "All utgående trafikk er av til et menneske slår den på, per kanal. Se dashbordet.",
    },
  };

  return NextResponse.json(svar, { status: database === "ok" ? 200 : 503 });
}
