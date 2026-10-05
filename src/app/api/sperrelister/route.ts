/**
 * Sperrelister — verktøyflate.
 *
 * Denne ruten er grensesnittet agenten senere kaller. Logikken ligger i
 * src/lib/guards/sperreliste.ts, og den pakkes inn som MCP-verktøy uten å
 * skrives om. Se docs/beslutninger.md B-003.
 *
 * To operasjoner:
 *   GET  ?epost=…                 sjekk om en mottaker er sperret
 *   POST { … }                    legg inn en sperre
 *
 * Hemmeligheten er CRON_SECRET_UTSENDING — samme nøkkel som styrer utsending,
 * fordi begge gjelder om noe får gå ut.
 */

import { NextResponse } from "next/server";

import type { Kanal, SperreGrunn, SperreType } from "@/generated/prisma/enums";
import { sjekkHemmelighetNavn } from "@/lib/auth/hemmelighet";
import {
  forMangeForesporsler,
  klientNokkel,
  rateLimitAktiv,
  sjekkRateLimit,
} from "@/lib/ratelimit";
import { feilmelding, logg } from "@/lib/logg";
import { leggTilSperre, sjekkSperreliste } from "@/lib/guards/sperreliste";
import { skrivRevisjon } from "@/lib/revisjon";

export const dynamic = "force-dynamic";

const HEMMELIGHET = "CRON_SECRET_UTSENDING";

const GYLDIGE_TYPER: SperreType[] = [
  "GLOBAL",
  "KANAL",
  "KONTAKT",
  "ORGANISASJON",
  "EPOSTDOMENE",
];

const GYLDIGE_GRUNNER: SperreGrunn[] = [
  "AVMELDING",
  "BOUNCE",
  "KLAGE",
  "EKSISTERENDE_KUNDE",
  "AKTIV_DIALOG",
  "MANUELL",
  "KONKURS",
  "OFFENTLIG_SEKTOR",
  "RESERVASJON",
];

const GYLDIGE_KANALER: Kanal[] = ["EPOST", "TELEFON", "SMS", "LINKEDIN", "WEBHOOK", "MANUELL"];

function uautorisert(resultat: { grunn: string; status: number }): Response {
  return NextResponse.json({ feil: "uautorisert", melding: resultat.grunn }, { status: resultat.status });
}

/** GET: sjekk om en mottaker er sperret. */
export async function GET(request: Request): Promise<Response> {
  if (rateLimitAktiv()) {
    const grense = sjekkRateLimit(klientNokkel(request.headers, "sperreliste"), 60, 60_000);
    if (!grense.tillatt) return forMangeForesporsler(grense);
  }

  const auth = sjekkHemmelighetNavn(request, HEMMELIGHET, "Sperreliste-verktøyet");
  if (!auth.ok) {
    logg.advarsel("Sperreliste avvist", { grunn: auth.grunn });
    return uautorisert(auth);
  }

  const url = new URL(request.url);
  const epost = url.searchParams.get("epost");
  const kanal = (url.searchParams.get("kanal") ?? "EPOST") as Kanal;
  const kontaktId = url.searchParams.get("kontaktId");
  const organisasjonId = url.searchParams.get("organisasjonId");

  if (!GYLDIGE_KANALER.includes(kanal)) {
    return NextResponse.json(
      { feil: "ugyldig_kanal", melding: `Kanalen «${kanal}» finnes ikke.` },
      { status: 400 },
    );
  }

  if (!epost && !kontaktId && !organisasjonId) {
    return NextResponse.json(
      {
        feil: "mangler_mottaker",
        melding: "Oppgi minst én av epost, kontaktId eller organisasjonId.",
      },
      { status: 400 },
    );
  }

  try {
    const svar = await sjekkSperreliste({ kanal, epost, kontaktId, organisasjonId });
    return NextResponse.json(svar);
  } catch (feil) {
    logg.feil("Sperresjekk feilet", { feil });
    return NextResponse.json(
      { feil: "intern_feil", melding: feilmelding(feil) },
      { status: 500 },
    );
  }
}

/** POST: legg inn en sperre. */
export async function POST(request: Request): Promise<Response> {
  if (rateLimitAktiv()) {
    const grense = sjekkRateLimit(klientNokkel(request.headers, "sperreliste-skriv"), 30, 60_000);
    if (!grense.tillatt) return forMangeForesporsler(grense);
  }

  const auth = sjekkHemmelighetNavn(request, HEMMELIGHET, "Sperreliste-verktøyet");
  if (!auth.ok) {
    logg.advarsel("Sperreliste avvist", { grunn: auth.grunn });
    return uautorisert(auth);
  }

  let kropp: unknown;
  try {
    kropp = await request.json();
  } catch {
    return NextResponse.json(
      { feil: "ugyldig_json", melding: "Kroppen må være gyldig JSON." },
      { status: 400 },
    );
  }

  const data = kropp as Record<string, unknown>;
  const type = data.type as SperreType;
  const grunn = data.grunn as SperreGrunn;

  if (!GYLDIGE_TYPER.includes(type)) {
    return NextResponse.json(
      { feil: "ugyldig_type", melding: `type må være en av: ${GYLDIGE_TYPER.join(", ")}.` },
      { status: 400 },
    );
  }

  if (!GYLDIGE_GRUNNER.includes(grunn)) {
    return NextResponse.json(
      { feil: "ugyldig_grunn", melding: `grunn må være en av: ${GYLDIGE_GRUNNER.join(", ")}.` },
      { status: 400 },
    );
  }

  const kanal = data.kanal as Kanal | undefined;
  if (kanal && !GYLDIGE_KANALER.includes(kanal)) {
    return NextResponse.json(
      { feil: "ugyldig_kanal", melding: `kanal må være en av: ${GYLDIGE_KANALER.join(", ")}.` },
      { status: 400 },
    );
  }

  try {
    const resultat = await leggTilSperre({
      type,
      grunn,
      epost: typeof data.epost === "string" ? data.epost : null,
      epostDomene: typeof data.epostDomene === "string" ? data.epostDomene : null,
      kontaktId: typeof data.kontaktId === "string" ? data.kontaktId : null,
      organisasjonId: typeof data.organisasjonId === "string" ? data.organisasjonId : null,
      kanal: kanal ?? null,
      notat: typeof data.notat === "string" ? data.notat : null,
      kilde: typeof data.kilde === "string" ? data.kilde : "api",
      opprettetAv: typeof data.opprettetAv === "string" ? data.opprettetAv : null,
    });

    if (resultat.ny) {
      await skrivRevisjon({
        handling: "SPERRE_OPPRETTET",
        aktor: typeof data.opprettetAv === "string" ? data.opprettetAv : "API",
        aktorType: "BRUKER",
        entitet: "Sperreliste",
        entitetId: resultat.id,
        kanal: kanal ?? null,
        grunnlag: `Sperre lagt inn via verktøyflaten. type=${type}, grunn=${grunn}`,
        resultat: "Sperret",
        resultatStatus: "ok",
        kilde: "api/sperrelister",
        metadata: { type, grunn, epost: data.epost ?? null },
      });
    }

    return NextResponse.json({ id: resultat.id, ny: resultat.ny });
  } catch (feil) {
    logg.feil("Kunne ikke legge inn sperre", { feil });
    return NextResponse.json(
      { feil: "intern_feil", melding: feilmelding(feil) },
      { status: 500 },
    );
  }
}
