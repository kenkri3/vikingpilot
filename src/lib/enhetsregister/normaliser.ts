/**
 * Normalisering av data fra Enhetsregisteret.
 *
 * Modul 3, bøtte 1. Dette er rene funksjoner uten database og uten nettverk, slik
 * at de kan testes isolert og kjøres offline.
 *
 * Poenget med normalisering er å gjøre sammenligning mulig. «Acme AS» og
 * «ACME  as.» er samme virksomhet for et menneske, men ikke for en database.
 * Vi lagrer derfor både det opprinnelige navnet — som skal vises — og en
 * normalisert form, som brukes til å oppdage duplikater og gjenta søk.
 */

export type RaaVirksomhet = {
  organisasjonsnummer?: string;
  navn?: string;
  organisasjonsform?: { kode?: string; beskrivelse?: string };
  naeringskode1?: { kode?: string; beskrivelse?: string };
  naeringskode2?: { kode?: string; beskrivelse?: string };
  naeringskode3?: { kode?: string; beskrivelse?: string };
  antallAnsatte?: number;
  stiftelsesdato?: string;
  registreringsdatoEnhetsregisteret?: string;
  konkurs?: boolean;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
  forretningsadresse?: RaaAdresse;
  postadresse?: RaaAdresse;
  hjemmeside?: string;
  sektor?: string;
  erSlettet?: boolean;
};

export type RaaAdresse = {
  land?: string;
  landkode?: string;
  postnummer?: string;
  poststed?: string;
  kommunenummer?: string;
  kommune?: string;
  adresse?: string[];
  fylke?: string;
};

export type NormalisertVirksomhet = {
  orgnr: string;
  navn: string;
  normalisertNavn: string;
  organisasjonsform: string | null;
  naeringskode: string | null;
  naeringsbeskrivelse: string | null;
  sektor: "PRIVAT" | "OFFENTLIG" | "UKJENT";
  antallAnsatte: number | null;
  stiftetDato: Date | null;
  registrertDato: Date | null;
  konkurs: boolean;
  underAvvikling: boolean;
  adresse: string | null;
  postnummer: string | null;
  poststed: string | null;
  fylke: string | null;
  kommunenummer: string | null;
  nettside: string | null;
};

/**
 * Nøkkelen til hele normaliseringen.
 *
 * Vi fjerner det som gjør at to skrivemåter av samme navn ser ulike ut:
 *   - store og små bokstaver
 *   - ekstra mellomrom
 *   - tegnet «.» og andre skilletegn
 *   - aksenter, slik at «Næring» og «Naering» ikke skiller seg
 *
 * Vi fjerner IKKE ord som «as» og «asa». De er en del av navnet, og å fjerne dem
 * ville slått sammen virksomheter som faktisk er forskjellige.
 */
export function normaliserNavn(navn: string): string {
  return navn
    .normalize("NFKD")
    // Fjern diakritiske tegn, men behold æøå som de er.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,'"«»()\[\]{}]/g, " ")
    .replace(/&/g, " og ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rydder et organisasjonsnummer til ni siffer.
 *
 * Enhetsregisteret oppgir det noen ganger med mellomrom. Vi avviser alt som ikke
 * er nøyaktig ni siffer — heller null enn et halvt riktig nummer, for et
 * feilaktig orgnr ville pekt på feil virksomhet.
 */
export function normaliserOrgnr(raa: string | undefined | null): string | null {
  if (!raa) return null;

  const siffer = raa.replace(/\D/g, "");

  if (siffer.length !== 9) return null;

  return siffer;
}

/**
 * Tolker en dato fra Enhetsregisteret, som bruker ISO-format (YYYY-MM-DD).
 *
 * Ugyldige datoer gir null. Vi godtar ikke en dato vi ikke forstår, fordi en
 * gal stiftelsesdato ville påvirket aldersfilteret.
 */
export function normaliserDato(raa: string | undefined | null): Date | null {
  if (!raa) return null;

  const trimmet = raa.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmet)) return null;

  // Bygg i UTC. Bruker vi lokal tid, kan datoen flytte seg et døgn.
  const [aar, maaned, dag] = trimmet.split("-").map((d) => Number.parseInt(d, 10));
  const dato = new Date(Date.UTC(aar!, maaned! - 1, dag!));

  // Avvis datoer som ikke finnes, f.eks. 2026-02-30.
  if (
    dato.getUTCFullYear() !== aar ||
    dato.getUTCMonth() !== maaned! - 1 ||
    dato.getUTCDate() !== dag
  ) {
    return null;
  }

  return dato;
}

/** Setter sammen en adresse fra Enhetsregisterets adressestruktur. */
function settSammenAdresse(adresse: RaaAdresse | undefined): string | null {
  if (!adresse?.adresse?.length) return null;

  const linjer = adresse.adresse.filter((l) => l && l.trim() !== "");
  if (linjer.length === 0) return null;

  return linjer.join(", ").replace(/\s+/g, " ").trim();
}

/**
 * Avgjør om virksomheten er offentlig.
 *
 * Selve reglene og kodelistene ligger i sektor.ts. Vi importerer dem hit, slik
 * at resten av koden kan hente alt fra normaliser, og re-eksporterer for
 * bakoverkompatibilitet.
 */
import { utledSektor } from "@/lib/enhetsregister/sektor";

export { utledSektor };
export type { Sektor } from "@/lib/enhetsregister/sektor";

/** Rydder et nettsted til en brukbar URL, eller null. */
export function normaliserNettside(raa: string | undefined | null): string | null {
  if (!raa) return null;

  const trimmet = raa.trim();
  if (trimmet === "") return null;

  // Enhetsregisteret lagrer noen ganger uten protokoll.
  const medProtokoll = /^https?:\/\//i.test(trimmet) ? trimmet : `https://${trimmet}`;

  try {
    const url = new URL(medProtokoll);
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Normaliserer én virksomhet fra Enhetsregisteret.
 *
 * Returnerer null hvis virksomheten mangler navn eller et gyldig
 * organisasjonsnummer. Vi lagrer ikke halvferdige rader — en virksomhet vi ikke
 * kan identifisere er ikke en vi kan kontakte.
 */
export function normaliserVirksomhet(raa: RaaVirksomhet): NormalisertVirksomhet | null {
  const orgnr = normaliserOrgnr(raa.organisasjonsnummer);
  const navn = (raa.navn ?? "").trim();

  if (!orgnr || navn === "") return null;

  const forretningsadresse = raa.forretningsadresse;
  const postadresse = raa.postadresse;
  const adresse = forretningsadresse ?? postadresse;

  return {
    orgnr,
    navn,
    normalisertNavn: normaliserNavn(navn),
    organisasjonsform: raa.organisasjonsform?.kode ?? null,
    naeringskode: raa.naeringskode1?.kode ?? null,
    naeringsbeskrivelse: raa.naeringskode1?.beskrivelse ?? null,
    sektor: utledSektor(raa.sektor, raa.organisasjonsform?.kode),
    antallAnsatte:
      typeof raa.antallAnsatte === "number" && Number.isFinite(raa.antallAnsatte)
        ? raa.antallAnsatte
        : null,
    stiftetDato: normaliserDato(raa.stiftelsesdato),
    registrertDato: normaliserDato(raa.registreringsdatoEnhetsregisteret),
    konkurs: raa.konkurs === true,
    underAvvikling: raa.underAvvikling === true || raa.underTvangsavviklingEllerTvangsopplosning === true,
    adresse: settSammenAdresse(adresse),
    postnummer: adresse?.postnummer ?? null,
    poststed: adresse?.poststed ?? null,
    fylke: adresse?.fylke ?? null,
    kommunenummer: adresse?.kommunenummer ?? null,
    nettside: normaliserNettside(raa.hjemmeside),
  };
}
