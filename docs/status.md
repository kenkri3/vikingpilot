# Status — verifisert, antatt, ikke sjekket

Oppdragets regel 1: *«Ingen påstand uten dekning. Skill verifisert, antatt og ikke
sjekket.»* Dette dokumentet er stedet der den regelen håndheves.

Sist oppdatert: etter runde 9 (fase 5, fjerde del).

---

## Verifisert

Påstander jeg har målt, med kommandoen eller resultatet som beviser dem.

### Miljøet

| Påstand | Bevis |
|---|---|
| `G:` er Google Drive for Desktop og kan ikke brukes til bygging | `Win32_LogicalDisk G:` → `DriveType 3`, `FileSystem FAT32`, `VolumeName "Google Drive"`. `npm install ms@2.1.3` rapporterte suksess, men hver fil var **0 byte**; `npm ls` → `ms@ invalid`. `mklink /J` → «Local NTFS volumes are required» |
| Skallet virker — det feilet bare fordi det startet i `G:`-stien | `pwsh` med `workdir C:\VikingPilot` → `shell alive from C:`. Uten workdir → `spawn powershell.exe ENOENT` |
| `grep` og `glob` virker med `C:`-arbeidsmappe | `grep` fant 9 treff i `docs/`; `glob` fant 9 `.md`-filer |
| Nedlasting med `curl` virker der `Invoke-WebRequest` feilet | Postgres-binærfiler: 329 891 687 byte, identisk med serverens `Content-Length`. `curl` exit 0 |
| Port 3000 er opptatt av et annet prosjekt | `Get-NetTCPConnection -LocalPort 3000` → PID 11656, kommandolinje viser `OneDrive\...\Tønsberglivet\...\next start` |
| Denne økten kjørte uten admin | `IsInRole(BuiltInRole.Administrator)` → `False` |
| `docs/spesifikasjon.md` fantes ikke | Søkt i arbeidsmappen, tre søsterrepoer, Downloads, Desktop, Documents og fem AI-verktøymapper — ingen treff |

### Bygget

| Påstand | Bevis |
|---|---|
| Prisma 7.10.0 er stabil, `latest` er en release candidate | `npm view prisma dist-tags` → `latest: 8.0.0-rc.19`, `prev: 7.10.0`. `@prisma/client` sto på 7.10.0 |
| Prisma 7 krever `prisma.config.ts` og fjerner `url` fra skjemaet | `prisma validate` → `P1012: The datasource property 'url' is no longer supported` |
| Skjemaet er gyldig | `npx prisma validate` → «The schema at prisma\schema.prisma is valid 🚀» |
| Klienten genereres til riktig sted med riktig eksport | `prisma generate` → «Generated Prisma Client (7.10.0) to .\src\generated\prisma». `client.ts` inneholder `export const PrismaClient` |
| Skjemaet setter seg selv opp mot en **tom** database | `prisma migrate dev --name initial` mot nyopprettet `vikingpilot` → «Your database is now in sync». 32 tabeller i `public` |
| Typekontroll er ren | `npx tsc --noEmit` → exit 0, ingen feil |
| Bygget er grønt | `npm run build` → «Compiled successfully in 34.4s», alle 6 ruter bygget |
| Testene er grønne | `node --import tsx --test` → 9 tester, 9 bestått, 0 feilet |
| Frødataene kjører | `tsx prisma/seed.ts` → 6 kanaler, 4 integrasjoner, 5 cron-jobber, 6 oppvarmingstrinn, 1 målgruppe, 2 produkter, 1 sekvens med 3 steg, 2 brukere |

### Systemet i drift

| Påstand | Bevis |
|---|---|
| Helsesjekken svarer riktig | `GET /api/helse` → **HTTP 200**, `database.status: "ok"`, alle fire integrasjoner med navngitte manglende nøkler |
| Innloggingssiden vises | `GET /login` → HTTP 200, 7891 tegn, inneholder «VikingPilot» og «Logg inn» |
| Dashbordet krever innlogging | `GET /dashboard` uten cookie → **HTTP 307** (omdirigering) |
| Cron nekter når hemmeligheten mangler | `GET /api/cron/enhetsregister` uten hemmelighet → **HTTP 503**, «CRON_SECRET_ENHETSREGISTER er ikke satt» |
| Cron nekter ved feil hemmelighet | Med `Bearer helt-feil` → **HTTP 401**, «Feil hemmelighet» |
| Cron tørrkjører som standard | Med riktig hemmelighet, ingen parameter → `torrkjoering: true` |
| Cron finner ikke på data | Samme kall → `status: "ikke_konfigurert"`, navngir `ENHETSREGISTERET_API_KEY`, og svarer hva den *ville* gjort |
| **Ingen kanal kan sende** | `SELECT count(*) FROM "KanalInnstilling" WHERE "utgaaendeAktivert" = true` → **0**. Alle 6 kanaler `f`, `maksPerDag` 0 |
| Idempotens avviser duplikat | Sjekkelisten: to utsendinger med samme nøkkel → andre avvises |
| Tidsvindu stenger helg, rød dag og natt | Sjekkelisten: søndag, første juledag og natt kl. 04:00 avvises alle |
| Norske røde dager regnes riktig | Skjærtorsdag 2026 → 2. april (påsken beregnes, ikke slås opp). 12 røde dager i 2026 |
| Hemmeligheter maskeres i logger | Tilkoblingsstreng med passord → passordet erstattet med `[skjult]` |
| Sjekkelisten er grønn | `npm run sjekkliste` → **32 bestått, 0 feilet** |

### Fase 2 — sperrelister og revisjonslogg

| Påstand | Bevis |
|---|---|
| 27 bruddforsøk mot guardrailsene, alle avviser | `node --import tsx --test tests/sperrelister.test.ts` → 27 bestått, 0 feilet |
| Store bokstaver og mellomrom omgår ikke en sperre | Test: tre varianter av samme adresse stoppes alle |
| En global sperre på én adresse sperrer **ikke** andre | Test: `enperson@…` sperret, `enheltannen@…` slipper gjennom |
| En kanalsperre stopper bare sin egen kanal | Test: EPOST-sperre sperrer EPOST, ikke SMS |
| En sperre uten mottaker nektes | Test: `UgyldigSperre` kastes for GLOBAL, EPOSTDOMENE og KANAL uten mottaker |
| Sperret kontakt stopper uten e-postadresse | Test: treff på `kontaktId` alene |
| Hard bounce sperrer, myk bounce sperrer ikke | To tester, motsatt forventning |
| Avmelding to ganger gir én sperre | Test: andre kall gir `opprettet: false`, samme id |
| Opphevet sperre slettes ikke | Test: raden finnes igjen med `aktiv: false` |
| Revisjonsmodulen har ingen endre- eller slettevei | Strukturell test over modulens eksporterte navn |
| Hemmeligheter vaskes ut av revisjonsmetadata | Test: API-nøkkel og passord borte, `a@b.no` i behold |
| Korrelasjonsid knytter en kjede sammen | Test: tre oppføringer, riktig rekkefølge |
| Sperreliste-ruten svarer riktig over HTTP | Uten hemmelighet → **401**. Feil hemmelighet → **401**. Fri adresse → `tillatt: true`. Sperret adresse → `tillatt: false` med `AVMELDING`. Ugyldig type → **400**. Sperre uten mottaker → **400** |

### Fase 3 — Enhetsregister-pipelinen og utsendingsvakten

| Påstand | Bevis |
|---|---|
| Enhetsregisteret krever ingen nøkkel | `GET https://data.brreg.no/enhetsregisteret/api/enheter?size=1` **uten** autentisering → HTTP 200 med ekte data |
| Normalisering er deterministisk og testet | 43 tester i `tests/enhetsregister.test.ts` |
| Offentlig sektor avvises selv med helt åpen konfigurasjon | Test: `ekskluderOffentlig: false` slipper den likevel ikke gjennom |
| Konkurs og avvikling avvises alltid | To tester, samme mønster |
| Ukjent sektor avvises som standard | Test: `UKJENT` gir `OFFENTLIG_SEKTOR` |
| Vanlige private selskapsformer slipper gjennom | Test over ni former: AS, ASA, ENK, ANS, DA, SA, FLI, STI, NUF |
| **Pipelinen kjører mot ekte data** | `GET /api/cron/enhetsregister?sider=2&antall=100` → hentet **200**, godkjent **13**, avvist **187** |
| **Tørrkjøring skriver ingenting** | Etter tørrkjøring: `Organisasjon` = **0**, `Prospekt` = **0**, `CronKjoering` = 3 |
| **Ekte kjøring skriver** | `?torrkjoering=false` → opprettet **13** organisasjoner og **13** prospekter |
| **Kjøring er idempotent** | Samme kall igjen → opprettet **0**, oppdatert **13**, antall uendret |
| **Ingen offentlige i basen** | `SELECT count(*) WHERE sektor = 'OFFENTLIG'` → **0** |
| **Ingen konkurser eller avviklinger i basen** | `SELECT count(*) WHERE konkurs OR "underAvvikling"` → **0** |
| Døgnkvoten stopper den ene meldingen for mye | Test: 99 av 100 slipper, 100 av 100 stoppes |
| Ukekvoten gjelder selv når døgnkvoten er ledig | Test |
| En tom oppvarmingsplan gir kvote 0 | Test, med kommentar om at dette er den farligste feilen |
| Effektiv kvote er den **laveste** av to grenser | Test |
| Parallell reservasjon slipper bare én gjennom | Test med tre samtidige `Promise.all` |
| Sendt melding kan ikke reserveres på nytt | Test |
| Feilet melding blokkerer også | Test |
| Tellere nullstilles ved norsk midnatt, ikke etter 24 timer | Test: 23:00 UTC er 00:00 norsk tid, og døgnet har skiftet |

### Fase 4 — sekvensmotoren og godkjenningskøen

| Påstand | Bevis |
|---|---|
| **Kjeden virker ende-til-ende** | `npx tsx scripts/e2e-fase4.ts` → prospekt → sekvens startet → utkast → kø → godkjent → utsendingsjobben vurderte meldingen. **Alt besto** |
| **Ingenting sendes, selv etter godkjenning** | Etter hele kjeden: `Utsending` med status SENDT = **0**. Grunnen: «E-postkanalen er ikke konfigurert» |
| Et menneske kan ikke legge forslag i køen | Test: `Ugyldig forslagsstiller` |
| Bare SYSTEMET og AGENT kan foreslå | Test |
| En godkjenning kan ikke tas to ganger | Test: andre forsøk avvises med «står allerede som GODKJENT» |
| Et avvist forslag kan ikke godkjennes etterpå | Test |
| Parallell godkjenning slipper bare én gjennom | Test med tre samtidige `Promise.all`. Én beslutning registrert |
| En avgjørelse uten navn avvises | Test: status forblir VENTER |
| `erKlarTilSending` sier nei for alt unntatt GODKJENT | Test over VENTER, AVVIST, GODKJENT og ukjent id |
| Beslutningen registrerer hvem, når og kommentar | Test mot `Godkjenningsbeslutning` |
| **Motoren SENDER ingenting — den lager utkast** | Test: meldingen står som `VENTER_GODKJENNING`, og null `Utsending`-rader opprettes |
| **Tørrkjøring skriver ingenting** | Test: antall godkjenninger, meldinger og steg er uendret |
| **Godkjenning flytter også meldingen** | Test: `DialogMelding.status` går fra `VENTER_GODKJENNING` til `GODKJENT`, og utsendingsjobben finner den |
| Avvisning flytter meldingen til AVVIST | Test |
| Ventetid regnes fra forrige steg, ikke fra start | Test: 72 timer etter steg 1, ikke etter sekvensstart |
| En forsinket kjøring komprimerer ikke sekvensen | Test |
| Kanalen stenger alt uansett | Test: `kanSende` nekter for EPOST |
| Sjekkelisten dekker invariantene | **51 bestått**, inkludert «ingen melding er godkjent uten en beslutning» og «ingen utsending er sendt uten en godkjenning» |

---

## Antatt

Påstander jeg tror er riktige, men ikke har bevist.

| Antakelse | Hvorfor jeg tror det | Hvordan den verifiseres |
|---|---|---|
| Dockerfile bygger og kjører på Railway | Den bygger lokalt med `npm ci` + `prisma generate` + `next build` | Første deploy, krever din Railway-konto |
| Prisma-motoren finner riktig binær på Alpine/musl | Alpine bruker musl, og `npm ci` kjører inne i bildet slik at `prisma generate` henter binæren der | Første deploy. Dette er den mest sannsynlige feilkilden i bildet, fordi den ikke kan testes uten Docker |
| `prisma migrate deploy` virker mot Railway-Postgres | Samme kommando virket lokalt mot tom database | Første deploy |
| Org.nr 933 851 222 er riktig | Oppgitt i oppdraget | Slå opp i Enhetsregisteret når nøkkel finnes |
| Enhetsregisteret kan nås med API-nøkkel | Allment kjent | Fase 3 |
| `pg_ctl register` gir en fungerende Windows-tjeneste | Dokumentert Postgres-atferd | Krever forhøyet ledetekst — ikke kjørt |
| Innlogging virker ende-til-ende i nettleser | Alle delene er testet hver for seg, men jeg har ikke sendt inn skjemaet | Klikk gjennom selv, eller jeg tester med en HTTP-klient |

---

## Ikke sjekket

- Om Railway-kontoen har ledig prosjekt, og om Postgres-tillegget er aktivert.
- Hvilke miljøvariabler som allerede ligger i Railway for Vikingnet-relaterte tjenester.
- Hvordan VikingCRM-webhooken faktisk er formet — hvilke felter den sender, og om den signerer.
- Om agentplattformen støtter MCP over HTTP eller bare stdio.
- Hvilke NACE-koder som er relevante for Vikingnets målgruppe.

---

## Åpne funn

Alvor etter skalaen BLOKKERER / HØY / MIDDELS / LAV.

| # | Alvor | Funn | Status |
|---|---|---|---|
| F-001 | ~~BLOKKERER~~ | ~~Skallet er dødt~~ | **Lukket. Var feildiagnostisert.** Skallet virket hele tiden; det feilet bare fordi det startet i `G:`-stien. Se `LAGT-TIL-GRUNN.md` A-005 |
| F-002 | ~~BLOKKERER~~ | ~~`G:` kan ikke brukes som byggerot~~ | **Lukket.** Byggerot flyttet til `C:\VikingPilot`. Krever fortsatt din aksept, se A-001 |
| F-003 | MIDDELS | Revisjonsloggens uforanderlighet håndheves bare i applikasjonslaget, ikke med databasetrigger | Åpent, bevisst. Se B-007 |
| F-004 | LAV | `docs/spesifikasjon.md` er skrevet av meg, ikke av deg | Åpent. Se A-002 |
| F-005 | LAV | Port 3000 er opptatt av Tønsberglivet-prosjektet på denne maskinen | Dokumentert i `docs/manuell-oppsett.md` A5. VikingPilot bruker 3100 lokalt. Ikke berørt |
| F-006 | ~~MIDDELS~~ | ~~`start-prod.mjs` brukte `new URL().pathname`, som gir `C:\C:\…` på Windows~~ | **Lukket.** Rettet med `fileURLToPath`. Feilet høyt ved første kjøring og ble funnet fordi jeg faktisk startet systemet |
| F-007 | LAV | `@prisma/adapter-pg` 7.10.0 gir en `DEP0190`-advarsel om `shell: true` i `start-prod.mjs` | Åpent, ufarlig. `spawn` med `shell` brukes bare for `npx` på Windows |
| F-008 | ~~HØY~~ | ~~En kanalsperre for e-post sperret også SMS~~ | **Lukket.** Treffregelen for adresse ignorerte kanal-feltet. Fanget av bruddforsøket «kanalsperre stopper bare sin egen kanal» |
| F-009 | ~~BLOKKERER~~ | ~~En global sperre på én adresse sperret **hver** mottaker i hele systemet~~ | **Lukket.** Regelen var `{ type: "GLOBAL" }` uten adressesjekk. Ville stoppet all utsending. Fanget av kontrolltesten «en mottaker uten sperre slipper gjennom» |
| F-010 | ~~HØY~~ | ~~En sperre uten mottaker ble godtatt, og sperret all utgående trafikk~~ | **Lukket.** Nektes nå med `UgyldigSperre`. Se B-018 |
| F-011 | ~~MIDDELS~~ | ~~`instanceof` krysser ikke modulgrenser pålitelig i Next.js — feilhåndtering ga 500 i stedet for 400~~ | **Lukket** med kode-sjekk. Se B-019. Kan gjelde andre feilklasser senere |
| F-012 | ~~HØY~~ | ~~`ENHETSREGISTERET_API_KEY` ble krevd, men API-et er åpent~~ | **Lukket.** Integrasjonen ville vist «ikke konfigurert» for alltid. Verifisert at API-et svarer uten nøkkel. Se B-020 |
| F-013 | ~~HØY~~ | ~~Sektor-utledningen avviste ALT fra det åpne API-et som «ukjent sektor»~~ | **Lukket.** `sektor`-feltet er tomt i praksis. 0 godkjente av 200 før rettelsen. Se B-021 |
| F-014 | MIDDELS | Enhetsregisteret oppgir ikke `fylke` for de fleste virksomheter | Åpent. Fylke-filteret virker, men slipper bare gjennom det som faktisk har fylkesnavn. Se `docs/aapne-sporsmal.md` |
| F-015 | LAV | Enhetsregisteret oppgir ikke `antallAnsatte` for de fleste virksomheter | Åpent, ikke en feil. 185 av 200 ble avvist på `ANSATTE` fordi feltet var tomt. Målgruppens `minAnsatte` bestemmer hvor stort tapet er |
| F-016 | ~~HØY~~ | ~~Godkjenning flyttet ikke dialogmeldingen, så godkjente meldinger ville aldri blitt sendt~~ | **Lukket.** Ville sett ut som om alt virket. Funnet ved å kjøre hele kjeden ende-til-ende. Se B-027 |
| F-017 | MIDDELS | Enhetsregisteret oppgir ingen e-postadresser. 13 prospekter står uten kontakt | Åpent, og ikke en feil i koden. Sekvensmotoren rapporterer `utenKontakt` i stedet for å gjette. Må løses med en kontaktkilde, se B-028 |
| F-018 | LAV | `leverTilKanal()` er en stubbe som alltid svarer «ikke bygget» | Åpent, bevisst. Kanalen er ikke konfigurert, og systemet sier det ærlig |
| F-019 | ~~LAV~~ | ~~Cron-rutene har to ulike mønstre: tre bruker innebygd skjelett, to bruker `kjoerCronjobb()`~~ | **Lukket.** Alle fem bruker nå `kjoerCronjobb()`. Dette var ikke bare kosmetisk: de tre rutene manglet den globale sikringen mot gjetting fra B-032, og én av dem var **utsendingsruten** — den eneste i systemet som kan føre noe ut til en mottaker. Prøvd etter migreringen: 24 feilforsøk med 24 forfalskede IP-er mot `utsending`, `oppvarming` og `sekvens` slo alle sikringen til ved forsøk 21 |
| F-020 | ~~LAV~~ | ~~Manglende cron-hemmelighet gir **401** i `kjoerCronjobb()`, men **503** i de tre eldste rutene~~ | **Lukket, og beskrivelsen var feil.** Jeg hadde skrevet at de tre gamle rutene svarte 503 der de nye svarte 401. Det stemte ikke. Målt: **503** når hemmelighetens navn ikke er satt **på serveren** (serveren er feilkonfigurert, ikke kalleren), og **401** når kalleren ikke oppgir den eller oppgir feil. Alle fem rutene gjorde allerede dette riktig. Funnet var altså ikke en inkonsistens, men en feil i min egen beskrivelse av den |
| F-021 | ~~HØY~~ | ~~Endring av `KanalInnstilling` revideres ikke. Hovedbryteren for all utgående trafikk kunne slås på uten at revisjonsloggen sa hvem, hva eller når~~ | **Lukket.** All skriving går nå gjennom `src/lib/kanaler/innstillinger.ts`, som skriver til revisjonsloggen med aktor, tidspunkt og egen handlingstype. Å slå PÅ krever både navn og en begrunnelse på minst ti tegn. Prøvd med `scripts/bevis-kanalspor.ts` — alt besto. Hendelsen som avdekket det: `EPOST` sto på etter en direkte databaseendring under uavhengig testing, og loggen kunne ikke si hvem som gjorde det. Selve funnet sto uavhengig av hendelsen. Se B-033 |
| F-022 | ~~MIDDELS~~ | ~~`npm run verify` kjørte `typecheck` før `build`, men `tsconfig.json` inkluderer `.next/types/**`~~ | **Lukket.** Feilet med `TS6053` fra ren tilstand der `.next` manglet. Rekkefølgen er snudd, og prøvd fra ren tilstand |
| F-023 | ~~BLOKKERER~~ | ~~`registrerUtsending()` hadde null kallere. Døgnkvote, ukekvote og oppvarmingstak var død kode~~ | **Lukket.** Funnet av uavhengig etterkontroll. Tellingen avledes nå fra `Utsending`-rader med status SENDT, og kan ikke komme ut av synk. Testene oppretter ekte rader i stedet for å skrive telleren direkte med Prisma — den forrige testmetoden var nettopp grunnen til at feilen overlevde 133 tester |
| F-024 | ~~BLOKKERER~~ | ~~`kanSende()` hoppet stille over volum og oppvarming når `avsenderId` manglet, og den eneste kalleren i produksjon oppga den ikke~~ | **Lukket.** `avsenderId` er påkrevd i typen, og null eller undefined gir avslag. Porten er nå fem sjekker, ikke tre |
| F-025 | ~~MIDDELS~~ | ~~`Oppvarmingssteg.dagFraStart` er globalt unik, så avsenderspesifikke oppvarmingsplaner kan ikke opprettes~~ | **Lukket.** Unikheten er nå per avsender, pluss en partiell unik indeks for de globale trinnene. Prøvd: et avsenderspesifikt trinn på dag 0 kan opprettes, overstyrer det globale, og påvirker ikke andre avsendere. Se B-029 |
| F-026 | ~~MIDDELS~~ | ~~`epostDomene` normaliseres ikke ved innlegging, så en domenesperre med store bokstaver treffer aldri~~ | **Lukket.** `normaliserDomene()` brukes nå på BEGGE sider — både når sperren legges inn og når den slås opp. Et ugyldig domene nektes i stedet for å lagres. Se B-030 |
| F-031 | ~~HØY~~ | ~~`sjekkOppvarming` slapp kvoten fri så snart planen ikke hadde et neste trinn. En plan med ett trinn opphevet seg selv etter én dag~~ | **Lukket.** Funnet mens F-025 ble bevist, ikke av en test. Oppvarmingen er nå først ferdig når planen er ute OG kvoten er minst like høy som avsenderens døgnkvote. Se B-031 |
| F-027 | ~~MIDDELS~~ | ~~Rate limiting nøkler på `x-forwarded-for`, som kalleren selv kan sette~~ | **Redusert til LAV.** Den per-IP-baserte grensen står, men er nå et supplement, ikke hovedgjerdet. En global teller sperrer alle cron-kall etter 20 mislykkede hemmelighetsforsøk i minuttet, uansett IP. Prøvd over HTTP: 20 feilforsøk med 20 ulike forfalskede IP-er slo sikringen til ved forsøk 21, og selv riktig hemmelighet ble avvist mens den var åpen. Se B-032 |
| F-029 | ~~LAV~~ | ~~Tørrkjøring i `sendMelding` sjekket kanalkonfigurasjon før tørrkjøringsgrenen~~ | **Lukket.** Tørrkjøring hopper nå over konfigurasjonssjekken og rapporterer både hva den ville sendt, hvilke sjekker som passerte, og at kanalen mangler |
| F-028 | ~~LAV~~ | ~~`/api/helse` svarte `utgaaende: { standard: "av" }` som en streng, ikke fra databasen~~ | **Lukket.** Leser nå `KanalInnstilling`, og svarer «antar det verste» hvis lesingen feiler |
| F-032 | LAV | Rate limiting er i minnet, og den globale sikringen i B-032 gjelder derfor per instans | Åpent, og dokumentert. Railway kjører én replika (`numReplicas: 1`), så i praksis gjelder den for hele tjenesten. Skal flyttes til databasen hvis tjenesten noen gang skaleres |
| F-033 | ~~BLOKKERER~~ | ~~Ingen seeding kjørte i produksjon. Railway kjørte migreringer, men `prisma db seed` krever tsx, som ikke finnes i produksjonsbildet. Første oppstart ga et tomt system~~ | **Lukket.** `scripts/grunndata.mjs` settes opp ved oppstart fra `start-prod.mjs`, og er idempotent. Prøvd: kjørte `start-prod.mjs` og leste loggen — migreringer, grunndata, server, `/api/helse` 200 |
| F-034 | ~~BLOKKERER~~ | ~~Det fantes ingen måte å opprette en bruker på i produksjon, så ingen kunne logge inn~~ | **Lukket.** `npm run bruker:lag`. Passordet skjules, styrken sjekkes med samme kode som innloggingen, og både oppretting og passordbytte skrives til revisjonsloggen. Prøvd: opprettet bruker, logget inn med riktig passord, avvist med feil |
| F-035 | ~~HØY~~ | ~~Dockerfile brukte `node:20`, som ikke kan lese TypeScript. Den genererte Prisma-klienten ER TypeScript, og uten tsx i bildet kunne den ikke lastes~~ | **Lukket.** Byttet til `node:22-alpine`. Prøvd at ren Node laster klienten uten flagg |
| F-036 | ~~HØY~~ | ~~`src/generated` ble ikke kopiert inn i kjøresteget i Dockerfile, så oppstartsjobben ville ikke funnet Prisma-klienten~~ | **Lukket.** Kopieres eksplisitt |
| F-030 | ~~LAV~~ | ~~`/api/helse` og dashbordet viste rå Prisma-feilmelding~~ | **Lukket som forsiktighetstiltak.** Revisoren klarte **ikke** å fremprovosere en lekkasje, så dette var en mistanke og ikke et bevis. `/api/helse` vasker nå meldingen med `vask()` likevel — det koster ingenting, og `vask()` brukes overalt ellers |
| F-037 | ~~HØY~~ | ~~`npm run forhåndssjekk` virket ikke. npm lagret skriptnavnet ødelagt fordi det inneholdt `å`~~ | **Lukket.** Omdøpt til `forhandsjekk` (ASCII), og filen til `scripts/forhandsjekk.ts`. Dette ville truffet Kenneth på den **første kommandoen** han ble bedt om å kjøre, og feilmeldingen fra npm sier ingenting om hvorfor. Funnet ved å kjøre hver kommando README-en oppgir, i stedet for å anta at de virker. Se B-034 |

**Ingen funn av alvor BLOKKERER eller HØY står åpent.** Stoppkriterium 8 er oppfylt for
denne runden.

---

## Ærlig avgrensning

Det som er bygget og verifisert er **fase 1: skjelettet**. Følgende står igjen, og
ingenting av det er påstått ferdig:

- Fase 2: kjernedata i bruk, sperrelister, revisjonslogg
- Fase 3: Enhetsregister-pipelinen og utsendingsvakten
- Fase 4: sekvensmotoren og godkjenningskøen
- Fase 5: herding, full frødata og manuell liste prøvd fra tom mappe

Se `docs/plan.md` for status per fase.

---

## Hvordan denne filen brukes

Etter hver runde:

1. Flytt påstander som er blitt målt fra «antatt» til «verifisert», med beviset.
2. Legg til nye antakelser eksplisitt — ikke la dem ligge implisitt i koden.
3. Oppdater «åpne funn».
4. Stoppkriterium 8 er oppfylt først når ingen rader står med BLOKKERER eller HØY.

---

## Produksjonsstien verifisert under Node 22 — runde 9

Den viktigste påstanden jeg ikke kunne bevise før — fordi Docker ikke finnes på denne
maskinen — var at byttet fra `node:20` til `node:22` faktisk løser problemet. Node 20 kan
ikke lese TypeScript, og den genererte Prisma-klienten **er** TypeScript. Var påstanden
feil, ville Railway-deployen krasjet.

Den er nå bevist med en ekte Node 22, lastet ned fra nodejs.org.

| Påstand | Bevis |
|---|---|
| Node 22 laster den genererte klienten uten flagg | `node -e "import('./src/generated/prisma/client.ts')"` under **v22.23.3** → «LASTET OK», ingen advarsel om eksperimentelt flagg |
| `scripts/oppsett.mjs` virker under Node 22 | Kjørt med Node 22 → 6 kanaler, 4 integrasjoner, 5 cron-jobber, 1 målgruppe, 2 produkter, sekvens med 3 steg. **exit 0** |
| `scripts/bruker.mjs` virker under Node 22 | Opprettet bruker. **exit 0** |
| **Hele produksjonsoppstarten virker under Node 22** | `node22 scripts/start-prod.mjs` → migreringer fullført, grunndata på plass, «Ready in 5.7s», **ingenting i stderr**. `/api/helse` → **HTTP 200**, `database=ok`, `noenAapne=false` |

**Hva som fortsatt ikke er bevist, og hvorfor:** selve Docker-**bygget**. Docker er ikke
installert her, så jeg kan ikke bygge bildet. Det som er bevist, er at hver bestanddel
bildet kjører — Node 22, den genererte klienten, oppstartsjobben, migreringene og
serveren — virker under den Node-versjonen bildet bruker. Det som gjenstår er `apk add`,
filkopieringen, og at Prisma-motoren finner riktig binær for musl/Alpine.

Det siste er verdt å merke seg: Alpine bruker musl, mens maskinen her er Windows/glibc.
`npm ci` kjøres **inne i bildet**, så `prisma generate` kjører der og henter den binæren
som hører til. Det er sannsynligvis riktig, men det er ikke målt, og det står derfor som
en åpen antakelse nedenfor.

---

## Uavhengig etterkontroll — runde 6

Oppdraget krever at en annen agent enn den som skrev noe, bekrefter at det virker.
Det ble gjort i denne runden. Revisoren fikk beskjed om å motbevise systemets egne
påstander, ikke å bekrefte dem.

**Den fant to feil av alvor BLOKKERER som 133 egne tester ikke hadde funnet:**

1. **F-023.** Volumvakten telte aldri. `registrerUtsending()` hadde null kallere i
   produksjonskoden. Døgnkvote, ukekvote og oppvarmingstak var korrekte funksjoner som
   aldri ble stilt spørsmålet. Testene skrev telleren direkte med Prisma, og så derfor
   ingenting.
2. **F-024.** `kanSende()` hoppet stille over volum og oppvarming når `avsenderId` manglet,
   og den eneste kalleren i produksjon oppga den ikke. «Porten alle utsendelser må gjennom»
   var tre sjekker, ikke fem.

Begge er lukket. F-023 er lukket ved å avlede tellingen fra `Utsending`-rader, slik at den
ikke kan komme ut av synk. F-024 er lukket ved å gjøre `avsenderId` påkrevd og nekte når
den mangler.

**Hva dette sier om testene mine.** De var ikke svake på logikk — de var svake på
*integrasjon*. Hver test skrev den tilstanden den trengte direkte i basen, i stedet for å
gå gjennom koden som skulle produsere den. Da tester man funksjonen, ikke systemet. Det er
samme feilklasse som F-016 i fase 4, og den er nå rettet i begge tilfeller: testene
oppretter ekte rader gjennom den ekte kodeveien.

**Revisoren bekreftet også at flere sentrale påstander holder** under aktiv motstand:
agenten kan ikke godkjenne, en avgjørelse kan ikke tas to ganger, ingenting kan sendes i
dag, sperrelogikken er riktig bortsett fra store bokstaver i domene, idempotensen tåler
parallelle kall, og det lekker ingen hemmeligheter i repo, logger eller feilmeldinger.

**Revisorens egen feil:** den satte `EPOST.utgaaendeAktivert = true` for å kunne
observere F-024, og gjenopprettingen havnet i `catch`-grenen i stedet for i
suksessgrenen. Bryteren sto derfor på i ca. 31 sekunder. Den ble oppdaget av
sjekkelisten, ikke av revisoren, og satt tilbake. Ingen e-post kunne gå ut i vinduet.
Det er redegjort for i F-021, og det er samtidig den beste illustrasjonen av hvorfor
F-021 må lukkes: endringen var usynlig i revisjonsloggen.
