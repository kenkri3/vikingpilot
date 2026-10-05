/**
 * Godkjenningskøen — verktøyflate.
 *
 * To slags tilgang, med vilje forskjellige:
 *
 *   GET                        krever innlogget menneske. Se hva som venter.
 *   POST { handling: "foreslaa" }  krever hemmelighet. Agenten legger inn forslag.
 *   POST { handling: "godkjenn" | "avvis" }  krever innlogget menneske.
 *
 * En agent kan ALDRI godkjenne. Det er ikke en konvensjon — det er håndhevet her,
 * ved at avgjørelser krever en sesjon og ikke en hemmelighet.
 */

import { NextResponse } from "next/server";

import { hvemErInnlogget } from "@/lib/auth/innlogging";
import { sjekkHemmelighetNavn } from "@/lib/auth/hemmelighet";
import { forMangeForesporsler, klientNokkel, rateLimitAktiv, sjekkRateLimit } from "@/lib/ratelimit";
import { feilmelding, logg } from "@/lib/logg";
import {
  avvis,
  godkjenn,
  hentMedHistorikk,
  koStatus,
  leggIForslag,
  ventende,
} from "@/lib/godkjenning/ko";

export const dynamic = "force-dynamic";

function uautorisert(melding: string, status = 401): Response {
  return NextResponse.json({ feil: "uautorisert", melding }, { status });
}

export async function GET(request: Request): Promise<Response> {
  if (rateLimitAktiv()) {
    const grense = sjekkRateLimit(klientNokkel(request.headers, "ko-les"), 120, 60_000);
    if (!grense.tillatt) return forMangeForesporsler(grense);
  }

  // Bare et innlogget menneske får se køen.
  let bruker = null;
  try {
    bruker = await hvemErInnlogget();
  } catch {
    bruker = null;
  }

  if (!bruker) {
    return uautorisert("Køen krever innlogging.");
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  try {
    if (id) {
      const enkelt = await hentMedHistorikk(id);
      if (!enkelt) {
        return NextResponse.json({ feil: "ikke_funnet", melding: `Fant ingen godkjenning med id ${id}.` }, { status: 404 });
      }
      return NextResponse.json(enkelt);
    }

    const [liste, status] = await Promise.all([ventende(100), koStatus()]);
    return NextResponse.json({ ko: status, venter: liste });
  } catch (feil) {
    logg.feil("Kunne ikke lese køen", { feil });
    return NextResponse.json({ feil: "intern_feil", melding: feilmelding(feil) }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (rateLimitAktiv()) {
    const grense = sjekkRateLimit(klientNokkel(request.headers, "ko-skriv"), 60, 60_000);
    if (!grense.tillatt) return forMangeForesporsler(grense);
  }

  let kropp: Record<string, unknown>;
  try {
    kropp = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ feil: "ugyldig_json", melding: "Kroppen må være gyldig JSON." }, { status: 400 });
  }

  const handling = String(kropp.handling ?? "").toLowerCase();

  // --- Legge inn et forslag: krever hemmelighet, ikke sesjon. ---
  if (handling === "foreslaa" || handling === "foreslå") {
    const auth = sjekkHemmelighetNavn(request, "CRON_SECRET_SEKVENS", "Køen");
    if (!auth.ok) return uautorisert(auth.grunn, auth.status);

    try {
      const forslag = await leggIForslag({
        tittel: String(kropp.tittel ?? "Uten tittel"),
        begrunnelse: typeof kropp.begrunnelse === "string" ? kropp.begrunnelse : null,
        gjelder: typeof kropp.gjelder === "string" ? kropp.gjelder : null,
        kanal: (kropp.kanal as "EPOST" | undefined) ?? "EPOST",
        kontaktId: typeof kropp.kontaktId === "string" ? kropp.kontaktId : null,
        organisasjonId: typeof kropp.organisasjonId === "string" ? kropp.organisasjonId : null,
        risiko: typeof kropp.risiko === "string" ? kropp.risiko : null,
        forslagFra: typeof kropp.forslagFra === "string" ? kropp.forslagFra : "AGENT",
        brukerAgent: typeof kropp.brukerAgent === "string" ? kropp.brukerAgent : null,
      });

      return NextResponse.json(forslag);
    } catch (feil) {
      logg.feil("Kunne ikke legge forslag i køen", { feil });
      return NextResponse.json({ feil: "intern_feil", melding: feilmelding(feil) }, { status: 500 });
    }
  }

  // --- Avgjørelser: krever innlogget menneske. Aldri hemmelighet. ---
  if (handling === "godkjenn" || handling === "avvis") {
    let bruker = null;
    try {
      bruker = await hvemErInnlogget();
    } catch {
      bruker = null;
    }

    if (!bruker) {
      return uautorisert(
        "En godkjennelse krever innlogging. En hemmelighet er ikke nok — systemet skal vite hvilket menneske som bestemte.",
      );
    }

    const godkjenningId = String(kropp.id ?? "");
    if (!godkjenningId) {
      return NextResponse.json({ feil: "mangler_id", melding: "Oppgi id på godkjenningen." }, { status: 400 });
    }

    const beslutning = {
      godkjenningId,
      brukerEpost: bruker.epost,
      brukerId: bruker.id,
      kommentar: typeof kropp.kommentar === "string" ? kropp.kommentar : null,
    };

    const resultat =
      handling === "godkjenn" ? await godkjenn(beslutning) : await avvis(beslutning);

    if (!resultat.ok) {
      return NextResponse.json({ feil: "avvist", melding: resultat.grunn }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      status: resultat.status,
      av: bruker.epost,
      melding:
        resultat.status === "GODKJENT"
          ? "Godkjent. Meldingen sendes av utsendingsjobben når kanalen er åpen."
          : "Avvist.",
    });
  }

  return NextResponse.json(
    {
      feil: "ukjent_handling",
      melding: "handling må være en av: foreslaa, godkjenn, avvis.",
    },
    { status: 400 },
  );
}
