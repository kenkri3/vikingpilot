/**
 * Sperrelister.
 *
 * Modul 2. Sjekkes i det øyeblikket noe skal sendes — ikke i en prompt.
 * Se docs/spesifikasjon.md, bøtte 1, og docs/beslutninger.md B-003.
 *
 * Grunnregelen: en sperre kan ikke snakkes rundt. Den ligger i databasen, og
 * denne funksjonen er den eneste veien til å sende noe.
 *
 * Funksjonen svarer alltid med en grunn. Revisjonsloggen skal kunne vise
 * *hvorfor* en melding ble stoppet, ikke bare at den ble det.
 */

import type { Kanal, SperreGrunn, SperreType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { logg } from "@/lib/logg";

export type SperreSvar = {
  /** Sann hvis det er lov å sende. */
  tillatt: boolean;
  /** Forklaring i klartekst. Brukes i revisjonsloggen og i dashbordet. */
  grunn: string;
  /** Hva slags sperre som traff, hvis noen. */
  type: SperreType | null;
  /** Hvorfor sperren finnes. */
  sperreGrunn: SperreGrunn | null;
  /** Id-en til sperreraden, slik at den kan spores. */
  sperreId: string | null;
};

export type SperreForespoersel = {
  kanal: Kanal;
  /** Mottakerens e-postadresse, hvis vi har den. */
  epost?: string | null;
  kontaktId?: string | null;
  organisasjonId?: string | null;
};

/** Normaliserer en e-postadresse for sammenligning. */
export function normaliserEpost(epost: string): string {
  return epost.trim().toLowerCase();
}

/**
 * Normaliserer et domene for sammenligning.
 *
 * Dette MÅ gjøres både når en sperre legges inn og når den slås opp. Gjør vi det
 * bare én av veiene, kan en sperre som er registrert med store bokstaver bli
 * liggende og gjøre ingenting — operatøren tror domenet er sperret, og det er
 * det ikke. Det var en ekte feil: `epostDomene` ble lagret rå, mens oppslaget
 * normaliserte.
 *
 * Vi fjerner det som gjør at to skrivemåter av samme domene ser ulike ut:
 *   - store bokstaver
 *   - innledende `www.`
 *   - avsluttende punktum (rot i DNS-notasjon)
 *   - protokoll og skråstrek, i tilfelle noen limer inn en URL
 *   - alt etter en eventuell @, i tilfelle noen limer inn en hel adresse
 */
export function normaliserDomene(raa: string): string | null {
  let d = raa.trim().toLowerCase();

  if (d === "") return null;

  // Har noen limt inn en hel adresse, tar vi domenedelen.
  const alfakrull = d.lastIndexOf("@");
  if (alfakrull >= 0) d = d.slice(alfakrull + 1);

  // Fjern protokoll og sti.
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.split("/")[0]!;
  d = d.split("?")[0]!;
  d = d.split(":")[0]!;

  // Fjern innledende www. og avsluttende punktum.
  d = d.replace(/^www\./, "");
  d = d.replace(/\.+$/, "");

  if (d === "" || !d.includes(".")) return null;

  return d;
}

/** Henter domenedelen av en e-postadresse, normalisert, eller null. */
export function epostDomene(epost: string): string | null {
  const deler = normaliserEpost(epost).split("@");
  if (deler.length !== 2 || !deler[1]) return null;
  return normaliserDomene(deler[1]!);
}

/**
 * Sjekker om det er lov å sende til en mottaker på en gitt kanal.
 *
 * Sjekker i denne rekkefølgen:
 *   1. Global sperre        — gjelder alle kanaler
 *   2. Kanalsperre          — gjelder én kanal, eller alle hvis kanal er null
 *   3. E-postadresse        — direkte treff
 *   4. E-postdomene         — hele domenet sperret
 *   5. Kontakt              — personen er sperret
 *   6. Organisasjon         — hele virksomheten er sperret
 *
 * Returnerer ved første treff. En sperre kan ikke overstyres av et parameter —
 * det finnes ingen «force»-flagg, og det er med vilje.
 */
export async function sjekkSperreliste(
  forespoersel: SperreForespoersel,
): Promise<SperreSvar> {
  const naa = new Date();
  const epost = forespoersel.epost ? normaliserEpost(forespoersel.epost) : null;
  const domene = epost ? epostDomene(epost) : null;

  // Utløpte sperrer teller ikke. Vi sjekker det eksplisitt i stedet for å stole
  // på at noen har ryddet dem bort.
  const aktivOgGjeldende = {
    aktiv: true,
    OR: [{ utloeper: null }, { utloeper: { gt: naa } }],
  };

  const treff = await prisma.sperreliste.findFirst({
    where: {
      AND: [
        aktivOgGjeldende,
        {
          // Sperren maa ha noe aa treffe. Se sperreOmfang() — en sperre uten
          // mottaker er avvist allerede ved innlegging.
          OR: [
            // Global sperre: treffer en adresse eller et domene, men gjelder
            // ALLE kanaler. Den treffer ikke «alt» — den treffer bare det den
            // peker paa. Å skrive { type: "GLOBAL" } alene sperret hver eneste
            // mottaker i hele systemet. Bruddforsøket «en usperret adresse
            // slipper gjennom» fanget det.
            ...(epost ? [{ type: "GLOBAL" as const, epost }] : []),
            ...(domene ? [{ type: "GLOBAL" as const, epostDomene: domene }] : []),
            ...(forespoersel.kontaktId
              ? [{ type: "GLOBAL" as const, kontaktId: forespoersel.kontaktId }]
              : []),
            ...(forespoersel.organisasjonId
              ? [{ type: "GLOBAL" as const, organisasjonId: forespoersel.organisasjonId }]
              : []),

            // Domenesperre er sin egen type, og gjelder alle kanaler.
            ...(domene ? [{ type: "EPOSTDOMENE" as const, epostDomene: domene }] : []),

            // Kanalsperre: samme treffregler, men bare for denne kanalen.
            ...(epost ? [{ type: "KANAL" as const, kanal: forespoersel.kanal, epost }] : []),
            ...(domene
              ? [{ type: "KANAL" as const, kanal: forespoersel.kanal, epostDomene: domene }]
              : []),
            ...(forespoersel.kontaktId
              ? [
                  {
                    type: "KANAL" as const,
                    kanal: forespoersel.kanal,
                    kontaktId: forespoersel.kontaktId,
                  },
                ]
              : []),
            ...(forespoersel.organisasjonId
              ? [
                  {
                    type: "KANAL" as const,
                    kanal: forespoersel.kanal,
                    organisasjonId: forespoersel.organisasjonId,
                  },
                ]
              : []),

            // Kanalsperre med kanal = null gjelder alle kanaler.
            ...(epost ? [{ type: "KANAL" as const, kanal: null, epost }] : []),
            ...(domene ? [{ type: "KANAL" as const, kanal: null, epostDomene: domene }] : []),
            ...(forespoersel.kontaktId
              ? [{ type: "KANAL" as const, kanal: null, kontaktId: forespoersel.kontaktId }]
              : []),
            ...(forespoersel.organisasjonId
              ? [
                  {
                    type: "KANAL" as const,
                    kanal: null,
                    organisasjonId: forespoersel.organisasjonId,
                  },
                ]
              : []),

            // Kontakt- og virksomhetssperrer. Disse er egne typer, og treffer
            // uansett kanal. MERK `type: { not: "KANAL" }`: uten den ville en
            // kanalsperre på e-post ogsaa blitt fanget her, og dermed sperret SMS.
            // Det var nettopp feilen bruddforsøket
            // «kanalsperre stopper bare sin egen kanal» fant.
            ...(forespoersel.kontaktId
              ? [
                  {
                    type: { not: "KANAL" as const },
                    kontaktId: forespoersel.kontaktId,
                  },
                ]
              : []),
            ...(forespoersel.organisasjonId
              ? [
                  {
                    type: { not: "KANAL" as const },
                    organisasjonId: forespoersel.organisasjonId,
                  },
                ]
              : []),
          ],
        },
      ],
    },
    orderBy: { opprettet: "asc" },
  });

  if (!treff) {
    return {
      tillatt: true,
      grunn: "Ingen sperre traff.",
      type: null,
      sperreGrunn: null,
      sperreId: null,
    };
  }

  return {
    tillatt: false,
    grunn: forklarSperre(treff.type, treff.grunn, treff.kanal, forespoersel.kanal),
    type: treff.type,
    sperreGrunn: treff.grunn,
    sperreId: treff.id,
  };
}

/** Lager en forklaring i klartekst. Brukes både i logg og i dashbordet. */
export function forklarSperre(
  type: SperreType,
  grunn: SperreGrunn,
  sperretKanal: Kanal | null,
  forespurtKanal: Kanal,
): string {
  const hva: Record<SperreType, string> = {
    GLOBAL: "Global sperre",
    KANAL: sperretKanal
      ? `Sperret for kanalen ${sperretKanal}`
      : "Sperret for alle kanaler",
    KONTAKT: "Personen er sperret",
    ORGANISASJON: "Virksomheten er sperret",
    EPOSTDOMENE: "Hele e-postdomenet er sperret",
  };

  const hvorfor: Record<SperreGrunn, string> = {
    AVMELDING: "vedkommende har meldt seg av",
    BOUNCE: "adressen har bouncet",
    KLAGE: "det er kommet en klage",
    EKSISTERENDE_KUNDE: "dette er en eksisterende kunde",
    AKTIV_DIALOG: "det løper allerede en aktiv dialog",
    MANUELL: "den er lagt inn manuelt",
    KONKURS: "virksomheten er konkurs",
    OFFENTLIG_SEKTOR: "offentlig sektor skal ikke kontaktes",
    RESERVASJON: "vedkommende har reservert seg",
  };

  return `${hva[type]}: ${hvorfor[grunn]}. Kan ikke sende på ${forespurtKanal}.`;
}

// ---------------------------------------------------------------------------
// Legge inn sperrer
// ---------------------------------------------------------------------------

export type SperreInn = {
  type: SperreType;
  grunn: SperreGrunn;
  epost?: string | null;
  epostDomene?: string | null;
  kontaktId?: string | null;
  organisasjonId?: string | null;
  kanal?: Kanal | null;
  notat?: string | null;
  kilde?: string | null;
  opprettetAv?: string | null;
  utloeper?: Date | null;
};

/**
 * Felten vi kaster når en sperre ikke har noe å treffe.
 *
 * `kode` finnes fordi `instanceof` ikke er til å stole på her: Next.js pakker
 * ruter og delte moduler hver for seg, og da kan det ligge to ulike
 * klasse-identiteter av samme klasse i samme prosess. Da feiler instanceof selv
 * om feilen er riktig. En streng kode overlever bundling.
 * Det oppdaget vi ved å kalle ruten på ekte.
 */
export const UGYLDIG_SPERRE_KODE = "UGYLDIG_SPERRE";

export class UgyldigSperre extends Error {
  readonly kode = UGYLDIG_SPERRE_KODE;

  constructor(melding: string) {
    super(melding);
    this.name = "UgyldigSperre";
  }
}

/** Sann hvis feilen er en UgyldigSperre, uansett hvilken modulkopi den kom fra. */
export function erUgyldigSperre(feil: unknown): feil is UgyldigSperre {
  return (
    typeof feil === "object" &&
    feil !== null &&
    (feil as { kode?: unknown }).kode === UGYLDIG_SPERRE_KODE
  );
}

/**
 * Sjekker at sperren har noe å treffe.
 *
 * Dette er et sikkerhetsgjerde, ikke skjemavalidering. En sperre uten mottaker
 * ville tidligere blitt tolket som «sperr alt», og stoppet hele systemet fra å
 * sende noe som helst til noen. Det er en feil som er lett å lage ved et uhell
 * og vond å oppdage, så vi nekter å lage den i det hele tatt.
 *
 * En sperre må peke på minst én av: epost, epostDomene, kontaktId,
 * organisasjonId. Å sperre en hel kanal for alle er ikke en sperre — det er å
 * slå av kanalen, og det gjøres i KanalInnstilling av et menneske.
 */
function sperreOmfang(inn: SperreInn): void {
  const harMottaker = Boolean(
    inn.epost || inn.epostDomene || inn.kontaktId || inn.organisasjonId,
  );

  if (!harMottaker) {
    throw new UgyldigSperre(
      "En sperre må peke på minst én mottaker: epost, epostDomene, kontaktId eller " +
        "organisasjonId. Uten det ville sperren stoppet all utgående trafikk på " +
        "kanalen, ikke bare det den gjelder. Skal en hel kanal stenges, gjøres det " +
        "i KanalInnstilling.",
    );
  }
}

/**
 * Legger inn en sperre.
 *
 * Er sperren der allerede, oppdaterer vi den ikke — vi returnerer den som finnes.
 * Det gjør funksjonen trygg å kalle flere ganger, for eksempel fra en webhook som
 * leverer samme hendelse to ganger.
 *
 * Kaster UgyldigSperre hvis sperren ikke har noe å treffe.
 */
export async function leggTilSperre(inn: SperreInn): Promise<{ id: string; ny: boolean }> {
  sperreOmfang(inn);

  // Begge normaliseres her, og den SAMME verdien brukes til både oppslag og
  // innsetting. Normaliserte vi bare den ene veien, ville en sperre lagret med
  // store bokstaver blitt liggende uten å treffe noe.
  const epost = inn.epost ? normaliserEpost(inn.epost) : null;

  const epostDomeneVerdi = inn.epostDomene ? normaliserDomene(inn.epostDomene) : null;

  // Ble et domene oppgitt, men avvist som ugyldig, sier vi fra i stedet for å
  // lagre en sperre som ikke virker.
  if (inn.epostDomene && inn.epostDomene.trim() !== "" && epostDomeneVerdi === null) {
    throw new UgyldigSperre(
      `«${inn.epostDomene}» er ikke et gyldig domene. En sperre på et ugyldig domene ` +
        `ville sett ut som den virket, uten å gjøre det.`,
    );
  }

  const eksisterende = await prisma.sperreliste.findFirst({
    where: {
      type: inn.type,
      grunn: inn.grunn,
      epost,
      epostDomene: epostDomeneVerdi,
      kontaktId: inn.kontaktId ?? null,
      organisasjonId: inn.organisasjonId ?? null,
      kanal: inn.kanal ?? null,
      aktiv: true,
    },
  });

  if (eksisterende) {
    return { id: eksisterende.id, ny: false };
  }

  const opprettet = await prisma.sperreliste.create({
    data: {
      type: inn.type,
      grunn: inn.grunn,
      epost,
      epostDomene: epostDomeneVerdi,
      kontaktId: inn.kontaktId ?? null,
      organisasjonId: inn.organisasjonId ?? null,
      kanal: inn.kanal ?? null,
      notat: inn.notat ?? null,
      kilde: inn.kilde ?? null,
      opprettetAv: inn.opprettetAv ?? null,
      utloeper: inn.utloeper ?? null,
    },
  });

  logg.info("Sperre lagt til", {
    sperreId: opprettet.id,
    type: inn.type,
    grunn: inn.grunn,
    kilde: inn.kilde,
  });

  return { id: opprettet.id, ny: true };
}

/**
 * Fjerner en sperre ved å sette den inaktiv.
 *
 * Vi sletter aldri en sperre. At en sperre har eksistert er historie, og
 * historien skal kunne leses etterpå. Se docs/beslutninger.md B-007.
 */
export async function opphevSperre(
  sperreId: string,
  opphevetAv: string,
): Promise<boolean> {
  const oppdatert = await prisma.sperreliste.updateMany({
    where: { id: sperreId, aktiv: true },
    data: { aktiv: false, notat: `Opphevet av ${opphevetAv}` },
  });

  if (oppdatert.count > 0) {
    logg.info("Sperre opphevet", { sperreId, opphevetAv });
    return true;
  }

  return false;
}
