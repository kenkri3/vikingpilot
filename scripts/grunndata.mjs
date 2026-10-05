/**
 * Oppsett av grunndata — trygt å kjøre flere ganger.
 *
 * HVORFOR DENNE FINNES VED SIDEN AV prisma/seed.ts:
 *
 * `prisma db seed` kjører via tsx, som er en utvikleravhengighet og ikke finnes
 * i produksjonsbildet. På Railway kjøres derfor ingen seeding i det hele tatt,
 * og første oppstart ga et tomt system: null kanaler, null cron-jobber, null
 * målgruppe — og ingen bruker å logge inn med.
 *
 * Denne filen gjør det samme som seed.ts, men uten tsx, og den kalles fra
 * scripts/start-prod.mjs ved oppstart. Den er idempotent: kjører du den to
 * ganger, skjer ingenting andre gang.
 *
 * BRUKERNE OPPRETTES IKKE HER. Et passord skal velges av et menneske, ikke
 * genereres i en oppstartsjobb og havne i en logg. Bruk `npm run bruker:lag`.
 */

/** Kanalene. Alle er AV. Dette er systemets viktigste standardverdi. */
const KANALER = ["EPOST", "TELEFON", "SMS", "LINKEDIN", "WEBHOOK", "MANUELL"];

/**
 * Integrasjoner. Enhetsregisteret har TOM nøkkelliste med vilje: det er et åpent
 * API, verifisert ved å kalle det uten autentisering. Å kreve en nøkkel ville
 * vist «ikke konfigurert» for alltid, og det ville vært usant.
 */
const INTEGRASJONER = [
  {
    navn: "enhetsregisteret",
    beskrivelse:
      "Åpent API fra Brønnøysundregistrene. Krever ingen nøkkel. Henter nye selskaper.",
    nokler: [],
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
    beskrivelse: "Viser oppvarmingsstatus og ledig kvote per avsender.",
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

const OPPVARMINGSSTEG = [
  { dagFraStart: 0, maksPerDag: 5, beskrivelse: "Dag 1–3: svært lavt volum." },
  { dagFraStart: 4, maksPerDag: 10, beskrivelse: "Dag 4–7: forsiktig økning." },
  { dagFraStart: 8, maksPerDag: 20, beskrivelse: "Dag 8–14: gradvis opptrapping." },
  { dagFraStart: 15, maksPerDag: 40, beskrivelse: "Dag 15–21: nær normalt." },
  { dagFraStart: 22, maksPerDag: 80, beskrivelse: "Dag 22–30: normalt volum." },
  { dagFraStart: 31, maksPerDag: 150, beskrivelse: "Etter dag 30: fullt volum." },
];

const MAALGRUPPE = {
  navn: "Standard: norske SMB i privat sektor",
  beskrivelse:
    "Utgangspunkt. Kenneth og Fredrik kan endre denne uten at noen skriver kode. Se S4 i docs/aapne-sporsmal.md.",
  naeringskoder: [],
  fylker: [],
  minAnsatte: 5,
  maxAnsatte: 250,
  roller: ["Daglig leder", "Adm. direktør", "IT-sjef", "Driftssjef"],
  ekskluderOffentlig: true,
  ekskluderKonkurs: true,
  ekskluderUnderAvvikling: true,
  minAlderMaaneder: 12,
  prioritet: 10,
};

const PRODUKTER = [
  {
    sku: "VP-AVVIKLING",
    navn: "Avvikling av manuelle arbeidsoppgaver",
    beskrivelse: "Kartlegging og automatisering av én arbeidsflyt. Pris må bekreftes.",
    prisOre: 0,
    enhet: "ENGANG",
  },
  {
    sku: "VP-AGENT-MND",
    navn: "Autonom agent — månedlig",
    beskrivelse: "Drift av én autonom agent. Pris må bekreftes.",
    prisOre: 0,
    enhet: "PER_MANED",
  },
];

const SEKVENSNavn = "Standard oppfølging";
const SEKVENSN_STEG = [
  {
    rekkefolge: 1,
    navn: "Første henvendelse",
    ventetidTimer: 0,
    emneMal: "Kort spørsmål om {{oppgave}}",
    innholdMal: "Mal. Selve teksten skriver agenten senere, innenfor rammene systemet setter.",
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

/**
 * Legger inn grunndata. Idempotent.
 *
 * @param prisma En Prisma-klient. Sendes inn slik at denne filen ikke selv
 *               bestemmer hvordan databasen åpnes.
 * @returns En oppsummering av hva som ble gjort.
 */
export async function settOppGrunndata(prisma) {
  const gjort = [];

  // 1. Kanaler — all utgående trafikk AV.
  for (const kanal of KANALER) {
    await prisma.kanalInnstilling.upsert({
      where: { kanal },
      update: {},
      create: {
        kanal,
        utgaaendeAktivert: false,
        maksPerDag: 0,
        maksPerUke: 0,
        maksPerMinutt: 0,
        tidsvinduStart: "08:00",
        tidsvinduSlutt: "16:00",
        kunHverdager: true,
        helligdagLand: "NO",
        oppvarmingAktiv: true,
        notat: "Av som standard. Volum settes når avsender og oppvarmingsplan er bestemt.",
      },
    });
  }
  gjort.push(`${KANALER.length} kanaler, alle med utgående AV`);

  // 2. Integrasjoner.
  for (const i of INTEGRASJONER) {
    const mangler = i.nokler.filter((n) => !process.env[n] || process.env[n].trim() === "");

    await prisma.integrasjon.upsert({
      where: { navn: i.navn },
      update: { konfigurert: mangler.length === 0, manglendeNokler: mangler, sistSjekket: new Date() },
      create: {
        navn: i.navn,
        beskrivelse: i.beskrivelse,
        konfigurert: mangler.length === 0,
        manglendeNokler: mangler,
        sistSjekket: new Date(),
      },
    });
  }
  gjort.push(`${INTEGRASJONER.length} integrasjoner`);

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
  gjort.push(`${CRON_JOBBER.length} cron-jobber`);

  // 4. Oppvarmingsplan. Bare hvis den er tom — den er konfigurasjon.
  const antallSteg = await prisma.oppvarmingssteg.count({ where: { avsenderId: null } });
  if (antallSteg === 0) {
    await prisma.oppvarmingssteg.createMany({ data: OPPVARMINGSSTEG });
    gjort.push(`${OPPVARMINGSSTEG.length} oppvarmingstrinn`);
  }

  // 5. Målgruppe.
  await prisma.maalgruppe.upsert({
    where: { navn: MAALGRUPPE.navn },
    update: {},
    create: MAALGRUPPE,
  });
  gjort.push("1 målgruppe");

  // 6. Produkter.
  for (const p of PRODUKTER) {
    await prisma.produkt.upsert({ where: { sku: p.sku }, update: {}, create: p });
  }
  gjort.push(`${PRODUKTER.length} produkter`);

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
  gjort.push(`sekvens med ${SEKVENSN_STEG.length} steg`);

  return gjort;
}

/**
 * Åpner en Prisma-klient.
 *
 * Vi importerer den genererte klienten dynamisk, fordi den er TypeScript og
 * bare kan lastes gjennom en transpilator. I produksjonsbildet finnes tsx, fordi
 * start:prod kjører migreringer. Feiler det, sier vi tydelig hvorfor i stedet
 * for å kaste en uforståelig modulfeil.
 */
export async function åpneKlient() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL mangler. Se docs/manuell-oppsett.md, del C1.");
  }

  const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
    import("@prisma/adapter-pg"),
    import("../src/generated/prisma/client.ts"),
  ]);

  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
