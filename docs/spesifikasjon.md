# VikingPilot — kravspesifikasjon

**Master-prompt for VikingPilot.** Dette dokumentet beskriver hva systemet skal være,
og — like viktig — hva som hører i kode og hva som hører hos agenten.

- **Oppdragsgiver:** Vikingnet / AIChat Norge AS, org.nr 933 851 222
- **Brukere:** Kenneth Kristiansen, Fredrik Rostrup Ellingsen
- **Systemet er internt.** Det har ikke eget domene. Det kjører på Railway-URL-en.
- **Status for dette dokumentet:** skrevet i fase 0. Den opprinnelige
  `docs/spesifikasjon.md` fantes ikke i repoet, i søsterrepoene eller på maskinen da
  byggingen startet. Dette dokumentet er derfor destillert fra oppdragsbeskrivelsen og
  skal leses som gjeldende master-prompt inntil Kenneth eller Fredrik erstatter det.

---

## 1. Formål

Vikingnet selger autonome AI-agenter til bedrifter. VikingPilot skal gjøre den jobben
for oss: finne relevante norske bedrifter, kvalifisere dem, følge dem opp, og legge alt
klart for at et menneske kan lukke avtalen.

VikingPilot er **ikke** en selger. Det er motoren som finner, kvalifiserer og forbereder.
Et menneske lukker.

---

## 2. Arkitekturregelen — ufravikelig

> **Systemet eier sannhet, grenser og logg. Agenten eier skjønn og samtale.**

Fire konsekvenser som styrer hver eneste beslutning i kodebasen:

1. **Agenten får aldri egne nøkler.** Ingen postkasse-tilgang, ingen repo-tilgang, ingen
   CRM-tilgang. Agenten kaller systemets egne verktøy, og systemet håndhever grensene.
2. **Alle guardrails ligger i database og kode.** Volumbegrensninger, sperrelister,
   oppvarmingsplan og tidsvinduer er rader og funksjoner — aldri setninger i en prompt.
   En regel i en prompt kan snakkes rundt. En regel i en database kan ikke.
3. **Alt med ekstern konsekvens går gjennom godkjenningskøen.**
4. **Agenten skal kunne byttes ut** uten at forretningslogikken endres. Derfor bygges
   alle guardrails som vanlige tjenestefunksjoner med HTTP-ruter rundt. En senere økt
   pakker dem inn som MCP-verktøy uten å skrive dem om.

---

## 3. Oppdelingen: to bøtter

Hver oppgave i systemet plasseres i nøyaktig én bøtte. Plasseringen er ikke kosmetisk:
den avgjør hva som bygges nå, og hva som bare får datastruktur og verktøyflate.

**Kostnaden per melding er en del av marginen vår.** Hver oppgave som flyttes fra bøtte 2
til bøtte 1 er verdt penger. Når du er i tvil: spør om oppgaven egentlig krever skjønn,
eller om den bare ser ut som om den gjør det.

### 3.1 Bøtte 1 — DETERMINISTISK (hører i kode, bygges nå)

| # | Oppgave | Hvor |
|---|---|---|
| 1 | Henting fra Enhetsregisteret | `src/lib/enhetsregister/` |
| 2 | Normalisering av navn, orgnr, adresse, NACE | `src/lib/enhetsregister/normalize.ts` |
| 3 | Deterministiske filtre: bransje, fylke, størrelse, alder, rolle | `src/lib/enhetsregister/filter.ts` |
| 4 | Offentlig sektor ut, alltid | `src/lib/enhetsregister/filter.ts` |
| 5 | Sperrelister, alle kanaler | `src/lib/guards/sperreliste.ts` |
| 6 | Volumbegrensning per avsender, dag og uke | `src/lib/guards/volum.ts` |
| 7 | Oppvarmingsplan | `src/lib/guards/oppvarming.ts` |
| 8 | Hverdagsvinduer og røde dager | `src/lib/guards/tidsvindu.ts` |
| 9 | Idempotens på utsending | `src/lib/guards/idempotens.ts` |
| 10 | Sekvensmotor: steg, ventetid, avslutningsregler | `src/lib/sekvens/` |
| 11 | Godkjenningskøens mekanikk | `src/lib/godkjenning/` |
| 12 | Revisjonslogg, uforanderlig | `src/lib/revisjon/` |
| 13 | Cron med egen hemmelighet, tørrkjøring, logg | `src/app/api/cron/` |
| 14 | Webhook-mapping fra VikingCRM | `src/lib/vikingcrm/` |
| 15 | Datofestet kvittering (dato, klokkeslett, orgnr) | `src/lib/format/` |
| 16 | Logging og feilrapportering | `src/lib/logg/` |
| 17 | Rate limiting på åpne endepunkter | `src/lib/ratelimit.ts` |
| 18 | Målgruppekonfigurasjon (bransje, fylke, størrelse, rolle) | database, `Maalgruppe` |

### 3.2 Bøtte 2 — SKJØNN (hører hos agenten, bygges senere)

For disse bygges **bare datastrukturene og verktøyflatene** i denne økten. Ingen logikk.

| # | Oppgave | Datastruktur / flate som bygges nå |
|---|---|---|
| 1 | Skrive tekst som ikke lukter AI | `Utkast` + `Godkjenning` |
| 2 | Klassifisere et svar | `Dialog.meldingKlassifisering`, `Klassifisering` |
| 3 | Velge strategi | `Sekvens.versjon` + `Steg` (agenten velger, motoren utfører) |
| 4 | Formulere en kvittering | `Kvittering` (mal + felter; agenten fyller ordlyden) |
| 5 | Tolke fritekst fra en innkommende e-post | `Innkommende` + rå lagring |
| 6 | Vurdere om et treff er relevant | `Prospekt.score`, `Prospekt.begrunnelse` |

### 3.3 Grensetilfellene — og hvorfor de havnet der de gjorde

Disse er nevnt fordi de er lette å plassere feil:

- **Kvittering.** *Ordlyden* er skjønn (bøtte 2). Men *at* en kvittering finnes, *når* den
  lages, og *hvilke felter* den inneholder, er deterministisk (bøtte 1). Systemet garanterer
  sporbarhet; agenten formulerer.
- **Svarklassifisering.** Selve kategorisettet er deterministisk — det er en lukket liste i
  databasen. Hvilken kategori et konkret svar havner i, er skjønn.
- **«Når skal vi følge opp?»** Ventetid er deterministisk: den er `Steg.ventetidTimer`.
  Agenten kan ikke velge å vente kortere.
- **Sperrelister.** Agenten kan ikke se bort fra en sperre. Den kan heller ikke se den —
  sjekken skjer i systemet, i det øyeblikket noe skal sendes.

---

## 4. Moduler

| # | Modul | Innhold |
|---|---|---|
| 1 | Kjernedata | organisasjoner, kontakter, prospekter, kunder, dialoger, produkter med SKU og pris, avtaler, oppgaver |
| 2 | Sperrelister | global sperre på tvers av kanaler, eksisterende kunder, aktiv dialog, avmeldinger, bounces. Sjekkes i det øyeblikket noe skal sendes |
| 3 | Enhetsregister-pipeline | hent, normaliser, filtrer deterministisk, fyll på jevnlig |
| 4 | Utsendingsvakt | volum per avsender, oppvarmingsplan, hverdagsvinduer, røde dager, idempotens |
| 5 | Sekvensmotor | versjonerte sekvenser med steg, ventetid og avslutningsregler. Sekvenser er data, ikke kode |
| 6 | Godkjenningskø | alt eksternt går gjennom den, med hvem-godkjente-hva og når |
| 7 | Revisjonslogg | hver utgående handling med grunnlag, tidspunkt, resultat og kilde. Uforanderlig |
| 8 | Tidsplan | hver cron-jobb som egen rute med egen hemmelighet, tørrkjøringsmodus og logg |
| 9 | Dashbord | hva kjører, hva venter på meg, hva feilet, hva systemet ikke er konfigurert for ennå |

---

## 5. Målgruppen er konfigurasjon

Hvilke bransjer, fylker, størrelser og roller vi vil nå, skal være **konfigurasjon i
databasen, ikke hardkodet i koden.** Kenneth og Fredrik skal kunne endre hvem vi leter
etter uten at noen skriver kode.

Dette er ikke bare et brukervennlighetskrav. Det er et uttrykk for arkitekturregelen:
hvem vi leter etter er en forretningsregel, og forretningsregler hører i databasen.

---

## 6. Krav til «100 % ferdig»

1. Bygget grønt. Ingen plassholdere, ingen «kommer snart», ingen TODO i det en bruker ser.
2. Hver integrasjon har en ærlig «ikke konfigurert»-tilstand. Mangler en nøkkel, skal
   systemet si det tydelig og fortsette å virke — **aldri finne på data**.
3. **All utgående trafikk er av som standard.** Ingenting sendes eller endres eksternt før
   Kenneth eller Fredrik slår det på, per kanal.
4. Alle cron-ruter kan kjøres i tørrkjøring og logger hva de ville gjort.
5. Skjemaet setter seg selv opp ved oppstart og tåler å kjøre mot en halvferdig database.
6. Frødata som gjør at hele systemet kan demonstreres uten én eneste ekstern tjeneste.
7. En sjekkeliste som verifiserer systemet ende-til-ende uten nettverk.

---

## 7. Sikkerhet og personvern

- Ingen hemmeligheter i repo, logger eller feilmeldinger. Referer til nøkler.
- Alle åpne endepunkter har rate limiting.
- Personopplysninger skal ha dokumentert formål og kunne slettes.

---

## 8. Utenfor scope for denne økten

Disse er bevisst ikke bygget, og skal ikke bygges uten en ny beslutning:

- **Selve agenten.** Den kobles på i en egen økt. Denne økten leverer verktøyflatene.
- **Eget domene.** Systemet kjører på Railway-URL-en. Det er et krav, ikke en mangel.
- **Vikingnet-nettsiden.** Den er bygget i Firebase
  (`fredrikrellingsen-debug/vikingnet`) og skal **ikke** røres eller migreres.
- **VikingCRM i produksjon.** Vi snakker med den via webhook. Vi endrer den ikke.
- **Kunders nettsider.** Røres ikke.
- **Betalingsinnkreving, fakturering, regnskap.** Utenfor formålet.
