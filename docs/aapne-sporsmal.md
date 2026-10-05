# Åpne spørsmål

Spørsmålene her er stilt fordi jeg **ikke vil gjette**. Regel 7 i oppdraget er tydelig:
org.nr, priser, nøkler og kundedata spør vi om. Et galt svar som blir bygget inn i koden
er dyrere å rette enn et spørsmål som blir stilt.

Svar gjerne kort: «S1: SMTP», eller fyll inn verdien. Tomme felt betyr «ikke bestemt ennå».

---

## Blokkerer fase 1

### S1 — Hvilken kanal sender vi e-post gjennom?

Utsendingsvakten og godkjenningskøen er bygget slik at kanalen er en innstilling, ikke en
antakelse. Men *implementasjonen* av selve sendingen må velges.

- [ ] SMTP (vi har egne postbokser)
- [ ] En e-postleverandør med API
- [ ] Vet ikke ennå — bygg kanalen som en «ikke konfigurert»-stubb, så kan den fylles inn senere

**Svar:**

---

### S2 — Hvilke avsendere har vi, og hvor mange meldinger tåler de?

Oppvarmingsplanen trenger et startpunkt. Uten dette kan jeg ikke sette en ærlig
oppvarmingskurve, og da er tallene mine oppdiktede.

| Avsenderadresse | Domene | Alder på domenet | Dagens volum |
|---|---|---|---|
| | | | |
| | | | |

**Svar:**

---

### S3 — Er domeneoppsettet (SPF, DKIM, DMARC) i orden?

Hvis ikke, bør systemet si det tydelig i dashbordet før noen slår på utgående trafikk.

- [ ] Ja, alle tre
- [ ] Delvis
- [ ] Nei
- [ ] Vet ikke

**Svar:**

---

## Blokkerer fase 3

### S4 — Hva kjennetegner en god kunde for oss?

Målgruppen skal ligge i databasen, ikke i koden. Men jeg trenger et *første* innhold i
frødataene — ellers vet jeg ikke hva jeg skal fylle inn. Dette er den ene gangen jeg ber
om innhold i stedet for struktur.

- **Bransjer (NACE-koder eller beskrivelse):**
- **Fylker:**
- **Størrelse (antall ansatte):**
- **Roller vi vil treffe (daglig leder, IT-ansvarlig, …):**
- **Virksomheter vi *ikke* vil ha:**

**Svar:**

---

### S5 — Hvor mange prospekter vil vi ha per uke?

Volumbegrensningen er deterministisk, men den trenger et tall.

**Svar:**

---

## Blokkerer fase 4

### S6 — Hvordan ser en sekvens ut i praksis?

Jeg bygger sekvensmotoren som data. For å legge inn én frøsekvens trenger jeg et reelt
eksempel på hvordan Vikingnet faktisk følger opp i dag.

**Steg 1:** ventetid ______ / kanal ______ / hensikt ______
**Steg 2:** ventetid ______ / kanal ______ / hensikt ______
**Steg 3:** ventetid ______ / kanal ______ / hensikt ______

**Avslutningsregler (hva skal stoppe sekvensen?):**

**Svar:**

---

### S7 — Hva vil vi selge, og til hvilken pris?

Produktmodellen har SKU og pris. Jeg trenger de faktiske verdiene.

| Produktnavn | SKU | Pris | Enhet |
|---|---|---|---|
| | | | |

**Svar:**

---

## Blokkerer fase 5

### S12 — Hvor kommer kontaktene fra?

**Dette er det viktigste åpne spørsmålet nå — men det blokkerer ikke lenger arbeidet.**

Enhetsregisteret oppgir virksomheter — navn, orgnr, adresse, næringskode. Det oppgir
**ikke** e-postadresser eller personer. Roller og fødselsnummer ligger bak et eget
autorisiert API som vi ikke bruker, og som krever avtale.

Konsekvensen er målt, ikke antatt: de 13 prospektene pipelinen har hentet, har ingen
kontakt. Sekvensmotoren svarer `utenKontakt: 13` i stedet for å finne på en adresse.
Systemet er bygget for å sende, men har ingen å sende til.

Jeg finner ikke på e-postadresser. Å konstruere `fornavn.etternavn@firma.no` ville sendt
post til fremmede, og det er nøyaktig den typen gjetning oppdraget forbyr.

**Hva som er gjort i mellomtiden:** Uansett hvilket svar du velger, må kontaktene inn i
systemet på én måte. Før fantes det ingen — den eneste veien var å skrive dem inn manuelt i
databasen. Nå finnes `npm run kontakt:import`, som tar en CSV. Den kobler kontaktene til
riktige selskaper, avviser det den ikke kan bruke, krever dokumentert grunnlag for
personopplysningene, og er trygg å kjøre flere ganger.

Se [import-av-kontakter.md](import-av-kontakter.md).

**Spørsmålet står altså, men du kan svare på det ved å lage en CSV.** Velg retning:

- [ ] **Vi har en kontaktliste.** Lag en CSV med `fornavn,etternavn,epost` og kjør
      `npm run kontakt:import -- --fil listen.csv --grunnlag "..."`. Ferdig.
- [ ] **Vi henter roller fra Enhetsregisterets autoriserte API.** Krever avtale med
      Brønnøysundregistrene. Gir navn og rolle, men fortsatt ikke e-post.
- [ ] **Vi henter fra nettsidene deres.** Krever egen innhøsting, og reiser
      personvernspørsmål vi må avklare før vi begynner.
- [ ] **Vi tester med oppdiktede kontakter først**, og løser kilden senere. Importen
      godtar dem, og alt annet kan prøves ende-til-ende.
- [ ] **Annet:**

**Svar:**

**Hva som fortsatt ikke virker uten et svar:** ingenting sendes, og skal heller ikke det.
Men uten kontakter kan vi ikke se om sekvensmotoren, godkjenningskøen og utsendingsvakten
henger sammen på ekte data — bare på data vi selv har lagt inn i testene.

---

### S8 — Hvilke nøkler finnes allerede?

Jeg bygger «ikke konfigurert»-tilstander uansett. Dette spørsmålet avgjør hva som er
*verifiserbart* og hva som forblir en stubbe i denne økten. Svar med navn på nøkkelen —
ikke verdien. Verdiene skal aldri i repo, chat eller logg.

| Tjeneste | Finnes nøkkelen? | Navn på variabelen (ikke verdien) |
|---|---|---|
| Enhetsregisteret | | |
| E-post | | |
| VikingCRM webhook | | |
| Agentplattformen | | |
| GitHub | | |

**Svar:**

---

## Ikke-blokkerende, men trengs før produksjon

### S9 — Hvem skal kunne logge inn?

- [ ] Kun Kenneth og Fredrik
- [ ] Også andre i Vikingnet — hvem:

**Svar:**

---

### S10 — Hvor lenge skal vi oppbevare personopplysninger?

Personvernkravet sier at personopplysninger skal ha dokumentert formål og kunne slettes.
Jeg trenger en frist for hvor lenge et prospekt vi aldri fikk svar fra skal ligge.

- [ ] 12 måneder
- [ ] 24 måneder
- [ ] Annet:

**Svar:**

---

### S11 — Er det greit at frødataene er oppdiktede?

Systemet skal kunne demonstreres ende-til-ende uten én eneste ekstern tjeneste. Da må
frødataene være oppdiktede — jeg finner ikke på ekte bedrifter og ekte personer.

- [ ] Ja, oppdiktede data er greit. Bruk tydelige plassholdere
- [ ] Nei, bruk kun data hentet fra Enhetsregisteret (forutsetter nettverk under demo)
- [ ] Ja, men bruk Dataforeningen og lignende tydelig fiktive navn med orgnr 999 999 999

**Svar:**

---

## Avklart

| # | Spørsmål | Svar | Dato |
|---|---|---|---|
| B-008 | Innlogging | E-post og passord i databasen, scrypt og signert cookie | fase 0 |
| B-009 | Testverktøy | Nodes innebygde testkjører | fase 0 |
| B-010 | Postgres lokalt | Windows-tjeneste fra EDB-binærfiler | fase 0 |
| — | Spesifikasjonen | Skrives av meg fra oppdraget | fase 0 |
| — | Byggerot | Lokal NTFS, ikke Google Drive | fase 0 |
