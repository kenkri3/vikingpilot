# VikingPilot — ett ark

**Status: fase 1 (skjelettet) er bygget og verifisert. Fase 2–5 gjenstår.**

---

## Hva systemet gjør

VikingPilot er motoren som finner norske bedrifter, kvalifiserer dem, følger dem opp, og
legger alt klart for at et menneske kan lukke avtalen. Det selger ikke selv.

**Systemet eier sannhet, grenser og logg. Agenten eier skjønn og samtale.**

Ni moduler, alle med datastruktur på plass:

1. **Kjernedata** — organisasjoner, kontakter, prospekter, kunder, dialoger, produkter,
   avtaler, oppgaver
2. **Sperrelister** — global sperre, eksisterende kunder, aktiv dialog, avmeldinger,
   bounces. Sjekkes i det øyeblikket noe skal sendes
3. **Enhetsregister-pipeline** — hent, normaliser, filtrer, fyll på jevnlig
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
| Bygg, typekontroll og tester er grønne | `npm run verify` → exit 0 |
| Systemet svarer | `GET /api/helse` → 200, database ok |
| Innlogging kreves | `/dashboard` uten cookie → 307 til `/login` |
| All utgående trafikk er av | 0 av 6 kanaler slått på, alle med døgnkvote 0 |
| Ingen kan sende ved et uhell | Cron tørrkjører som standard; idempotens avviser duplikat |
| Integrasjoner er ærlige | Hver navngir nøyaktig hvilke nøkler som mangler — og finner ikke på data |
| Cron-ruter er beskyttet | Uten hemmelighet → 503. Feil hemmelighet → 401 |
| Røde dager stenges | Søndag, første juledag og natt avvises |
| Hemmeligheter lekker ikke | Passord i tilkoblingsstrenger maskeres i logger |
| Sjekkelisten er grønn | 26 bestått, 0 feilet, uten nettverk |

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
| Enhetsregister-pipelinen henter ikke faktisk | Fase 3. Ruten sier ærlig «ikke konfigurert» |
| Utsendingsvakten håndhever ikke volum i praksis | Fase 3. Ingen kanal er slått på, så ingen fare |
| Sperrelister fylles ikke automatisk | Fase 2. Tabellen finnes, reglene bygges |
| Sekvensmotoren kjører ikke | Fase 4. Sekvensen ligger som data |
| Godkjenningskøen har ingen grensesnitt | Fase 4. Tabellene finnes |
| Bare én av fem cron-ruter er bygget | Resten følger mønsteret i fase 3–4 |
| Selve agenten | Egen økt. Denne økten leverer verktøyflatene |
| Eget domene | Skal ikke ha det. Kjører på Railway-URL-en |
| Migrering av vikingnet.no | Bygget i Firebase, skal ikke røres |

---

## Beslutninger som gjenstår

Elleve spørsmål står åpne i `docs/aapne-sporsmal.md`. Fire blokkerer videre arbeid:

| # | Spørsmål | Blokkerer |
|---|---|---|
| S1 | Hvilken kanal sender vi e-post gjennom? | fase 3 |
| S2 | Hvilke avsendere, og hvor mange meldinger tåler de? | fase 3 |
| S4 | Hva kjennetegner en god kunde for oss? | fase 3 |
| S7 | Hva selger vi, og til hvilken pris? | fase 4 |

**Én beslutning haster mer enn de andre:** byggeroten er flyttet fra
`G:\Min disk\GitHub\Vikingpilot` til `C:\VikingPilot`. `G:` er Google Drive og skriver
0-byte filer uten å si fra. Begrunnelsen er målt — se `LAGT-TIL-GRUNN.md` A-001. Uten din
aksept på dette fortsetter jeg på lånt grunn.

**Og én ting du bør vite:** port 3000 på denne maskinen er opptatt av
Tønsberglivet-prosjektet ditt. Jeg rørte den ikke. VikingPilot bruker 3100 lokalt.

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
