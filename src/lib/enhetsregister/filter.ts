/**
 * Deterministiske filtre for målgruppen.
 *
 * Modul 3, bøtte 1. Ingen skjønn, ingen prompt. Hvert avslag får en grunn i
 * klartekst, slik at dashbordet kan vise hvorfor en virksomhet ble silt ut.
 *
 * To regler kan ikke slås av fra konfigurasjon:
 *
 *   1. Offentlig sektor skal ut, alltid. Se docs/beslutninger.md B-006.
 *   2. Konkurs og under avvikling skal ut, alltid.
 *
 * De øvrige reglene styres av `Maalgruppe` i databasen, slik at Kenneth og
 * Fredrik kan endre hvem vi leter etter uten at noen skriver kode.
 */

import type { NormalisertVirksomhet } from "@/lib/enhetsregister/normaliser";

export type FilterKonfig = {
  /** NACE-koder eller prefikser. Tom liste betyr «alle». */
  naeringskoder: string[];
  /** Fylker. Tom liste betyr «alle». */
  fylker: string[];
  minAnsatte: number | null;
  maxAnsatte: number | null;
  /** Minimumsalder i hele måneder. */
  minAlderMaaneder: number | null;
  ekskluderOffentlig: boolean;
  ekskluderKonkurs: boolean;
  ekskluderUnderAvvikling: boolean;
};

export type FilterSvar = {
  godkjent: boolean;
  /** Hvorfor. Alltid satt, også når virksomheten godkjennes. */
  grunn: string;
  /** Kort kode for telling og feilsøking. */
  kode:
    | "GODKJENT"
    | "OFFENTLIG_SEKTOR"
    | "KONKURS"
    | "UNDER_AVVIKLING"
    | "NAERING"
    | "FYLKE"
    | "ANSATTE"
    | "ALDER"
    | "UGYLDIG_ALDER";
};

/** Standard: alt ut, ingenting sluppet gjennom ved tvil. */
export const STRENG_KONFIG: FilterKonfig = {
  naeringskoder: [],
  fylker: [],
  minAnsatte: null,
  maxAnsatte: null,
  minAlderMaaneder: null,
  ekskluderOffentlig: true,
  ekskluderKonkurs: true,
  ekskluderUnderAvvikling: true,
};

/**
 * Fjerner alt som ikke er siffer, slik at «62.010», «62.01» og «62010»
 * kan sammenlignes. NACE-koder skrives ulikt avhengig av kilde.
 */
export function normaliserKode(kode: string): string {
  return kode.replace(/\D/g, "");
}

/**
 * Sjekker om en NACE-kode treffer en av de ønskede.
 *
 * Treffer hvis ønsket kode er et prefiks av virksomhetens kode. Det gjør at
 * «62» fanger opp hele «62.010 Databehandling», som er det man vil når man
 * skriver en hovedgruppe.
 */
export function naeringTreffer(virksomhetKode: string | null, onskede: string[]): boolean {
  if (onskede.length === 0) return true;
  if (!virksomhetKode) return false;

  const kandidat = normaliserKode(virksomhetKode);
  if (kandidat === "") return false;

  return onskede.some((o) => {
    const onsket = normaliserKode(o);
    return onsket !== "" && kandidat.startsWith(onsket);
  });
}

/** Sammenligner fylker uten hensyn til store og små bokstaver. */
export function fylkeTreffer(virksomhetFylke: string | null, onskede: string[]): boolean {
  if (onskede.length === 0) return true;
  if (!virksomhetFylke) return false;

  const kandidat = virksomhetFylke.trim().toLowerCase();
  return onskede.some((f) => f.trim().toLowerCase() === kandidat);
}

/**
 * Antall hele måneder mellom to datoer.
 *
 * Brukes til aldersfilteret. Vi regner hele måneder, ikke dager, fordi
 * «12 måneder» er lettere å forholde seg til enn «365 dager» når kvartals- og
 * årsskifter kommer imellom.
 */
export function maanederMellom(fra: Date, til: Date): number {
  let maaneder =
    (til.getUTCFullYear() - fra.getUTCFullYear()) * 12 +
    (til.getUTCMonth() - fra.getUTCMonth());

  // Har vi ikke passert dagen i måneden ennå, er en hel måned ikke gått.
  if (til.getUTCDate() < fra.getUTCDate()) {
    maaneder -= 1;
  }

  return maaneder;
}

/**
 * Vurderer én virksomhet mot konfigurasjonen.
 *
 * Rekkefølgen betyr noe: de absolutte reglene sjekkes først, slik at grunnen som
 * rapporteres er den viktigste. Er virksomheten konkurs, sier vi det — ikke at
 * den falt utenfor fylkesfilteret.
 *
 * @param naa Tidspunktet aldersfilteret måles mot. Settes av testene.
 */
export function vurderVirksomhet(
  virksomhet: NormalisertVirksomhet,
  konfig: FilterKonfig = STRENG_KONFIG,
  naa: Date = new Date(),
): FilterSvar {
  // 1. Absolutte regler. Disse kan ikke slås av.
  if (virksomhet.konkurs) {
    return { godkjent: false, grunn: "Virksomheten er konkurs.", kode: "KONKURS" };
  }

  if (virksomhet.underAvvikling) {
    return {
      godkjent: false,
      grunn: "Virksomheten er under avvikling.",
      kode: "UNDER_AVVIKLING",
    };
  }

  if (virksomhet.sektor === "OFFENTLIG") {
    return {
      godkjent: false,
      grunn: "Offentlig sektor kontaktes ikke.",
      kode: "OFFENTLIG_SEKTOR",
    };
  }

  // 2. Konfigurerbare regler.
  if (konfig.ekskluderOffentlig && virksomhet.sektor === "UKJENT") {
    // Vi vet ikke om den er offentlig. Da tar vi den ikke med.
    // Å utelate en privat virksomhet er billig; å kontakte en offentlig er ikke.
    return {
      godkjent: false,
      grunn: "Sektoren er ukjent, og offentlig sektor skal alltid ut.",
      kode: "OFFENTLIG_SEKTOR",
    };
  }

  if (!naeringTreffer(virksomhet.naeringskode, konfig.naeringskoder)) {
    return {
      godkjent: false,
      grunn: `Næringskoden ${virksomhet.naeringskode ?? "mangler"} er ikke i målgruppen.`,
      kode: "NAERING",
    };
  }

  if (!fylkeTreffer(virksomhet.fylke, konfig.fylker)) {
    return {
      godkjent: false,
      grunn: `Fylket ${virksomhet.fylke ?? "er ukjent"} er ikke i målgruppen.`,
      kode: "FYLKE",
    };
  }

  const ansatte = virksomhet.antallAnsatte;

  if (konfig.minAnsatte !== null) {
    if (ansatte === null) {
      return {
        godkjent: false,
        grunn: `Antall ansatte er ukjent, og målgruppen krever minst ${konfig.minAnsatte}.`,
        kode: "ANSATTE",
      };
    }
    if (ansatte < konfig.minAnsatte) {
      return {
        godkjent: false,
        grunn: `Har ${ansatte} ansatte, målgruppen krever minst ${konfig.minAnsatte}.`,
        kode: "ANSATTE",
      };
    }
  }

  if (konfig.maxAnsatte !== null) {
    if (ansatte === null) {
      return {
        godkjent: false,
        grunn: `Antall ansatte er ukjent, og målgruppen krever høyst ${konfig.maxAnsatte}.`,
        kode: "ANSATTE",
      };
    }
    if (ansatte > konfig.maxAnsatte) {
      return {
        godkjent: false,
        grunn: `Har ${ansatte} ansatte, målgruppen krever høyst ${konfig.maxAnsatte}.`,
        kode: "ANSATTE",
      };
    }
  }

  if (konfig.minAlderMaaneder !== null) {
    if (!virksomhet.stiftetDato) {
      return {
        godkjent: false,
        grunn: `Stiftelsesdato er ukjent, og målgruppen krever minst ${konfig.minAlderMaaneder} måneders alder.`,
        kode: "UGYLDIG_ALDER",
      };
    }

    const alder = maanederMellom(virksomhet.stiftetDato, naa);

    if (alder < 0) {
      // Stiftet i fremtiden. Det er en datfeil, og vi tar den ikke med.
      return {
        godkjent: false,
        grunn: "Stiftelsesdato ligger i fremtiden. Datfeil i kilden.",
        kode: "UGYLDIG_ALDER",
      };
    }

    if (alder < konfig.minAlderMaaneder) {
      return {
        godkjent: false,
        grunn: `Er ${alder} måneder gammel, målgruppen krever minst ${konfig.minAlderMaaneder}.`,
        kode: "ALDER",
      };
    }
  }

  return {
    godkjent: true,
    grunn: `Innenfor målgruppen.`,
    kode: "GODKJENT",
  };
}

/** Kjører filteret over en liste og deler i godkjente og avviste. */
export function filtrerVirksomheter(
  virksomheter: NormalisertVirksomhet[],
  konfig: FilterKonfig = STRENG_KONFIG,
  naa: Date = new Date(),
): {
  godkjente: NormalisertVirksomhet[];
  avviste: { virksomhet: NormalisertVirksomhet; svar: FilterSvar }[];
  opptelling: Record<string, number>;
} {
  const godkjente: NormalisertVirksomhet[] = [];
  const avviste: { virksomhet: NormalisertVirksomhet; svar: FilterSvar }[] = [];
  const opptelling: Record<string, number> = {};

  for (const virksomhet of virksomheter) {
    const svar = vurderVirksomhet(virksomhet, konfig, naa);
    opptelling[svar.kode] = (opptelling[svar.kode] ?? 0) + 1;

    if (svar.godkjent) {
      godkjente.push(virksomhet);
    } else {
      avviste.push({ virksomhet, svar });
    }
  }

  return { godkjente, avviste, opptelling };
}
