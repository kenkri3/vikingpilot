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
| 1 | Skjelett: stack, skjema, migreringer, innlogging, tomt dashbord, deploybart | **Fullført og verifisert** |
| 2 | Kjernedata, sperrelister, revisjonslogg | **Fullført og verifisert** |
| 3 | Enhetsregister-pipeline og utsendingsvakt | **Fullført og verifisert** mot ekte data |
| 4 | Sekvensmotor med tørrkjøring, og godkjenningskø | **Fullført og verifisert** ende-til-ende |
| 5 | Herding: frødata, sjekkeliste, dokumentasjon, manuell liste | **Pågår.** Uavhengig etterkontroll utført, funn lukket. Gjenstår: prøvd av Kenneth/Fredrik, og Railway-deploy |

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

**Status: fullført og verifisert.** Kjernedataene lå allerede i skjemaet fra fase 1.

**Steg og resultat:**

1. ✅ Kjernemodeller med relasjoner — alle tabellene finnes fra fase 1
2. ✅ `Sperreliste` med kanal og grunn
3. ✅ Automatiske sperrer i `src/lib/guards/automatisk.ts`: avmelding, hard bounce,
   klage, eksisterende kunde, aktiv dialog, konkurs, offentlig sektor
4. ✅ `sjekkSperreliste()` og `kanSende()` som tjenestefunksjoner, med ruten
   `/api/sperrelister` rundt
5. ✅ `Revisjon`: skriv, aldri endre. Med korrelasjonsid for å knytte kjeder sammen
6. ✅ 27 bruddforsøk i `tests/sperrelister.test.ts`

**Bevis:** se `docs/status.md`, avsnittet «Fase 2».

**Tre ekte feil funnet av bruddforsøkene:**

| Feil | Konsekvens | Fanget av |
|---|---|---|
| Kanalsperre for e-post sperret også SMS | Over-sperring på tvers av kanaler | «kanalsperre stopper bare sin egen kanal» |
| Global sperre på én adresse sperret **alle** mottakere | All utsending ville stoppet | «en mottaker uten sperre slipper gjennom» |
| Sperre uten mottaker ble godtatt | All utgående trafikk ville stoppet | Ny test etter at feilen ble forstått |

Alle tre var stille feil: systemet ville sett ut til å virke, men nektet alt. De er nå
låst fast som faste bruddforsøk.

**Én feil funnet ved å kalle ruten på ekte:** `instanceof` krysser ikke modulgrenser
pålitelig i Next.js, så en klientfeil ga 500 i stedet for 400. Rettet med en konstant
feilkode. Se B-019.

**Designvalg som må huskes:**

- En sperre må peke på en mottaker. Å stenge en hel kanal gjøres i `KanalInnstilling`.
- `kanSende()` sjekker kanalen **før** sperrelisten. Er kanalen av, vurderes ikke
  mottakeren engang.
- Myk bounce sperrer ikke. Full postkasse er ikke det samme som ukjent adresse.
- Oppheving setter `aktiv = false`. Vi sletter aldri en sperre.

---

## Fase 3 — Enhetsregister-pipeline og utsendingsvakt

**Status: fullført og verifisert mot ekte data.**

**Steg og resultat:**

1. ✅ `hent.ts` henter fra det åpne API-et. Ingen nøkkel kreves — verifisert
2. ✅ `normaliser.ts` rydder navn, orgnr, datoer og adresser. Rene funksjoner, ingen nettverk
3. ✅ `filter.ts` avviser med grunn i klartekst. Offentlig sektor, konkurs og avvikling ut, alltid
4. ✅ `sektor.ts` klassifiserer etter organisasjonsform, med eksplisitte kodelister
5. ✅ `volum.ts`: døgn- og ukekvote per avsender, nullstilles ved norsk midnatt
6. ✅ `oppvarming.ts`: kvoten vokser etter en plan som er data
7. ✅ `idempotens.ts`: unik nøkkel i databasen, ikke sjekk-og-send
8. ✅ 43 + 28 nye tester, alle med bruddforsøk

**Bevis:** se `docs/status.md`, avsnittet «Fase 3».

**To ekte feil funnet ved å kjøre mot virkelige data:**

| Feil | Konsekvens | Hvordan den ble funnet |
|---|---|---|
| `ENHETSREGISTERET_API_KEY` ble krevd, men API-et er åpent | Integrasjonen ville vist «ikke konfigurert» for alltid | Kalte API-et uten autentisering og fikk HTTP 200 |
| Sektor-utledningen avviste alt fra det åpne API-et | 0 godkjente av 200, inkludert vanlige AS | Kjørte pipelinen og leste opptellingen |

Den andre er den lærerike. Koden var «trygg» — den avviste alt den var i tvil om. Men
den var ubrukelig, og den så riktig ut i alle enhetstester fordi testdataene mine hadde
et `sektor`-felt som virkeligheten ikke har. **Enhetstester mot oppdiktede data fant det
ikke. Å kjøre mot ekte data gjorde det.**

**Tre feil i mine egne forventninger, funnet av testene:**

- `dagerSiden` regner i norske døgn. 23:00 UTC er 00:00 norsk tid, så døgnet *har*
  skiftet. Testen min sa feil, ikke koden.
- Idempotenstestene brukte falske fremmednøkler og feilet på `P2003` i stedet for
  `P2002`. Da testet de ingenting.
- Oppvarmingstestene skrev og slettet globale trinn — delt tilstand. De leser nå planen
  som faktisk ligger i basen.

**Kjent begrensning som ikke er en feil:** Enhetsregisterets åpne API oppgir sjelden
`antallAnsatte` og `fylke`. 185 av 200 ble avvist nettopp på manglende ansattall. Det
betyr at `minAnsatte` i målgruppen koster treff. Se F-014 og F-015 i `docs/status.md`.

**Designvalg som må huskes:**

- En tom oppvarmingsplan gir kvote 0, ikke fritt fram. Låst med test.
- Effektiv kvote er den *laveste* av oppvarmingskvoten og døgnkvoten.
- Idempotens bruker en unik indeks, ikke les-så-skriv. Kappløpet er testet med tre
  samtidige kall.

---

## Fase 4 — Sekvensmotor og godkjenningskø

**Status: fullført og verifisert ende-til-ende.**

**Steg og resultat:**

1. ✅ `godkjenning/ko.ts`: forslag, godkjenning, avvisning, med navn og tidspunkt
2. ✅ Avgjørelser krever sesjon; hemmeligheten holder bare til å foreslå
3. ✅ `sekvens/motor.ts`: velger neste steg, regner planlagt tid, lager utkast
4. ✅ `sekvens/utsending.ts`: den eneste veien til en mottaker, med hele kjeden av sjekker
5. ✅ `/api/cron/sekvens` og `/api/cron/utsending`, begge med tørrkjøring
6. ✅ `/api/godkjenninger` som verktøyflate
7. ✅ `scripts/e2e-fase4.ts` som kjører hele kjeden og sjekker tilstanden underveis

**Bevis:** se `docs/status.md`, avsnittet «Fase 4».

**Én ekte feil funnet — og den ble bare funnet av ende-til-ende-kjøringen:**

Godkjenningen ble satt til `GODKJENT`, men `DialogMelding.status` ble stående i
`VENTER_GODKJENNING`. Utsendingsjobben ser på meldingens status. En godkjent melding ville
derfor blitt liggende usendt **for alltid**, og alt ville sett riktig ut.

26 enhetstester fant det ikke, fordi hver av dem testet sin egen del. Det ble funnet ved å
kjøre prospekt → sekvens → utkast → kø → godkjenning → utsending i én sammenhengende kjede
og lese tilstanden mellom hvert ledd. Se B-027.

**Én designbeslutning tatt underveis:** skal et utkast som venter på godkjenning blokkere
neste steg? Nei — se B-026.

**Én ærlig begrensning:** Enhetsregisteret oppgir virksomheter, ikke e-postadresser. De 13
prospektene står uten kontakt, og motoren sier `utenKontakt: 13` i stedet for å finne på en
adresse. Se B-028 og F-017.

---

## Fase 5 — Herding

**Status: pågår. Det vesentligste er gjort, men to ting gjenstår utenfor min rekkevidde.**

**Gjort:**

1. ✅ Alle fem cron-ruter bygget, med egen hemmelighet, tørrkjøring og logging
2. ✅ `kjoerCronjobb()` samler cron-skjelettet på ett sted
3. ✅ Ryddejobben verifisert mot ekte gamle rader, og den rører ikke bevis
4. ✅ Dashbordet har godkjenn- og avvis-knapper
5. ✅ Manuell oppsettliste kjørt fra **tom** database: `dropdb`, `createdb`, `migrate`, `seed`, `verify`, `sjekkeliste`
6. ✅ **Uavhengig etterkontroll av en annen agent** — oppdragets krav
7. ✅ To funn av alvor BLOKKERER lukket, pluss fire andre
8. ✅ Kanalsporing: hovedbryteren kan ikke lenger endres i stillhet

**Bevis:** se `docs/status.md`, avsnittene «Fase 5» og «Uavhengig etterkontroll».

**Hva etterkontrollen fant, og hvorfor det er verdt å merke seg:**

Revisoren fikk beskjed om å motbevise systemets egne påstander. Den fant to feil av
alvor BLOKKERER som **138 egne tester ikke hadde funnet**:

| Feil | Hva den betydde |
|---|---|
| F-023 | `registrerUtsending()` hadde null kallere. Døgnkvote, ukekvote og oppvarmingstak var korrekte funksjoner som aldri ble stilt spørsmålet |
| F-024 | `kanSende()` hoppet stille over volum og oppvarming når `avsenderId` manglet — og den eneste kalleren oppga den ikke |

**Fellesnevneren er lærerik:** testene mine var ikke svake på logikk, men på
*integrasjon*. Hver test skrev den tilstanden den trengte direkte i basen, i stedet for å
gå gjennom koden som skulle produsere den. Da tester man funksjonen, ikke systemet.

Det er samme feilklasse som F-016 i fase 4 — godkjenningen som ikke flyttet meldingen.
Begge ble funnet ved å kjøre den ekte kjeden, ikke ved å lese koden.

**Hva som gjenstår, og hvorfor jeg ikke kan gjøre det:**

- **Railway-deployen.** Krever Kenneths konto. `railway.json` og `Dockerfile` ligger klare.
- **At Kenneth eller Fredrik følger den manuelle listen selv.** Jeg har kjørt den fra tom
  database, men kriteriet sier at listen skal være *prøvd*, og en ekte prøve er at noen
  andre følger den uten hjelp.
- **En kontaktkilde.** Uten e-postadresser kan målgruppen fylles, men ikke kontaktes.
  Se S12.

---

## Fase 5 — de seks stegene, og hvor de står

**Mål:** systemet kan demonstreres uten én eneste ekstern tjeneste, og du kan sette det opp
uten å skrive kode.

| # | Steg | Status |
|---|---|---|
| 1 | Frødata: hele systemet demonstrerbart offline | ✅ Seed dekker alle ni moduler |
| 2 | `npm run sjekkliste` — verifiserer ende-til-ende uten nettverk | ✅ 53 kontroller, alle grønne |
| 3 | `docs/manuell-oppsett.md` prøvd fra tom mappe | ✅ Kjørt fra 0 tabeller av meg. Gjenstår å bli prøvd av Kenneth eller Fredrik |
| 4 | Alle åpne funn av BLOKKERER eller HØY lukket | ✅ F-023, F-024 og F-021 lukket. Ingen BLOKKERER eller HØY står åpent |
| 5 | `docs/oversikt.md` oppdatert med faktisk status | ✅ |
| 6 | Uavhengig etterkontroll av en annen agent | ✅ Utført. Fant to BLOKKERER-feil, begge lukket |

**Stoppkriterium:** alle åtte stoppkriterier i `docs/stoppkriterier.md` har kommando kjørt
og bevis innført. Se `docs/stoppkriterier.md` for status per kriterium.

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

**Blokkert av:** F-001 (skall dødt) og F-002 (byggerot, krever din aksept). Begge er siden
lukket — se runde 2.

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

---

### Runde 3 — fase 2

**Gjort:** Sperrelister og revisjonslogg. `sjekkSperreliste()`, `kanSende()`, automatiske
sperrer, revisjonslogg med korrelasjonsid, ruten `/api/sperrelister`, 27 bruddforsøk, og
utvidet sjekkeliste fra 26 til 32 kontroller.

**Endret for en bruker av systemet:** Ja, konkret.

- En mottaker som har meldt seg av kan nå ikke kontaktes, og systemet sier hvorfor.
- Hard bounce sperrer adressen automatisk. Myk bounce gjør det ikke — det var et bevisst
  valg, ikke en forglemmelse.
- Hver utgående handling kan spores med grunnlag, resultat og kilde, knyttet sammen i en
  kjede fra utkast til sending.
- Agentens verktøyflate har fått sitt andre endepunkt: `/api/sperrelister`.

Det viktigste er likevel usynlig for brukeren: **tre feil som ville stoppet all utsending
er funnet og lukket før de nådde produksjon.**

**Rettet egne feil underveis:**

1. En kanalsperre lakk til andre kanaler.
2. En global sperre på én adresse sperret alle.
3. Sperrer uten mottaker ble godtatt.
4. `instanceof` virket ikke på tvers av Next.js' modulgrenser.
5. Testdataene mine lakk mellom tester — to ganger. Domenesperren og den globale sperren
   traff naboene. Isolerte hvert tilfelle i eget underdomene.
6. Sjekkelistens myk-bounce-sjekk feilet fordi den brukte en adresse som allerede var
   sperret av en tidligere sjekk i samme kjøring.

**Blokkert av:** ingenting.

---

### Runde 4 — fase 3

**Gjort:** Enhetsregister-pipelinen og utsendingsvakten. Henting fra det åpne API-et,
normalisering, deterministisk filtrering med grunner i klartekst, sektor-klassifisering,
volum, oppvarming og idempotens. Cron-ruten kjører hele pipelinen med tørrkjøring som
standard. 71 nye tester. Sjekkelisten utvidet fra 32 til 44 kontroller.

**Endret for en bruker av systemet:** Ja, og denne gangen med ekte data.

- Pipelinen fyller målgruppen selv. Kjør den, og det ligger kvalifiserte prospekter i basen.
- Dashbordet kan vise hvorfor en virksomhet ble silt ut — hvert avslag har en grunn.
- Utsendingsvakten kan ikke lenger bare teoretisk hindre overforbruk: døgnkvote, ukekvote,
  oppvarmingsplan og idempotens er bygget og testet.
- Beviset på at det virker mot virkeligheten: hentet 200, godkjent 13, opprettet 13.
  Kjørt om igjen: opprettet 0, oppdatert 13.

**Rettet egne feil underveis:**

1. `ENHETSREGISTERET_API_KEY` ble krevd av en feil jeg selv innførte i fase 1.
2. Sektor-utledningen avviste alt fra det åpne API-et. Funnet bare ved å kjøre mot ekte data.
3. `dagerSiden`-testen min hadde feil forventning om tidssoner.
4. Idempotenstestene testet ingenting, fordi de feilet på fremmednøkkel først.
5. Oppvarmingstestene rørte delt tilstand.
6. `hentSider` manglet `endepunkt` i returtypen.
7. Seed-dataene krevde fortsatt den gamle nøkkelen, så dashbordet viste feil tilstand.

**Blokkert av:** ingenting.

---

### Runde 5 — fase 4

**Gjort:** Godkjenningskøen og sekvensmotoren. Kø med atomiske avgjørelser, sekvensmotor
som lager utkast og aldri sender, utsendingsjobb med hele kjeden av sjekker, to nye
cron-ruter, verktøyflaten `/api/godkjenninger`, og et ende-til-ende-skript. 26 nye tester.
Sjekkelisten utvidet fra 44 til 51 kontroller.

**Endret for en bruker av systemet:** Ja, og dette er den fasen som betyr mest.

- Kenneth og Fredrik har nå en kø å tømme. De ser hva som venter, og de bestemmer.
- Systemet kan ikke lenger bare *påstå* at alt går gjennom køen — det er håndhevet, og
  sjekkelisten verifiserer invariantene: ingen melding er godkjent uten en beslutning,
  ingen utsending er sendt uten en godkjenning.
- Hele kjeden er bevist ende-til-ende: prospekt → sekvens → utkast → kø → godkjenning →
  utsendingsjobb. Den siste stoppet ærlig med «E-postkanalen er ikke konfigurert».

**Rettet egne feil underveis:**

1. **Godkjenning flyttet ikke meldingen.** En godkjent melding ville aldri blitt sendt.
   26 enhetstester fant det ikke; ende-til-ende-kjøringen gjorde det.
2. Testoppsettet ryddet ikke kontakter, som er unike på e-post. En krasjet kjøring gjorde
   at alle påfølgende tester feilet på en fremmednøkkel.
3. `kanSende` dekket bare kanal og sperreliste. Nå dekker den også tidsvindu, oppvarming
   og volum, slik at sendende ruter ikke kan glemme en sjekk.

**Blokkert av:** ingenting.

---

### Runde 6 — fase 5, første del

**Gjort:** Alle fem cron-ruter. Ryddejobben verifisert mot ekte gamle rader. Dashbordet
med godkjenn- og avvis-knapper. Manuell oppsettliste kjørt fra tom database.
**Uavhengig etterkontroll av en annen agent** — oppdragets krav. To BLOKKERER-funn og fire
andre lukket. Kanalsporing bygget. Dashbordet viser nå køen den faktisk kan tømme.

**Endret for en bruker av systemet:** Ja, på flere måter:

- Kenneth og Fredrik kan godkjenne og avvise fra dashbordet, ikke bare se køen.
- Alle fem cron-jobber kan kjøres, hver med sin egen hemmelighet og tørrkjøring.
- Systemet kan settes opp fra ingenting med kommandoene i den manuelle listen. Det er
  prøvd, ikke bare skrevet.
- Hovedbryteren kan ikke lenger endres i stillhet.

**Rettet egne feil underveis:**

1. **F-023.** Volumvakten telte aldri. Døgnkvote, ukekvote og oppvarmingstak var død kode.
2. **F-024.** `kanSende()` hoppet over to av fem sjekker, og produksjonskalleren traff
   den grenen.
3. **F-021.** Kanalendringer ble ikke revidert.
4. **F-022.** `verify` kjørte typecheck før build, og feilet fra ren tilstand.
5. **F-028.** `/api/helse` påstod at utgående var av i stedet for å lese det.
6. Tre av mine egne testforventninger var feil om tidssoner og ISO-uker. Koden hadde rett.

**Én hendelse verdt å føre videre:** under den uavhengige testen ble
`EPOST.utgaaendeAktivert` satt til `true` direkte i databasen, og gjenopprettingen feilet
fordi den lå i en `catch`-gren. Bryteren sto på i ca. 31 sekunder. Den ble oppdaget av
**sjekkelisten**, ikke av revisoren. Ingen e-post kunne gå ut: `maksPerDag` var 0,
`EPOST_KANAL` er ikke satt, og `leverTilKanal` er en stubbe. Hendelsen er den beste
illustrasjonen av hvorfor F-021 måtte lukkes.

**Blokkert av:** ingenting jeg kan løse selv. Det som gjenstår krever Kenneth:
Railway-deployen, en kontaktkilde (S12), og at noen andre følger den manuelle listen.

---

### Neste runde — hvis ingenting endres

F-025 og F-026 er de mest verdifulle av de gjenstående funnene: begge gjør at en
konfigurasjon ser ut til å virke uten å gjøre det. F-025 hindrer avsenderspesifikk
oppvarming, F-026 gjør en domenesperre med store bokstaver virkningsløs.

Dernest: `leverTilKanal` og selve e-postintegrasjonen. Men **den bør ikke bygges før
S1 og S2 er besvart** — å bygge en sender uten å vite hvilken kanal og hvilke avsendere
er å bygge i blinde.
