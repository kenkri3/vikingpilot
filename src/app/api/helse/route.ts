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
import { utgaaendeStatus } from "@/lib/kanaler/innstillinger";
import { forMangeForesporsler, klientNokkel, rateLimitAktiv, sjekkRateLimit } from "@/lib/ratelimit";
import { vask } from "@/lib/logg";

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
    // Vi vasker meldingen. En rå Prisma-feil kan inneholde vertsnavn og annet
    // vi ikke vil gi en uautentisert kalleren. `vask()` maskerer
    // tilkoblingsstrenger og felter som ser hemmelige ut.
    databaseFeil = String(vask(feil instanceof Error ? feil.message : String(feil)));
  }

  const integrasjoner = integrasjonsstatus();

  // Utgående status LESES fra databasen. Vi påstår ikke at alt er av — vi
  // sjekker det. Det var en feil at dette sto som en streng.
  let utgaaende: { noenAapne: boolean; aapne: string[]; antall: number; feil?: string };

  try {
    const status = await utgaaendeStatus();
    utgaaende = {
      noenAapne: status.noenAapne,
      aapne: status.aapne,
      antall: status.antall,
    };
  } catch {
    utgaaende = {
      noenAapne: true,
      aapne: [],
      antall: -1,
      feil: "Kunne ikke lese kanalstatus. Antar det verste: at noe kan sendes.",
    };
  }

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
    utgaaende,
  };

  return NextResponse.json(svar, { status: database === "ok" ? 200 : 503 });
}
