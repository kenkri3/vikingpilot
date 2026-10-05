-- CreateEnum
CREATE TYPE "Kanal" AS ENUM ('EPOST', 'TELEFON', 'SMS', 'LINKEDIN', 'WEBHOOK', 'MANUELL');

-- CreateEnum
CREATE TYPE "Sektor" AS ENUM ('PRIVAT', 'OFFENTLIG', 'UKJENT');

-- CreateEnum
CREATE TYPE "ProspektStatus" AS ENUM ('NY', 'KVALIFISERT', 'I_SEKVENS', 'DIALOG', 'MOTE_BESTILT', 'TILBUD_SENDT', 'VUNNET', 'TAPT', 'AVVIST', 'SPERRET');

-- CreateEnum
CREATE TYPE "KundeStatus" AS ENUM ('AKTIV', 'PAUSET', 'AVSLUTTET', 'TIDLIGERE');

-- CreateEnum
CREATE TYPE "DialogRetning" AS ENUM ('UT', 'INN', 'INTERN');

-- CreateEnum
CREATE TYPE "MeldingStatus" AS ENUM ('UTKAST', 'VENTER_GODKJENNING', 'GODKJENT', 'SENDT', 'LEVERT', 'BOUNCET', 'AVVIST', 'FEILET');

-- CreateEnum
CREATE TYPE "PrisEnhet" AS ENUM ('ENGANG', 'PER_MANED', 'PER_SAK', 'PER_BRUKER', 'PER_TIME');

-- CreateEnum
CREATE TYPE "AvtaleStatus" AS ENUM ('UTKAST', 'SENDT', 'FORHANDLET', 'SIGNERT', 'AKTIV', 'AVSLUTTET', 'AVVIST');

-- CreateEnum
CREATE TYPE "OppgaveStatus" AS ENUM ('AAPEN', 'PAAGAAR', 'FULLFOERT', 'AVBRUTT');

-- CreateEnum
CREATE TYPE "OppgavePrioritet" AS ENUM ('LAV', 'NORMAL', 'HOY');

-- CreateEnum
CREATE TYPE "SperreType" AS ENUM ('GLOBAL', 'KANAL', 'KONTAKT', 'ORGANISASJON', 'EPOSTDOMENE');

-- CreateEnum
CREATE TYPE "SperreGrunn" AS ENUM ('AVMELDING', 'BOUNCE', 'KLAGE', 'EKSISTERENDE_KUNDE', 'AKTIV_DIALOG', 'MANUELL', 'KONKURS', 'OFFENTLIG_SEKTOR', 'RESERVASJON');

-- CreateEnum
CREATE TYPE "KjoeringStatus" AS ENUM ('KJORER', 'FULLFOERT', 'FEILET', 'TORRKJORT');

-- CreateEnum
CREATE TYPE "AvsenderStatus" AS ENUM ('OPPVARMING', 'AKTIV', 'PAUSET', 'SPERRET');

-- CreateEnum
CREATE TYPE "StegType" AS ENUM ('EPOST', 'OPPGAVE', 'VENT', 'AVSLUTT');

-- CreateEnum
CREATE TYPE "SekvensStatus" AS ENUM ('AKTIV', 'PAUSET', 'FULLFOERT', 'AVSLUTTET', 'AVBRUTT');

-- CreateEnum
CREATE TYPE "StegStatus" AS ENUM ('VENTER', 'KLAR', 'UTKAST_LAGET', 'VENTER_GODKJENNING', 'SENDT', 'HOPPET_OVER', 'AVBRUTT', 'FEILET');

-- CreateEnum
CREATE TYPE "GodkjenningStatus" AS ENUM ('VENTER', 'GODKJENT', 'AVVIST', 'UTLOPT');

-- CreateEnum
CREATE TYPE "GodkjenningType" AS ENUM ('UTKAST', 'UTSENDING', 'ENDRING', 'IMPORT', 'ANNET');

-- CreateTable
CREATE TABLE "Organisasjon" (
    "id" TEXT NOT NULL,
    "orgnr" TEXT NOT NULL,
    "navn" TEXT NOT NULL,
    "normalisertNavn" TEXT NOT NULL,
    "organisasjonsform" TEXT,
    "naeringskode" TEXT,
    "naeringsbeskrivelse" TEXT,
    "sektor" "Sektor" NOT NULL DEFAULT 'UKJENT',
    "antallAnsatte" INTEGER,
    "stiftetDato" TIMESTAMP(3),
    "registrertDato" TIMESTAMP(3),
    "konkurs" BOOLEAN NOT NULL DEFAULT false,
    "underAvvikling" BOOLEAN NOT NULL DEFAULT false,
    "adresse" TEXT,
    "postnummer" TEXT,
    "poststed" TEXT,
    "fylke" TEXT,
    "kommunenummer" TEXT,
    "nettside" TEXT,
    "kilde" TEXT NOT NULL DEFAULT 'ENHETSREGISTERET',
    "raaData" JSONB,
    "sistHentet" TIMESTAMP(3),
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisasjon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kontakt" (
    "id" TEXT NOT NULL,
    "organisasjonId" TEXT,
    "fornavn" TEXT NOT NULL,
    "etternavn" TEXT NOT NULL,
    "epost" TEXT,
    "telefon" TEXT,
    "rolle" TEXT,
    "erBeslutningstaker" BOOLEAN NOT NULL DEFAULT false,
    "linkedinUrl" TEXT,
    "notat" TEXT,
    "samtykkeGrunnlag" TEXT,
    "samtykkeDato" TIMESTAMP(3),
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kontakt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospekt" (
    "id" TEXT NOT NULL,
    "organisasjonId" TEXT NOT NULL,
    "kontaktId" TEXT,
    "status" "ProspektStatus" NOT NULL DEFAULT 'NY',
    "kilde" TEXT NOT NULL DEFAULT 'ENHETSREGISTERET',
    "score" INTEGER,
    "begrunnelse" TEXT,
    "maalgruppeId" TEXT,
    "kvalifisertDato" TIMESTAMP(3),
    "nesteHandling" TIMESTAMP(3),
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospekt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kundeforhold" (
    "id" TEXT NOT NULL,
    "organisasjonId" TEXT NOT NULL,
    "kundeStatus" "KundeStatus" NOT NULL DEFAULT 'AKTIV',
    "kundenummer" TEXT,
    "kundeSiden" TIMESTAMP(3),
    "avsluttetDato" TIMESTAMP(3),
    "notat" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kundeforhold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dialog" (
    "id" TEXT NOT NULL,
    "kontaktId" TEXT,
    "emne" TEXT NOT NULL,
    "kanal" "Kanal" NOT NULL DEFAULT 'EPOST',
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "sisteAktivitet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "klassifisering" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialogMelding" (
    "id" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "retning" "DialogRetning" NOT NULL,
    "kanal" "Kanal" NOT NULL,
    "emne" TEXT,
    "tekst" TEXT NOT NULL,
    "status" "MeldingStatus" NOT NULL DEFAULT 'UTKAST',
    "sendtTid" TIMESTAMP(3),
    "eksternId" TEXT,
    "feilmelding" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DialogMelding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produkt" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "navn" TEXT NOT NULL,
    "beskrivelse" TEXT,
    "prisOre" INTEGER NOT NULL,
    "valuta" TEXT NOT NULL DEFAULT 'NOK',
    "enhet" "PrisEnhet" NOT NULL DEFAULT 'PER_MANED',
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produkt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Avtale" (
    "id" TEXT NOT NULL,
    "tittel" TEXT NOT NULL,
    "organisasjonId" TEXT NOT NULL,
    "kundeId" TEXT,
    "prospektId" TEXT,
    "produktId" TEXT,
    "beloepOre" INTEGER,
    "status" "AvtaleStatus" NOT NULL DEFAULT 'UTKAST',
    "signertDato" TIMESTAMP(3),
    "startDato" TIMESTAMP(3),
    "sluttDato" TIMESTAMP(3),
    "notat" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Avtale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Oppgave" (
    "id" TEXT NOT NULL,
    "tittel" TEXT NOT NULL,
    "beskrivelse" TEXT,
    "status" "OppgaveStatus" NOT NULL DEFAULT 'AAPEN',
    "prioritet" "OppgavePrioritet" NOT NULL DEFAULT 'NORMAL',
    "forfaller" TIMESTAMP(3),
    "kontaktId" TEXT,
    "prospektId" TEXT,
    "tildeltBrukerId" TEXT,
    "fullfoertTid" TIMESTAMP(3),
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oppgave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sperreliste" (
    "id" TEXT NOT NULL,
    "type" "SperreType" NOT NULL,
    "grunn" "SperreGrunn" NOT NULL,
    "epost" TEXT,
    "epostDomene" TEXT,
    "kontaktId" TEXT,
    "organisasjonId" TEXT,
    "kanal" "Kanal",
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "notat" TEXT,
    "kilde" TEXT,
    "opprettetAv" TEXT,
    "utloeper" TIMESTAMP(3),
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sperreliste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Maalgruppe" (
    "id" TEXT NOT NULL,
    "navn" TEXT NOT NULL,
    "beskrivelse" TEXT,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "naeringskoder" TEXT[],
    "fylker" TEXT[],
    "minAnsatte" INTEGER,
    "maxAnsatte" INTEGER,
    "roller" TEXT[],
    "ekskluderOffentlig" BOOLEAN NOT NULL DEFAULT true,
    "ekskluderKonkurs" BOOLEAN NOT NULL DEFAULT true,
    "ekskluderUnderAvvikling" BOOLEAN NOT NULL DEFAULT true,
    "minAlderMaaneder" INTEGER,
    "prioritet" INTEGER NOT NULL DEFAULT 0,
    "sisteKjoering" TIMESTAMP(3),
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Maalgruppe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineKjoering" (
    "id" TEXT NOT NULL,
    "maalgruppeId" TEXT,
    "status" "KjoeringStatus" NOT NULL DEFAULT 'KJORER',
    "torrkjoering" BOOLEAN NOT NULL DEFAULT false,
    "hentet" INTEGER NOT NULL DEFAULT 0,
    "normalisert" INTEGER NOT NULL DEFAULT 0,
    "filtrertBort" INTEGER NOT NULL DEFAULT 0,
    "opprettet" INTEGER NOT NULL DEFAULT 0,
    "oppdatert" INTEGER NOT NULL DEFAULT 0,
    "feil" INTEGER NOT NULL DEFAULT 0,
    "feilmelding" TEXT,
    "startet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avsluttet" TIMESTAMP(3),
    "varighetMs" INTEGER,
    "detaljer" JSONB,

    CONSTRAINT "PipelineKjoering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KanalInnstilling" (
    "id" TEXT NOT NULL,
    "kanal" "Kanal" NOT NULL,
    "utgaaendeAktivert" BOOLEAN NOT NULL DEFAULT false,
    "maksPerDag" INTEGER NOT NULL DEFAULT 0,
    "maksPerUke" INTEGER NOT NULL DEFAULT 0,
    "maksPerMinutt" INTEGER NOT NULL DEFAULT 0,
    "tidsvinduStart" TEXT NOT NULL DEFAULT '08:00',
    "tidsvinduSlutt" TEXT NOT NULL DEFAULT '16:00',
    "kunHverdager" BOOLEAN NOT NULL DEFAULT true,
    "helligdagLand" TEXT NOT NULL DEFAULT 'NO',
    "oppvarmingAktiv" BOOLEAN NOT NULL DEFAULT true,
    "oppvarmingStartDato" TIMESTAMP(3),
    "notat" TEXT,
    "oppdatertAv" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KanalInnstilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Avsender" (
    "id" TEXT NOT NULL,
    "epost" TEXT NOT NULL,
    "navn" TEXT,
    "domene" TEXT NOT NULL,
    "status" "AvsenderStatus" NOT NULL DEFAULT 'OPPVARMING',
    "maksPerDag" INTEGER NOT NULL DEFAULT 10,
    "maksPerUke" INTEGER NOT NULL DEFAULT 50,
    "sendtIDag" INTEGER NOT NULL DEFAULT 0,
    "sendtDenneUken" INTEGER NOT NULL DEFAULT 0,
    "dognDato" TIMESTAMP(3),
    "ukeDato" TIMESTAMP(3),
    "feilrateSiste" INTEGER NOT NULL DEFAULT 0,
    "notat" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Avsender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Oppvarmingssteg" (
    "id" TEXT NOT NULL,
    "avsenderId" TEXT,
    "dagFraStart" INTEGER NOT NULL,
    "maksPerDag" INTEGER NOT NULL,
    "beskrivelse" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Oppvarmingssteg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Utsending" (
    "id" TEXT NOT NULL,
    "idempotensNokkel" TEXT NOT NULL,
    "kanal" "Kanal" NOT NULL,
    "avsenderId" TEXT,
    "kontaktId" TEXT,
    "organisasjonId" TEXT,
    "dialogMeldingId" TEXT,
    "sekvensStegId" TEXT,
    "status" "MeldingStatus" NOT NULL DEFAULT 'UTKAST',
    "planlagtTid" TIMESTAMP(3),
    "sendtTid" TIMESTAMP(3),
    "eksternId" TEXT,
    "feilmelding" TEXT,
    "torrkjoering" BOOLEAN NOT NULL DEFAULT false,
    "forsok" INTEGER NOT NULL DEFAULT 0,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Utsending_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Helligdag" (
    "id" TEXT NOT NULL,
    "dato" TIMESTAMP(3) NOT NULL,
    "navn" TEXT NOT NULL,
    "land" TEXT NOT NULL DEFAULT 'NO',
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Helligdag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sekvens" (
    "id" TEXT NOT NULL,
    "navn" TEXT NOT NULL,
    "beskrivelse" TEXT,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "versjon" INTEGER NOT NULL DEFAULT 1,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sekvens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SekvensVersjon" (
    "id" TEXT NOT NULL,
    "sekvensId" TEXT NOT NULL,
    "versjon" INTEGER NOT NULL,
    "aktiv" BOOLEAN NOT NULL DEFAULT false,
    "notat" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SekvensVersjon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SekvensSteg" (
    "id" TEXT NOT NULL,
    "versjonId" TEXT NOT NULL,
    "rekkefolge" INTEGER NOT NULL,
    "type" "StegType" NOT NULL DEFAULT 'EPOST',
    "navn" TEXT NOT NULL,
    "ventetidTimer" INTEGER NOT NULL DEFAULT 0,
    "kanal" "Kanal" NOT NULL DEFAULT 'EPOST',
    "emneMal" TEXT,
    "innholdMal" TEXT,
    "avsluttVedSvar" BOOLEAN NOT NULL DEFAULT true,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SekvensSteg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspektSekvens" (
    "id" TEXT NOT NULL,
    "prospektId" TEXT NOT NULL,
    "versjonId" TEXT NOT NULL,
    "status" "SekvensStatus" NOT NULL DEFAULT 'AKTIV',
    "startet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nesteStegTid" TIMESTAMP(3),
    "avsluttet" TIMESTAMP(3),
    "avsluttGrunn" TEXT,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspektSekvens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StegKjoering" (
    "id" TEXT NOT NULL,
    "prospektSekvensId" TEXT NOT NULL,
    "stegId" TEXT NOT NULL,
    "status" "StegStatus" NOT NULL DEFAULT 'VENTER',
    "planlagtTid" TIMESTAMP(3),
    "utfortTid" TIMESTAMP(3),
    "torrkjoering" BOOLEAN NOT NULL DEFAULT false,
    "resultat" TEXT,
    "feilmelding" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StegKjoering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Godkjenning" (
    "id" TEXT NOT NULL,
    "type" "GodkjenningType" NOT NULL DEFAULT 'UTKAST',
    "status" "GodkjenningStatus" NOT NULL DEFAULT 'VENTER',
    "tittel" TEXT NOT NULL,
    "begrunnelse" TEXT,
    "gjelder" TEXT,
    "kanal" "Kanal",
    "kontaktId" TEXT,
    "organisasjonId" TEXT,
    "dialogMeldingId" TEXT,
    "risiko" TEXT,
    "forslagFra" TEXT NOT NULL DEFAULT 'SYSTEMET',
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Godkjenning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Godkjenningsbeslutning" (
    "id" TEXT NOT NULL,
    "godkjenningId" TEXT NOT NULL,
    "brukerId" TEXT,
    "brukerEpost" TEXT,
    "status" "GodkjenningStatus" NOT NULL,
    "kommentar" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Godkjenningsbeslutning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revisjon" (
    "id" TEXT NOT NULL,
    "handling" TEXT NOT NULL,
    "aktor" TEXT NOT NULL,
    "aktorType" TEXT NOT NULL DEFAULT 'SYSTEMET',
    "entitet" TEXT,
    "entitetId" TEXT,
    "kanal" "Kanal",
    "grunnlag" TEXT,
    "resultat" TEXT,
    "resultatStatus" TEXT,
    "kilde" TEXT,
    "ip" TEXT,
    "brukerAgent" TEXT,
    "metadata" JSONB,
    "korrelasjonId" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dialogMeldingId" TEXT,

    CONSTRAINT "Revisjon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronJobb" (
    "id" TEXT NOT NULL,
    "navn" TEXT NOT NULL,
    "beskrivelse" TEXT,
    "sti" TEXT NOT NULL,
    "cronUttrykk" TEXT NOT NULL,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "torrkjoeringStandard" BOOLEAN NOT NULL DEFAULT true,
    "hemmelighetNavn" TEXT NOT NULL,
    "sisteKjoering" TIMESTAMP(3),
    "sisteStatus" "KjoeringStatus",
    "sisteFeil" TEXT,
    "antallKjoeringer" INTEGER NOT NULL DEFAULT 0,
    "antallFeil" INTEGER NOT NULL DEFAULT 0,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronJobb_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronKjoering" (
    "id" TEXT NOT NULL,
    "cronJobbId" TEXT,
    "navn" TEXT NOT NULL,
    "status" "KjoeringStatus" NOT NULL DEFAULT 'KJORER',
    "torrkjoering" BOOLEAN NOT NULL DEFAULT false,
    "startet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avsluttet" TIMESTAMP(3),
    "varighetMs" INTEGER,
    "antallUtfort" INTEGER NOT NULL DEFAULT 0,
    "antallFeil" INTEGER NOT NULL DEFAULT 0,
    "melding" TEXT,
    "detaljer" JSONB,
    "feilmelding" TEXT,

    CONSTRAINT "CronKjoering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaHendelse" (
    "id" TEXT NOT NULL,
    "idempotensNokkel" TEXT NOT NULL,
    "kilde" TEXT NOT NULL,
    "type" TEXT,
    "payload" JSONB,
    "behandlet" BOOLEAN NOT NULL DEFAULT false,
    "behandletTid" TIMESTAMP(3),
    "feilmelding" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaHendelse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bruker" (
    "id" TEXT NOT NULL,
    "epost" TEXT NOT NULL,
    "navn" TEXT NOT NULL,
    "passordHash" TEXT NOT NULL,
    "passordSalt" TEXT NOT NULL,
    "rolle" TEXT NOT NULL DEFAULT 'BRUKER',
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "sistInnlogget" TIMESTAMP(3),
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bruker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sesjon" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "brukerId" TEXT NOT NULL,
    "utloeper" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "brukerAgent" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sesjon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integrasjon" (
    "id" TEXT NOT NULL,
    "navn" TEXT NOT NULL,
    "beskrivelse" TEXT,
    "konfigurert" BOOLEAN NOT NULL DEFAULT false,
    "manglendeNokler" TEXT[],
    "sistSjekket" TIMESTAMP(3),
    "sisteFeil" TEXT,
    "opprettet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oppdatert" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integrasjon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisasjon_orgnr_key" ON "Organisasjon"("orgnr");

-- CreateIndex
CREATE INDEX "Organisasjon_fylke_idx" ON "Organisasjon"("fylke");

-- CreateIndex
CREATE INDEX "Organisasjon_naeringskode_idx" ON "Organisasjon"("naeringskode");

-- CreateIndex
CREATE INDEX "Organisasjon_sektor_idx" ON "Organisasjon"("sektor");

-- CreateIndex
CREATE INDEX "Organisasjon_antallAnsatte_idx" ON "Organisasjon"("antallAnsatte");

-- CreateIndex
CREATE INDEX "Organisasjon_normalisertNavn_idx" ON "Organisasjon"("normalisertNavn");

-- CreateIndex
CREATE UNIQUE INDEX "Kontakt_epost_key" ON "Kontakt"("epost");

-- CreateIndex
CREATE INDEX "Kontakt_organisasjonId_idx" ON "Kontakt"("organisasjonId");

-- CreateIndex
CREATE INDEX "Kontakt_etternavn_idx" ON "Kontakt"("etternavn");

-- CreateIndex
CREATE INDEX "Prospekt_status_idx" ON "Prospekt"("status");

-- CreateIndex
CREATE INDEX "Prospekt_nesteHandling_idx" ON "Prospekt"("nesteHandling");

-- CreateIndex
CREATE UNIQUE INDEX "Prospekt_organisasjonId_maalgruppeId_key" ON "Prospekt"("organisasjonId", "maalgruppeId");

-- CreateIndex
CREATE UNIQUE INDEX "Kundeforhold_kundenummer_key" ON "Kundeforhold"("kundenummer");

-- CreateIndex
CREATE INDEX "Kundeforhold_organisasjonId_idx" ON "Kundeforhold"("organisasjonId");

-- CreateIndex
CREATE INDEX "Kundeforhold_kundeStatus_idx" ON "Kundeforhold"("kundeStatus");

-- CreateIndex
CREATE INDEX "Dialog_kontaktId_idx" ON "Dialog"("kontaktId");

-- CreateIndex
CREATE INDEX "Dialog_aktiv_idx" ON "Dialog"("aktiv");

-- CreateIndex
CREATE INDEX "DialogMelding_dialogId_idx" ON "DialogMelding"("dialogId");

-- CreateIndex
CREATE INDEX "DialogMelding_status_idx" ON "DialogMelding"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Produkt_sku_key" ON "Produkt"("sku");

-- CreateIndex
CREATE INDEX "Produkt_aktiv_idx" ON "Produkt"("aktiv");

-- CreateIndex
CREATE INDEX "Avtale_status_idx" ON "Avtale"("status");

-- CreateIndex
CREATE INDEX "Avtale_organisasjonId_idx" ON "Avtale"("organisasjonId");

-- CreateIndex
CREATE INDEX "Oppgave_status_idx" ON "Oppgave"("status");

-- CreateIndex
CREATE INDEX "Oppgave_forfaller_idx" ON "Oppgave"("forfaller");

-- CreateIndex
CREATE INDEX "Sperreliste_epost_idx" ON "Sperreliste"("epost");

-- CreateIndex
CREATE INDEX "Sperreliste_epostDomene_idx" ON "Sperreliste"("epostDomene");

-- CreateIndex
CREATE INDEX "Sperreliste_kontaktId_idx" ON "Sperreliste"("kontaktId");

-- CreateIndex
CREATE INDEX "Sperreliste_organisasjonId_idx" ON "Sperreliste"("organisasjonId");

-- CreateIndex
CREATE INDEX "Sperreliste_aktiv_type_idx" ON "Sperreliste"("aktiv", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Maalgruppe_navn_key" ON "Maalgruppe"("navn");

-- CreateIndex
CREATE INDEX "Maalgruppe_aktiv_idx" ON "Maalgruppe"("aktiv");

-- CreateIndex
CREATE INDEX "PipelineKjoering_startet_idx" ON "PipelineKjoering"("startet");

-- CreateIndex
CREATE UNIQUE INDEX "KanalInnstilling_kanal_key" ON "KanalInnstilling"("kanal");

-- CreateIndex
CREATE UNIQUE INDEX "Avsender_epost_key" ON "Avsender"("epost");

-- CreateIndex
CREATE INDEX "Avsender_domene_idx" ON "Avsender"("domene");

-- CreateIndex
CREATE INDEX "Avsender_status_idx" ON "Avsender"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Oppvarmingssteg_dagFraStart_key" ON "Oppvarmingssteg"("dagFraStart");

-- CreateIndex
CREATE INDEX "Oppvarmingssteg_dagFraStart_idx" ON "Oppvarmingssteg"("dagFraStart");

-- CreateIndex
CREATE UNIQUE INDEX "Utsending_idempotensNokkel_key" ON "Utsending"("idempotensNokkel");

-- CreateIndex
CREATE INDEX "Utsending_status_idx" ON "Utsending"("status");

-- CreateIndex
CREATE INDEX "Utsending_planlagtTid_idx" ON "Utsending"("planlagtTid");

-- CreateIndex
CREATE INDEX "Utsending_kanal_idx" ON "Utsending"("kanal");

-- CreateIndex
CREATE UNIQUE INDEX "Helligdag_dato_key" ON "Helligdag"("dato");

-- CreateIndex
CREATE INDEX "Helligdag_dato_idx" ON "Helligdag"("dato");

-- CreateIndex
CREATE UNIQUE INDEX "Sekvens_navn_key" ON "Sekvens"("navn");

-- CreateIndex
CREATE INDEX "SekvensVersjon_aktiv_idx" ON "SekvensVersjon"("aktiv");

-- CreateIndex
CREATE UNIQUE INDEX "SekvensVersjon_sekvensId_versjon_key" ON "SekvensVersjon"("sekvensId", "versjon");

-- CreateIndex
CREATE INDEX "SekvensSteg_versjonId_idx" ON "SekvensSteg"("versjonId");

-- CreateIndex
CREATE UNIQUE INDEX "SekvensSteg_versjonId_rekkefolge_key" ON "SekvensSteg"("versjonId", "rekkefolge");

-- CreateIndex
CREATE INDEX "ProspektSekvens_status_idx" ON "ProspektSekvens"("status");

-- CreateIndex
CREATE INDEX "ProspektSekvens_nesteStegTid_idx" ON "ProspektSekvens"("nesteStegTid");

-- CreateIndex
CREATE INDEX "StegKjoering_status_idx" ON "StegKjoering"("status");

-- CreateIndex
CREATE INDEX "StegKjoering_planlagtTid_idx" ON "StegKjoering"("planlagtTid");

-- CreateIndex
CREATE UNIQUE INDEX "StegKjoering_prospektSekvensId_stegId_key" ON "StegKjoering"("prospektSekvensId", "stegId");

-- CreateIndex
CREATE UNIQUE INDEX "Godkjenning_dialogMeldingId_key" ON "Godkjenning"("dialogMeldingId");

-- CreateIndex
CREATE INDEX "Godkjenning_status_idx" ON "Godkjenning"("status");

-- CreateIndex
CREATE INDEX "Godkjenning_type_idx" ON "Godkjenning"("type");

-- CreateIndex
CREATE INDEX "Godkjenning_opprettet_idx" ON "Godkjenning"("opprettet");

-- CreateIndex
CREATE INDEX "Godkjenningsbeslutning_godkjenningId_idx" ON "Godkjenningsbeslutning"("godkjenningId");

-- CreateIndex
CREATE INDEX "Revisjon_opprettet_idx" ON "Revisjon"("opprettet");

-- CreateIndex
CREATE INDEX "Revisjon_handling_idx" ON "Revisjon"("handling");

-- CreateIndex
CREATE INDEX "Revisjon_aktor_idx" ON "Revisjon"("aktor");

-- CreateIndex
CREATE INDEX "Revisjon_korrelasjonId_idx" ON "Revisjon"("korrelasjonId");

-- CreateIndex
CREATE INDEX "Revisjon_entitet_entitetId_idx" ON "Revisjon"("entitet", "entitetId");

-- CreateIndex
CREATE UNIQUE INDEX "CronJobb_navn_key" ON "CronJobb"("navn");

-- CreateIndex
CREATE INDEX "CronJobb_aktiv_idx" ON "CronJobb"("aktiv");

-- CreateIndex
CREATE INDEX "CronKjoering_navn_idx" ON "CronKjoering"("navn");

-- CreateIndex
CREATE INDEX "CronKjoering_startet_idx" ON "CronKjoering"("startet");

-- CreateIndex
CREATE INDEX "CronKjoering_status_idx" ON "CronKjoering"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RaHendelse_idempotensNokkel_key" ON "RaHendelse"("idempotensNokkel");

-- CreateIndex
CREATE INDEX "RaHendelse_kilde_idx" ON "RaHendelse"("kilde");

-- CreateIndex
CREATE INDEX "RaHendelse_behandlet_idx" ON "RaHendelse"("behandlet");

-- CreateIndex
CREATE UNIQUE INDEX "Bruker_epost_key" ON "Bruker"("epost");

-- CreateIndex
CREATE INDEX "Bruker_epost_idx" ON "Bruker"("epost");

-- CreateIndex
CREATE UNIQUE INDEX "Sesjon_token_key" ON "Sesjon"("token");

-- CreateIndex
CREATE INDEX "Sesjon_token_idx" ON "Sesjon"("token");

-- CreateIndex
CREATE INDEX "Sesjon_utloeper_idx" ON "Sesjon"("utloeper");

-- CreateIndex
CREATE UNIQUE INDEX "Integrasjon_navn_key" ON "Integrasjon"("navn");

-- AddForeignKey
ALTER TABLE "Kontakt" ADD CONSTRAINT "Kontakt_organisasjonId_fkey" FOREIGN KEY ("organisasjonId") REFERENCES "Organisasjon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospekt" ADD CONSTRAINT "Prospekt_organisasjonId_fkey" FOREIGN KEY ("organisasjonId") REFERENCES "Organisasjon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospekt" ADD CONSTRAINT "Prospekt_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospekt" ADD CONSTRAINT "Prospekt_maalgruppeId_fkey" FOREIGN KEY ("maalgruppeId") REFERENCES "Maalgruppe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kundeforhold" ADD CONSTRAINT "Kundeforhold_organisasjonId_fkey" FOREIGN KEY ("organisasjonId") REFERENCES "Organisasjon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dialog" ADD CONSTRAINT "Dialog_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialogMelding" ADD CONSTRAINT "DialogMelding_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "Dialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avtale" ADD CONSTRAINT "Avtale_organisasjonId_fkey" FOREIGN KEY ("organisasjonId") REFERENCES "Organisasjon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avtale" ADD CONSTRAINT "Avtale_kundeId_fkey" FOREIGN KEY ("kundeId") REFERENCES "Kundeforhold"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avtale" ADD CONSTRAINT "Avtale_prospektId_fkey" FOREIGN KEY ("prospektId") REFERENCES "Prospekt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avtale" ADD CONSTRAINT "Avtale_produktId_fkey" FOREIGN KEY ("produktId") REFERENCES "Produkt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oppgave" ADD CONSTRAINT "Oppgave_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oppgave" ADD CONSTRAINT "Oppgave_prospektId_fkey" FOREIGN KEY ("prospektId") REFERENCES "Prospekt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oppgave" ADD CONSTRAINT "Oppgave_tildeltBrukerId_fkey" FOREIGN KEY ("tildeltBrukerId") REFERENCES "Bruker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sperreliste" ADD CONSTRAINT "Sperreliste_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sperreliste" ADD CONSTRAINT "Sperreliste_organisasjonId_fkey" FOREIGN KEY ("organisasjonId") REFERENCES "Organisasjon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Utsending" ADD CONSTRAINT "Utsending_avsenderId_fkey" FOREIGN KEY ("avsenderId") REFERENCES "Avsender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Utsending" ADD CONSTRAINT "Utsending_dialogMeldingId_fkey" FOREIGN KEY ("dialogMeldingId") REFERENCES "DialogMelding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Utsending" ADD CONSTRAINT "Utsending_sekvensStegId_fkey" FOREIGN KEY ("sekvensStegId") REFERENCES "SekvensSteg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SekvensVersjon" ADD CONSTRAINT "SekvensVersjon_sekvensId_fkey" FOREIGN KEY ("sekvensId") REFERENCES "Sekvens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SekvensSteg" ADD CONSTRAINT "SekvensSteg_versjonId_fkey" FOREIGN KEY ("versjonId") REFERENCES "SekvensVersjon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspektSekvens" ADD CONSTRAINT "ProspektSekvens_prospektId_fkey" FOREIGN KEY ("prospektId") REFERENCES "Prospekt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspektSekvens" ADD CONSTRAINT "ProspektSekvens_versjonId_fkey" FOREIGN KEY ("versjonId") REFERENCES "SekvensVersjon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StegKjoering" ADD CONSTRAINT "StegKjoering_prospektSekvensId_fkey" FOREIGN KEY ("prospektSekvensId") REFERENCES "ProspektSekvens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StegKjoering" ADD CONSTRAINT "StegKjoering_stegId_fkey" FOREIGN KEY ("stegId") REFERENCES "SekvensSteg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Godkjenning" ADD CONSTRAINT "Godkjenning_dialogMeldingId_fkey" FOREIGN KEY ("dialogMeldingId") REFERENCES "DialogMelding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Godkjenningsbeslutning" ADD CONSTRAINT "Godkjenningsbeslutning_godkjenningId_fkey" FOREIGN KEY ("godkjenningId") REFERENCES "Godkjenning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Godkjenningsbeslutning" ADD CONSTRAINT "Godkjenningsbeslutning_brukerId_fkey" FOREIGN KEY ("brukerId") REFERENCES "Bruker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revisjon" ADD CONSTRAINT "Revisjon_dialogMeldingId_fkey" FOREIGN KEY ("dialogMeldingId") REFERENCES "DialogMelding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CronKjoering" ADD CONSTRAINT "CronKjoering_cronJobbId_fkey" FOREIGN KEY ("cronJobbId") REFERENCES "CronJobb"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sesjon" ADD CONSTRAINT "Sesjon_brukerId_fkey" FOREIGN KEY ("brukerId") REFERENCES "Bruker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
