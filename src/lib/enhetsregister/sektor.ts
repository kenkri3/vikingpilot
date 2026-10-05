/**
 * Klassifisering av organisasjonsformer.
 *
 * Dette er sikkerhetskritisk: offentlig sektor skal aldri kontaktes. Se
 * docs/beslutninger.md B-006.
 *
 * VIKTIG om virkeligheten: Enhetsregisterets `sektor`-felt er ofte TOMT. Det er
 * verifisert ved å hente ekte data — aksjeselskaper og enkeltpersonforetak
 * kommer tilbake med `sektor: ""`. Klassifiseringen kan derfor ikke hvile på
 * det feltet alene. Vi må bruke organisasjonsformen.
 *
 * Det snudde en feil vi fant i praksis: første versjon avviste ALT fra det åpne
 * API-et som «ukjent sektor», inkludert helt vanlige AS. Trygt, men ubrukelig.
 *
 * Listen under er bygget på Enhetsregisterets egne kodelister. Er vi i tvil,
 * svarer vi OFFENTLIG — å utelate en privat virksomhet er billig, å kontakte en
 * offentlig etat er et brudd på kravet.
 */

/** Organisasjonsformer som alltid er offentlige. */
export const OFFENTLIGE_FORMER = new Set([
  "ORGL", // Organisasjonsledd — brukes av offentlige etater
  "STAT", // Statlig enhet
  "FYLK", // Fylkeskommune
  "KOMM", // Kommune
  "KTRF", // Kommunalt foretak
  "SF", // Statsforetak
  "IKS", // Interkommunalt selskap — offentlig eid
  "KF", // Kommunalt foretak (eldre kode)
  "FKF", // Fylkeskommunalt foretak
]);

/**
 * Organisasjonsformer som alltid er private.
 *
 * Dette er selskapsformer og foretaksformer drevet av private rettssubjekter.
 * Et AS eid av det offentlige er fortsatt et AS — en egen juridisk person — og
 * skal vurderes på vanlig måte, ikke utelukkes på form.
 */
export const PRIVATE_FORMER = new Set([
  "AS", // Aksjeselskap
  "ASA", // Allmennaksjeselskap
  "ANS", // Ansvarlig selskap
  "DA", // Delt ansvar
  "ENK", // Enkeltpersonforetak
  "SA", // Samvirkeforetak
  "SAM", // Samvirkeforetak (eldre kode)
  "BA", // Selskap med begrenset ansvar
  "FLI", // Forening/lag/innretning
  "STI", // Stiftelse
  "NUF", // Norskregistrert utenlandsk foretak
  "UTLA", // Utlandet
  "PRE", // Privat eid
  "VPFO", // Verdipapirfond
  "BO", // Boutgift
  "KBO", // Konkursbo
  "TVF", // Tvangsavvikling
  "DNUF", // Deltakerregistrert NUF
  "ESEK", // Europeisk selskap
  "SE", // Europeisk selskap
  "SPA", // Sparebank
  "GFS", // Gjensidig forsikringsselskap
]);

export type Sektor = "PRIVAT" | "OFFENTLIG" | "UKJENT";

/**
 * Avgjør sektoren ut fra sektor-feltet og organisasjonsformen.
 *
 * Rekkefølgen er: eksplisitt sektor først, deretter formen. Er ingen av dem
 * kjent, svarer vi UKJENT — og filteret avviser UKJENT når `ekskluderOffentlig`
 * er på, som er standarden.
 */
export function utledSektor(
  sektor: string | undefined,
  organisasjonsformKode: string | undefined,
): Sektor {
  const sektorLav = (sektor ?? "").toLowerCase().trim();

  // 1. Et eksplisitt sektor-felt vinner alltid.
  if (sektorLav.includes("offentlig") || sektorLav.includes("statlig")) {
    return "OFFENTLIG";
  }
  if (sektorLav.includes("privat")) {
    return "PRIVAT";
  }

  // 2. Organisasjonsformen.
  const form = (organisasjonsformKode ?? "").toUpperCase().trim();

  if (form === "") return "UKJENT";
  if (OFFENTLIGE_FORMER.has(form)) return "OFFENTLIG";
  if (PRIVATE_FORMER.has(form)) return "PRIVAT";

  // 3. Ukjent form. Vi gjetter ikke.
  return "UKJENT";
}
