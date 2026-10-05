/**
 * Felles hjelpere for alle cron-ruter.
 *
 * Hver jobb har sin egen hemmelighet. Mister vi én, slutter bare den ene jobben
 * å virke — ikke hele tidsplanen.
 *
 * Den konstant-tids sammenligningen ligger i auth/hemmelighet.ts, slik at cron
 * og API-ruter bruker nøyaktig samme kode.
 */

import { boolsk } from "@/lib/config";
import { sjekkHemmelighetNavn, type HemmelighetResultat } from "@/lib/auth/hemmelighet";

export type HemmelighetSvar = HemmelighetResultat;

/**
 * Sjekker hemmeligheten for en cron-jobb.
 *
 * @param navnMiljoevariabel F.eks. «CRON_SECRET_ENHETSREGISTER». Vi leser
 *                          verdien fra miljøet — den ligger aldri i koden.
 */
export function sjekkHemmelighet(request: Request, navnMiljoevariabel: string): HemmelighetSvar {
  return sjekkHemmelighetNavn(request, navnMiljoevariabel, "Jobben");
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
