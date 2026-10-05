# Manuell oppsettliste

Dette er listen du ba om: **nøyaktig hva du skal legge inn og sette opp, og ingenting
annet.** Alt annet skal systemet gjøre selv.

Tre deler:

- **Del A** — lokalt byggemiljø (gjøres én gang, på maskinen din)
- **Del B** — Railway (gjøres én gang, i nettleseren)
- **Del C** — variabler, med en tabell du fyller ut

Regler som gjelder hele listen:

- **Aldri lim inn en hemmelighet i et repo, i en commit, i en chat eller i en logg.**
  Hemmeligheter legges inn i Railway-variabler og i din lokale `.env`, som er ignorert av git.
- Der det står *valgfritt*, kan du hoppe over det. Systemet sier ærlig «ikke konfigurert»
  og virker ellers.
- Alle kommandoer under kjøres i **PowerShell**.

---

# Del A — Lokalt byggemiljø

## A1. Byggerot

Prosjektet ligger på `C:\VikingPilot`. Dette er ikke et valg — Google Drive-stien
`G:\Min disk` kan ikke brukes til å bygge. Målingen står i `LAGT-TIL-GRUNN.md` A-001.

Kildekoden speiles til `G:\Min disk\GitHub\Vikingpilot` så du fortsatt har den i Google
Drive. Speilingen utelater `node_modules`, `.next` og `.tools`.

**Du gjør ingenting her.** Dette er allerede satt opp.

---

## A2. PostgreSQL lokalt

Du valgte Postgres som Windows-tjeneste. Registreringen krever forhøyede rettigheter, så
denne delen må du kjøre selv.

### A2.1 Åpne et forhøyet PowerShell-vindu

Trykk **Start**, skriv `PowerShell`, høyreklikk på **Windows PowerShell**, velg
**Kjør som administrator**. Svar **Ja** på spørsmålet fra Windows.

### A2.2 Last ned og pakk ut Postgres 17.6

Lim inn hele blokken. Den laster ned de offisielle binærfilerne (330 MB) og pakker dem ut.

```powershell
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path 'C:\pgsql', 'C:\VikingPilotBuild' | Out-Null

$zip = 'C:\VikingPilotBuild\pg-binaries.zip'
curl.exe -L -o $zip 'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip'
Write-Host "Lastet ned: $((Get-Item $zip).Length) byte"

Expand-Archive -Path $zip -DestinationPath 'C:\VikingPilotBuild\pg' -Force
Move-Item 'C:\VikingPilotBuild\pg\pgsql\*' 'C:\pgsql' -Force
Write-Host "Postgres ligger i C:\pgsql"
& 'C:\pgsql\bin\postgres.exe' --version
```

**Forventet resultat:** den siste linjen skriver `postgres (PostgreSQL) 17.6`.

> Hvis nedlastingen skriver 0 byte, er grunnen at målet ligger på Google Drive. Sørg for at
> `$zip` peker på `C:\`, ikke på `G:\`.

### A2.3 Opprett dataklusteren

```powershell
$pgdata = 'C:\pgsql\data'
New-Item -ItemType Directory -Force -Path $pgdata | Out-Null

# Velg et passord for superbrukeren 'postgres'. Skriv det ned et trygt sted.
$pw = Read-Host 'Velg passord for postgres-brukeren' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))

$pwFile = 'C:\VikingPilotBuild\pw.txt'
Set-Content -Path $pwFile -Value $plain -NoNewline -Encoding ascii

& 'C:\pgsql\bin\initdb.exe' -D $pgdata -U postgres --pwfile=$pwFile -E UTF8 --locale=Norwegian_Norway.1252

Remove-Item $pwFile -Force
Remove-Variable plain, pw
Write-Host 'Dataklusteren er opprettet.'
```

**Forventet resultat:** `Success. You can now start the database server using: …`

> Passordfilen slettes umiddelbart etterpå. Passordet skal ikke ligge på disk.

### A2.4 Registrer Postgres som Windows-tjeneste

```powershell
& 'C:\pgsql\bin\pg_ctl.exe' register -N 'postgresql-17' -D 'C:\pgsql\data' -S auto
Start-Service 'postgresql-17'
Get-Service 'postgresql-17' | Select-Object Name, Status, StartType
```

**Forventet resultat:**

```
Name           Status StartType
----           ------ ---------
postgresql-17 Running Automatic
```

`StartType = Automatic` betyr at Postgres starter av seg selv når maskinen slås på.

### A2.5 Opprett databasen

```powershell
$env:PGPASSWORD = Read-Host 'Passordet du valgte i A2.3' -AsSecureString |
  ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }

& 'C:\pgsql\bin\createdb.exe' -U postgres -h localhost vikingpilot
& 'C:\pgsql\bin\psql.exe' -U postgres -h localhost -c '\l' | Select-String vikingpilot
Remove-Item Env:\PGPASSWORD
```

**Forventet resultat:** en linje som inneholder `vikingpilot`.

**Ferdig.** Databasen kjører som tjeneste og starter av seg selv.

---

## A3. Lokal `.env`

Opprett filen `C:\VikingPilot\.env`. Den er ignorert av git og skal **aldri** committes.

Innhold — bytt ut `DITT_PASSORD`:

```dotenv
DATABASE_URL="postgresql://postgres:DITT_PASSORD@localhost:5432/vikingpilot?schema=public"
```

Resten av variablene fyller du ut i Del C. **Du trenger ikke gjøre det nå** — systemet
starter uten dem og sier ærlig hva som mangler.

---

## A4. Node-avhengigheter

```powershell
cd C:\VikingPilot
npm install
```

Kjøres på `C:`. **Aldri** fra `G:`.

---

## A5. Port 3000 er opptatt på denne maskinen

**Dette er målt, ikke antatt.** Da jeg skulle starte systemet, svarte port 3000 med
404 på `/api/helse`. Årsaken var en helt annen tjeneste:

```
Port 3000 → PID 11656
"node" "...\OneDrive\AIChat Norge AS\Vikingent\Tønsberglivet\node_modules\.bin\..\next\dist\bin\next" start
```

Det kjører altså et Next.js-prosjekt fra OneDrive på port 3000. **Jeg rørte den ikke.**

VikingPilot bruker derfor **port 3100** lokalt:

```powershell
$env:PORT = "3100"
npm run start:prod
```

Åpne [http://localhost:3100](http://localhost:3100).

På Railway spiller dette ingen rolle — der setter Railway `PORT` selv, og hver tjeneste
får sin egen. Konflikten finnes bare på denne maskinen.

**Vil du heller bruke 3000**, må Tønsberglivet-tjenesten stoppes først. Det er din
beslutning, ikke min — den tilhører et annet prosjekt.

---

# Del B — Railway

Du trenger en Railway-konto. Alt under gjøres i nettleseren.

## B1. Opprett prosjektet

1. Gå til [railway.com](https://railway.com) og logg inn.
2. **New Project** → **Deploy from GitHub repo**.
3. Velg VikingPilot-repoet. *(Se B4 hvis repoet ikke ligger på GitHub ennå.)*
4. Railway oppdager `Dockerfile` og `railway.json` automatisk.

## B2. Legg til Postgres

1. I prosjektet: **New** → **Database** → **Add PostgreSQL**.
2. Vent til tjenesten er grønn.
3. Klikk på Postgres-tjenesten → **Variables** → kopier verdien `DATABASE_URL`.
4. Gå tilbake til app-tjenesten → **Variables** → legg inn `DATABASE_URL` med den verdien.

> Bruk `DATABASE_URL` fra Postgres-tjenesten. Den inneholder passordet, og Railway fyller
> den ut selv. Ikke skriv den for hånd.

## B3. Generer hemmelighetene

Kjør dette lokalt og lim inn i Railway. **Ikke** legg resultatet i repoet.

```powershell
1..6 | ForEach-Object { -join ((48..57) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ }) }
```

Du får seks tilfeldige strenger. De skal brukes til:

| Streng | Variabel |
|---|---|
| 1 | `SESSION_SECRET` |
| 2 | `CRON_SECRET_ENHETSREGISTER` |
| 3 | `CRON_SECRET_SEKVENS` |
| 4 | `CRON_SECRET_UTSENDING` |
| 5 | `CRON_SECRET_OPPVARMING` |
| 6 | `CRON_SECRET_RYDDING` |

Hver cron-jobb har sin egen hemmelighet. Mister én av dem, slutter bare den ene jobben å
virke — ikke alle.

## B4. Hvis repoet ikke er på GitHub

Kjør lokalt fra `C:\VikingPilot`:

```powershell
git init
git add .
git commit -m "VikingPilot: skjelett"
git remote add origin https://github.com/DITT_BRUKERNAVN/vikingpilot.git
git push -u origin main
```

Sjekk at `.env` **ikke** er med i `git status` før du committer. Den skal være utelatt.

## B5. Variabler som må inn i Railway

Se Del C. Legg dem inn under **Variables** på app-tjenesten.

## B6. Slå på utgående trafikk

**Ikke gjør dette før systemet kjører og du har sett dashbordet.**

Dette er bryteren for at noe i det hele tatt kan gå ut. Den er av fra første migrasjon.
Settes per kanal, og først når du har bestemt deg:

| Variabel | Standard | Betydning |
|---|---|---|
| `UTGAAENDE_EPOST_AKTIVERT` | `false` | Setter `true` gjør at e-post kan sendes — men bare gjennom godkjenningskøen |

> Selv med denne satt til `true` går ingenting ut uten at noen har godkjent det i køen.
> Bryteren er et ekstra gjerde, ikke hovedgjerde.

---

# Del C — Variabler

## C1. Påkrevd for at systemet starter

| Variabel | Hvor finnes den | Lokalt | Railway |
|---|---|---|---|
| `DATABASE_URL` | A3 lokalt, B2 på Railway | ☐ | ☐ |
| `SESSION_SECRET` | B3, streng 1 | ☐ | ☐ |

Uten disse to starter ikke systemet. Det sier det tydelig i stedet for å feile uforståelig.

## C2. Cron-hemmeligheter

Hver rute har sin egen. Se B3.

| Variabel | Jobb | Lokalt | Railway |
|---|---|---|---|
| `CRON_SECRET_ENHETSREGISTER` | Henter nye selskaper | ☐ | ☐ |
| `CRON_SECRET_SEKVENS` | Kjører sekvensmotoren | ☐ | ☐ |
| `CRON_SECRET_UTSENDING` | Sender godkjente meldinger | ☐ | ☐ |
| `CRON_SECRET_OPPVARMING` | Justerer oppvarmingskvote | ☐ | ☐ |
| `CRON_SECRET_RYDDING` | Rydder og arkiverer | ☐ | ☐ |

> Mangler én, feiler **bare** den jobben, med en tydelig melding i dashbordet. Det er med
> vilje: én manglende nøkkel skal ikke ta ned hele tidsplanen.

## C3. Integrasjoner — alle valgfrie

Hver av disse har en ærlig «ikke konfigurert»-tilstand. Systemet virker uten dem.

### Enhetsregisteret

**Ingen nøkkel trengs.** Enhetsregisteret er et åpent API fra Brønnøysundregistrene.
Dette er verifisert ved å kalle det uten autentisering — det svarte HTTP 200 med ekte data.

| Variabel | Beskrivelse | Lokalt | Railway |
|---|---|---|---|
| `ENHETSREGISTERET_BASE_URL` | *Valgfritt.* Peker på et annet endepunkt, f.eks. et lokalt testoppsett. Tom = det offisielle, åpne API-et | ☐ | ☐ |
| `ENHETSREGISTERET_API_KEY` | *Valgfritt og normalt unødvendig.* Sendes som Bearer-header hvis den er satt | ☐ | ☐ |

**Du trenger ikke gjøre noe her.** Pipelinen henter fra det åpne API-et uten konfigurasjon.

### E-post

| Variabel | Beskrivelse | Lokalt | Railway |
|---|---|---|---|
| `EPOST_KANAL` | `smtp` eller `api`. Se S1 i `docs/aapne-sporsmal.md` | ☐ | ☐ |
| `SMTP_HOST` | Postserver | ☐ | ☐ |
| `SMTP_PORT` | Som regel `587` | ☐ | ☐ |
| `SMTP_BRUKER` | Brukernavn | ☐ | ☐ |
| `SMTP_PASSORD` | Passord. **Hemmelig** | ☐ | ☐ |
| `EPOST_FRA_ADRESSE` | Avsenderadresse | ☐ | ☐ |
| `EPOST_FRA_NAVN` | Avsendernavn, f.eks. `Vikingnet` | ☐ | ☐ |
| `EPOST_SVAR_TIL` | Svar-til-adresse | ☐ | ☐ |
| `UTGAAENDE_EPOST_AKTIVERT` | `false` som standard. Se B6 | ☐ | ☐ |

Uten disse: utsendingsvakten sier «ikke konfigurert», og **ingenting sendes**. Det er
standardtilstanden, og den er trygg.

### VikingCRM

| Variabel | Beskrivelse | Lokalt | Railway |
|---|---|---|---|
| `VIKINGCRM_WEBHOOK_URL` | Adresse vi sender hendelser til | ☐ | ☐ |
| `VIKINGCRM_WEBHOOK_SECRET` | Signerer forespørsler. **Hemmelig** | ☐ | ☐ |
| `VIKINGCRM_INNKOMMENDE_SECRET` | Verifiserer det vi mottar | ☐ | ☐ |

Uten disse: systemet viser «ikke konfigurert» og sender ingen hendelser. **VikingCRM i
produksjon røres ikke** — vi snakker bare med den.

### Agentplattformen

Omtales aldri ved produktnavn i kode eller dokumentasjon. Variablene er nøytrale med vilje.

| Variabel | Beskrivelse | Lokalt | Railway |
|---|---|---|---|
| `AGENT_WEBHOOK_URL` | Adresse for utgående hendelser | ☐ | ☐ |
| `AGENT_WEBHOOK_SECRET` | Signerer forespørsler. **Hemmelig** | ☐ | ☐ |
| `AGENT_INNKOMMENDE_SECRET` | Verifiserer innkommende kall | ☐ | ☐ |
| `MCP_ENDPOINT_STI` | *Valgfritt.* Sti for verktøyflaten | ☐ | ☐ |

## C4. Drift

| Variabel | Standard | Beskrivelse | Lokalt | Railway |
|---|---|---|---|---|
| `TIDSONE` | `Europe/Oslo` | Grunnlag for tidsvinduer og røde dager | ☐ | ☐ |
| `LOGG_NIVAA` | `info` | `debug` gir mer | ☐ | ☐ |
| `RATE_LIMIT_PER_MINUTT` | `60` | Tak per IP på åpne endepunkter | ☐ | ☐ |
| `STANDARD_TØRRKJØRING` | `true` | Alle sendende ruter tørrkjører med mindre annet sies | ☐ | ☐ |
| `PORT` | settes av Railway | Ikke rør | — | — |

---

# Del D — Kontroll at det virker

Kjør i `C:\VikingPilot`:

```powershell
npm run verify      # bygg, typekontroll, tester
npm run sjekkliste  # ende-til-ende, uten nettverk

# Start systemet. Port 3100 fordi 3000 er opptatt, se A5.
$env:PORT = "3100"
npm run start:prod
```

Åpne [http://localhost:3100](http://localhost:3100). Du skal se dashbordet med fire felt:

1. **Hva kjører** — cron-jobber og siste kjøring
2. **Hva venter på meg** — godkjenningskøen
3. **Hva feilet** — feilede jobber, med årsak
4. **Hva mangler konfigurasjon** — hver integrasjon som ikke er satt opp, og hvilken
   variabel som mangler

Felt 4 skal være **ærlig**. Ser du «ikke konfigurert» der, virker systemet som det skal.

---

# Del E — Feilsøking

| Symptom | Årsak | Løsning |
|---|---|---|
| `npm install` gir 0-byte filer | Du kjører på `G:` | Bytt til `C:\VikingPilot`. Se A-001 |
| `spawn powershell.exe ENOENT` | Skallet er nede | Start DSH på nytt |
| `Can't reach database server` | Postgres-tjenesten kjører ikke | `Start-Service postgresql-17` |
| `password authentication failed` | Feil passord i `DATABASE_URL` | Sjekk `.env` mot passordet fra A2.3 |
| `relation does not exist` | Migrering ikke kjørt | `npx prisma migrate deploy` |
| Dashbordet viser «ikke konfigurert» overalt | Ingen variabler satt | Riktig oppførsel. Fyll ut Del C |

---

# Del F — Det du ikke skal gjøre

- **Ikke** rør `Vikingnet`-repoet. Det er Firebase, og skal ikke migreres.
- **Ikke** endre VikingCRM i produksjon. Vi snakker med den via webhook.
- **Ikke** rør kunders nettsider.
- **Ikke** lim inn hemmeligheter i en chat, et issue eller en commit.
- **Ikke** slå på `UTGAAENDE_EPOST_AKTIVERT` før du har sett dashbordet og forstått køen.
- **Ikke** bytt byggerot tilbake til `G:`.
