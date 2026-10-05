/**
 * Import av kontakter fra CSV.
 *
 * HVORFOR DENNE FINNES:
 * Enhetsregisteret oppgir virksomheter, ikke personer eller e-postadresser. Uansett
 * hvor kontaktene kommer fra — et CRM-eksport, en liste Kenneth har samlet, eller
 * noe annet — må de inn i systemet på én måte. Før dette fantes det ingen: den
 * eneste veien var å skrive dem inn manuelt i databasen.
 *
 * Dette er bøtte 1: det er filtrering, validering, normalisering og logging.
 * Ingen skjønn, ingen agent. Samme fil inn to ganger gir samme resultat.
 *
 * PERSONVERN: e-postadresser er personopplysninger. Derfor krever importen et
 * dokumentert grunnlag. Har ikke CSV-filen en kolonne for det, må operatøren
 * oppgi det eksplisitt. Vi gjetter ikke på hvorfor vi har lov til å lagre dem.
 */

import { prisma } from "@/lib/db";
import { logg } from "@/lib/logg";
import { normaliserEpost, epostDomene } from "@/lib/guards/sperreliste";
import { normaliserNavn, normaliserOrgnr } from "@/lib/enhetsregister/normaliser";
import { skrivRevisjon } from "@/lib/revisjon";

/** Kolonnenavn vi godtar, med de vanligste skrivemåtene. */
const KOLONNER = {
  fornavn: ["fornavn", "firstname", "first_name", "first name"],
  etternavn: ["etternavn", "lastname", "last_name", "last name", "surname"],
  epost: ["epost", "e-post", "email", "e_mail", "mail", "epostadresse"],
  telefon: ["telefon", "telefonnummer", "tlf", "phone", "mobile", "mobil"],
  rolle: ["rolle", "stilling", "tittel", "title", "position", "jobb"],
  orgnr: ["orgnr", "org.nr", "organisasjonsnummer", "org_number", "orgnummer"],
  organisasjon: ["organisasjon", "organisasjon_navn", "selskap", "company", "firma", "arbeidsgiver"],
  beslutningstaker: ["beslutningstaker", "decisionmaker", "decision_maker", "beslutter"],
  samtykke: ["samtykke", "samtykkeGrunnlag", "grunnlag", "consent", "basis", "hjemmel"],
  notat: ["notat", "note", "kommentar", "comment"],
  linkedin: ["linkedin", "linkedinurl", "linkedin_url", "profil"],
} as const;

export type ImportRad = {
  /** Linjenummer i filen, medregnet overskriften. Brukes i feilmeldinger. */
  linje: number;
  fornavn: string;
  etternavn: string;
  epost: string | null;
  telefon: string | null;
  rolle: string | null;
  orgnr: string | null;
  organisasjon: string | null;
  beslutningstaker: boolean;
  samtykke: string | null;
  notat: string | null;
  linkedinUrl: string | null;
};

export type ImportFeil = {
  linje: number;
  grunn: string;
  rad: string;
};

export type ImportResultat = {
  lest: number;
  gyldige: number;
  opprettet: number;
  oppdatert: number;
  hoppetOver: number;
  feil: ImportFeil[];
  /** Kontakter vi ikke fant en organisasjon til. De lagres uten. */
  utenOrganisasjon: number;
  /** Organisasjoner vi opprettet fordi de ikke fantes. */
  nyeOrganisasjoner: number;
  torrkjoering: boolean;
};

export class ImportFeilISeg extends Error {
  readonly kode = "IMPORT_FEIL";
  constructor(
    melding: string,
    readonly feil: ImportFeil[],
  ) {
    super(melding);
    this.name = "ImportFeilISeg";
  }
}

export function erImportFeil(e: unknown): e is ImportFeilISeg {
  return typeof e === "object" && e !== null && (e as { kode?: string }).kode === "IMPORT_FEIL";
}

/**
 * Deler én CSV-linje i felt. Håndterer hermetegn og komma inne i felt.
 *
 * Vi skriver dette selv i stedet for å hente en avhengighet: formatet vi trenger
 * er lite, og en avhengighet er noe som skal vedlikeholdes.
 */
export function delCsvLinje(linje: string): string[] {
  const felt: string[] = [];
  let naavaerende = "";
  let inneIHerketegn = false;

  for (let i = 0; i < linje.length; i += 1) {
    const tegn = linje[i]!;

    if (inneIHerketegn) {
      if (tegn === '"') {
        // "" inne i et hermetegn betyr ett hermetegn.
        if (linje[i + 1] === '"') {
          naavaerende += '"';
          i += 1;
        } else {
          inneIHerketegn = false;
        }
      } else {
        naavaerende += tegn;
      }
    } else if (tegn === '"') {
      inneIHerketegn = true;
    } else if (tegn === "," || tegn === ";") {
      felt.push(naavaerende);
      naavaerende = "";
    } else {
      naavaerende += tegn;
    }
  }

  felt.push(naavaerende);
  return felt.map((f) => f.trim());
}

/** Finner kolonneindeksen for et felt, ut fra de skrivemåtene vi godtar. */
function finnKolonne(overskrifter: string[], navn: keyof typeof KOLONNER): number {
  const godtatte = KOLONNER[navn] as readonly string[];

  for (let i = 0; i < overskrifter.length; i += 1) {
    const o = overskrifter[i]!.trim().toLowerCase();
    if (godtatte.includes(o)) return i;
  }

  return -1;
}

function santEllerUsant(verdi: string): boolean {
  return ["ja", "j", "true", "1", "y", "yes", "x"].includes(verdi.trim().toLowerCase());
}

/** Tolker hele CSV-innholdet. Kaster hvis overskriften mangler nødvendige kolonner. */
export function tolkCsv(innhold: string): { rader: ImportRad[]; feil: ImportFeil[] } {
  const linjer = innhold
    .replace(/^\uFEFF/, "") // fjern BOM fra Excel
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");

  if (linjer.length === 0) {
    throw new ImportFeilISeg("Filen er tom.", []);
  }

  const overskrifter = delCsvLinje(linjer[0]!);

  const iFornavn = finnKolonne(overskrifter, "fornavn");
  const iEtternavn = finnKolonne(overskrifter, "etternavn");
  const iEpost = finnKolonne(overskrifter, "epost");

  const mangler: string[] = [];
  if (iFornavn < 0) mangler.push("fornavn");
  if (iEtternavn < 0) mangler.push("etternavn");
  if (iEpost < 0) mangler.push("epost");

  if (mangler.length > 0) {
    throw new ImportFeilISeg(
      `Overskriften mangler disse kolonnene: ${mangler.join(", ")}. ` +
        `Fant: ${overskrifter.join(", ")}. Se docs/import-av-kontakter.md.`,
      [],
    );
  }

  const iTelefon = finnKolonne(overskrifter, "telefon");
  const iRolle = finnKolonne(overskrifter, "rolle");
  const iOrgnr = finnKolonne(overskrifter, "orgnr");
  const iOrg = finnKolonne(overskrifter, "organisasjon");
  const iBeslutning = finnKolonne(overskrifter, "beslutningstaker");
  const iSamtykke = finnKolonne(overskrifter, "samtykke");
  const iNotat = finnKolonne(overskrifter, "notat");
  const iLinkedin = finnKolonne(overskrifter, "linkedin");

  const rader: ImportRad[] = [];
  const feil: ImportFeil[] = [];

  const hent = (felt: string[], indeks: number): string => (indeks >= 0 ? (felt[indeks] ?? "").trim() : "");

  for (let n = 1; n < linjer.length; n += 1) {
    const linjenummer = n + 1;
    const felt = delCsvLinje(linjer[n]!);
    const raa = linjer[n]!;

    const fornavn = hent(felt, iFornavn);
    const etternavn = hent(felt, iEtternavn);
    const epostRaa = hent(felt, iEpost);

    if (fornavn === "" || etternavn === "") {
      feil.push({ linje: linjenummer, grunn: "Mangler fornavn eller etternavn.", rad: raa });
      continue;
    }

    if (epostRaa === "") {
      // Uten e-postadresse kan vi ikke nå personen. Vi lagrer dem ikke, for et
      // kontaktkort vi ikke kan bruke er bare en personopplysning vi ikke har
      // nytte av.
      feil.push({
        linje: linjenummer,
        grunn: "Mangler e-postadresse. Uten den kan kontakten ikke kontaktes, og vi lagrer den ikke.",
        rad: raa,
      });
      continue;
    }

    const epost = normaliserEpost(epostRaa);

    // Enkel, ærlig validering. Vi skal ikke godta noe vi ikke kan sende til.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost) || epostDomene(epost) === null) {
      feil.push({ linje: linjenummer, grunn: `«${epostRaa}» ser ikke ut som en e-postadresse.`, rad: raa });
      continue;
    }

    const orgnrRaa = hent(felt, iOrgnr);
    const orgnr = orgnrRaa ? normaliserOrgnr(orgnrRaa) : null;

    if (orgnrRaa && orgnr === null) {
      feil.push({
        linje: linjenummer,
        grunn: `«${orgnrRaa}» er ikke et gyldig organisasjonsnummer (ni siffer).`,
        rad: raa,
      });
      continue;
    }

    rader.push({
      linje: linjenummer,
      fornavn,
      etternavn,
      epost,
      telefon: hent(felt, iTelefon) || null,
      rolle: hent(felt, iRolle) || null,
      orgnr,
      organisasjon: hent(felt, iOrg) || null,
      beslutningstaker: iBeslutning >= 0 ? santEllerUsant(hent(felt, iBeslutning)) : false,
      samtykke: hent(felt, iSamtykke) || null,
      notat: hent(felt, iNotat) || null,
      linkedinUrl: hent(felt, iLinkedin) || null,
    });
  }

  // Duplikater i filen: samme adresse to ganger. Den siste vinner, og vi sier fra.
  const sett = new Map<string, ImportRad>();

  for (const rad of rader) {
    const forrige = sett.get(rad.epost!);

    if (forrige) {
      feil.push({
        linje: rad.linje,
        grunn: `Samme e-postadresse som linje ${forrige.linje}. Denne er brukt i stedet.`,
        rad: `${rad.fornavn} ${rad.etternavn} <${rad.epost}>`,
      });
    }

    sett.set(rad.epost!, rad);
  }

  return { rader: [...sett.values()], feil };
}

/**
 * Finner organisasjonen en kontakt hører til.
 *
 * Rekkefølgen er valgt med vilje: organisasjonsnummer er entydig og kan ikke
 * tolkes feil. Domenet er nest best. Navn er svakest, og vi krever eksakt treff
 * på normalisert navn — ellers kunne «Nord AS» havnet hos «Nordic AS».
 */
async function finnOrganisasjon(rad: ImportRad): Promise<string | null> {
  if (rad.orgnr) {
    const org = await prisma.organisasjon.findUnique({
      where: { orgnr: rad.orgnr },
      select: { id: true },
    });
    if (org) return org.id;
  }

  const domene = rad.epost ? epostDomene(rad.epost) : null;

  if (domene) {
    // Organisasjonen lagrer nettside, ikke domenet til en kontaktadresse.
    // Vi leter derfor etter domenet inne i nettsiden.
    const org = await prisma.organisasjon.findFirst({
      where: { nettside: { contains: domene } },
      select: { id: true },
    });
    if (org) return org.id;
  }

  if (rad.organisasjon) {
    const normalisert = normaliserNavn(rad.organisasjon);

    if (normalisert !== "") {
      // `normalisertNavn` er ikke unik i skjemaet, så vi kan ikke bruke
      // findUnique. Vi krever ett entydig treff: finnes det to organisasjoner
      // med samme normaliserte navn, lar vi være å gjette. Å koble en kontakt
      // til feil selskap er verre enn å ikke koble den i det hele tatt.
      const treff = await prisma.organisasjon.findMany({
        where: { normalisertNavn: normalisert },
        select: { id: true },
        take: 2,
      });

      if (treff.length === 1) return treff[0]!.id;

      if (treff.length > 1) {
        logg.advarsel("Flere organisasjoner har samme normaliserte navn — kobler ikke", {
          navn: rad.organisasjon,
          normalisert,
        });
      }
    }
  }

  return null;
}

/**
 * Importerer kontakter.
 *
 * Idempotent: samme fil to ganger gir samme resultat. En kontakt som finnes
 * oppdateres, den dupliseres ikke.
 */
export async function importerKontakter(
  innhold: string,
  valg: {
    torrkjoering: boolean;
    /** Påkrevd hvis filen ikke har en samtykkekolonne. */
    samtykkeGrunnlag?: string;
    /** Opprett organisasjoner som ikke finnes, ut fra navn i filen. */
    opprettOrganisasjoner?: boolean;
    kilde?: string;
  },
): Promise<ImportResultat> {
  const { rader, feil } = tolkCsv(innhold);

  // PERSONVERN: vi lagrer ikke e-postadresser uten et dokumentert grunnlag.
  const utenGrunnlag = rader.filter((r) => !r.samtykke && !valg.samtykkeGrunnlag);

  if (utenGrunnlag.length > 0) {
    throw new ImportFeilISeg(
      `${utenGrunnlag.length} rad(er) mangler grunnlag for å lagre personopplysninger, og ` +
        `du oppga ingen. Legg til en kolonne «samtykke», eller kjør med ` +
        `--grunnlag "hvorfor dere har lov til å lagre disse".`,
      utenGrunnlag.map((r) => ({
        linje: r.linje,
        grunn: "Mangler samtykkegrunnlag.",
        rad: `${r.fornavn} ${r.etternavn} <${r.epost}>`,
      })),
    );
  }

  const resultat: ImportResultat = {
    lest: rader.length + feil.length,
    gyldige: rader.length,
    opprettet: 0,
    oppdatert: 0,
    hoppetOver: 0,
    feil,
    utenOrganisasjon: 0,
    nyeOrganisasjoner: 0,
    torrkjoering: valg.torrkjoering,
  };

  for (const rad of rader) {
    const organisasjonId = await finnOrganisasjon(rad);

    if (!organisasjonId) {
      resultat.utenOrganisasjon += 1;
    }

    if (valg.torrkjoering) {
      const finnes = await prisma.kontakt.findUnique({
        where: { epost: rad.epost! },
        select: { id: true },
      });

      if (finnes) resultat.oppdatert += 1;
      else resultat.opprettet += 1;

      continue;
    }

    const samtykkeGrunnlag = rad.samtykke ?? valg.samtykkeGrunnlag ?? null;

    const data = {
      fornavn: rad.fornavn,
      etternavn: rad.etternavn,
      telefon: rad.telefon,
      rolle: rad.rolle,
      erBeslutningstaker: rad.beslutningstaker,
      notat: rad.notat,
      linkedinUrl: rad.linkedinUrl,
      samtykkeGrunnlag,
      organisasjonId,
    };

    const forrige = await prisma.kontakt.findUnique({
      where: { epost: rad.epost! },
      select: { id: true },
    });

    if (forrige) {
      // Vi oppdaterer ikke samtykkedatoen ved en oppdatering. Den skal vise når
      // grunnlaget først ble registrert, ikke når filen sist ble lest inn.
      await prisma.kontakt.update({ where: { epost: rad.epost! }, data });
      resultat.oppdatert += 1;
    } else {
      await prisma.kontakt.create({
        data: {
          ...data,
          epost: rad.epost!,
          samtykkeDato: samtykkeGrunnlag ? new Date() : null,
        },
      });
      resultat.opprettet += 1;
    }
  }

  if (!valg.torrkjoering) {
    await skrivRevisjon({
      handling: "KONTAKTER_IMPORTERT",
      aktor: "BRUKER",
      aktorType: "BRUKER",
      entitet: "Kontakt",
      grunnlag: valg.samtykkeGrunnlag
        ? `Import fra ${valg.kilde ?? "CSV"}. Grunnlag oppgitt av operatør.`
        : `Import fra ${valg.kilde ?? "CSV"}. Grunnlag hentet fra filen.`,
      resultat: `Opprettet ${resultat.opprettet}, oppdaterte ${resultat.oppdatert}, avviste ${resultat.feil.length}.`,
      resultatStatus: resultat.feil.length > 0 ? "delvis" : "ok",
      kilde: "kontakter/import",
      metadata: {
        lest: resultat.lest,
        opprettet: resultat.opprettet,
        oppdatert: resultat.oppdatert,
        avvist: resultat.feil.length,
        utenOrganisasjon: resultat.utenOrganisasjon,
      },
    });
  }

  logg.info("Kontaktimport kjørte", {
    torrkjoering: valg.torrkjoering,
    opprettet: resultat.opprettet,
    oppdatert: resultat.oppdatert,
    avvist: resultat.feil.length,
  });

  return resultat;
}
