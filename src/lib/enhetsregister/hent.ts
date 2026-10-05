/**
 * Henting fra Enhetsregisteret.
 *
 * Modul 3, bøtte 1.
 *
 * VIKTIG: Enhetsregisteret er et ÅPENT API. Det krever ingen nøkkel. Det er
 * verifisert ved å kalle det uten autentisering, og det svarte HTTP 200 med
 * ekte data. `ENHETSREGISTERET_BASE_URL` finnes bare for å kunne peke på et
 * annet endepunkt, for eksempel et lokalt testoppsett.
 *
 * Systemet skal kunne kjøres helt uten nettverk. Derfor er hentingen skilt fra
 * normaliseringen og filtreringen, som er rene funksjoner. Er nettverket nede,
 * feiler hentingen med en forståelig melding — den finner ikke på data.
 *
 * Vi kaller bare offentlig myndighetsdata. Ingen personopplysninger hentes her;
 * roller og fødselsnummer ligger bak et eget autorisert API som vi ikke bruker.
 */

import { feilmelding, logg } from "@/lib/logg";
import { valgfri } from "@/lib/config";
import {
  normaliserVirksomhet,
  type NormalisertVirksomhet,
  type RaaVirksomhet,
} from "@/lib/enhetsregister/normaliser";

/** Standard endepunkt. Åpent, uten nøkkel. */
const STANDARD_BASE = "https://data.brreg.no/enhetsregisteret/api";

export type HentResultat = {
  ok: boolean;
  virksomheter: NormalisertVirksomhet[];
  /** Hvilket endepunkt som faktisk ble brukt. Aldri hemmelig. */
  endepunkt: string;
  /** Antall rå rader vi mottok, før normalisering. */
  mottatt: number;
  /** Antall rader som falt bort i normaliseringen, med grunn. */
  forkastet: { orgnr: string | null; grunn: string }[];
  /** Neste side, hvis det finnes flere. */
  nesteSide: number | null;
  feil: string | null;
  /** Hvor lang tid kallet tok, i millisekunder. */
  varighetMs: number;
};

function baseUrl(): string {
  return valgfri("ENHETSREGISTERET_BASE_URL", STANDARD_BASE).replace(/\/+$/, "");
}

/**
 * Bygger hodene vi sender.
 *
 * Er det satt en nøkkel i miljøet, sendes den med — men vi krever den ikke, og
 * vi logger den aldri.
 */
function hoder(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/json",
    "user-agent": "VikingPilot/0.1 (internt system; kontakt: post@vikingnet.no)",
  };

  const nokkel = process.env.ENHETSREGISTERET_API_KEY;
  if (nokkel && nokkel.trim() !== "") {
    h["authorization"] = `Bearer ${nokkel.trim()}`;
  }

  return h;
}

export type HentValg = {
  /** Antall per side. API-et tillater opptil 1000. */
  antall?: number;
  /** Side nummer, fra 0. */
  side?: number;
  /** Tidsavbrudd i millisekunder. */
  tidsavbruddMs?: number;
  /** Sortering, f.eks. «organisasjonsnummer ASC». */
  sortering?: string;
  /** Bare virksomheter registrert etter denne datoen (YYYY-MM-DD). */
  registrertEtter?: string;
  /** Bare virksomheter registrert før denne datoen (YYYY-MM-DD). */
  registrertFoer?: string;
};

/**
 * Henter én side med virksomheter.
 *
 * Kaster ikke. Returnerer alltid et resultat med `ok` og eventuell `feil`, slik
 * at kalleren kan rapportere ærlig i stedet for å krasje.
 */
export async function hentSide(valg: HentValg = {}): Promise<HentResultat> {
  const startet = Date.now();
  const endepunkt = `${baseUrl()}/enheter`;

  const antall = Math.min(Math.max(valg.antall ?? 100, 1), 1000);
  const side = Math.max(valg.side ?? 0, 0);
  const tidsavbrudd = valg.tidsavbruddMs ?? 20_000;

  const url = new URL(endepunkt);
  url.searchParams.set("size", String(antall));
  url.searchParams.set("page", String(side));
  if (valg.sortering) url.searchParams.set("sort", valg.sortering);
  if (valg.registrertEtter) {
    url.searchParams.set("registreringsdatoEnhetsregisteretFra", valg.registrertEtter);
  }
  if (valg.registrertFoer) {
    url.searchParams.set("registreringsdatoEnhetsregisteretTil", valg.registrertFoer);
  }

  const avbryter = new AbortController();
  const timer = setTimeout(() => avbryter.abort(), tidsavbrudd);

  try {
    const svar = await fetch(url.toString(), {
      headers: hoder(),
      signal: avbryter.signal,
    });

    if (!svar.ok) {
      const melding =
        svar.status === 404
          ? `Endepunktet finnes ikke: ${endepunkt}. Sjekk ENHETSREGISTERET_BASE_URL.`
          : `Enhetsregisteret svarte HTTP ${svar.status}.`;

      logg.advarsel("Henting fra Enhetsregisteret feilet", { status: svar.status });

      return {
        ok: false,
        virksomheter: [],
        endepunkt,
        mottatt: 0,
        forkastet: [],
        nesteSide: null,
        feil: melding,
        varighetMs: Date.now() - startet,
      };
    }

    const kropp = (await svar.json()) as {
      _embedded?: { enheter?: RaaVirksomhet[] };
      page?: { totalPages?: number; number?: number; totalElements?: number };
    };

    const rader = kropp._embedded?.enheter ?? [];
    const virksomheter: NormalisertVirksomhet[] = [];
    const forkastet: { orgnr: string | null; grunn: string }[] = [];

    for (const raa of rader) {
      const normalisert = normaliserVirksomhet(raa);

      if (normalisert) {
        virksomheter.push(normalisert);
      } else {
        // Vi forkaster heller enn å lagre en halvferdig rad. En virksomhet vi
        // ikke kan identifisere, kan vi ikke kontakte.
        forkastet.push({
          orgnr: raa.organisasjonsnummer ?? null,
          grunn: !raa.organisasjonsnummer
            ? "Mangler organisasjonsnummer."
            : "Mangler navn eller har ugyldig organisasjonsnummer.",
        });
      }
    }

    const totalSider = kropp.page?.totalPages ?? 1;
    const denneSiden = kropp.page?.number ?? side;
    const nesteSide = denneSiden + 1 < totalSider ? denneSiden + 1 : null;

    return {
      ok: true,
      virksomheter,
      endepunkt,
      mottatt: rader.length,
      forkastet,
      nesteSide,
      feil: null,
      varighetMs: Date.now() - startet,
    };
  } catch (feil) {
    const erAvbrutt = feil instanceof Error && feil.name === "AbortError";

    const melding = erAvbrutt
      ? `Tidsavbrudd etter ${tidsavbrudd} ms mot ${endepunkt}.`
      : `Kunne ikke nå Enhetsregisteret: ${feilmelding(feil)}`;

    logg.advarsel("Henting fra Enhetsregisteret feilet", {
      grunn: erAvbrutt ? "tidsavbrudd" : "nettverksfeil",
    });

    return {
      ok: false,
      virksomheter: [],
      endepunkt,
      mottatt: 0,
      forkastet: [],
      nesteSide: null,
      feil: melding,
      varighetMs: Date.now() - startet,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Henter flere sider, opptil et tak.
 *
 * Taket er der for å hindre at én cron-kjøring drar i gang en henting av hele
 * registeret — det er over en million enheter. Hvor mange sider som hentes per
 * kjøring er konfigurasjon, ikke en tilfeldighet.
 */
export async function hentSider(maksSider: number, valg: HentValg = {}): Promise<{
  ok: boolean;
  virksomheter: NormalisertVirksomhet[];
  sider: number;
  mottatt: number;
  forkastet: { orgnr: string | null; grunn: string }[];
  /** Endepunktet som ble brukt. Aldri hemmelig. */
  endepunkt: string;
  feil: string | null;
  varighetMs: number;
}> {
  const startet = Date.now();
  const alle: NormalisertVirksomhet[] = [];
  const forkastet: { orgnr: string | null; grunn: string }[] = [];

  let side = valg.side ?? 0;
  let siderHentet = 0;
  let mottatt = 0;
  let forsteFeil: string | null = null;

  const grense = Math.max(1, maksSider);

  while (siderHentet < grense) {
    const resultat = await hentSide({ ...valg, side });

    mottatt += resultat.mottatt;
    alle.push(...resultat.virksomheter);
    forkastet.push(...resultat.forkastet);
    siderHentet += 1;

    if (!resultat.ok) {
      forsteFeil = resultat.feil;
      break;
    }

    if (resultat.nesteSide === null) break;

    side = resultat.nesteSide;
  }

  return {
    ok: forsteFeil === null,
    virksomheter: alle,
    sider: siderHentet,
    mottatt,
    forkastet,
    endepunkt: gjeldendeEndepunkt(),
    feil: forsteFeil,
    varighetMs: Date.now() - startet,
  };
}

/** Endepunktet vi faktisk bruker. Nyttig å vise i dashbordet. */
export function gjeldendeEndepunkt(): string {
  return `${baseUrl()}/enheter`;
}

/** Sann hvis vi bruker det offisielle, åpne endepunktet. */
export function brukerOffentligEndepunkt(): boolean {
  return baseUrl() === STANDARD_BASE;
}
