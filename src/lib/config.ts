/**
 * Konfigurasjon og integrasjonsstatus.
 *
 * Grunnregelen: mangler en nøkkel, sier systemet det tydelig og fortsetter å virke.
 * Det finnes ingen kodevei her som finner på data.
 *
 * Vi returnerer alltid *navnet* på variabelen som mangler — aldri verdien.
 */

export type IntegrasjonNavn =
  | "enhetsregisteret"
  | "epost"
  | "vikingcrm"
  | "agent";

export type Integrasjonsstatus = {
  navn: IntegrasjonNavn;
  visningsnavn: string;
  beskrivelse: string;
  konfigurert: boolean;
  /** Navnene på miljøvariablene som mangler. Aldri verdiene. */
  manglendeNokler: string[];
};

function harVerdi(navn: string): boolean {
  const verdi = process.env[navn];
  return typeof verdi === "string" && verdi.trim() !== "";
}

/**
 * Sjekker en liste miljøvariabler og returnerer hvilke som mangler.
 * Returnerer navn, ikke verdier — trygt å logge og vise i dashbordet.
 */
export function manglende(navn: string[]): string[] {
  return navn.filter((n) => !harVerdi(n));
}

/** Sann hvis alle oppgitte variabler er satt. */
export function alleSatt(navn: string[]): boolean {
  return manglende(navn).length === 0;
}

/** Leser en valgfri variabel med standardverdi. */
export function valgfri(navn: string, standard: string): string {
  const verdi = process.env[navn];
  return typeof verdi === "string" && verdi.trim() !== "" ? verdi.trim() : standard;
}

/** Leser et heltall fra miljøet. Ugyldig verdi gir standardverdien, ikke NaN. */
export function tall(navn: string, standard: number): number {
  const raa = process.env[navn];
  if (!raa) return standard;
  const n = Number.parseInt(raa, 10);
  return Number.isFinite(n) ? n : standard;
}

/** Leser en boolsk verdi. Bare "true" (uansett store/små bokstaver) gir sann. */
export function boolsk(navn: string, standard: boolean): boolean {
  const raa = process.env[navn];
  if (raa === undefined) return standard;
  return raa.trim().toLowerCase() === "true";
}

// ---------------------------------------------------------------------------
// Standardverdier for drift
// ---------------------------------------------------------------------------

export const TIDSONE = () => valgfri("TIDSONE", "Europe/Oslo");

/**
 * Alle sendende ruter tørrkjører med mindre annet eksplisitt sies.
 * Dette er standarden i .env.example, og den skal være sann.
 */
export const STANDARD_TORRKJORING = () => boolsk("STANDARD_TORRKJORING", true);

// ---------------------------------------------------------------------------
// Integrasjoner
// ---------------------------------------------------------------------------

/**
 * Beskriver hver integrasjon og hva som mangler.
 *
 * Brukes av dashbordet for å vise «ikke konfigurert» ærlig, og av tjenestene for
 * å nekte å gjøre noe halvveis i stedet for å finne på data.
 */
export function integrasjonsstatus(): Integrasjonsstatus[] {
  // Enhetsregisteret er et ÅPENT API og krever ingen nøkkel. Det er verifisert
  // ved å kalle det uten autentisering. Vi markerer det derfor som konfigurert,
  // og sier samtidig at en nøkkel ikke er nødvendig. Å kreve en nøkkel her ville
  // vist «ikke konfigurert» for alltid, og det ville vært usant.
  const enhetsregisteret: string[] = [];
  const epost = ["EPOST_KANAL", "EPOST_FRA_ADRESSE"];
  const vikingcrm = ["VIKINGCRM_WEBHOOK_URL"];
  const agent = ["AGENT_WEBHOOK_URL"];

  return [
    {
      navn: "enhetsregisteret",
      visningsnavn: "Enhetsregisteret",
      beskrivelse:
        "Åpent API fra Brønnøysundregistrene. Krever ingen nøkkel. Henter nye selskaper.",
      konfigurert: alleSatt(enhetsregisteret),
      manglendeNokler: manglende(enhetsregisteret),
    },
    {
      navn: "epost",
      visningsnavn: "E-post",
      beskrivelse:
        "Sender e-post. Uten konfigurasjon sier utsendingsvakten stopp, og ingenting sendes.",
      konfigurert: alleSatt(epost),
      manglendeNokler: manglende(epost),
    },
    {
      navn: "vikingcrm",
      visningsnavn: "VikingCRM",
      beskrivelse:
        "Sender hendelser til VikingCRM via webhook. Vi snakker med den — vi endrer den ikke.",
      konfigurert: alleSatt(vikingcrm),
      manglendeNokler: manglende(vikingcrm),
    },
    {
      navn: "agent",
      visningsnavn: "Agenten",
      beskrivelse:
        "Verktøyflaten agenten kaller. Uten konfigurasjon virker resten av systemet som normalt.",
      konfigurert: alleSatt(agent),
      manglendeNokler: manglende(agent),
    },
  ];
}

/** Henter status for én integrasjon. */
export function integrasjon(navn: IntegrasjonNavn): Integrasjonsstatus {
  const funnet = integrasjonsstatus().find((i) => i.navn === navn);
  if (!funnet) {
    throw new Error(`Ukjent integrasjon: ${navn}`);
  }
  return funnet;
}

/** Sann hvis integrasjonen er fullt konfigurert. */
export function erKonfigurert(navn: IntegrasjonNavn): boolean {
  return integrasjon(navn).konfigurert;
}
