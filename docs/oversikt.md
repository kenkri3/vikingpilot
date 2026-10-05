# VikingPilot — ett ark

**Status: fase 1–4 er bygget og verifisert. Fase 5 (herding) gjenstår.**

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
3. **Enhetsregister-pipeline** — henter, normaliserer, filtrerer, fyller på jevnlig
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
| Bygg, typekontroll og tester er grønne | `npm run verify` → exit 0, **133 tester** |
| Sjekkelisten er grønn, uten nettverk | **51 bestått, 0 feilet** |
| Skjemaet setter seg selv opp mot tom database | 32 tabeller opprettet fra tom base |
| Systemet svarer | `GET /api/helse` → 200, database ok |
| Innlogging kreves | `/dashboard` uten cookie → 307 til `/login` |
| **Pipelinen henter ekte bedrifter** | Hentet **200**, godkjent **13**, opprettet **13** |
| **Tørrkjøring skriver ingenting** | Etter tørrkjøring: 0 organisasjoner, 0 prospekter |
| **Kjøring er idempotent** | Samme kall igjen → opprettet **0**, oppdatert **13** |
| **Offentlig sektor kommer aldri inn** | 0 offentlige i basen. Avvises selv med åpen konfigurasjon |
| **Hele kjeden virker** | prospekt → sekvens → utkast → kø → godkjenning → utsendingsjobb |
| **Ingenting når en mottaker** | Etter hele kjeden: **0 utsendinger**. Grunnen sies høyt |
| **Agenten kan ikke godkjenne** | Avgjørelser krever innlogging, ikke hemmelighet |
| **En avgjørelse tas én gang** | Test med tre samtidige godkjenninger: én slapp gjennom |
| **Ingen melding er godkjent uten en beslutning** | Sjekkelisten verifiserer invarianten |
| **Ingen utsending er sendt uten godkjenning** | Sjekkelisten verifiserer invarianten |
| All utgående trafikk er av | 0 av 6 kanaler slått på, alle med døgnkvote 0 |
| Sperrelister virker | 27 bruddforsøk, alle avviser |
| Utsendingsvakten virker | Døgnkvote, ukekvote, oppvarming og idempotens testet |
| Integrasjoner er ærlige | Hver navngir nøyaktig hvilke nøkler som mangler |
| Hemmeligheter lekker ikke | Passord i tilkoblingsstrenger maskeres i logger |

Kjør det selv:

```powershell
cd C:\VikingPilot
npm run forhandsjekk             # sjekker miljøet. Kjør denne FØRST
npm run verify
npm run sjekkliste
npx tsx scripts/e2e-fase4.ts     # hele kjeden, ende-til-ende
$env:PORT = "3100"; npm run start:prod
```

**`npm run forhandsjekk` er den viktigste av dem.** Den sjekker 18 ting i miljøet og
sier tydelig hva som mangler — før du deployer, ikke etter. Den viser aldri en
hemmelighet, bare navnet på variabelen og om den er satt. Kjør den både lokalt og på
Railway etter første deploy.

---

## Det viktigste som gjenstår

**En kontaktkilde.** Enhetsregisteret oppgir virksomheter, ikke e-postadresser. De 13
prospektene i basen har derfor ingen kontakt, og sekvensmotoren svarer `utenKontakt: 13` i
stedet for å finne på en adresse.

Det betyr: **målgruppen kan fylles, men ikke kontaktes.** Systemet er bygget for å sende,
men har ingen å sende til ennå. Dette er en åpen beslutning, ikke en feil i koden — se S12
i `docs/aapne-sporsmal.md`.

---

## Hva det ikke gjør ennå

| Ikke bygget | Hvorfor |
|---|---|
| Selve e-postutsendingen | Fase 5. Kanalen er av, og `leverTilKanal` sier ærlig fra |
| Bare tre av fem cron-ruter er bygget | Oppvarming og rydding følger samme mønster |
| Dashbordet har ingen godkjenn-knapp | Ruten finnes, men knappen mangler |
| Manuell liste ikke prøvd fra tom mappe | Fase 5 |
| Ingen uavhengig etterkontroll ennå | Fase 5, og oppdraget krever det |
| Selve agenten | Egen økt. Denne økten leverer verktøyflatene |
| Eget domene | Skal ikke ha det. Kjører på Railway-URL-en |
| Migrering av vikingnet.no | Bygget i Firebase, skal ikke røres |

---

## Beslutninger som gjenstår

Tolv spørsmål står åpne i `docs/aapne-sporsmal.md`. To haster:

| # | Spørsmål | Hvorfor det haster |
|---|---|---|
| S12 | Hvor kommer kontaktene fra? | Uten dem kan ingenting sendes |
| S1/S2 | E-postkanal og avsendere | Når noe faktisk skal ut |

**Én beslutning haster fortsatt mer:** byggeroten er flyttet fra
`G:\Min disk\GitHub\Vikingpilot` til `C:\VikingPilot`. `G:` er Google Drive og skriver
0-byte filer uten å si fra. Se `LAGT-TIL-GRUNN.md` A-001.

**Og en ting du bør vite:** port 3000 på denne maskinen er opptatt av
Tønsberglivet-prosjektet ditt. Jeg rørte den ikke. VikingPilot bruker 3100 lokalt.

**Datakvalitet:** Enhetsregisteret oppgir sjelden `antallAnsatte` og `fylke`. Med
`minAnsatte: 5` ble 185 av 200 avvist nettopp på det. Målgruppen i databasen kan justeres
— det er konfigurasjon, ikke kode.

---

## Dokumenter

| Fil | Innhold |
|---|---|
| `docs/spesifikasjon.md` | Master-prompt, med bøtte 1 og bøtte 2 |
| `docs/plan.md` | Planen. Kilde til sannhet for neste økt |
| `docs/stoppkriterier.md` | De åtte kriteriene, med kommando og bevisfelt |
| `docs/beslutninger.md` | Tjueåtte beslutninger med begrunnelse |
| `docs/aapne-sporsmal.md` | Spørsmål som venter på svar |
| `docs/manuell-oppsett.md` | Klikkbar liste: variabler og miljø |
| `docs/status.md` | Verifisert / antatt / ikke sjekket |
| `LAGT-TIL-GRUNN.md` | Påkrevde avvik fra oppdraget — inkludert mine egne feil |
