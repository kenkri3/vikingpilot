import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { hvemErInnlogget } from "@/lib/auth/innlogging";
import { integrasjonsstatus } from "@/lib/config";
import { norskTid } from "@/lib/tid/vinduer";
import { erHelligdag, helligdagNavn } from "@/lib/tid/helligdager";
import { loggUtHandling } from "@/app/login/actions";
import AvgjoerelseSkjema from "./AvgjoerelseSkjema";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

/** Formaterer et tidspunkt i norsk tid. */
function tid(dato: Date | null | undefined): string {
  if (!dato) return "aldri";
  const n = norskTid(dato);
  return `${n.dato} ${String(n.time).padStart(2, "0")}:${String(n.minutt).padStart(2, "0")}`;
}

/**
 * Kjører en databasespørring og fanger feil.
 *
 * Er databasen nede, skal dashbordet fortsatt vises — med en ærlig melding —
 * i stedet for å krasje. Se kravet om at systemet skal fortsette å virke.
 */
async function trygt<T>(spørring: () => Promise<T>, standard: T): Promise<{ data: T; feil: string | null }> {
  try {
    return { data: await spørring(), feil: null };
  } catch (feil) {
    const melding = feil instanceof Error ? feil.message : String(feil);
    return { data: standard, feil: melding };
  }
}

function Kort({
  tittel,
  antall,
  beskrivelse,
  tom,
  children,
}: {
  tittel: string;
  antall: number;
  beskrivelse: string;
  tom: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-kant bg-kort p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{tittel}</h2>
          <p className="mt-0.5 text-xs text-dempet">{beskrivelse}</p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium tabular-nums text-neutral-700">
          {antall}
        </span>
      </header>
      {antall === 0 ? <p className="text-sm text-dempet">{tom}</p> : children}
    </section>
  );
}

// ---------------------------------------------------------------------------

export default async function Dashbord() {
  let bruker = null;
  try {
    bruker = await hvemErInnlogget();
  } catch {
    bruker = null;
  }

  if (!bruker) {
    redirect("/login");
  }

  const [cron, kanaler, godkjenninger, feiledeJobber, sperrelister, revisjoner, prospekter] =
    await Promise.all([
      trygt(() => prisma.cronJobb.findMany({ orderBy: { navn: "asc" } }), []),
      trygt(
        () => prisma.kanalInnstilling.findMany({ orderBy: { kanal: "asc" } }),
        [],
      ),
      trygt(
        () =>
          prisma.godkjenning.findMany({
            where: { status: "VENTER" },
            orderBy: { opprettet: "desc" },
            take: 10,
          }),
        [],
      ),
      trygt(
        () =>
          prisma.cronKjoering.findMany({
            where: { status: "FEILET" },
            orderBy: { startet: "desc" },
            take: 10,
          }),
        [],
      ),
      trygt(() => prisma.sperreliste.count({ where: { aktiv: true } }), 0),
      trygt(() => prisma.revisjon.count(), 0),
      trygt(() => prisma.prospekt.count(), 0),
    ]);

  const databaseFeil =
    cron.feil ?? kanaler.feil ?? godkjenninger.feil ?? feiledeJobber.feil ?? null;

  const integrasjoner = integrasjonsstatus();
  const manglerKonfigurasjon = integrasjoner.filter((i) => !i.konfigurert);
  const aktiveKanaler = kanaler.data.filter((k) => k.utgaaendeAktivert);

  const naa = new Date();
  const idag = norskTid(naa);
  const rodDag = erHelligdag(new Date(`${idag.dato}T00:00:00Z`));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">VikingPilot</h1>
          <p className="mt-0.5 text-sm text-dempet">
            {bruker.navn} · {idag.dato}
            {rodDag ? ` · rød dag: ${helligdagNavn(new Date(`${idag.dato}T00:00:00Z`))}` : ""}
          </p>
        </div>

        <form action={loggUtHandling}>
          <button
            type="submit"
            className="rounded-md border border-kant bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-neutral-50"
          >
            Logg ut
          </button>
        </form>
      </header>

      {/* Aller viktigst: er noe slått på? */}
      <div
        className={`mb-6 rounded-lg border p-4 ${
          aktiveKanaler.length === 0
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-300 bg-amber-50"
        }`}
      >
        <p className="text-sm font-medium">
          {aktiveKanaler.length === 0
            ? "All utgående trafikk er av."
            : `Advarsel: ${aktiveKanaler.length} kanal(er) er slått på.`}
        </p>
        <p className="mt-0.5 text-xs text-neutral-700">
          {aktiveKanaler.length === 0
            ? "Ingenting kan sendes eller endres eksternt. Dette er standardtilstanden."
            : `Påslått: ${aktiveKanaler.map((k) => k.kanal).join(", ")}.`}
        </p>
      </div>

      {databaseFeil ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">Databasen svarte ikke</p>
          <p className="mt-1 font-mono text-xs break-all text-red-800">{databaseFeil}</p>
          <p className="mt-1 text-xs text-red-800">
            Se docs/manuell-oppsett.md, del E, for feilsøking.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {/* 1. Hva kjører */}
        <Kort
          tittel="Hva kjører"
          antall={cron.data.length}
          beskrivelse="Tidsplanen. Hver jobb har sin egen hemmelighet og tørrkjører som standard."
          tom="Ingen cron-jobber er satt opp. Kjør npm run db:seed."
        >
          <ul className="space-y-2.5">
            {cron.data.map((jobb) => {
              const manglerNokkel = !process.env[jobb.hemmelighetNavn];
              return (
                <li key={jobb.id} className="border-t border-kant pt-2.5 first:border-0 first:pt-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{jobb.navn}</span>
                    <span className="font-mono text-xs text-dempet">{jobb.cronUttrykk}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-dempet">
                    Sist: {tid(jobb.sisteKjoering)}
                    {jobb.sisteStatus ? ` · ${jobb.sisteStatus}` : ""}
                    {jobb.torrkjoeringStandard ? " · tørrkjøring" : ""}
                  </p>
                  {manglerNokkel ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Mangler <code className="font-mono">{jobb.hemmelighetNavn}</code> — jobben
                      kan ikke kalles.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Kort>

        {/* 2. Hva venter på meg */}
        <Kort
          tittel="Hva venter på meg"
          antall={godkjenninger.data.length}
          beskrivelse="Godkjenningskøen. Alt med ekstern konsekvens går gjennom den."
          tom="Ingenting venter på godkjenning."
        >
          <ul className="space-y-3">
            {godkjenninger.data.map((g) => (
              <li key={g.id} className="border-t border-kant pt-3 first:border-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{g.tittel}</span>
                  <span className="text-xs text-dempet">{tid(g.opprettet)}</span>
                </div>
                {g.begrunnelse ? (
                  <p className="mt-0.5 text-xs text-dempet">{g.begrunnelse}</p>
                ) : null}
                {g.forslagFra === "AGENT" ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Foreslått av agenten. Et menneske må bestemme.
                  </p>
                ) : null}
                <AvgjoerelseSkjema id={g.id} />
              </li>
            ))}
          </ul>
        </Kort>

        {/* 3. Hva feilet */}
        <Kort
          tittel="Hva feilet"
          antall={feiledeJobber.data.length}
          beskrivelse="Feiler en jobb, skal den si det — ikke tie."
          tom="Ingen feilede jobber."
        >
          <ul className="space-y-2.5">
            {feiledeJobber.data.map((k) => (
              <li key={k.id} className="border-t border-kant pt-2.5 first:border-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{k.navn}</span>
                  <span className="text-xs text-dempet">{tid(k.startet)}</span>
                </div>
                {k.feilmelding ? (
                  <p className="mt-0.5 font-mono text-xs break-all text-red-700">{k.feilmelding}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Kort>

        {/* 4. Hva mangler konfigurasjon */}
        <Kort
          tittel="Hva mangler konfigurasjon"
          antall={manglerKonfigurasjon.length}
          beskrivelse="Ærlig tilstand. Systemet virker ellers, og finner aldri på data."
          tom="Alt er konfigurert."
        >
          <ul className="space-y-2.5">
            {manglerKonfigurasjon.map((i) => (
              <li key={i.navn} className="border-t border-kant pt-2.5 first:border-0 first:pt-0">
                <span className="text-sm font-medium">{i.visningsnavn}</span>
                <p className="mt-0.5 text-xs text-dempet">{i.beskrivelse}</p>
                <p className="mt-1 text-xs">
                  Mangler:{" "}
                  {i.manglendeNokler.map((n, indeks) => (
                    <span key={n}>
                      {indeks > 0 ? ", " : ""}
                      <code className="font-mono text-amber-700">{n}</code>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </Kort>
      </div>

      {/* Tall for systemet */}
      <section className="mt-4 rounded-lg border border-kant bg-kort p-5">
        <h2 className="mb-3 text-sm font-semibold">Systemet</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { navn: "Prospekter", verdi: prospekter.data },
            { navn: "Aktive sperrer", verdi: sperrelister.data },
            { navn: "Revisjonsoppføringer", verdi: revisjoner.data },
            { navn: "Kanaler slått på", verdi: aktiveKanaler.length },
          ].map((t) => (
            <div key={t.navn}>
              <dt className="text-xs text-dempet">{t.navn}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{t.verdi}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dempet">
        <span>Tørrkjøring som standard: på</span>
        <span>·</span>
        <span>Rate limiting: på</span>
        <span>·</span>
        <Link href="/api/helse" className="underline hover:text-foreground">
          Helsesjekk
        </Link>
      </footer>
    </main>
  );
}
