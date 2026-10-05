"use server";

/**
 * Serverhandlinger for innlogging og utlogging.
 *
 * Alle åpne endepunkter har rate limiting. Innlogging er det mest utsatte
 * punktet i hele systemet, så det har en egen, streng grense.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { loggInn, loggUt } from "@/lib/auth/innlogging";
import { klientNokkel, sjekkRateLimit } from "@/lib/ratelimit";
import { logg } from "@/lib/logg";
import { settSesjonscookie, fjernSesjonscookie } from "@/lib/auth/sesjon";

export type LoginTilstand = { feil?: string };

export async function loggInnHandling(
  _forrige: LoginTilstand,
  formData: FormData,
): Promise<LoginTilstand> {
  const epost = String(formData.get("epost") ?? "");
  const passord = String(formData.get("passord") ?? "");

  const hode = await headers();
  const ip = hode.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "ukjent";

  // 10 forsøk per minutt per IP. Over det svarer vi uten å sjekke passordet.
  const grense = sjekkRateLimit(klientNokkel(hode, "innlogging"), 10, 60_000);
  if (!grense.tillatt) {
    logg.advarsel("Innlogging rate-limited", { ip });
    return { feil: "For mange forsøk. Vent et minutt og prøv igjen." };
  }

  if (!epost || !passord) {
    return { feil: "Fyll ut både e-post og passord." };
  }

  try {
    const resultat = await loggInn(epost, passord, ip);

    if (!resultat.ok) {
      return { feil: resultat.melding };
    }

    await settSesjonscookie(resultat.token);
  } catch (feil) {
    // Feiler databasen, sier vi det — vi later ikke som påloggingen virket.
    logg.feil("Innlogging feilet teknisk", { feil });
    return {
      feil: "Kunne ikke logge inn nå. Sjekk at databasen er tilgjengelig, se docs/manuell-oppsett.md.",
    };
  }

  redirect("/dashboard");
}

export async function loggUtHandling(): Promise<void> {
  await loggUt();
  await fjernSesjonscookie();
  redirect("/login");
}
