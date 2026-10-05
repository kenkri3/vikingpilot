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

## Kriterium 7 — prøvd fra tom mappe

Dette er **kjørt**, ikke bare skrevet ned. Runden gjorde følgende på denne maskinen:

```powershell
& "$pg\dropdb.exe"  -h localhost -p 5432 -U postgres --if-exists vikingpilot
& "$pg\createdb.exe" -h localhost -p 5432 -U postgres vikingpilot
# Bekreftet tom: SELECT count(*) FROM information_schema.tables WHERE table_schema='public'  ->  0

cd C:\VikingPilot
npm run db:migrate    # 2 migreringer anvendt. exit 0
npm run db:seed       # 8 frødatagrupper. exit 0
npm run verify        # exit 0, 133 tester
npm run sjekkliste    # 51 bestått, 0 feilet
```

**Resultat:** 32 tabeller, 6 kanaler (alle av), 2 brukere, 5 cron-jobber, 4 integrasjoner,
1 målgruppe, 6 oppvarmingstrinn. Systemet kom opp fra ingenting med de kommandoene som
faktisk står i `docs/manuell-oppsett.md`.

Etterpå ble pipelinen kjørt på nytt, og ga nøyaktig samme resultat som før slettingen:
hentet 200, godkjent 13, opprettet 13. Det bekrefter at kjøringen er gjentakbar og ikke
avhenger av rester fra tidligere kjøringer.

**Hva som ennå ikke er gjort for dette kriteriet:** det er jeg som har kjørt listen, ikke
Kenneth eller Fredrik. Kriteriet sier at listen skal være «prøvd», og det er oppfylt i
bokstavelig forstand — men en ekte prøve er at noen andre følger den uten hjelp. Det står
som åpent punkt nedenfor.

---

## Kriterium 8 — åpne funn

`docs/status.md` føres løpende. Per nå står ingen funn med alvor BLOKKERER eller HØY
åpent. Funn 001 til 018 er enten lukket eller nedgradert med skriftlig begrunnelse.

Uavhengig etterkontroll av en annen agent ble startet i denne runden. Resultatet føres inn
i `docs/status.md` når det foreligger.

---

## Ærlig status per nå

Etter runde 6 (fase 5, første del).

| # | Kriterium | Status | Merknad |
|---|---|---|---|
| 1 | Bygg, typekontroll og alle sjekker grønne | **Oppfylt** | `npm run verify` → exit 0, 133 tester |
| 2 | Starter på Railway med tom database | **Delvis** | Selvoppsett mot tom database er bevist lokalt, fra 0 tabeller. Selve Railway-deployen er ikke kjørt — den krever Kenneths konto |
| 3 | Hver modul demonstrerbar med frødata | **Oppfylt** | Sjekkelisten dekker alle ni moduler og kjører uten nettverk |
| 4 | Hver integrasjon viser ærlig «ikke konfigurert» | **Oppfylt** | Alle fire navngir nøyaktig hvilke nøkler som mangler |
| 5 | Bevist at ingenting kan sendes ved et uhell | **Oppfylt** | 0 av 6 kanaler slått på. Etter hele kjeden: 0 utsendinger. Cron tørrkjører som standard |
| 6 | Guardrails testet med bruddforsøk | **Oppfylt** | 133 tester, hvorav svært mange er aktive bruddforsøk mot hver guardrail |
| 7 | Manuell liste komplett og prøvd fra tom mappe | **Delvis** | Kjørt fra tom database av meg. Ikke prøvd av Kenneth eller Fredrik |
| 8 | Ingen funn av BLOKKERER eller HØY | **Delvis** | Ingen åpne nå. Uavhengig etterkontroll pågår |

**Det som gjenstår er i hovedsak utenfor min rekkevidde:** Railway-deployen krever din
konto, og en ekte prøve av den manuelle listen krever at noen andre enn jeg følger den.

**Ett kriterium fortjener en presisering.** Kriterium 3 sier at hver modul skal kunne
demonstreres med frødata. Det er oppfylt — men Enhetsregister-pipelinen henter ekte data,
og de 13 prospektene i basen er ekte norske virksomheter, ikke frødata. Det er strengt tatt
bedre enn kravet, men det betyr også at sjekkelisten må tåle at innholdet varierer. Den
gjør det: den sjekker invarianter, ikke bestemte rader.
