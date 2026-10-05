# VikingPilot — ett ark

**Status: fase 1–3 er bygget og verifisert. Fase 4–5 gjenstår.**

---

## Hva systemet gjør

VikingPilot er motoren som finner norske bedrifter, kvalifiserer dem, følger dem opp, og
legger alt klart for at et menneske kan lukke avtalen. Det selger ikke selv.

**Systemet eier sannhet, grenser og logg. Agenten eier skjønn og samtale.**

Ni moduler:

1. **Kjernedata** — organisasjoner, kontakter, prospekter, kunder, dialoger, produkter,
   avtaler, oppgaver
2. **Sperrelister** — global sperre, eksisterende kunder, aktiv dialog, avmeldinger,
   bounces. Sjekkes i det øyeblikket noe skal sendes
3. **Enhetsregister-pipeline** — henter, normaliserer, filtrerer, fyller på jevning
4. **Utsendingsvakt** — volum per avsender, oppvarmingsplan, hverdagsvinduer, røde dager,
   idempotens
5. **Sekvensmotor** — versjonerte sekvenser. Sekvensene er data, ikke kode
6. **Godkjenningskø** — alt eksternt går gjennom den, med hvem-godkjente-hva og når
7. **Revisjonslogg** — hver utgående handling, uforanderlig
8. **Tidsplan** — hver cron-jobb egen rute, egen hemmelighet, tørrkjøring, logg
9. **Dashbord** — hva kjører, hva venter på meg, hva feilet, hva mangler konfigurasjon

**Sikkert som standard:** all utgående trafikk er av.

---

## Hva som virker nå

Målt, ikke antatt:

| Ting | Bevis |
|---|---|
| Skjemaet setter seg selv opp mot tom database | 32 tabeller opprettet fra tom base |
| Bygg, typekontroll og tester er grønne | `npm run verify` → exit 0, **107 tester** |
| Sjekkelisten er grønn, uten nettverk | **44 bestått, 0 feilet** |
| Systemet svarer | `GET /api/helse` → 200, database ok |
| Innlogging kreves | `/dashboard` uten cookie → 307 til `/login` |
| All utgående trafikk er av | 0 av 6 kanaler slått på, alle med døgnkvote 0 |
| **Pipelinen henter ekte bedrifter** | Hentet **200**, godkjent **13**, opprettet **13** |
| **Tørrkjøring skriver ingenting** | Etter tørrkjøring: 0 organisasjoner, 0 prospekter |
| **Kjøring er idempotent** | Samme kall igjen → opprettet **0**, oppdatert **13** |
| **Offentlig sektor kommer aldri inn** | 0 offentlige i basen. Avvises selv med åpen konfigurasjon |
| **Ingen konkurser eller avviklinger** | 0 i basen |
| Sperrelister virker | 27 bruddforsøk, alle avviser |
| Utsendingsvakten virker | Døgnkvote, ukekvote, oppvarming og idempotens testet med bruddforsøk |
| Ingen kan sende ved et uhell | Ingen utsending står som sendt. Cron tørrkjører som standard |
| Integrasjoner er ærlige | Hver navngir nøyaktig hvilke nøkler som mangler — og finner ikke på data |
| Hemmeligheter lekker ikke | Passord i tilkoblingsstrenger maskeres i logger |

Kjør det selv:

```powershell
cd C:\VikingPilot
npm run verify
npm run sjekkliste
$env:PORT = "3100"; npm run start:prod
```

---

## Hva det ikke gjør ennå

| Ikke bygget | Hvorfor |
|---|---|
| Sekvensmotoren kjører ikke | Fase 4. Sekvensen ligger som data |
| Godkjenningskøen har ingen rute å legge noe i | Fase 4. Tabellene finnes |
| Bare én av fem cron-ruter er bygget | Resten følger mønsteret i fase 4 |
| Ingen e-post kan faktisk sendes | Bevisst. Kanalen er av, og Fase 4 bygger køen først |
| Selve agenten | Egen økt. Denne økten leverer verktøyflatene |
| Eget domene | Skal ikke ha det. Kjører på Railway-URL-en |
| Migrering av vikingnet.no | Bygget i Firebase, skal ikke røres |

---

## Beslutninger som gjenstår

Elleve spørsmål står åpne i `docs/aapne-sporsmal.md`. To blokkerer fase 4 sitt innhold:

| # | Spørsmål | Blokkerer |
|---|---|---|
| S6 | Hvordan ser en sekvens ut i praksis? | fase 4, innholdet |
| S7 | Hva selger vi, og til hvilken pris? | fase 4, innholdet |

Mekanikken i fase 4 kan bygges med frødata først.

**Én beslutning haster fortsatt mer:** byggeroten er flyttet fra
`G:\Min disk\GitHub\Vikingpilot` til `C:\VikingPilot`. `G:` er Google Drive og skriver
0-byte filer uten å si fra. Se `LAGT-TIL-GRUNN.md` A-001.

**Og en ting du bør vite:** port 3000 på denne maskinen er opptatt av
Tønsberglivet-prosjektet ditt. Jeg rørte den ikke. VikingPilot bruker 3100 lokalt.

**En ting du bør vite om Enhetsregisteret:** det åpne API-et oppgir sjelden
`antallAnsatte` og `fylke`. Med `minAnsatte: 5` ble 185 av 200 avvist nettopp på det.
Vil du ha flere treff, må målgruppen i databasen justeres — det er konfigurasjon, ikke kode.

---

## Dokumenter

| Fil | Innhold |
|---|---|
| `docs/spesifikasjon.md` | Master-prompt, med bøtte 1 og bøtte 2 |
| `docs/plan.md` | Planen. Kilde til sannhet for neste økt |
| `docs/stoppkriterier.md` | De åtte kriteriene, med kommando og bevisfelt |
| `docs/beslutninger.md` | Seksten beslutninger med begrunnelse |
| `docs/aapne-sporsmal.md` | Elleve spørsmål, fire blokkerende |
| `docs/manuell-oppsett.md` | Klikkbar liste: variabler og miljø |
| `docs/status.md` | Verifisert / antatt / ikke sjekket |
| `LAGT-TIL-GRUNN.md` | Påkrevde avvik fra oppdraget — inkludert mine egne feil |
