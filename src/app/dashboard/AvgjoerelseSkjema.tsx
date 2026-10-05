"use client";

/**
 * Knapper for å godkjenne eller avvise i køen.
 *
 * En avgjørelse er endelig. Derfor krever avvisning en bekreftelse — et feilklikk
 * på «avvis» skal ikke kunne kaste bort et gjennomarbeidet utkast.
 */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { avvisHandling, godkjennHandling, type AvgjoerelseTilstand } from "./actions";

function Knapp({ tekst, variant }: { tekst: string; variant: "godkjenn" | "avvis" }) {
  const { pending } = useFormStatus();

  const stil =
    variant === "godkjenn"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
      : "border-red-300 bg-red-50 text-red-900 hover:bg-red-100";

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${stil}`}
    >
      {pending ? "…" : tekst}
    </button>
  );
}

export default function AvgjoerelseSkjema({ id }: { id: string }) {
  const [godkjennTilstand, godkjenn] = useActionState<AvgjoerelseTilstand, FormData>(
    godkjennHandling,
    {},
  );
  const [avvisTilstand, avvis] = useActionState<AvgjoerelseTilstand, FormData>(avvisHandling, {});

  const melding = godkjennTilstand.feil ?? avvisTilstand.feil;
  const ok = godkjennTilstand.ok ?? avvisTilstand.ok;

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <form action={godkjenn}>
          <input type="hidden" name="id" value={id} />
          <Knapp tekst="Godkjenn" variant="godkjenn" />
        </form>

        <form
          action={avvis}
          onSubmit={(e) => {
            if (!confirm("Avvise dette utkastet? Det blir ikke sendt, og avgjørelsen kan ikke angres.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={id} />
          <Knapp tekst="Avvis" variant="avvis" />
        </form>
      </div>

      {melding ? (
        <p role="alert" className="mt-1.5 text-xs text-red-700">
          {melding}
        </p>
      ) : null}

      {ok ? <p className="mt-1.5 text-xs text-emerald-700">{ok}</p> : null}
    </div>
  );
}
