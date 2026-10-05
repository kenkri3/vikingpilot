# VikingPilot

Internt system for **Vikingnet / AIChat Norge AS**, org.nr 933 851 222.

VikingPilot finner norske bedrifter, kvalifiserer dem, følger dem opp, og legger alt klart
for at et menneske kan lukke avtalen. Det selger ikke selv.

> **Systemet eier sannhet, grenser og logg. Agenten eier skjønn og samtale.**

Systemet er internt. Det har ikke eget domene — det kjører på Railway-URL-en.

---

## Kom i gang

```powershell
npm install
npm run db:migrate      # setter opp skjemaet
npm run db:seed         # frødata, alle kanaler AV
npm run verify          # bygg, typekontroll, tester
npm run sjekkliste      # ende-til-ende, uten nettverk

$env:PORT = "3100"      # 3000 er opptatt på denne maskinen, se A5
npm run start:prod
```

Åpne [http://localhost:3100](http://localhost:3100).

**Full oppsettsliste:** [`docs/manuell-oppsett.md`](docs/manuell-oppsett.md)

---

## Viktig å vite før du endrer noe

**All utgående trafikk er av som standard.** Hver kanal har en egen rad i
`KanalInnstilling` med `utgaaendeAktivert = false`. Det finnes ingen kodevei som setter
den til `true` selv. Ingenting sendes eller endres eksternt før et menneske slår det på,
per kanal.

**Alle guardrails ligger i database og kode — aldri i en prompt.** Volumbegrensninger,
sperrelister, oppvarmingsplan og tidsvinduer er rader og funksjoner. En regel i en prompt
kan snakkes rundt; en regel i en database kan ikke.

**Alle guardrails er tjenestefunksjoner med HTTP-ruter rundt.** En senere økt pakker dem
inn som MCP-verktøy uten å skrive dem om. Agenten får aldri egne nøkler.

**Agentplattformen navngis aldri.** Ikke i kode, dokumentasjon, kommentarer eller
commit-meldinger. Omtal den som «agentplattformen» eller «agenten».

**Byggerot er `C:\VikingPilot`.** Ikke Google Drive. `G:` skriver 0-byte filer og kaller
det suksess. Se [`LAGT-TIL-GRUNN.md`](LAGT-TIL-GRUNN.md) A-001.

**Prisma er pinnet til 7.10.0.** `latest` på npm er en release candidate. Ikke oppgrader
uten videre. Prisma 7 krever `prisma.config.ts` og en driver-adapter — `url` i
`datasource` finnes ikke lenger.

---

## Struktur

```
prisma/
  schema.prisma        32 tabeller for alle ni moduler
  migrations/          selvoppsettende skjema
  seed.ts              frødata — kanalene er AV
src/
  app/                 sider og ruter
    dashboard/         hva kjører, hva venter, hva feilet, hva mangler
    login/             scrypt + signert cookie
    api/helse/         helsesjekk
    api/cron/          én rute per jobb, egen hemmelighet, tørrkjøring
  lib/
    db.ts              eneste sted som åpner en databaseforbindelse
    config.ts          integrasjonsstatus — ærlig «ikke konfigurert»
    logg.ts            logging som vasker bort hemmeligheter
    ratelimit.ts       rate limiting på åpne endepunkter
    auth/              passord, sesjon, innlogging
    tid/               norske røde dager og tidsvinduer
    cron/felles.ts     hemmelighet og tørrkjøring
scripts/
  start-prod.mjs       migrerer, så starter
  sjekkliste.ts        verifiserer ende-til-ende uten nettverk
docs/                  se oversikt.md for innhold
tests/                 node --test
```

---

## Dokumentasjon

| Fil | Innhold |
|---|---|
| [`docs/oversikt.md`](docs/oversikt.md) | Ett ark: hva systemet gjør og ikke gjør |
| [`docs/spesifikasjon.md`](docs/spesifikasjon.md) | Master-prompt, med bøtte 1 og bøtte 2 |
| [`docs/plan.md`](docs/plan.md) | Planen. Kilde til sannhet |
| [`docs/stoppkriterier.md`](docs/stoppkriterier.md) | De åtte kriteriene, med bevisfelt |
| [`docs/beslutninger.md`](docs/beslutninger.md) | Beslutninger med begrunnelse |
| [`docs/aapne-sporsmal.md`](docs/aapne-sporsmal.md) | Spørsmål som venter på svar |
| [`docs/manuell-oppsett.md`](docs/manuell-oppsett.md) | Variabler og miljø, steg for steg |
| [`docs/status.md`](docs/status.md) | Verifisert / antatt / ikke sjekket |
| [`LAGT-TIL-GRUNN.md`](LAGT-TIL-GRUNN.md) | Påkrevde avvik, inkludert mine egne feil |

---

## Regler som ikke kan bøyes

1. Ingen påstand uten dekning. Skill verifisert, antatt og ikke sjekket.
2. Bygg og sjekker grønne før noe kalles ferdig.
3. Verifiser det som faktisk sendes og vises — ikke bare koden.
4. Uavhengig etterkontroll av en annen agent.
5. Rett egne feil høyt.
6. Ikke rør andres ucommitterte arbeid.
7. Ikke gjett på fakta du ikke har. Org.nr, priser, nøkler, kundedata: spør.
8. Destruktive handlinger krever bevis.
9. Ingen endringer ingen ba om.
10. Ikke slå av sikkerhet for å få noe til å virke.
11. Ingen hemmeligheter i logger, rapporter eller repo.
12. Stopp når det er nok.

---

## Ikke rør

- **VikingCRM i produksjon.** Vi snakker med den via webhook. Vi endrer den ikke.
- **Kunders nettsider.**
- **`vikingnet.no`** — bygget i Firebase, skal ikke migreres.
- **Andres ucommitterte arbeid.**
