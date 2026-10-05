/**
 * Felles hjelpere for alle cron-ruter.
 *
 * Hver jobb har sin egen hemmelighet. Mister vi én, slutter bare den ene jobben
 * å virke — ikke hele tidsplanen.
 *
 * Hemmeligheten sammenlignes i konstant tid, slik at svartiden ikke røper hvor
 * mye av den som var riktig.
 */

import { timingSafeEqual } from "node:crypto";

import { boolsk } from "@/lib/config";

export type HemmelighetSvar =
  | { ok: true }
  | { ok: false; grunn: string; status: number };

/**
 * Leser hemmeligheten fra forespørselen.
 *
 * Godtar både `Authorization: Bearer <hemmelighet>` og `?hemmelighet=`.
 * Sistnevnte er praktisk for manuell kjøring fra nettleser, men den havner i
 * logger — derfor anbefales headeren, og derfor logger vi aldri verdien.
 */
function lesFraForesporsel(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const url = new URL(request.url);
  const fraQuery = url.searchParams.get("hemmelighet");
  if (fraQuery) return fraQuery.trim();

  return null;
}

/** Sammenligner to strenger i konstant tid. */
function likt(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    // Vi sammenligner likevel, slik at lengdeforskjell ikke gir kortere svartid.
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Sjekker hemmeligheten for en jobb.
 *
 * @param navnMiljoevariabel F.eks. «CRON_SECRET_ENHETSREGISTER». Vi leser
 *                          verdien fra miljøet — den ligger aldri i koden.
 */
export function sjekkHemmelighet(request: Request, navnMiljoevariabel: string): HemmelighetSvar {
  const forventet = process.env[navnMiljoevariabel];

  if (!forventet || forventet.trim() === "") {
    // Mangler hemmeligheten, nekter vi. Vi gjetter aldri på en standardverdi.
    return {
      ok: false,
      grunn: `${navnMiljoevariabel} er ikke satt. Jobben kan ikke kalles. Se docs/manuell-oppsett.md, del C2.`,
      status: 503,
    };
  }

  const gitt = lesFraForesporsel(request);

  if (!gitt) {
    return { ok: false, grunn: "Mangler hemmelighet.", status: 401 };
  }

  if (!likt(gitt, forventet)) {
    return { ok: false, grunn: "Feil hemmelighet.", status: 401 };
  }

  return { ok: true };
}

/**
 * Skal jobben tørrkjøre?
 *
 * Tørrkjøring er standard. For å faktisk utføre noe må man eksplisitt be om det
 * med `?torrkjoering=false` — det er vanskelig å gjøre ved et uhell.
 */
export function vilTorrkjoere(request: Request, standard = true): boolean {
  const url = new URL(request.url);
  const raa = url.searchParams.get("torrkjoering");

  if (raa === null) {
    return standard && boolsk("STANDARD_TORRKJORING", true);
  }

  return raa.toLowerCase() !== "false";
}
