# Beslutningsregister

Hver beslutning har et nummer, en dato, en begrunnelse og en status. Når en beslutning
endres, skrives den **ikke** om — det legges til en ny rad som opphever den gamle. På den
måten kan neste økt se hva vi visste da vi valgte.

Datoene er ført i den rekkefølgen arbeidet faktisk skjedde.

---

## B-001 — Systemet har ikke eget domene

**Dato:** fase 0
**Beslutning:** VikingPilot kjører på Railway-URL-en. Eget domene bygges ikke.
**Begrunnelse:** Systemet er internt. Et domene ville vært et ekstra angrepspunkt og et
ekstra vedlikeholdsansvar uten forretningsverdi.
**Status:** gjeldende.

---

## B-002 — Agentplattformen navngis aldri

**Dato:** fase 0
**Beslutning:** Agentplattformen omtales som «agentplattformen» eller «agenten» — i kode,
dokumentasjon, kommentarer og commit-meldinger. Aldri ved produktnavn.
**Begrunnelse:** Plattformen er hvitmerket og skal fremstå som vår egen merkevare.
**Konsekvens for kode:** ingen importer, ingen avhengigheter, ingen miljøvariabler og
ingen kommentarer som røper leverandøren. Integrasjonen skjer over MCP og webhook, som er
åpne protokoller, og omtales som nettopp det.
**Status:** gjeldende.

---

## B-003 — Alle guardrails er tjenestefunksjoner med HTTP-ruter

**Dato:** fase 0
**Beslutning:** Ingen guardrail bygges som en del av en agent-prompt. Alle bygges som
vanlige funksjoner i `src/lib/`, med en tynn rute i `src/app/api/` rundt.
**Begrunnelse:** Arkitekturregelen. En regel i en prompt kan snakkes rundt; en regel i en
database kan ikke. I tillegg kan en senere økt pakke funksjonene inn som MCP-verktøy uten
å skrive dem om.
**Status:** gjeldende.

---

## B-004 — Utgående trafikk er av som standard, per kanal

**Dato:** fase 0
**Beslutning:** Hver kanal har en egen rad i `KanalInnstilling` med `utgaaendeAktivert =
false` fra første migrasjon. Ingenting sendes eller endres eksternt før Kenneth eller
Fredrik slår det på for den kanalen.
**Begrunnelse:** Krav til «100 % ferdig», punkt 3. Et system som kan sende ved et uhell er
farligere enn et system som ikke kan sende.
**Konsekvens:** `KanalInnstilling` opprettes med frødata der alle kanaler er av. Det finnes
ingen kodevei som setter den til `true` automatisk.
**Status:** gjeldende.

---

## B-005 — Målgruppen er data, ikke kode

**Dato:** fase 0
**Beslutning:** Bransje, fylke, størrelse og rolle ligger i tabellen `Maalgruppe`.
**Begrunnelse:** Kenneth og Fredrik skal kunne endre hvem vi leter etter uten at noen
skriver kode. Se `docs/spesifikasjon.md` avsnitt 5.
**Status:** gjeldende.

---

## B-006 — Offentlig sektor og sperrede selskaper filtreres alltid bort

**Dato:** fase 0
**Beslutning:** Filteret ligger i `src/lib/enhetsregister/filter.ts` og kan ikke slås av
fra dashbordet eller fra en konfigurasjonsrad. Det er ikke en innstilling.
**Begrunnelse:** Oppdragsbeskrivelsen: «Offentlig sektor og sperrede selskaper ut, alltid.»
**Status:** gjeldende.

---

## B-007 — Revisjonsloggen er uforanderlig

**Dato:** fase 0
**Beslutning:** `Revisjon` har ingen oppdaterings- eller sletteoperasjon. Verken i
Prisma-klienten slik den brukes i koden, eller i noen rute.
**Begrunnelse:** En logg som kan endres er ikke et bevis.
**Merknad:** Dette håndheves i applikasjonslaget. Det er **ikke** håndhevet med
databasetrigger. Det er en kjent begrensning og står i `docs/status.md`.
**Status:** gjeldende.

---

## B-008 — Innlogging: e-post og passord i databasen

**Dato:** fase 0 (valgt av Kenneth)
**Beslutning:** Innlogging med e-post og passord, `scrypt` fra Nodes innebygde `crypto`,
og en signert cookie med `HMAC-SHA256`. Ingen ekstern identitetstjeneste.
**Begrunnelse:** Skal virke uten nettverk, og uten nye avhengigheter. Godkjenningskøen
krever «hvem godkjente hva», så en felles passordvariabel er ikke godt nok.
**Alternativer som ble vurdert:** felles passord fra miljøvariabel (svekker
revisjonskravet), ingen innlogging (åpner dashbordet for alle med Railway-URL-en).
**Status:** gjeldende.

---

## B-009 — Tester: Nodes innebygde testkjører

**Dato:** fase 0 (valgt av Kenneth)
**Beslutning:** `node --test`. Ingen Vitest, ingen Biome, ingen nye avhengigheter for
testing eller formatering.
**Begrunnelse:** Færrest mulig bevegelige deler. Skal kunne kjøre offline.
**Status:** gjeldende.

---

## B-010 — Postgres som Windows-tjeneste

**Dato:** fase 0 (valgt av Kenneth)
**Beslutning:** PostgreSQL 17.6 fra EnterpriseDBs offisielle binærfiler, registrert som
Windows-tjeneste med `pg_ctl register`.
**Begrunnelse:** Samme motor som Railway. Ingen Docker-avhengighet.
**Forbehold:** Registrering av en tjeneste krever forhøyede rettigheter. Denne økten
kjørte uten admin, så tjenesten er ikke registrert ennå. Se `docs/manuell-oppsett.md`.
**Status:** gjeldende, ikke utført.

---

## B-011 — Byggerot er lokal NTFS, ikke Google Drive

**Dato:** fase 0
**Beslutning:** Arbeidskopien ligger på `C:\VikingPilot`. Kildekoden speiles til
`G:\Min disk\GitHub\Vikingpilot` med `robocopy`, og `node_modules`, `.next` og `.tools`
utelates.
**Begrunnelse:** `G:` er Google Drive for Desktop (`DriveType 3`, FAT32). Verifisert i
denne økten: `npm install ms@2.1.3` rapporterte suksess, men **hver fil den skrev var
0 byte**. `create-next-app` feilet med `EBADF`. `mklink /J` svarte «Local NTFS volumes are
required». En 330 MB nedlasting skrev 0 byte og avbrøt etter 17 minutter.
**Konsekvens:** Ingen bygging, testing eller pakkeinstallasjon kan skje på `G:`.
**Status:** gjeldende. **Avviker fra oppdragets oppgitte sti** — se `LAGT-TIL-GRUNN.md`.

---

## B-012 — Kenneth og Fredrik godkjenner, agenten foreslår

**Dato:** fase 0
**Beslutning:** Godkjenningskøen har to menneskelige godkjennere. Agenten kan legge inn
forslag, men kan ikke godkjenne. En godkjenning registrerer hvem og når.
**Begrunnelse:** Arkitekturregelen: alt med ekstern konsekvens går gjennom køen.
**Status:** gjeldende.

---

## B-013 — Prisma pinnet til 7.10.0, ikke `latest`

**Dato:** fase 1
**Beslutning:** `prisma` og `@prisma/client` pinnes eksakt til `7.10.0`.
**Begrunnelse:** `npm view prisma dist-tags` viste at `latest` peker på `8.0.0-rc.19` — en
release candidate — mens `@prisma/client` sto på stabile `7.10.0`. Å installere uten
pinning ga en blanding av en RC og en stabil utgave, med en motstridende
peer-avhengighet (`@prisma/cli-engine`). Et fundament skal ikke være en kandidat.
**Konsekvens:** oppgradering til Prisma 8 er en egen, bevisst handling — ikke noe som
skjer av seg selv ved neste `npm install`.
**Status:** gjeldende.

---

## B-014 — Prisma 7s oppsett: `prisma.config.ts` og driver-adapter

**Dato:** fase 1
**Beslutning:** Tilkoblingsadressen ligger i `prisma.config.ts`. Applikasjonen kobler til
via `PrismaPg`-adapteren i `src/lib/db.ts`. Klienten genereres til
`src/generated/prisma` og er utelatt fra git.
**Begrunnelse:** Prisma 7 fjernet `url` fra `datasource` og krever `output` i
generatoren. `prisma validate` svarte `P1012: The datasource property 'url' is no longer
supported in schema files` inntil dette var endret.
**Konsekvens:** `src/lib/db.ts` er det eneste stedet som åpner en databaseforbindelse.
**Status:** gjeldende.

---

## B-015 — Ingen nettavhengige fonter

**Dato:** fase 1
**Beslutning:** `next/font/google` er fjernet. Vi bruker systemfonter.
**Begrunnelse:** `next/font/google` henter fonter over nett under bygging. Det bryter
kravet om at systemet skal kunne bygges og demonstreres uten nettverk
(`docs/stoppkriterier.md`, kriterium 3).
**Status:** gjeldende.

---

## B-016 — VikingPilot bruker port 3100 lokalt

**Dato:** fase 1
**Beslutning:** Lokal kjøring bruker port 3100. På Railway settes `PORT` av Railway.
**Begrunnelse:** Port 3000 på denne maskinen er opptatt av et annet prosjekt
(Tønsberglivet, kjørt fra OneDrive). Det prosjektet ble ikke rørt. Se
`docs/status.md` F-005.
**Status:** gjeldende.

---

## B-017 — Revisjon skrives, men håndheves ikke av databasen

**Dato:** fase 1
**Beslutning:** Uforanderligheten til `Revisjon` håndheves i applikasjonslaget: det finnes
ingen oppdaterings- eller slettefunksjon. Det legges **ikke** inn en databasetrigger nå.
**Begrunnelse:** En trigger er en destruktiv endring å rulle tilbake, og den krever en
migrasjon som er vanskelig å reversere. Applikasjonslaget dekker behovet i denne fasen.
**Kjent svakhet:** noen med direkte databasetilgang kan endre loggen. Det står i
`docs/status.md` som F-003, alvor MIDDELS.
**Status:** gjeldende, med kjent svakhet.

---

## B-018 — En sperre må peke på en mottaker

**Dato:** fase 2
**Beslutning:** `leggTilSperre()` nekter å opprette en sperre som ikke peker på minst én av
`epost`, `epostDomene`, `kontaktId` eller `organisasjonId`. Den kaster `UgyldigSperre`.
**Begrunnelse:** Uten dette kravet ble en sperre uten mottaker tolket som «sperr alt», og
stoppet hele systemet fra å sende til noen. Feilen er lett å lage ved et uhell og vond å
oppdage, fordi systemet ser ut til å virke — det nekter bare alt.
**Konsekvens:** skal en hel kanal stenges, gjøres det i `KanalInnstilling` av et menneske.
Det er en bevisst handling, ikke en sperrerad.
**Status:** gjeldende.

---

## B-019 — Feilkoder i stedet for `instanceof` på tvers av modulgrenser

**Dato:** fase 2
**Beslutning:** `UgyldigSperre` har et konstant `kode`-felt, og ruten sjekker det med
`erUgyldigSperre()` i stedet for `instanceof`.
**Begrunnelse:** Next.js pakker ruter og delte moduler hver for seg. Da kan to ulike
klasse-identiteter av samme klasse ligge i samme prosess, og `instanceof` feiler selv om
feilen er riktig. Det skjedde: ruten svarte 500 i stedet for 400 helt til vi byttet til
kode-sjekk. Vi fant det bare fordi vi kalte ruten på ekte i stedet for å lese koden.
**Status:** gjeldende. Gjelder all feilhåndtering som krysser en modulgrense.

---

## B-020 — Enhetsregisteret krever ingen nøkkel

**Dato:** fase 3
**Beslutning:** `ENHETSREGISTERET_API_KEY` er valgfri og normalt unødvendig. Pipelinen
henter fra det åpne API-et uten konfigurasjon, og integrasjonen meldes som konfigurert.
**Begrunnelse:** Oppdraget listet `ENHETSREGISTERET_API_KEY` blant nøklene, og fase 1
behandlet den som påkrevd. Det var **feil**. Vi kalte API-et uten autentisering og fikk
HTTP 200 med ekte data. Å kreve en nøkkel som ikke finnes ville vist «ikke konfigurert»
for alltid — og det ville vært usant, som er verre enn å mangle en nøkkel.
**Status:** gjeldende. `ENHETSREGISTERET_BASE_URL` beholdes for å kunne peke på et annet
endepunkt.

---

## B-021 — Sektor utledes fra organisasjonsform, ikke fra `sektor`-feltet

**Dato:** fase 3
**Beslutning:** Klassifiseringen ligger i `src/lib/enhetsregister/sektor.ts`, med eksplisitte
kodelister for offentlige og private organisasjonsformer. Et tomt `sektor`-felt gir
`UKJENT`, og `UKJENT` avvises når `ekskluderOffentlig` er på — som er standarden.
**Begrunnelse:** Enhetsregisterets `sektor`-felt er **tomt i praksis**. Det er målt: 200
hentede virksomheter kom tilbake med `sektor: ""`. Første versjon avviste derfor alt fra
det åpne API-et som «ukjent sektor», inkludert helt vanlige AS — 0 godkjente av 200.
Trygt, men ubrukelig. Vi fant det bare ved å kjøre pipelinen mot ekte data.
**Konsekvens:** Vi gjetter fortsatt ikke. En ukjent organisasjonsform gir `UKJENT` og
avvises. Men kjente private former slipper gjennom.
**Status:** gjeldende.

---

## B-022 — Effektiv døgnkvote er den laveste av to grenser

**Dato:** fase 3
**Beslutning:** `effektivDognkvote()` returnerer `min(oppvarmingskvote, avsenderens
maksPerDag)`. Begge grensene gjelder samtidig.
**Begrunnelse:** Å ta den høyeste ville latt oppvarmingsplanen overstyre en lavere
døgnkvote satt av et menneske. Den laveste er den trygge.
**Status:** gjeldende.

---

## B-023 — En tom oppvarmingsplan betyr kvote 0

**Dato:** fase 3
**Beslutning:** `kvoteForDag()` returnerer 0 når trinnlisten er tom. Manglende plan gir
ingen utsending.
**Begrunnelse:** Den farligste mulige feilen ville vært å tolke «ingen plan» som «ingen
grense». Det er låst fast med en egen test.
**Status:** gjeldende.

---

## B-024 — Et menneske kan ikke legge forslag i godkjenningskøen

**Dato:** fase 4
**Beslutning:** `leggIForslag()` godtar bare `SYSTEMET` eller `AGENT` som forslagsstiller.
Et menneske får en feil.
**Begrunnelse:** Kunne et menneske både foreslå og godkjenne, ville fire-øyne-prinsippet
vært en formalitet. Køen skal være et ekte mellomledd, ikke en knapp man trykker to ganger.
**Status:** gjeldende.

---

## B-025 — En avgjørelse krever sesjon, ikke hemmelighet

**Dato:** fase 4
**Beslutning:** Ruten `/api/godkjenninger` krever innlogget bruker for `godkjenn` og
`avvis`. Hemmeligheten `CRON_SECRET_SEKVENS` holder bare til `foreslaa`.
**Begrunnelse:** Agenten har hemmeligheten. Hadde hemmeligheten holdt til å godkjenne,
kunne agenten godkjent sitt eget forslag — og arkitekturregelen ville vært brutt uten at
noen så det. En avgjørelse skal kunne knyttes til et navngitt menneske.
**Status:** gjeldende.

---

## B-026 — Et utkast i køen blokkerer ikke neste sekvenssteg

**Dato:** fase 4
**Beslutning:** `VENTER_GODKJENNING` teller som «ferdig behandlet» av sekvensmotoren.
Sekvensen går videre til neste steg selv om ingen har godkjent utkastet ennå.
**Begrunnelse:** Alternativet ville latt ett utkast som ingen godkjenner stoppe hele
sekvensen for alltid. Ventetiden regnes fortsatt fra `utfortTid`, altså fra steget
faktisk kjørte, så rekkefølgen og takten holdes.
**Konsekvens:** Et menneske kan komme tilbake til en kø med flere ventende utkast fra
samme sekvens. Det er med vilje — køen skal kunne tømmes i ett sitt.
**Status:** gjeldende.

---

## B-027 — Godkjenning flytter også dialogmeldingen

**Dato:** fase 4
**Beslutning:** `godkjenn()` og `avvis()` oppdaterer `DialogMelding.status` sammen med
`Godkjenning.status`.
**Begrunnelse:** Dette var en ekte feil. Godkjenningen ble satt til `GODKJENT`, men
meldingen ble stående i `VENTER_GODKJENNING`. Utsendingsjobben ser på meldingens status,
så en godkjent melding ville blitt liggende usendt for alltid — og alt så riktig ut.
Ingen enhetstest fant det, fordi de testet hver sin del. Det ble funnet ved å kjøre
prospekt → sekvens → utkast → kø → godkjenning → utsending i én sammenhengende kjede.
**Status:** gjeldende, låst med egen test.

---

## B-028 — Kontakter kommer ikke fra Enhetsregisteret

**Dato:** fase 4
**Beslutning:** Systemet finner ikke på e-postadresser. Prospekter uten kontakt kan ikke
sekvenseres, og motoren rapporterer hvor mange det gjelder i stedet for å gjette.
**Begrunnelse:** Enhetsregisteret oppgir virksomheter, ikke personer eller adresser.
Roller og fødselsnummer ligger bak et eget autorisert API vi ikke bruker. Å konstruere
en adresse ut fra navnemønstre ville sendt post til fremmede.
**Konsekvens:** Målgruppen kan fylles, men ikke kontaktes, før en kontaktkilde er valgt.
Det er en åpen beslutning, ikke en feil. Se `docs/aapne-sporsmal.md`.
**Status:** gjeldende.

---

## B-029 — Oppvarmingsplanen er per avsender, med en partiell indeks for de globale

**Dato:** fase 5
**Beslutning:** `Oppvarmingssteg` har `@@unique([avsenderId, dagFraStart])`, pluss en
partiell unik indeks på `dagFraStart` der `avsenderId IS NULL`.
**Begrunnelse:** `dagFraStart` var globalt unik. De seks globale trinnene eide dag 0, 4,
8, 15, 22 og 31, så et avsenderspesifikt trinn kunne ikke opprettes på noen av dem — og
koden som foretrekker egne trinn var derfor aldri nåbar. Konfigurasjonen så ut til å
finnes, men kunne ikke brukes.
**Hvorfor to indekser:** PostgreSQL behandler NULL som forskjellig fra NULL i en unik
indeks. Kompositt-indeksen alene ville derfor tillatt to globale trinn på samme dag, med
ulik kvote, og `kvoteForDag` ville plukket ett av dem vilkårlig. Den partielle indeksen
lukker det.
**Merk:** dette er det eneste stedet i prosjektet der vi skriver rå SQL utenom
Prisma-skjemaet, fordi Prisma ikke uttrykker partielle indekser. Det er kommentert både i
migreringen og i `schema.prisma`.
**Status:** gjeldende.

---

## B-030 — Domene normaliseres på begge sider

**Dato:** fase 5
**Beslutning:** `normaliserDomene()` brukes både når en sperre legges inn og når den slås
opp. Den fjerner store bokstaver, innledende `www.`, avsluttende punktum, protokoll, sti og
en eventuell `@`-del. Et domene som ikke blir gyldig etter normalisering, avvises med feil.
**Begrunnelse:** `epost` ble normalisert ved innlegging, men `epostDomene` ble lagret rå.
En domenesperre med store bokstaver ble derfor liggende og gjorde ingenting, mens
operatøren trodde domenet var sperret. Det bryter med filens eget løfte om at en sperre
ikke kan snakkes rundt.
**Status:** gjeldende.

---

## B-031 — Oppvarmingen er først ferdig når kvoten når døgnkvoten

**Dato:** fase 5
**Beslutning:** `ferdigOppvarmet` er sant bare når planen ikke har flere trinn, dagen har
passert det siste trinnet, OG kvoten på det trinnet er minst like høy som avsenderens egen
`maksPerDag`.
**Begrunnelse:** Den første regelen var «ingen neste trinn betyr ferdig oppvarmet». Det er
fail-open: en avsenderspesifikk plan med ett trinn på dag 0 slutter der, og fra dag 1 ville
det betydd full døgnkvote. En plan som bare begrenser, ville opphevet seg selv etter én dag.
**Hvordan den ble funnet:** ikke av en test. Den dukket opp da F-025 skulle bevises, fordi
beviset sammenlignet `sjekkOppvarming` med `effektivDognkvote` og de to var uenige — 1 mot
100. To funksjoner som skal si det samme om samme tilstand, bør alltid sammenlignes.
**Status:** gjeldende, låst med egen test.

---

## B-032 — Global sikring mot gjetting på cron-hemmelighetene

**Dato:** fase 5
**Beslutning:** I tillegg til rate limiting per IP teller systemet mislykkede
hemmelighetsforsøk globalt. Ved 20 feil i minuttet avvises **alle** cron-kall med 429 til
vinduet er over — også kall med riktig hemmelighet.
**Begrunnelse:** Rate limiting per IP nøkler på `x-forwarded-for`, som kalleren selv kan
sette. Et script som sender et tilfeldig `X-Forwarded-For` per forespørsel får ubegrenset
antall forsøk. Per-IP-grensen er altså ikke et reelt gjerde mot gjetting. Den globale
telleren ser ikke på hvem som spør, bare på hvor mange som har gjettet feil, og kan derfor
ikke lures på samme måte.
**Prøvd:** 20 feilforsøk med 20 ulike forfalskede IP-er over HTTP. Sikringen slo til ved
forsøk 21, og avviste deretter også et kall med riktig hemmelighet.
**Kjent begrensning:** telleren er i minnet. Kjører tjenesten på flere instanser, gjelder
den per instans, og må flyttes til databasen. Railway kjører én replika
(`numReplicas: 1` i `railway.json`).
**Status:** gjeldende.

---

## B-033 — Hovedbryteren har én skrivevei, og den logger

**Dato:** fase 5
**Beslutning:** All skriving til `KanalInnstilling` går gjennom
`src/lib/kanaler/innstillinger.ts`. Hver endring skriver til revisjonsloggen med aktor,
tidspunkt, hva som endret seg, og en egen handlingstype. Å slå PÅ utgående trafikk krever
både navn og en begrunnelse på minst ti tegn.
**Begrunnelse:** Under uavhengig testing ble `EPOST.utgaaendeAktivert` satt til `true`
direkte i databasen. Endringen var **usynlig** — ingen revisjonsoppføring, og `oppdatertAv`
var tom. Vi kunne ikke si hvem, hva eller når ut fra systemet selv. For et felt som avgjør
om noe kan nå en mottaker, er det ikke godt nok.
**Prøvd:** `scripts/bevis-kanalspor.ts` slår en kanal på gjennom den eneste skriveveien,
bekrefter at revisjonsloggen fikk en oppføring med aktor og tidspunkt, at påslåing uten
begrunnelse nektes, og at endring uten navn nektes.
**Status:** gjeldende.



