/**
 * Cron: Enhetsregister-pipeline.
 *
 * Henter, normaliserer, filtrerer og lagrer nye virksomheter.
 *
 * Tre ting oppdraget krever av hver cron-rute:
 *
 *   1. Egen hemmelighet. Mister vi denne, slutter bare denne jobben å virke.
 *   2. Tørrkjøringsmodus. Standard er tørrkjøring, og den logger hva den ville gjort.
 *   3. Logging. Feiler jobben, skal den si det — ikke tie.
 *
 * Kjør med:
 *   GET /api/cron/enhetsregister                        tørrkjøring
 *   GET /api/cron/enhetsregister?torrkjoering=false     ekte kjøring
 *   GET /api/cron/enhetsregister?sider=3&antall=100     valgfritt omfang
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { feilmelding, logg } from "@/lib/logg";
import { forMangeForesporsler, klientNokkel, sjekkRateLimit } from "@/lib/ratelimit";
import { sjekkHemmelighet, vilTorrkjoere } from "@/lib/cron/felles";
import { hentSider } from "@/lib/enhetsregister/hent";
import { filtrerVirksomheter, type FilterKonfig } from "@/lib/enhetsregister/filter";
import type { NormalisertVirksomhet } from "@/lib/enhetsregister/normaliser";
import { skrivRevisjon } from "@/lib/revisjon";

export const dynamic = "force-dynamic";

/** Navnet på jobben. Brukes i logg, revisjon og dashbord. */
const NAVN = "enhetsregister";

/** Hvor mange sider per kjøring, hvis ikke annet er oppgitt. */
const STANDARD_SIDER = 1;
const STANDARD_ANTALL = 100;

function tallFraQuery(url: URL, navn: string, standard: number, maks: number): number {
  const raa = url.searchParams.get(navn);
  if (!raa) return standard;

  const n = Number.parseInt(raa, 10);
  if (!Number.isFinite(n) || n < 1) return standard;

  return Math.min(n, maks);
}

export async function POST(request: Request): Promise<Response> {
  return handter(request);
}

export async function GET(request: Request): Promise<Response> {
  return handter(request);
}

async function handter(request: Request): Promise<Response> {
  const startet = Date.now();
  const url = new URL(request.url);

  // Rate limiting, også på cron. Hemmeligheten er ikke et frikort mot hamring.
  const grense = sjekkRateLimit(klientNokkel(request.headers, `cron:${NAVN}`), 30, 60_000);
  if (!grense.tillatt) {
    return forMangeForesporsler(grense);
  }

  const hemmelighet = sjekkHemmelighet(request, "CRON_SECRET_ENHETSREGISTER");
  if (!hemmelighet.ok) {
    logg.advarsel("Cron avvist", { jobb: NAVN, grunn: hemmelighet.grunn });
    return NextResponse.json(
      { feil: "uautorisert", melding: hemmelighet.grunn },
      { status: hemmelighet.status },
    );
  }

  const torrkjoering = vilTorrkjoere(request);
  const maksSider = tallFraQuery(url, "sider", STANDARD_SIDER, 50);
  const antall = tallFraQuery(url, "antall", STANDARD_ANTALL, 1000);

  const kjoering = await prisma.cronKjoering.create({
    data: { navn: NAVN, status: "KJORER", torrkjoering },
  });

  try {
    // 1. Hvilken målgruppe gjelder? Dette er konfigurasjon, ikke kode.
    const maalgruppe = await prisma.maalgruppe.findFirst({
      where: { aktiv: true },
      orderBy: { prioritet: "desc" },
    });

    const konfig: FilterKonfig = maalgruppe
      ? {
          naeringskoder: maalgruppe.naeringskoder,
          fylker: maalgruppe.fylker,
          minAnsatte: maalgruppe.minAnsatte,
          maxAnsatte: maalgruppe.maxAnsatte,
          minAlderMaaneder: maalgruppe.minAlderMaaneder,
          ekskluderOffentlig: maalgruppe.ekskluderOffentlig,
          ekskluderKonkurs: maalgruppe.ekskluderKonkurs,
          ekskluderUnderAvvikling: maalgruppe.ekskluderUnderAvvikling,
        }
      : {
          naeringskoder: [],
          fylker: [],
          minAnsatte: null,
          maxAnsatte: null,
          minAlderMaaneder: null,
          ekskluderOffentlig: true,
          ekskluderKonkurs: true,
          ekskluderUnderAvvikling: true,
        };

    // 2. Hent. Enhetsregisteret er åpent og krever ingen nøkkel.
    const hentet = await hentSider(maksSider, { antall });

    if (!hentet.ok) {
      const melding = hentet.feil ?? "Ukjent feil under henting.";

      await prisma.cronKjoering.update({
        where: { id: kjoering.id },
        data: {
          status: "FEILET",
          avsluttet: new Date(),
          varighetMs: Date.now() - startet,
          antallFeil: 1,
          feilmelding: melding,
        },
      });

      await prisma.cronJobb.updateMany({
        where: { navn: NAVN },
        data: { sisteKjoering: new Date(), sisteStatus: "FEILET", sisteFeil: melding },
      });

      logg.feil("Enhetsregister-henting feilet", { jobb: NAVN, feil: melding });

      return NextResponse.json(
        { jobb: NAVN, torrkjoering, status: "feilet", feilmelding: melding },
        { status: 502 },
      );
    }

    // 3. Filtrer deterministisk.
    const filtrert = filtrerVirksomheter(hentet.virksomheter, konfig, new Date());

    // 4. Lagre — men ikke i tørrkjøring.
    let nye = 0;
    let oppdaterte = 0;
    const feil: string[] = [];

    if (!torrkjoering) {
      for (const virksomhet of filtrert.godkjente) {
        try {
          const resultat = await lagreVirksomhet(virksomhet, maalgruppe?.id ?? null);
          if (resultat.ny) nye += 1;
          else oppdaterte += 1;
        } catch (feilPerRad) {
          // Én dårlig rad skal ikke velte hele kjøringen.
          feil.push(`${virksomhet.orgnr}: ${feilmelding(feilPerRad)}`);
        }
      }
    }

    const melding = torrkjoering
      ? `Tørrkjøring. Ville hentet ${hentet.virksomheter.length}, godkjent ${filtrert.godkjente.length}, avvist ${filtrert.avviste.length}. Ingenting er skrevet.`
      : `Hentet ${hentet.virksomheter.length}, godkjent ${filtrert.godkjente.length}, opprettet ${nye}, oppdatert ${oppdaterte}, avvist ${filtrert.avviste.length}.`;

    await prisma.cronKjoering.update({
      where: { id: kjoering.id },
      data: {
        status: torrkjoering ? "TORRKJORT" : "FULLFOERT",
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        antallUtfort: torrkjoering ? 0 : nye + oppdaterte,
        antallFeil: feil.length,
        melding,
        detaljer: {
          endepunkt: hentet.endepunkt,
          sider: hentet.sider,
          mottatt: hentet.mottatt,
          forkastet: hentet.forkastet.length,
          opptelling: filtrert.opptelling,
        },
      },
    });

    await prisma.cronJobb.updateMany({
      where: { navn: NAVN },
      data: { sisteKjoering: new Date(), sisteStatus: "FULLFOERT", sisteFeil: null },
    });

    await prisma.pipelineKjoering.create({
      data: {
        maalgruppeId: maalgruppe?.id ?? null,
        status: torrkjoering ? "TORRKJORT" : feil.length > 0 ? "FEILET" : "FULLFOERT",
        torrkjoering,
        hentet: hentet.mottatt,
        normalisert: hentet.virksomheter.length,
        filtrertBort: filtrert.avviste.length,
        opprettet: nye,
        oppdatert: oppdaterte,
        feil: feil.length,
        feilmelding: feil.length > 0 ? feil.slice(0, 5).join("; ") : null,
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        detaljer: { opptelling: filtrert.opptelling, sider: hentet.sider },
      },
    });

    await skrivRevisjon({
      handling: "ENHETSREGISTER_KJORT",
      aktor: "SYSTEMET",
      aktorType: "SYSTEMET",
      entitet: "PipelineKjoering",
      grunnlag: `Cron-jobb ${NAVN}, ${torrkjoering ? "tørrkjøring" : "ekte kjøring"}.`,
      resultat: melding,
      resultatStatus: torrkjoering ? "torrkjoert" : "ok",
      kilde: `api/cron/${NAVN}`,
      metadata: {
        endepunkt: hentet.endepunkt,
        mottatt: hentet.mottatt,
        godkjent: filtrert.godkjente.length,
        avvist: filtrert.avviste.length,
      },
    });

    logg.info("Enhetsregister-pipeline kjørte", {
      jobb: NAVN,
      torrkjoering,
      mottatt: hentet.mottatt,
      godkjent: filtrert.godkjente.length,
      nye,
    });

    return NextResponse.json({
      jobb: NAVN,
      torrkjoering,
      status: torrkjoering ? "torrkjoert" : "fullfoert",
      melding,
      endepunkt: hentet.endepunkt,
      sider: hentet.sider,
      mottatt: hentet.mottatt,
      forkastet: hentet.forkastet.slice(0, 10),
      godkjent: filtrert.godkjente.length,
      avvist: filtrert.avviste.length,
      opptelling: filtrert.opptelling,
      opprettet: nye,
      oppdatert: oppdaterte,
      feil: feil.slice(0, 10),
      varighetMs: Date.now() - startet,
      // I tørrkjøring viser vi hva som ville skjedd, uten å skrive noe.
      eksempler: torrkjoering
        ? filtrert.godkjente.slice(0, 5).map((v) => ({
            orgnr: v.orgnr,
            navn: v.navn,
            fylke: v.fylke,
            ansatte: v.antallAnsatte,
          }))
        : undefined,
    });
  } catch (feil) {
    const melding = feilmelding(feil);

    await prisma.cronKjoering.update({
      where: { id: kjoering.id },
      data: {
        status: "FEILET",
        avsluttet: new Date(),
        varighetMs: Date.now() - startet,
        antallFeil: 1,
        feilmelding: melding,
      },
    });

    await prisma.cronJobb.updateMany({
      where: { navn: NAVN },
      data: { sisteKjoering: new Date(), sisteStatus: "FEILET", sisteFeil: melding },
    });

    logg.feil("Cron feilet", { jobb: NAVN, feil });

    return NextResponse.json({ jobb: NAVN, status: "feilet", feilmelding: melding }, { status: 500 });
  }
}

/**
 * Lagrer én virksomhet og oppretter et prospekt hvis den er ny.
 *
 * Er virksomheten der fra før, oppdaterer vi feltene fra registeret — men vi
 * rører ikke prospektets status. At noen allerede har vurdert det, skal ikke
 * overskrives av en cron-jobb.
 */
async function lagreVirksomhet(
  virksomhet: NormalisertVirksomhet,
  maalgruppeId: string | null,
): Promise<{ ny: boolean }> {
  const eksisterende = await prisma.organisasjon.findUnique({
    where: { orgnr: virksomhet.orgnr },
    select: { id: true },
  });

  const data = {
    navn: virksomhet.navn,
    normalisertNavn: virksomhet.normalisertNavn,
    organisasjonsform: virksomhet.organisasjonsform,
    naeringskode: virksomhet.naeringskode,
    naeringsbeskrivelse: virksomhet.naeringsbeskrivelse,
    sektor: virksomhet.sektor,
    antallAnsatte: virksomhet.antallAnsatte,
    stiftetDato: virksomhet.stiftetDato,
    registrertDato: virksomhet.registrertDato,
    konkurs: virksomhet.konkurs,
    underAvvikling: virksomhet.underAvvikling,
    adresse: virksomhet.adresse,
    postnummer: virksomhet.postnummer,
    poststed: virksomhet.poststed,
    fylke: virksomhet.fylke,
    kommunenummer: virksomhet.kommunenummer,
    nettside: virksomhet.nettside,
    sistHentet: new Date(),
  };

  const org = await prisma.organisasjon.upsert({
    where: { orgnr: virksomhet.orgnr },
    update: data,
    create: { orgnr: virksomhet.orgnr, kilde: "ENHETSREGISTERET", ...data },
    select: { id: true },
  });

  if (eksisterende) {
    return { ny: false };
  }

  // Ny virksomhet: opprett et prospekt hvis den hører til en målgruppe.
  if (maalgruppeId) {
    await prisma.prospekt.upsert({
      where: { organisasjonId_maalgruppeId: { organisasjonId: org.id, maalgruppeId } },
      update: {},
      create: {
        organisasjonId: org.id,
        maalgruppeId,
        status: "NY",
        kilde: "ENHETSREGISTERET",
      },
    });
  }

  return { ny: true };
}
