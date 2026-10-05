/**
 * Frødata.
 *
 * To formål:
 *
 *   1. Gjøre hele systemet demonstrerbart uten én eneste ekstern tjeneste.
 *   2. Sette trygge standardverdier — særlig at all utgående trafikk er AV.
 *
 * Kjøres med `npm run db:seed`. Skal kunne kjøres flere ganger uten å lage duplikater.
 *
 * Alle data her er oppdiktede. Vi finner ikke på ekte bedrifter eller ekte personer.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { hashPassord } from "../src/lib/auth/passord.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL mangler. Se docs/manuell-oppsett.md, del C1.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

type Kanal = "EPOST" | "TELEFON" | "SMS" | "LINKEDIN" | "WEBHOOK" | "MANUELL";

// ---------------------------------------------------------------------------
// Kanaler — alt er AV. Dette er systemets viktigste standardverdi.
// ---------------------------------------------------------------------------

const KANALER: {
  kanal: Kanal;
  maksPerDag: number;
  maksPerUke: number;
  maksPerMinutt: number;
  notat: string;
}[] = [
  {
    kanal: "EPOST",
    maksPerDag: 0,
    maksPerUke: 0,
    maksPerMinutt: 0,
    notat: "Av som standard. Volum settes når avsender og oppvarmingsplan er bestemt.",
  },
  { kanal: "TELEFON", maksPerDag: 0, maksPerUke: 0, maksPerMinutt: 0, notat: "Av som standard." },
  { kanal: "SMS", maksPerDag: 0, maksPerUke: 0, maksPerMinutt: 0, notat: "Av som standard." },
  { kanal: "LINKEDIN", maksPerDag: 0, maksPerUke: 0, maksPerMinutt: 0, notat: "Av som standard." },
  { kanal: "WEBHOOK", maksPerDag: 0, maksPerUke: 0, maksPerMinutt: 0, notat: "Av som standard." },
  { kanal: "MANUELL", maksPerDag: 0, maksPerUke: 0, maksPerMinutt: 0, notat: "Av som standard." },
];

// ---------------------------------------------------------------------------
// Integrasjoner — ærlig «ikke konfigurert»
// ---------------------------------------------------------------------------

const INTEGRASJONER = [
  {
    navn: "enhetsregisteret",
    beskrivelse:
      "Åpent API fra Brønnøysundregistrene. Krever ingen nøkkel. Henter nye selskaper.",
    // Tom liste med vilje: Enhetsregisteret er et åpent API. Det er verifisert
    // ved å kalle det uten autentisering. Å kreve en nøkkel her ville vist
    // «ikke konfigurert» for alltid, og det ville vært usant.
    nokler: [] as string[],
  },
  {
    navn: "epost",
    beskrivelse: "Sender e-post via valgt kanal.",
    nokler: ["EPOST_KANAL", "EPOST_FRA_ADRESSE"],
  },
  {
    navn: "vikingcrm",
    beskrivelse: "Sender hendelser til VikingCRM via webhook.",
    nokler: ["VIKINGCRM_WEBHOOK_URL"],
  },
  {
    navn: "agent",
    beskrivelse: "Verktøyflaten agenten kaller.",
    nokler: ["AGENT_WEBHOOK_URL"],
  },
];

// ---------------------------------------------------------------------------
// Cron-jobber — hver med sin egen hemmelighet
// ---------------------------------------------------------------------------

const CRON_JOBBER = [
  {
    navn: "enhetsregister",
    beskrivelse: "Henter og kvalifiserer nye selskaper fra Enhetsregisteret.",
    sti: "/api/cron/enhetsregister",
    cronUttrykk: "0 6 * * 1-5",
    hemmelighetNavn: "CRON_SECRET_ENHETSREGISTER",
  },
  {
    navn: "sekvens",
    beskrivelse: "Kjører sekvensmotoren og lager utkast til godkjenning.",
    sti: "/api/cron/sekvens",
    cronUttrykk: "0 7 * * 1-5",
    hemmelighetNavn: "CRON_SECRET_SEKVENS",
  },
  {
    navn: "utsending",
    beskrivelse: "Sender godkjente meldinger innenfor tidsvinduet.",
    sti: "/api/cron/utsending",
    cronUttrykk: "*/15 8-16 * * 1-5",
    hemmelighetNavn: "CRON_SECRET_UTSENDING",
  },
  {
    navn: "oppvarming",
    beskrivelse: "Justerer oppvarmingskvoten for avsendere.",
    sti: "/api/cron/oppvarming",
    cronUttrykk: "0 5 * * *",
    hemmelighetNavn: "CRON_SECRET_OPPVARMING",
  },
  {
    navn: "rydding",
    beskrivelse: "Arkiverer og rydder. Verken revisjon eller sperrelister røres.",
    sti: "/api/cron/rydding",
    cronUttrykk: "0 3 * * 0",
    hemmelighetNavn: "CRON_SECRET_RYDDING",
  },
];

// ---------------------------------------------------------------------------
// Oppvarmingsplan
// ---------------------------------------------------------------------------

const OPPVARMINGSSTEG = [
  { dagFraStart: 0, maksPerDag: 5, beskrivelse: "Dag 1–3: svært lavt volum." },
  { dagFraStart: 4, maksPerDag: 10, beskrivelse: "Dag 4–7: forsiktig økning." },
  { dagFraStart: 8, maksPerDag: 20, beskrivelse: "Dag 8–14: gradvis opptrapping." },
  { dagFraStart: 15, maksPerDag: 40, beskrivelse: "Dag 15–21: nær normalt." },
  { dagFraStart: 22, maksPerDag: 80, beskrivelse: "Dag 22–30: normalt volum." },
  { dagFraStart: 31, maksPerDag: 150, beskrivelse: "Etter dag 30: fullt volum." },
];

// ---------------------------------------------------------------------------
// Målgruppe — konfigurasjon, ikke kode
// ---------------------------------------------------------------------------

const MAALGRUPPE = {
  navn: "Standard: norske SMB i privat sektor",
  beskrivelse:
    "Utgangspunkt. Kenneth og Fredrik skal kunne endre denne uten at noen skriver kode. Se S4 i docs/aapne-sporsmal.md.",
  naeringskoder: [] as string[],
  fylker: [] as string[],
  minAnsatte: 5,
  maxAnsatte: 250,
  roller: ["Daglig leder", "Adm. direktør", "IT-sjef", "Driftssjef"],
  ekskluderOffentlig: true,
  ekskluderKonkurs: true,
  ekskluderUnderAvvikling: true,
  minAlderMaaneder: 12,
  prioritet: 10,
};

// ---------------------------------------------------------------------------
// Produkter — plassholdere. Ekte SKU og pris må komme fra Kenneth og Fredrik.
// Se S7 i docs/aapne-sporsmal.md.
// ---------------------------------------------------------------------------

const PRODUKTER = [
  {
    sku: "VP-AVVIKLING",
    navn: "Avvikling av manuelle arbeidsoppgaver",
    beskrivelse: "Kartlegging og automatisering av én arbeidsflyt. Pris må bekreftes.",
    prisOre: 0,
    enhet: "ENGANG" as const,
  },
  {
    sku: "VP-AGENT-MND",
    navn: "Autonom agent — månedlig",
    beskrivelse: "Drift av én autonom agent. Pris må bekreftes.",
    prisOre: 0,
    enhet: "PER_MANED" as const,
  },
];

// ---------------------------------------------------------------------------
// Sekvens — data, ikke kode
// ---------------------------------------------------------------------------

const SEKVENSNavn = "Standard oppfølging";
const SEKVENSN_STEG = [
  {
    rekkefolge: 1,
    navn: "Første henvendelse",
    ventetidTimer: 0,
    emneMal: "Kort spørsmål om {{oppgave}}",
    innholdMal:
      "Mal. Selve teksten skriver agenten senere, innenfor rammene systemet setter.",
  },
  {
    rekkefolge: 2,
    navn: "Oppfølging",
    ventetidTimer: 72,
    emneMal: "Fulgte opp — {{oppgave}}",
    innholdMal: "Mal. Sendes bare hvis forrige steg ikke fikk svar.",
  },
  {
    rekkefolge: 3,
    navn: "Siste forsøk",
    ventetidTimer: 120,
    emneMal: "Siste melding fra oss",
    innholdMal: "Mal. Etter dette avsluttes sekvensen.",
  },
];

// ===========================================================================

async function seed(): Promise<void> {
  console.log("Seeder VikingPilot …");

  // 1. Kanaler — all utgående trafikk AV.
  for (const k of KANALER) {
    await prisma.kanalInnstilling.upsert({
      where: { kanal: k.kanal },
      update: {},
      create: {
        kanal: k.kanal,
        utgaaendeAktivert: false,
        maksPerDag: k.maksPerDag,
        maksPerUke: k.maksPerUke,
        maksPerMinutt: k.maksPerMinutt,
        tidsvinduStart: "08:00",
        tidsvinduSlutt: "16:00",
        kunHverdager: true,
        helligdagLand: "NO",
        oppvarmingAktiv: true,
        notat: k.notat,
      },
    });
  }
  console.log(`  ✓ ${KANALER.length} kanaler, alle med utgående AV`);

  // 2. Integrasjoner — ærlig tilstand.
  for (const i of INTEGRASJONER) {
    const mangler = i.nokler.filter((n) => !process.env[n] || process.env[n]!.trim() === "");
    await prisma.integrasjon.upsert({
      where: { navn: i.navn },
      update: {
        konfigurert: mangler.length === 0,
        manglendeNokler: mangler,
        sistSjekket: new Date(),
      },
      create: {
        navn: i.navn,
        beskrivelse: i.beskrivelse,
        konfigurert: mangler.length === 0,
        manglendeNokler: mangler,
        sistSjekket: new Date(),
      },
    });
  }
  console.log(`  ✓ ${INTEGRASJONER.length} integrasjoner, ærlig status`);

  // 3. Cron-jobber.
  for (const j of CRON_JOBBER) {
    await prisma.cronJobb.upsert({
      where: { navn: j.navn },
      update: { beskrivelse: j.beskrivelse, sti: j.sti, cronUttrykk: j.cronUttrykk },
      create: {
        navn: j.navn,
        beskrivelse: j.beskrivelse,
        sti: j.sti,
        cronUttrykk: j.cronUttrykk,
        aktiv: true,
        torrkjoeringStandard: true,
        hemmelighetNavn: j.hemmelighetNavn,
      },
    });
  }
  console.log(`  ✓ ${CRON_JOBBER.length} cron-jobber`);

  // 4. Oppvarmingsplan.
  const antallSteg = await prisma.oppvarmingssteg.count();
  if (antallSteg === 0) {
    await prisma.oppvarmingssteg.createMany({ data: OPPVARMINGSSTEG });
    console.log(`  ✓ ${OPPVARMINGSSTEG.length} oppvarmingstrinn`);
  } else {
    console.log(`  · oppvarmingsplan finnes allerede (${antallSteg} trinn)`);
  }

  // 5. Målgruppe.
  await prisma.maalgruppe.upsert({
    where: { navn: MAALGRUPPE.navn },
    update: {},
    create: MAALGRUPPE,
  });
  console.log("  ✓ 1 målgruppe (konfigurasjon, ikke kode)");

  // 6. Produkter.
  for (const p of PRODUKTER) {
    await prisma.produkt.upsert({
      where: { sku: p.sku },
      update: {},
      create: p,
    });
  }
  console.log(`  ✓ ${PRODUKTER.length} produkter (pris må bekreftes)`);

  // 7. Sekvens med versjon og steg.
  const sekvens = await prisma.sekvens.upsert({
    where: { navn: SEKVENSNavn },
    update: {},
    create: { navn: SEKVENSNavn, beskrivelse: "Data, ikke kode. Kan endres og måles." },
  });

  const versjon = await prisma.sekvensVersjon.upsert({
    where: { sekvensId_versjon: { sekvensId: sekvens.id, versjon: 1 } },
    update: {},
    create: { sekvensId: sekvens.id, versjon: 1, aktiv: true, notat: "Første versjon." },
  });

  for (const s of SEKVENSN_STEG) {
    await prisma.sekvensSteg.upsert({
      where: { versjonId_rekkefolge: { versjonId: versjon.id, rekkefolge: s.rekkefolge } },
      update: {},
      create: {
        versjonId: versjon.id,
        rekkefolge: s.rekkefolge,
        type: "EPOST",
        navn: s.navn,
        ventetidTimer: s.ventetidTimer,
        kanal: "EPOST",
        emneMal: s.emneMal,
        innholdMal: s.innholdMal,
        avsluttVedSvar: true,
      },
    });
  }
  console.log(`  ✓ sekvens «${SEKVENSNavn}» med ${SEKVENSN_STEG.length} steg`);

  // 8. Brukere — bare hvis ingen finnes. Passord settes av Kenneth og Fredrik.
  const antallBrukere = await prisma.bruker.count();
  if (antallBrukere === 0) {
    const passord = process.env.SEED_PASSORD;
    if (passord && passord.trim().length >= 12) {
      const { hash } = await hashPassord(passord);
      const brukere = [
        { epost: "kenneth@vikingnet.no", navn: "Kenneth Kristiansen" },
        { epost: "fredrik@vikingnet.no", navn: "Fredrik Rostrup Ellingsen" },
      ];
      for (const b of brukere) {
        await prisma.bruker.create({
          data: {
            epost: b.epost,
            navn: b.navn,
            passordHash: hash,
            passordSalt: "se-hash",
            rolle: "BRUKER",
          },
        });
      }
      console.log(`  ✓ ${brukere.length} brukere opprettet med passordet fra SEED_PASSORD`);
    } else {
      console.log("  ! Ingen brukere opprettet — SEED_PASSORD mangler eller er under 12 tegn.");
    }
  } else {
    console.log(`  · ${antallBrukere} brukere finnes allerede`);
  }

  console.log("Ferdig.");
}

seed()
  .catch((feil) => {
    console.error("Seeding feilet:", feil instanceof Error ? feil.message : feil);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
