"use server";

/**
 * Serverhandlinger for godkjenningskøen.
 *
 * Denne filen er kjøreturen for et menneske. Den bruker `hvemErInnlogget()`,
 * altså en sesjon — ikke en hemmelighet. Det er hele poenget: en avgjørelse
 * skal kunne knyttes til et navngitt menneske, og en agent skal ikke kunne ta
 * den. Se docs/beslutninger.md B-025.
 */

import { revalidatePath } from "next/cache";

import { hvemErInnlogget } from "@/lib/auth/innlogging";
import { avvis, godkjenn } from "@/lib/godkjenning/ko";
import { logg } from "@/lib/logg";

export type AvgjoerelseTilstand = { feil?: string; ok?: string };

async function krevInnlogget(): Promise<
  { ok: true; epost: string; id: string } | { ok: false; feil: string }
> {
  let bruker = null;

  try {
    bruker = await hvemErInnlogget();
  } catch {
    bruker = null;
  }

  if (!bruker) {
    return { ok: false, feil: "Du er ikke innlogget. Logg inn på nytt og prøv igjen." };
  }

  return { ok: true, epost: bruker.epost, id: bruker.id };
}

/**
 * Godkjenner et forslag.
 *
 * Merk: godkjenning fører IKKE til at noe sendes. Det gjør meldingen klar for
 * utsendingsjobben, som fortsatt må slippe den gjennom hele guardrail-kjeden —
 * og kanalen må være åpen.
 */
export async function godkjennHandling(
  _forrige: AvgjoerelseTilstand,
  formData: FormData,
): Promise<AvgjoerelseTilstand> {
  const innlogget = await krevInnlogget();
  if (!innlogget.ok) return { feil: innlogget.feil };

  const id = String(formData.get("id") ?? "");
  if (!id) return { feil: "Mangler id på godkjenningen." };

  const resultat = await godkjenn({
    godkjenningId: id,
    brukerEpost: innlogget.epost,
    brukerId: innlogget.id,
    kommentar: String(formData.get("kommentar") ?? "") || null,
  });

  if (!resultat.ok) {
    logg.advarsel("Godkjenning avvist i dashbordet", { id, grunn: resultat.grunn });
    return { feil: resultat.grunn };
  }

  revalidatePath("/dashboard");

  return {
    ok: "Godkjent. Meldingen er klar, men sendes ikke før kanalen er åpen og utsendingsjobben slipper den gjennom.",
  };
}

/** Avviser et forslag. Meldingen blir aldri sendt. */
export async function avvisHandling(
  _forrige: AvgjoerelseTilstand,
  formData: FormData,
): Promise<AvgjoerelseTilstand> {
  const innlogget = await krevInnlogget();
  if (!innlogget.ok) return { feil: innlogget.feil };

  const id = String(formData.get("id") ?? "");
  if (!id) return { feil: "Mangler id på godkjenningen." };

  const resultat = await avvis({
    godkjenningId: id,
    brukerEpost: innlogget.epost,
    brukerId: innlogget.id,
    kommentar: String(formData.get("kommentar") ?? "") || null,
  });

  if (!resultat.ok) {
    return { feil: resultat.grunn };
  }

  revalidatePath("/dashboard");

  return { ok: "Avvist. Meldingen blir ikke sendt." };
}
