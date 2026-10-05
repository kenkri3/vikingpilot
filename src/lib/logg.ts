/**
 * Logging.
 *
 * To regler som ikke kan bøyes (oppdragets regel 11):
 *
 *   1. Ingen hemmeligheter i logger. Denne filen vasker dem bort før de skrives.
 *   2. Feiler en jobb, skal den si det — ikke tie.
 *
 * All logg går gjennom `logg()`. Ingen andre filer skriver til console direkte.
 */

export type LoggNivaa = "debug" | "info" | "advarsel" | "feil";

const NIVAAER: Record<LoggNivaa, number> = {
  debug: 10,
  info: 20,
  advarsel: 30,
  feil: 40,
};

function aktivtNivaa(): number {
  const raa = (process.env.LOGG_NIVAA ?? "info").toLowerCase();
  return NIVAAER[raa as LoggNivaa] ?? NIVAAER.info;
}

// ---------------------------------------------------------------------------
// Vasking av hemmeligheter
// ---------------------------------------------------------------------------

/**
 * Nøkkelnavn som alltid skal maskeres, uansett hvor de dukker opp.
 * Sammenligningen er gjort på små bokstaver og delvis samsvar.
 */
const FOELSOM_MOENSTER = [
  "secret",
  "passord",
  "password",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "nokkel",
  "nøkkel",
  "credential",
  "private",
  "session",
  "bearer",
];

const MASKERT = "[skjult]";

function erFoelsomNokkel(nokkel: string): boolean {
  const lav = nokkel.toLowerCase();
  return FOELSOM_MOENSTER.some((m) => lav.includes(m));
}

/**
 * Miljøvariabler som aldri skal logges, uansett.
 * Dette er navnene — ikke verdiene.
 */
const HEMMELIGE_MILJOEVARIABLER = new Set([
  "DATABASE_URL",
  "SESSION_SECRET",
  "SMTP_PASSORD",
  "VIKINGCRM_WEBHOOK_SECRET",
  "VIKINGCRM_INNKOMMENDE_SECRET",
  "AGENT_WEBHOOK_SECRET",
  "AGENT_INNKOMMENDE_SECRET",
  "ENHETSREGISTERET_API_KEY",
  "CRON_SECRET_ENHETSREGISTER",
  "CRON_SECRET_SEKVENS",
  "CRON_SECRET_UTSENDING",
  "CRON_SECRET_OPPVARMING",
  "CRON_SECRET_RYDDING",
]);

/**
 * Erstatter passord i en tilkoblingsstreng.
 * `postgresql://bruker:hemmelig@vert/db` blir `postgresql://bruker:[skjult]@vert/db`.
 */
function maskerConnectionString(tekst: string): string {
  return tekst.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@/\s]+):([^@/\s]+)@/g,
    `$1:${MASKERT}@`,
  );
}

/**
 * Vasker en vilkårlig verdi for hemmeligheter. Går dypt i objekter og lister.
 * Dette er sikkerhetsnettet: selv om noen logger feil objekt, lekker det ikke.
 */
export function vask(verdi: unknown, dybde = 0): unknown {
  if (dybde > 6) return "[for dyp]";

  if (verdi === null || verdi === undefined) return verdi;

  if (typeof verdi === "string") {
    let ut = maskerConnectionString(verdi);

    // Masker verdien til enhver hemmelig miljøvariabel som måtte være limt inn.
    for (const navn of HEMMELIGE_MILJOEVARIABLER) {
      const faktisk = process.env[navn];
      if (faktisk && faktisk.length >= 8 && ut.includes(faktisk)) {
        ut = ut.split(faktisk).join(MASKERT);
      }
    }

    return ut;
  }

  if (typeof verdi === "number" || typeof verdi === "boolean") return verdi;
  if (typeof verdi === "bigint") return verdi.toString();
  if (typeof verdi === "function") return "[funksjon]";

  if (verdi instanceof Date) return verdi.toISOString();

  if (verdi instanceof Error) {
    return {
      navn: verdi.name,
      melding: vask(verdi.message, dybde + 1),
      // Stakken kan inneholde stier, men ikke hemmeligheter.
      stakk: verdi.stack ? vask(verdi.stack, dybde + 1) : undefined,
    };
  }

  if (Array.isArray(verdi)) {
    return verdi.map((v) => vask(v, dybde + 1));
  }

  if (typeof verdi === "object") {
    const ut: Record<string, unknown> = {};
    for (const [nokkel, v] of Object.entries(verdi as Record<string, unknown>)) {
      ut[nokkel] = erFoelsomNokkel(nokkel) ? MASKERT : vask(v, dybde + 1);
    }
    return ut;
  }

  return String(verdi);
}

// ---------------------------------------------------------------------------
// Selve loggingen
// ---------------------------------------------------------------------------

type LoggFelt = Record<string, unknown>;

function skriv(nivaa: LoggNivaa, melding: string, felt?: LoggFelt): void {
  if (NIVAAER[nivaa] < aktivtNivaa()) return;

  const linje = {
    tid: new Date().toISOString(),
    nivaa,
    melding: vask(melding),
    ...(felt ? (vask(felt) as LoggFelt) : {}),
  };

  const tekst = JSON.stringify(linje);

  if (nivaa === "feil") {
    console.error(tekst);
  } else if (nivaa === "advarsel") {
    console.warn(tekst);
  } else {
    console.log(tekst);
  }
}

export const logg = {
  debug: (melding: string, felt?: LoggFelt) => skriv("debug", melding, felt),
  info: (melding: string, felt?: LoggFelt) => skriv("info", melding, felt),
  advarsel: (melding: string, felt?: LoggFelt) => skriv("advarsel", melding, felt),
  feil: (melding: string, felt?: LoggFelt) => skriv("feil", melding, felt),
};

/**
 * Pakker en feil til en trygg melding vi kan vise i dashbordet.
 * Returnerer aldri stakken til brukeren, og aldri hemmeligheter.
 */
export function feilmelding(feil: unknown): string {
  if (feil instanceof Error) {
    return String(vask(feil.message));
  }
  return String(vask(feil));
}
