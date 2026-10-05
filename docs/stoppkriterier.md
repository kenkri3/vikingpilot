# Stoppkriterier

Formålet med dette dokumentet er å gjøre «ferdig» etterprøvbart. Hvert kriterium har en
**kommando** som avgjør det, og et **bevis** som skal fylles inn. Et kriterium uten
utført kommando og innført bevis er ikke oppfylt.

Kolonnene `Kjørt` og `Bevis` er bevisst tomme nå. De fylles inn av den som kjører
kommandoen — ikke av den som skrev koden.

| # | Kriterium | Kommando | Kjørt | Bevis |
|---|---|---|---|---|
| 1 | Bygg, typekontroll og alle sjekker grønne på siste commit | `npm run verify` | nei | |
| 2 | Systemet starter på Railway med tom database og setter seg selv opp | `npm run start:prod` mot tom database, deretter `npm run smoke` | nei | |
| 3 | Hver modul kan demonstreres med frødata, uten eksterne tjenester | `npm run demo:alle` | nei | |
| 4 | Hver integrasjon viser ærlig «ikke konfigurert» når nøkkelen mangler, og systemet virker ellers | `npm run demo:uconfigurert` | nei | |
| 5 | Bevist at ingenting kan sendes ved et uhell: utgående er av, tørrkjøring dekker alle sendende ruter | `npm run test:guardrails` | nei | |
| 6 | Guardrailsene er testet med forsøk på å bryte dem — og avviser | `npm run test:brudd` | nei | |
| 7 | Den manuelle listen er komplett og prøvd fra tom mappe | Følg `docs/manuell-oppsett.md` på en maskin uten repo | nei | |
| 8 | Ingen gjenstående funn av alvor BLOKKERER eller HØY | `docs/status.md` → Åpne funn | nei | |

## Hva hvert kriterium faktisk krever

**1 — Bygg grønt.** `npm run verify` skal kjøre, i denne rekkefølgen: `prisma validate`,
`prisma generate`, `tsc --noEmit`, `next build`, `node --test`. Feiler ett ledd, er
kriteriet ikke oppfylt. Det er ikke nok at koden «ser riktig ut».

**2 — Selvoppsettende skjema.** Dette testes mot en database som er *tom*, ikke mot en
som allerede virker. Kravet «tåler å kjøre mot en halvferdig database» testes ved å kjøre
oppsettet to ganger på rad, og ved å kjøre det mot en database der én tabell er fjernet.

**3 — Frødata uten eksterne tjenester.** Nettverket skal være unødvendig. Testen skal
kjøre med alle nøkler fjernet. Finner den på data, er kriteriet brutt — ikke oppfylt.

**4 — Ærlig «ikke konfigurert».** For hver integrasjon (Enhetsregisteret, e-post,
VikingCRM, agentplattformen) skal systemet svare «ikke konfigurert» med *hvilken*
nøkkel som mangler. Det skal ikke kaste en uforståelig feil, og det skal ikke late som.

**5 — Utgående av.** Det skal finnes en test som forsøker å sende, og som beviser at
den blir stoppet av at kanalen er av — ikke av en tilfeldighet. Tørrkjøring skal dekke
hver rute som kan sende.

**6 — Bruddforsøk.** Testen skal aktivt prøve å bryte hver guardrail: sende til en sperret
adresse, overskride døgnvolumet, sende utenfor tidsvinduet, sende samme melding to ganger,
sende i oppvarmingsperioden uten kvote. Alle skal avvises.

**7 — Manuell liste.** Listen skal være prøvd fra en tom mappe, av noen som ikke skrev
den. Den skal ikke forutsette at repoet finnes lokalt fra før.

**8 — Åpne funn.** Alle funn av alvor BLOKKERER eller HØY skal være lukket eller
nedgradert med en skriftlig begrunnelse i `docs/status.md`.

## Ærlig status per nå

Etter runde 2 (fase 1). Kriteriene 1, 4 og 5 er helt eller delvis oppfylt for det som
finnes. Resten krever faser som ikke er bygget ennå.

| # | Kriterium | Status | Merknad |
|---|---|---|---|
| 1 | Bygg, typekontroll og alle sjekker grønne | **Oppfylt så langt** | `npm run verify` → exit 0. Gjelder det som er bygget |
| 2 | Starter på Railway med tom database | **Delvis** | Selvoppsett mot tom database er bevist lokalt. Selve Railway-deployen er ikke kjørt |
| 3 | Hver modul demonstrerbar med frødata | **Ikke oppfylt** | Frødata finnes for skjelettet. Modulene i fase 2–4 er ikke bygget |
| 4 | Hver integrasjon viser ærlig «ikke konfigurert» | **Oppfylt** | Alle fire navngir nøyaktig hvilke nøkler som mangler |
| 5 | Bevist at ingenting kan sendes ved et uhell | **Oppfylt for det som finnes** | 0 av 6 kanaler slått på. Cron tørrkjører som standard. Idempotens avviser duplikat |
| 6 | Guardrails testet med bruddforsøk | **Delvis** | Helg, rød dag, natt, idempotens og volum er testet. Sperrelister og oppvarming mangler, fordi reglene bygges i fase 2–3 |
| 7 | Manuell liste komplett og prøvd fra tom mappe | **Ikke oppfylt** | Listen finnes, men er ikke prøvd fra tom mappe av noen andre enn meg |
| 8 | Ingen funn av BLOKKERER eller HØY | **Oppfylt for denne runden** | F-001 og F-002 lukket. Se `docs/status.md` |

**Ingen av kriteriene kan kalles endelig oppfylt før fase 5**, fordi de avhenger av
moduler som ennå ikke er bygget. Dette dokumentet skal oppdateres etter hver runde — ikke
ved slutten.
