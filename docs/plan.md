# VikingPilot — plan

**Dette er planen. Den er kilde til sannhet, og neste økt leser den og fortsetter.**

- Oppdragsgiver: Vikingnet / AIChat Norge AS, org.nr 933 851 222
- Brukere: Kenneth Kristiansen, Fredrik Rostrup Ellingsen
- Stack: Next.js (App Router) + PostgreSQL + Prisma + Railway
- Byggerot: `C:\VikingPilot` (se B-011 og `LAGT-TIL-GRUNN.md` A-001)
- Systemet er internt. Ingen eget domene. Kjører på Railway-URL-en.
- Agentplattformen navngis aldri i kode, dokumentasjon, kommentarer eller commits. (B-002)

---

## Statusoversikt

| Fase | Innhold | Status |
|---|---|---|
| 0 | Kartlegg, les spesifikasjonen, skriv planen med stoppkriterier | **Fullført** — med to avvik, se A-002 og A-003 |
| 1 | Skjelett: stack, skjema, migreringer, innlogging, tomt dashbord, deploybart | **Fullført og verifisert** — se bevisene under |
| 2 | Kjernedata, sperrelister, revisjonslogg | Ikke startet |
| 3 | Enhetsregister-pipeline og utsendingsvakt | Ikke startet |
| 4 | Sekvensmotor med tørrkjøring, og godkjenningskø | Ikke startet |
| 5 | Herding: frødata, sjekkeliste, dokumentasjon, manuell liste | Ikke startet |

**Ingen blokkering står åpen.** F-001 (skallet) var feildiagnostisert og er lukket;
byggerot-spørsmålet er løst teknisk og venter bare på din aksept. Se `docs/status.md`.

---

## Hva som ble avgjort i fase 0

Fire spørsmål ble stilt og besvart av Kenneth:

| Spørsmål | Svar |
|---|---|
| `docs/spesifikasjon.md` finnes ikke — hva gjør vi? | Jeg skriver den fra oppdraget |
| Database lokalt | Postgres som Windows-tjeneste |
| Innlogging | E-post og passord i databasen, scrypt, signert cookie |
| Test- og sjekkeverktøy | Nodes innebygde testkjører, null nye avhengigheter |

I tillegg ble `G:`-problemet oppdaget og målt, og byggeroten flyttet. Se A-001.

---

## Bøtteplasseringen

Hver oppgave er plassert i nøyaktig én bøtte. Full tabell i `docs/spesifikasjon.md`
avsnitt 3. Kort oppsummert:

**Bøtte 1 — DETERMINISTISK. Bygges nå.**

Henting og normalisering fra Enhetsregisteret · filtre (bransje, fylke, størrelse, rolle) ·
offentlig sektor ut · sperrelister · volum per avsender · oppvarmingsplan · hverdagsvinduer
og røde dager · idempotens · sekvensmotor · godkjenningskøens mekanikk · revisjonslogg ·
cron med hemmelighet og tørrkjøring · webhook-mapping · kvitteringens felter og tidspunkt ·
logging · rate limiting · målgruppekonfigurasjon.

**Bøtte 2 — SKJØNN. Bygger bare datastruktur og verktøyflate.**

Å skrive tekst som ikke lukter AI · klassifisere et svar · velge strategi · formulere
kvitteringens ordlyd · tolke fritekst i innkommende e-post · vurdere om et treff er relevant.

**Grensetilfellene** er dokumentert i `docs/spesifikasjon.md` avsnitt 3.3. Kort: *at* en
kvittering finnes er deterministisk, *ordlyden* er skjønn. Ventetid er deterministisk —
agenten kan ikke velge å vente kortere.

---

## Fase 1 — Skjelett

**Status: fullført og verifisert.**

**Steg og resultat:**

1. ✅ `create-next-app@15` med TypeScript, App Router, Tailwind, `src/`-mappe
2. ✅ Prisma opp mot Postgres. `.env.example` med alle variabler, ingen verdier
3. ✅ `prisma/schema.prisma` med alle modeller for alle ni moduler — 32 tabeller
4. ✅ Migrering kjørt mot tom database. Selvoppsett ved oppstart i `scripts/start-prod.mjs`
5. ✅ Innlogging: scrypt + signert cookie. To brukere fra frødata
6. ✅ Dashbord med de fire spørsmålene, pluss en egen tavle for «all utgående trafikk er av»
7. ✅ `railway.json`, `Dockerfile`, `npm run verify`, `npm run sjekkliste`
8. ✅ Committet

**Bevis:**

| Krav | Resultat |
|---|---|
| `npx prisma validate` | «The schema at prisma\schema.prisma is valid 🚀» |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | «Compiled successfully in 34.4s», 6 ruter |
| `node --import tsx --test` | 9 tester, 9 bestått |
| `npx tsx scripts/sjekkliste.ts` | 26 bestått, 0 feilet |
| `GET /api/helse` | HTTP 200, database ok |
| `GET /dashboard` uten cookie | HTTP 307 → `/login` |
| Cron uten hemmelighet | HTTP 503 |
| Cron med feil hemmelighet | HTTP 401 |
| Kanaler slått på | **0 av 6** |

**Tekniske valg som må huskes av neste økt:**

- Prisma 7.10.0 er **pinnet**. `latest` på npm er `8.0.0-rc.19`, som er en release
  candidate. Ikke oppgrader uten videre.
- Prisma 7 krever `prisma.config.ts` og en driver-adapter. `url` i `datasource` er fjernet.
- Klienten genereres til `src/generated/prisma`, ikke `node_modules`.
- Tester kjøres med `node --import tsx --test`, fordi testene importerer `.ts` med
  stialias.
- `next/font/google` er **fjernet**. Den henter fonter over nett under bygging, og
  bryter kravet om å kunne bygges uten nettverk.

**Avvik fra planen underveis, som er rettet:**

- `start-prod.mjs` brukte `new URL().pathname`, som gir `C:\C:\…` på Windows. Rettet med
  `fileURLToPath`. Funnet fordi jeg faktisk startet systemet.
- Port 3000 var opptatt av et annet prosjekt. VikingPilot bruker 3100 lokalt.

---

## Fase 2 — Kjernedata, sperrelister, revisjonslogg

**Mål:** dataene finnes, og ingenting kan sendes til noen som står på en sperreliste.

**Steg:**

1. Alle kjernemodeller med relasjoner: organisasjoner, kontakter, prospekter, kunder,
   dialoger, produkter med SKU og pris, avtaler, oppgaver
2. `Sperreliste` med kanal og grunn. Global, på tvers av kanaler
3. Automatisk sperre ved: eksisterende kunde, aktiv dialog, avmelding, bounce
4. `sjekkSperreliste()` som tjenestefunksjon, og ruten rundt
5. `Revisjon`: skriv, aldri endre. Hver utgående handling med grunnlag, tidspunkt,
   resultat og kilde
6. Bruddforsøk: prøv å sende til en sperret adresse og bevis at det avvises

**Stoppkriterium:** en sperret adresse kan ikke sendes til, uansett hvilken kodevei som
prøves. Beviset ligger i `npm run test:brudd`.

---

## Fase 3 — Enhetsregister-pipeline og utsendingsvakt

**Mål:** systemet fyller seg selv med kvalifiserte prospekter, og kan ikke sende for mye.

**Steg:**

1. Hent fra Enhetsregisteret. Ærlig «ikke konfigurert» hvis nøkkel mangler
2. Normaliser: navn, orgnr, adresse, NACE
3. Filtrer deterministisk: bransje, fylke, størrelse, alder, rolle. Offentlig sektor ut
4. `Maalgruppe` som konfigurasjon. Kenneth og Fredrik skal kunne endre målgruppen
5. Volum per avsender, per dag og per uke
6. Oppvarmingsplan med kvote som vokser over tid
7. Hverdagsvindu og røde dager. Norske helligdager, ikke bare helger
8. Idempotensnøkkel. Samme melding skal aldri kunne sendes to ganger
9. Bruddforsøk mot hver guardrail

**Stoppkriterium:** alle guardrails avviser aktive bruddforsøk. `npm run test:brudd` grønn.

Blokkeres delvis av S4 (målgruppe) for frødataenes innhold.

---

## Fase 4 — Sekvensmotor og godkjenningskø

**Mål:** oppfølgingen skjer av seg selv, men ingenting går ut uten at et menneske har sagt ja.

**Steg:**

1. `Sekvens` med `versjon`. Steg med ventetid og kanal
2. Avslutningsregler: svar, avmelding, kunde, manuell stopp
3. Kjøring i tørrkjøringsmodus: logg hva den ville gjort, send ingenting
4. `Godkjenning`: hvem la inn, hvem godkjente, når, og hva som ble godkjent
5. Alt med ekstern konsekvens går gjennom køen. Ingen omvei
6. Agentens verktøyflate: funksjoner og ruter som senere pakkes som MCP-verktøy

**Stoppkriterium:** en sekvens kan kjøres ende-til-ende i tørrkjøring og produsere en
godkjenningskø, uten at én byte går ut.

Blokkeres delvis av S6 (sekvensens form) og S7 (produkt og pris).

---

## Fase 5 — Herding

**Mål:** systemet kan demonstreres uten én eneste ekstern tjeneste, og du kan sette det opp
uten å skrive kode.

**Steg:**

1. Frødata: hele systemet demonstrerbart offline
2. `npm run sjekkliste` — verifiserer ende-til-ende uten nettverk
3. `docs/manuell-oppsett.md` prøvd fra tom mappe
4. Alle åpne funn av BLOKKERER eller HØY lukket
5. `docs/oversikt.md` oppdatert med faktisk status
6. Uavhengig etterkontroll av en annen agent

**Stoppkriterium:** alle åtte stoppkriterier i `docs/stoppkriterier.md` har kommando kjørt
og bevis innført.

---

## Åpne spørsmål

Elleve spørsmål i `docs/aapne-sporsmal.md`. Fire blokkerer:

| # | Spørsmål | Blokkerer |
|---|---|---|
| S1 | Hvilken kanal sender vi e-post gjennom? | fase 1 |
| S2 | Hvilke avsendere, og hvor mange meldinger tåler de? | fase 1 |
| S4 | Hva kjennetegner en god kunde for oss? | fase 3 |
| S7 | Hva selger vi, og til hvilken pris? | fase 4 |

---

## Runde logg

### Runde 1 — fase 0

**Gjort:** Kartlagt miljøet. Målt at `G:` er Google Drive og ikke kan brukes. Målt at
skallet er dødt. Stilt fire beslutningsspørsmål og fått svar. Skrevet `docs/spesifikasjon.md`
med bøtteoppdelingen, `docs/stoppkriterier.md`, `docs/beslutninger.md`,
`docs/aapne-sporsmal.md`, `docs/status.md`, `docs/oversikt.md`, `docs/manuell-oppsett.md`
og `LAGT-TIL-GRUNN.md`.

**Endret for en bruker av systemet:** ingenting. Det finnes ingen bruker ennå, og ingen
kode. **Det er et ærlig svar, og det betyr at den autonome delen ikke kan fortsette før
skallet virker.**

**Blokkert av:** F-001 (skall dødt) og F-002 (byggerot, krever din aksept).

### Neste runde — fase 2

Kjernedata i bruk, sperrelister og revisjonslogg. Begynn med `src/lib/guards/sperreliste.ts`
og tjenestefunksjonen `sjekkSperreliste()`, med ruten rundt. Deretter bruddforsøk i
`tests/`.

**Rekkefølgen som er låst:** fase 2 → 3 → 4 → 5. Ikke hopp til fase 4 fordi den er
morsommere; fase 3 sin utsendingsvakt er det som gjør fase 4 trygg å bygge.

**Svar som trengs før fase 3:** S1, S2 og S4 i `docs/aapne-sporsmal.md`.
Fase 2 kan bygges helt uten dem.

---

## Runde logg

### Runde 2 — fase 1

**Gjort:** Bygget hele skjelettet. Next.js 15 + Prisma 7.10.0 + Postgres, 32 tabeller,
migrasjon mot tom database, selvoppsett ved oppstart, innlogging med scrypt og signert
cookie, dashbord med de fire spørsmålene, helsesjekk, første cron-rute med egen hemmelighet
og tørrkjøring, `railway.json`, `Dockerfile`, frødata, sjekkeliste, README og oppdatert
dokumentasjon. To commits.

**Endret for en bruker av systemet:** Ja, konkret. Kenneth og Fredrik kan nå:

- logge inn og se et dashbord som svarer på hva som kjører, hva som venter på godkjenning,
  hva som har feilet, og nøyaktig hvilke miljøvariabler som mangler
- se med egne øyne at all utgående trafikk er av
- kalle `/api/helse` og få sannheten om systemets tilstand
- kjøre `npm run sjekkliste` og få 26 kontroller verifisert uten nettverk

Det er en reell endring fra «ingen kode» til «et system de kan åpne og forstå».

**Rettet egne feil underveis:**

1. **Feildiagnosen fra runde 1.** Jeg erklærte at miljøet var nede. Det var det ikke —
   skallet feilet bare fordi det startet i `G:`-stien. Dokumentert i `LAGT-TIL-GRUNN.md`
   A-005. Rettelsen kostet én linje; feilen kostet en runde.
2. **`start-prod.mjs`** brukte `new URL().pathname`, som gir `C:\C:\…` på Windows. Funnet
   fordi jeg faktisk startet systemet og leste feilmeldingen.
3. **To manglende back-relasjoner** i skjemaet. Fanget av `prisma validate`.
4. **Typefeil i sjekkelisten** etter at den ble omdøpt fra `.mjs` til `.ts`. Fanget av
   `npm run verify` — som er grunnen til at `verify` kjører typekontroll før bygg.
5. **Rydding av prøvedatamapper** fra runde 1, som det første ryddeforsøket ikke fikk
   fjernet fordi skallet døde midt i kommandoen.

**Blokkert av:** ingenting. Men to ting venter på Kenneth:

- Aksept av byggerot `C:\VikingPilot` i stedet for `G:` (`LAGT-TIL-GRUNN.md` A-001)
- Svar på S1, S2, S4 før fase 3

### Neste runde — hvis ingenting endres

Fase 2. Sperrelister og revisjonslogg, med bruddforsøk.
