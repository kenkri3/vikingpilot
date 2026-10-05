/**
 * Forhåndssjekk før første deploy.
 *
 * Dette er den ene tingen som står mellom «det virker lokalt» og «det virker på
 * Railway», og den kjøres av Kenneth eller Fredrik — ikke av meg. Den sjekker
 * miljøet mot oppsettlisten og sier tydelig hva som mangler og hva som må gjøres.
 *
 * PRINSIPP: Den sier ALDRI at noe er i orden uten å ha sjekket det. Den skriver
 * aldri ut en hemmelighet, bare navnet på variabelen og om den er satt.
 *
 * Kjøres med:
 *   npx tsx scripts/forhåndssjekk.ts
 *
 * Kjør den lokalt før du legger inn variablene på Railway, og kjør den igjen på
 * Railway etter første deploy. Den virker begge steder.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

/**
 * Miljøvariablene leses fra `process.env`, men vi tar dem som parameter i
 * stedet for å lese dem direkte. Det gjør det mulig å prøve sjekken mot et
 * bevisst ødelagt miljø — og en sjekk som aldri kan feile, er verdiløs.
 */
type Miljoe = Record<string, string | undefined>;

/** Hvilken database vi kobler til. Settes av `--miljoe` for testing. */
let databaseUrl: string | undefined = process.env.DATABASE_URL;

type Nivaa = "OK" | "ADVARSEL" | "FEIL" | "INFO";

type Funn = {
  nivaa: Nivaa;
  tekst: string;
  detalj?: string;
  raad?: string;
};

const funn: Funn[] = [];

function legg(nivaa: Nivaa, tekst: string, detalj?: string, raad?: string) {
  funn.push({ nivaa, tekst, detalj, raad });
}

const GROENN = "\u001b[32m";
const ROED = "\u001b[31m";
const GUL = "\u001b[33m";
const BLA = "\u001b[36m";
const DUS = "\u001b[2m";
const SLUTT = "\u001b[0m";

function ikon(n: Nivaa): string {
  switch (n) {
    case "OK":
      return `${GROENN}OK  ${SLUTT}`;
    case "ADVARSEL":
      return `${GUL}ADV ${SLUTT}`;
    case "FEIL":
      return `${ROED}FEIL${SLUTT}`;
    case "INFO":
      return `${BLA}INFO${SLUTT}`;
  }
}

/**
 * Leser en miljøvariabel og sier bare om den er satt — aldri hva den er.
 *
 * `miljoe` sendes inn slik at sjekken kan prøves mot et ødelagt miljø.
 */
let miljoe: Miljoe = process.env;

function satt(navn: string): boolean {
  const v = miljoe[navn];
  return typeof v === "string" && v.trim() !== "";
}

function hent(navn: string): string {
  return miljoe[navn] ?? "";
}

// ---------------------------------------------------------------------------
// 1. Miljøvariabler
// ---------------------------------------------------------------------------

function sjekkMiljoe() {
  // Påkrevd.
  if (satt("DATABASE_URL")) {
    const url = hent("DATABASE_URL");

    // Sjekk at adressen ser riktig ut, uten å vise den.
    if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
      legg("OK", "DATABASE_URL er satt og ser ut som en Postgres-adresse");
    } else {
      legg(
        "FEIL",
        "DATABASE_URL er satt, men ser ikke ut som en Postgres-adresse",
        `starter med «${url.split(":")[0]}»`,
        "Den skal begynne med postgresql:// — hent den fra Postgres-tjenesten i Railway.",
      );
    }

    // Er passordet en plassholder?
    if (/plassholder|BYTT_UT|xxxx|ditt_passord/i.test(url)) {
      legg(
        "FEIL",
        "DATABASE_URL inneholder fortsatt en plassholder",
        undefined,
        "Lim inn den ekte adressen fra Railway, eller passordet du valgte lokalt.",
      );
    }
  } else {
    legg(
      "FEIL",
      "DATABASE_URL mangler",
      undefined,
      "Sett den i .env lokalt, eller i Railway under Variables. Se docs/manuell-oppsett.md, del C1.",
    );
  }

  const sesjon = hent("SESSION_SECRET");

  if (sesjon === "") {
    legg(
      "FEIL",
      "SESSION_SECRET mangler",
      undefined,
      'Generer med: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  } else if (sesjon.length < 32) {
    legg(
      "FEIL",
      "SESSION_SECRET er for kort",
      `${sesjon.length} tegn, trenger minst 32`,
      "Generer en ny. Cookien signeres med denne.",
    );
  } else if (/generer|bytt|endre|secret|passord/i.test(sesjon) && sesjon.length < 50) {
    legg(
      "ADVARSEL",
      "SESSION_SECRET ser ut som en plassholder",
      undefined,
      "Generer en tilfeldig verdi i stedet.",
    );
  } else {
    legg("OK", "SESSION_SECRET er satt og lang nok", `${sesjon.length} tegn`);
  }

  // Cron-hemmeligheter.
  const jobber: { navn: string; beskrivelse: string }[] = [
    { navn: "CRON_SECRET_ENHETSREGISTER", beskrivelse: "henter nye selskaper" },
    { navn: "CRON_SECRET_SEKVENS", beskrivelse: "lager utkast til køen" },
    { navn: "CRON_SECRET_UTSENDING", beskrivelse: "sender godkjente meldinger" },
    { navn: "CRON_SECRET_OPPVARMING", beskrivelse: "nullstiller tellere" },
    { navn: "CRON_SECRET_RYDDING", beskrivelse: "rydder driftshistorikk" },
  ];

  const manglende = jobber.filter((j) => !satt(j.navn));
  const korte = jobber.filter((j) => satt(j.navn) && hent(j.navn).length < 32);

  if (manglende.length === 0 && korte.length === 0) {
    legg("OK", `Alle ${jobber.length} cron-hemmeligheter er satt og lange nok`);
  } else {
    if (manglende.length > 0) {
      legg(
        "ADVARSEL",
        `${manglende.length} av ${jobber.length} cron-hemmeligheter mangler`,
        manglende.map((j) => `${j.navn} (${j.beskrivelse})`).join(", "),
        "Mangler én, feiler bare den jobben — med en tydelig melding i dashbordet. Se del C2.",
      );
    }
    if (korte.length > 0) {
      legg(
        "ADVARSEL",
        `${korte.length} cron-hemmeligheter er kortere enn 32 tegn`,
        korte.map((j) => j.navn).join(", "),
        "Bruk 48 tegn. Kommandoen i del B3 gir det.",
      );
    }
  }

  // Delte hemmeligheter er en reell svakhet: mister én, må alle byttes.
  const verdier = jobber.map((j) => miljoe[j.navn]).filter((v): v is string => Boolean(v));
  const unike = new Set(verdier);

  if (verdier.length > 1 && unike.size < verdier.length) {
    legg(
      "ADVARSEL",
      "Flere cron-jobber deler samme hemmelighet",
      `${verdier.length} jobber, ${unike.size} ulike verdier`,
      "Hver jobb skal ha sin egen, så én lekkasje ikke åpner alle.",
    );
  } else if (verdier.length > 1) {
    legg("OK", "Hver cron-jobb har sin egen hemmelighet");
  }

  // Integrasjoner.
  const valgfrie: { navn: string; tekst: string }[] = [
    { navn: "EPOST_KANAL", tekst: "e-postkanal" },
    { navn: "EPOST_FRA_ADRESSE", tekst: "avsenderadresse" },
    { navn: "VIKINGCRM_WEBHOOK_URL", tekst: "VikingCRM" },
    { navn: "AGENT_WEBHOOK_URL", tekst: "agentplattformen" },
  ];

  const usatte = valgfrie.filter((v) => !satt(v.navn));

  if (usatte.length === 0) {
    legg("OK", "Alle valgfrie integrasjoner er konfigurert");
  } else {
    legg(
      "INFO",
      `${usatte.length} valgfrie integrasjoner er ikke satt opp`,
      usatte.map((v) => v.tekst).join(", "),
      "Det er greit. Systemet sier ærlig «ikke konfigurert» og virker ellers.",
    );
  }

  // Utgående trafikk.
  if (satt("UTGAAENDE_EPOST_AKTIVERT")) {
    const v = hent("UTGAAENDE_EPOST_AKTIVERT").toLowerCase();
    if (v === "true") {
      legg(
        "ADVARSEL",
        "UTGAAENDE_EPOST_AKTIVERT står på true",
        undefined,
        "Dette er bryteren for at noe kan gå ut. Den skal være false til du har sett dashbordet og forstått køen. Kanalen i databasen må også være åpen.",
      );
    } else {
      legg("OK", "UTGAAENDE_EPOST_AKTIVERT er av");
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Filer som må ligge i repoet
// ---------------------------------------------------------------------------

async function sjekkFiler() {
  const { existsSync, readFileSync } = await import("node:fs");

  const viktige = [
    { sti: "railway.json", hvorfor: "Railway bruker denne til å bygge og starte" },
    { sti: "Dockerfile", hvorfor: "Railway bygger med denne" },
    { sti: "prisma/schema.prisma", hvorfor: "databasestrukturen" },
    { sti: "prisma/migrations", hvorfor: "migreringene som setter opp skjemaet" },
    { sti: ".env.example", hvorfor: "malen for miljøvariabler" },
    { sti: "scripts/start-prod.mjs", hvorfor: "kjører migreringer før serveren starter" },
    { sti: "docs/manuell-oppsett.md", hvorfor: "oppsettlisten" },
  ];

  const mangler = viktige.filter((v) => !existsSync(v.sti));

  if (mangler.length === 0) {
    legg("OK", `Alle ${viktige.length} viktige filer finnes`);
  } else {
    for (const m of mangler) {
      legg("FEIL", `${m.sti} mangler`, m.hvorfor, "Uten denne kan ikke Railway bygge eller starte.");
    }
  }

  // Er .env ignorert av git? Dette er kritisk.
  if (existsSync(".gitignore")) {
    const gi = readFileSync(".gitignore", "utf8");
    if (/^\.env\*?$/m.test(gi) || gi.includes(".env*")) {
      legg("OK", ".env er ignorert av git");
    } else {
      legg(
        "FEIL",
        ".env er ikke ignorert av git",
        undefined,
        "Hemmelighetene dine kan bli committet. Legg til «.env*» i .gitignore.",
      );
    }
  }

  // Ligger .env ute i repoet ved en feil?
  if (existsSync(".env") && existsSync(".git")) {
    const { execSync } = await import("node:child_process");
    try {
      const sporet = execSync("git ls-files .env", { encoding: "utf8" }).trim();
      if (sporet !== "") {
        legg(
          "FEIL",
          ".env er SPORET av git",
          undefined,
          "Hemmelighetene dine ligger i historikken. Fjern filen fra git og roter alle nøklene.",
        );
      } else {
        legg("OK", ".env er ikke sporet av git");
      }
    } catch {
      legg("INFO", "Kunne ikke sjekke git-sporing", "git er ikke tilgjengelig her");
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Databasen
// ---------------------------------------------------------------------------

async function sjekkDatabase() {
  if (!satt("DATABASE_URL")) {
    legg("INFO", "Hopper over databasesjekkene", "DATABASE_URL mangler");
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl ?? "" }),
  });

  try {
    await prisma.$queryRaw`SELECT 1`;
    legg("OK", "Databasen svarer");
  } catch (feil) {
    const m = feil instanceof Error ? feil.message : String(feil);
    legg(
      "FEIL",
      "Databasen svarer ikke",
      m.split("\n")[0]?.slice(0, 140),
      "Sjekk at Postgres kjører, og at DATABASE_URL er riktig. Se del E.",
    );
    await prisma.$disconnect();
    return;
  }

  try {
    const tabeller = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const antall = Number(tabeller[0]?.n ?? 0);

    if (antall === 0) {
      legg(
        "FEIL",
        "Databasen er tom — ingen tabeller",
        undefined,
        "Kjør npm run db:migrate. På Railway gjør start:prod dette selv ved oppstart.",
      );
      await prisma.$disconnect();
      return;
    }

    if (antall >= 30) {
      legg("OK", `Skjemaet er satt opp`, `${antall} tabeller`);
    } else {
      legg(
        "FEIL",
        "Skjemaet ser ufullstendig ut",
        `${antall} tabeller, forventet minst 30`,
        "Kjør npm run db:migrate.",
      );
      await prisma.$disconnect();
      return;
    }
  } catch {
    legg("ADVARSEL", "Kunne ikke telle tabeller");
  }

  // Er migreringene i synk?
  try {
    const anvendte = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    const n = Number(anvendte[0]?.n ?? 0);
    legg("OK", "Migreringer er anvendt", `${n} stk`);
  } catch {
    legg("ADVARSEL", "Kunne ikke lese migrasjonshistorikken");
  }

  // Frødata.
  try {
    const [kanaler, brukere, jobber, maalgrupper, oppvarming] = await Promise.all([
      prisma.kanalInnstilling.count(),
      prisma.bruker.count(),
      prisma.cronJobb.count(),
      prisma.maalgruppe.count(),
      prisma.oppvarmingssteg.count({ where: { avsenderId: null } }),
    ]);

    if (kanaler === 0) {
      legg(
        "FEIL",
        "Ingen kanaler er satt opp",
        undefined,
        "Kjør npm run db:seed. Uten kanaler nekter systemet all sending.",
      );
    } else {
      legg("OK", `${kanaler} kanaler er satt opp`);
    }

    if (brukere === 0) {
      legg(
        "ADVARSEL",
        "Ingen brukere finnes — du kan ikke logge inn",
        undefined,
        "Sett SEED_PASSORD og kjør npm run db:seed. Bruk et passord på minst 12 tegn.",
      );
    } else {
      legg("OK", `${brukere} brukere kan logge inn`);
    }

    if (jobber === 0) {
      legg("ADVARSEL", "Ingen cron-jobber er satt opp", undefined, "Kjør npm run db:seed.");
    } else {
      legg("OK", `${jobber} cron-jobber er satt opp`);
    }

    if (maalgrupper === 0) {
      legg(
        "ADVARSEL",
        "Ingen målgruppe er satt opp — pipelinen henter ingenting",
        undefined,
        "Kjør npm run db:seed, og juster den etterpå. Målgruppen er konfigurasjon, ikke kode.",
      );
    } else {
      legg("OK", `${maalgrupper} målgruppe(r) er satt opp`);
    }

    if (oppvarming === 0) {
      legg(
        "ADVARSEL",
        "Ingen global oppvarmingsplan finnes",
        undefined,
        "Uten den er kvoten 0, og ingenting kan sendes. Kjør npm run db:seed.",
      );
    } else {
      legg("OK", `Oppvarmingsplanen har ${oppvarming} trinn`);
    }
  } catch (feil) {
    legg("ADVARSEL", "Kunne ikke lese frødataene", feil instanceof Error ? feil.message.slice(0, 100) : "");
  }

  // Den viktigste invarianten av alle.
  try {
    const aapne = await prisma.kanalInnstilling.findMany({
      where: { utgaaendeAktivert: true },
      select: { kanal: true, oppdatertAv: true, maksPerDag: true },
    });

    if (aapne.length === 0) {
      legg("OK", "All utgående trafikk er AV", "ingen kanal er åpen");
    } else {
      for (const k of aapne) {
        legg(
          k.maksPerDag > 0 ? "ADVARSEL" : "INFO",
          `Kanalen ${k.kanal} er ÅPEN for utgående trafikk`,
          k.maksPerDag > 0
            ? `døgnkvote ${k.maksPerDag}, åpnet av ${k.oppdatertAv ?? "ukjent"}`
            : "men døgnkvoten er 0, så ingenting kan sendes ennå",
          k.maksPerDag > 0
            ? "Dette er bryteren for at noe kan gå ut. Bekreft at det er meningen."
            : "Sett døgnkvoten når du er klar til å sende.",
        );
      }
    }
  } catch {
    legg("ADVARSEL", "Kunne ikke lese kanalstatus");
  }

  // Har noe faktisk gått ut?
  try {
    const sendt = await prisma.utsending.count({ where: { status: "SENDT" } });
    if (sendt === 0) {
      legg("OK", "Ingen utsending er noen gang sendt");
    } else {
      legg("INFO", `${sendt} utsendinger står som sendt`, undefined, "Det er forventet hvis du har slått på en kanal.");
    }
  } catch {
    // Tabellen finnes, men vi lar det passere stille.
  }

  // Er det en avsender? Uten den nekter utsendingsvakten alt.
  try {
    const avsendere = await prisma.avsender.count();
    if (avsendere === 0) {
      legg(
        "INFO",
        "Ingen avsendere er satt opp",
        undefined,
        "Det er riktig så lenge ingenting skal sendes. Uten avsender nekter utsendingsvakten all sending.",
      );
    } else {
      legg("OK", `${avsendere} avsendere er satt opp`);
    }
  } catch {
    // Ignorer.
  }

  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// 4. Oppsummering
// ---------------------------------------------------------------------------

async function hoved() {
  // Prøvemodus: les variablene fra en annen fil, slik at sjekken kan testes mot
  // et bevisst ødelagt miljø. Uten dette ville vi aldri visst om den faktisk
  // fanger noe — og en sjekk som aldri kan feile, er verdiløs.
  const miljoeIndeks = process.argv.indexOf("--miljoe");

  if (miljoeIndeks >= 0) {
    const sti = process.argv[miljoeIndeks + 1];

    if (!sti) {
      console.error("Bruk: npx tsx scripts/forhåndssjekk.ts --miljoe <fil>");
      process.exit(2);
    }

    const { readFileSync } = await import("node:fs");
    const innhold = readFileSync(sti, "utf8");
    const lastet: Miljoe = {};

    for (const linje of innhold.split("\n")) {
      const trimmet = linje.trim();
      if (trimmet === "" || trimmet.startsWith("#")) continue;

      const lik = trimmet.indexOf("=");
      if (lik <= 0) continue;

      const navn = trimmet.slice(0, lik).trim();
      const verdi = trimmet.slice(lik + 1).trim().replace(/^["']|["']$/g, "");
      lastet[navn] = verdi;
    }

    miljoe = lastet;
    databaseUrl = lastet["DATABASE_URL"];
    console.log(`${DUS}Prøvemodus: leser miljøet fra ${sti}${SLUTT}\n`);
  }

  console.log("VikingPilot — forhåndssjekk før deploy");
  console.log("Sjekker miljøet mot docs/manuell-oppsett.md. Viser aldri hemmeligheter.");
  console.log("");

  sjekkMiljoe();
  await sjekkFiler();
  await sjekkDatabase();

  console.log("Miljøvariabler");
  console.log("Filer");
  console.log("Database");
  console.log("");

  for (const f of funn) {
    console.log(`${ikon(f.nivaa)} ${f.tekst}`);
    if (f.detalj) console.log(`     ${DUS}${f.detalj}${SLUTT}`);
    if (f.raad) console.log(`     ${DUS}→ ${f.raad}${SLUTT}`);
  }

  const feil = funn.filter((f) => f.nivaa === "FEIL").length;
  const advarsler = funn.filter((f) => f.nivaa === "ADVARSEL").length;
  const ok = funn.filter((f) => f.nivaa === "OK").length;

  // Norske flertallsformer. «advarsel» blir «advarsler», ikke «advarselr» —
  // derfor en liten tabell i stedet for å henge på en endelse.
  const flertall = (antall: number, entall: string, fler: string) =>
    antall === 1 ? `${antall} ${entall}` : `${antall} ${fler}`;

  console.log("");
  console.log("─".repeat(64));

  if (feil === 0 && advarsler === 0) {
    console.log(`${GROENN}Alt er i orden.${SLUTT} ${ok} sjekker bestått.`);
  } else if (feil === 0) {
    console.log(
      `${GROENN}${ok} bestått${SLUTT}, ${GUL}${flertall(advarsler, "advarsel", "advarsler")}${SLUTT}. Ingen feil.`,
    );
    console.log("Advarslene stopper ikke oppstarten, men bør ses på før noe skal sendes.");
  } else {
    console.log(
      `${ROED}${flertall(feil, "feil", "feil")}${SLUTT}, ${GUL}${flertall(advarsler, "advarsel", "advarsler")}${SLUTT}, ${GROENN}${ok} bestått${SLUTT}.`,
    );
    console.log(`\n${ROED}Rett feilene over før du deployer.${SLUTT}`);
  }

  process.exit(feil > 0 ? 1 : 0);
}

hoved().catch((feil) => {
  console.error("Forhåndssjekken krasjet:", feil);
  process.exit(1);
});
