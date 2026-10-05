/**
 * Konstant-tids sammenligning av hemmeligheter.
 *
 * Ligger alene her fordi både cron-rutene og API-rutene trenger den. Å ha to
 * kopier av en sikkerhetsfunksjon er en måte å få én av dem feil på.
 *
 * Svartiden skal ikke røpe hvor mye av hemmeligheten som var riktig.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Sammenligner to strenger i konstant tid.
 *
 * Er lengdene ulike, sammenligner vi likevel — mot oss selv — slik at en
 * lengdeforskjell ikke gir kortere svartid.
 */
export function liktKonstantTid(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

export type HemmelighetResultat =
  | { ok: true }
  | { ok: false; grunn: string; status: number };

/**
 * Leser en hemmelighet fra en forespørsel.
 *
 * Godtar `Authorization: Bearer <hemmelighet>` og `?hemmelighet=`.
 * Query-varianten er praktisk for manuell kjøring, men havner i logger —
 * derfor anbefales headeren. Vi logger aldri verdien.
 */
export function lesHemmelighet(request: Request): string | null {
  const auth = request.headers.get("authorization");

  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const url = new URL(request.url);
  const fraQuery = url.searchParams.get("hemmelighet");

  return fraQuery ? fraQuery.trim() : null;
}

/**
 * Sjekker hemmeligheten mot en navngitt miljøvariabel.
 *
 * Er variabelen ikke satt, nekter vi. Vi gjetter aldri på en standardverdi —
 * en tom hemmelighet ville betydd at hvem som helst kunne kalle ruten.
 */
export function sjekkHemmelighetNavn(
  request: Request,
  navnMiljoevariabel: string,
  hva = "Jobben",
): HemmelighetResultat {
  const forventet = process.env[navnMiljoevariabel];

  if (!forventet || forventet.trim() === "") {
    return {
      ok: false,
      grunn: `${navnMiljoevariabel} er ikke satt. ${hva} kan ikke kalles. Se docs/manuell-oppsett.md, del C2.`,
      status: 503,
    };
  }

  const gitt = lesHemmelighet(request);

  if (!gitt) {
    return { ok: false, grunn: "Mangler hemmelighet.", status: 401 };
  }

  if (!liktKonstantTid(gitt, forventet)) {
    return { ok: false, grunn: "Feil hemmelighet.", status: 401 };
  }

  return { ok: true };
}
