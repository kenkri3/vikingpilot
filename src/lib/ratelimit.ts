/**
 * Rate limiting.
 *
 * Alle åpne endepunkter har rate limiting. Uten det kan en cron-rute eller en
 * webhook misbrukes til å hamre løs på systemet.
 *
 * Implementasjonen er i minnet og teller per nøkkel i faste vinduer. Det er
 * bevisst enkelt: systemet kjører som én tjeneste på Railway. Skal det senere
 * skaleres til flere instanser, må telleren flyttes til databasen eller Redis —
 * og det skal i så fall gjøres eksplisitt, ikke ved et uhell.
 */

import { valgfri, tall } from "@/lib/config";

type Vindu = {
  antall: number;
  nullstilles: number;
};

const vinduer = new Map<string, Vindu>();

/** Rydder gamle oppføringer så minnet ikke vokser ubegrenset. */
function rydd(naa: number): void {
  if (vinduer.size < 1000) return;

  for (const [nokkel, vindu] of vinduer) {
    if (vindu.nullstilles <= naa) {
      vinduer.delete(nokkel);
    }
  }
}

export type RateLimitResultat = {
  tillatt: boolean;
  gjenstaar: number;
  nullstillesOmMs: number;
};

/**
 * Sjekker og teller ett forsøk for en nøkkel.
 *
 * @param nokkel   Hva vi teller per. Bruk IP, eller `cron:<jobb>`.
 * @param grense   Maks antall forsøk i vinduet.
 * @param vinduMs  Vinduets lengde i millisekunder.
 */
export function sjekkRateLimit(
  nokkel: string,
  grense: number,
  vinduMs = 60_000,
): RateLimitResultat {
  const naa = Date.now();
  rydd(naa);

  const eksisterende = vinduer.get(nokkel);

  if (!eksisterende || eksisterende.nullstilles <= naa) {
    vinduer.set(nokkel, { antall: 1, nullstilles: naa + vinduMs });
    return { tillatt: true, gjenstaar: grense - 1, nullstillesOmMs: vinduMs };
  }

  if (eksisterende.antall >= grense) {
    return {
      tillatt: false,
      gjenstaar: 0,
      nullstillesOmMs: eksisterende.nullstilles - naa,
    };
  }

  eksisterende.antall += 1;

  return {
    tillatt: true,
    gjenstaar: grense - eksisterende.antall,
    nullstillesOmMs: eksisterende.nullstilles - naa,
  };
}

/** Standardgrensen per minutt, fra miljøet. */
export function standardGrense(): number {
  return tall("RATE_LIMIT_PER_MINUTT", 60);
}

/**
 * Henter klientens adresse fra en forespørsel.
 *
 * Railway setter x-forwarded-for. Vi tar første ledd, som er den opprinnelige
 * klienten. Mangler den, faller vi tilbake til en fast nøkkel slik at
 * begrensningen fortsatt gjelder — den blir bare grovere.
 */
export function klientNokkel(headers: Headers, prefiks = "ip"): string {
  const videre = headers.get("x-forwarded-for");
  const ip = videre ? videre.split(",")[0]!.trim() : (headers.get("x-real-ip") ?? "ukjent");
  return `${prefiks}:${ip}`;
}

/**
 * Bygger en 429-respons med forståelig innhold og Retry-After.
 */
export function forMangeForesporsler(resultat: RateLimitResultat): Response {
  const sekunder = Math.max(1, Math.ceil(resultat.nullstillesOmMs / 1000));

  return new Response(
    JSON.stringify({
      feil: "for_mange_foresporsler",
      melding: `For mange forespørsler. Prøv igjen om ${sekunder} sekunder.`,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(sekunder),
      },
    },
  );
}

/** Tømmer tellerne. Brukes av tester. */
export function nullstillRateLimit(): void {
  vinduer.clear();
}

/** Antall aktive tellere. Brukes av tester. */
export function antallTellere(): number {
  return vinduer.size;
}

/** Er rate limiting slått på? Kan slås av i testmiljø. */
export function rateLimitAktiv(): boolean {
  return valgfri("RATE_LIMIT_AKTIV", "true") !== "false";
}
