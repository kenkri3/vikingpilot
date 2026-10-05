import { redirect } from "next/navigation";

import { hvemErInnlogget } from "@/lib/auth/innlogging";
import LoginSkjema from "./LoginSkjema";

export const dynamic = "force-dynamic";

export default async function LoginSide() {
  let innlogget = null;

  try {
    innlogget = await hvemErInnlogget();
  } catch {
    // Databasen er ikke tilgjengelig. Vi viser skjemaet likevel, slik at
    // brukeren får en forståelig side i stedet for en krasj.
    innlogget = null;
  }

  if (innlogget) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">VikingPilot</h1>
          <p className="mt-1.5 text-sm text-dempet">
            Internt system for Vikingnet. Finner, kvalifiserer og forbereder.
          </p>
        </div>

        <div className="rounded-lg border border-kant bg-kort p-6 shadow-sm">
          <LoginSkjema />
        </div>

        <p className="mt-6 text-center text-xs text-dempet">
          All utgående trafikk er av som standard. Ingenting sendes før det slås på, per kanal.
        </p>
      </div>
    </main>
  );
}
