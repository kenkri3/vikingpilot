# LAGT-TIL-GRUNN — påkrevde avvik fra oppdraget

Dette dokumentet finnes fordi oppdraget har en regel som sier at jeg skal rette egne feil
høyt, og en som sier at jeg ikke skal gjøre endringer ingen ba om. Når de to kolliderer,
skriver jeg avviket ned her i stedet for å skjule det.

Hvert avvik har: hva oppdraget sa, hva jeg gjorde, **hvorfor**, og hva du kan gjøre med det.

---

## A-001 — Byggeroten er flyttet fra `G:` til `C:`

**Oppdraget sa:** «Sti: [ny mappe]», med arbeidsmappen oppgitt som
`G:\Min disk\GitHub\Vikingpilot`.

**Hva jeg gjorde:** Opprettet `C:\VikingPilot` som arbeidskopi. Kildekoden speiles tilbake
til `G:\Min disk\GitHub\Vikingpilot`.

**Hvorfor — målt, ikke antatt:**

| Funn | Bevis |
|---|---|
| `G:` er Google Drive for Desktop | `Win32_LogicalDisk G:` → `DriveType 3`, `FileSystem FAT32`, `VolumeName "Google Drive"` |
| npm skriver 0-byte filer på `G:` og kaller det suksess | `npm install ms@2.1.3` → «added 1 package in 9s», men `ms/index.js` var **0 byte**, `package.json` **0 byte**, og `npm ls` svarte `ms@ invalid` |
| Full Next.js-scaffold feiler på `G:` | `create-next-app` → `npm error code EBADF`, `tar TAR_ENTRY_ERROR UNKNOWN: unknown error, write` |
| Hardlink/junction er umulig på `G:` | `mklink /J` → «Local NTFS volumes are required to complete the operation» |
| Store nedlastinger feiler på `G:` | 330 MB Postgres-nedlasting skrev **0 byte**, `Invoke-WebRequest` avbrøt etter 1019 sekunder |

**Hvorfor dette ikke kunne løses på annen måte:** Det er ikke en innstilling. Google Drives
virtuelle filsystem støtter ikke filoperasjonene npm trenger. Det finnes ingen
konfigurasjon av npm, pnpm eller Next.js som gjør `G:` brukbar.

**Hvorfor jeg ikke bare bygget videre på `G:` likevel:** Fordi feilmodusen er *stille*.
npm rapporterte suksess. En 0-byte `node_modules` ville gitt feil som ser ut som
kodefeil, og jeg ville brukt runder på å feilsøke noe som ikke var koden. Det bryter
stoppkriterium 1 og 3, og det bryter regelen om å verifisere det som faktisk kjører.

**Hva du kan gjøre:**
- Godta `C:\VikingPilot` som byggerot, med speiling til Google Drive. *(anbefalt)*
- Be meg legge prosjektet et annet sted på lokal disk.
- Be meg bruke `G:` likevel — men da kan jeg ikke bygge, teste eller verifisere noe, og
  systemet kan ikke bli «100 % ferdig» etter din egen definisjon.

**Merk:** Ingen kode var skrevet da dette ble oppdaget. Arbeidsmappen var tom — verifisert,
antall filer 0. Det er ingenting å migrere, og ingenting av ditt er endret.

---

## A-002 — `docs/spesifikasjon.md` fantes ikke, og er skrevet av meg

**Oppdraget sa:** «Kravspesifikasjon: docs/spesifikasjon.md (min eksisterende master-prompt)».

**Hva jeg fant:** Filen finnes ikke. Jeg lette i:
- `G:\Min disk\GitHub\Vikingpilot` — tom mappe, 0 filer
- `G:\Min disk\GitHub\Vikingnet`, `VikingCode`, `Anbudspilot` — ingen treff
- `C:\Users\glosl\Downloads`, `Desktop`, `Documents` — ingen treff
- `~/.claude`, `~/.cursor`, `%APPDATA%\Claude`, `G:\.claude`, `G:\.cursor` — finnes ikke

**Hva jeg gjorde:** Skrev `docs/spesifikasjon.md` fra oppdragsbeskrivelsen, med
bøtte-1/bøtte-2-tabellen som du ba om. Du godkjente dette på forhånd blant de fire
valgene i fase 0.

**Hvorfor jeg ikke gjettet på innholdet i din versjon:** Fordi jeg ikke kan lese et
dokument som ikke finnes, og et oppdiktet innhold ville sett autoritativt ut samtidig som
det var feil. Det er verre enn et ærlig tomrom.

**Hva du bør gjøre:** Les `docs/spesifikasjon.md` og se om den stemmer med det du mente.
Den er ment å bli erstattet av din egen tekst hvis du har den. Lim den inn, og jeg retter
planen etter den.

---

## A-003 — Tidsboksen er ikke oppgitt, og jeg har ikke satt en

**Oppdraget sa:** «Tidsboks: [maks antall runder, eller maks antall timer]» — feltet står
igjen som en plassholder.

**Hva jeg gjorde:** Satte et tak på 12 runder på det vedvarende målet, som en
forholdsregel mot å pushe endringer ingen har sett. Det er **min** antakelse, ikke din
beslutning.

**Hvorfor jeg ikke bare valgte et tall og lot som det var ditt:** Fordi tidsboksen er din
styringsmekanisme. Et tall jeg finner på, gir deg falsk trygghet om at noen har bestemt
noe.

**Hva du kan gjøre:** Si et tall — runder eller timer — og jeg justerer målet.

---

## A-004 — Postgres-tjenesten er ikke registrert

**Oppdraget sa (via ditt valg):** «Installer Postgres som Windows-tjeneste».

**Hva jeg gjorde:** Lastet ned de offisielle binærfilerne fra EnterpriseDB (lenkene er
verifisert: alle svarer HTTP 200). Registrerte **ikke** tjenesten.

**Hvorfor ikke:** `pg_ctl register` krever forhøyede rettigheter. Denne økten kjørte uten
admin — verifisert:
`([Security.Principal.WindowsPrincipal]…).IsInRole(Administrator)` → `False`. I tillegg
døde skallet før nedlastingen fullførte, så ingen binærfiler er pakket ut ennå.

**Hva du kan gjøre:** Følg `docs/manuell-oppsett.md` avsnitt «Postgres lokalt». Der står
den nøyaktige kommandoen som skal kjøres i et forhøyet ledetekst-vindu. Det er ett klikk
og én lim-inn-linje.

---

## A-005 — Jeg konkluderte feil: «miljøet er nede» var en feildiagnose

**Dette avviket er min egen feil, og det står her fordi oppdragets regel 5 sier at jeg skal
rette egne feil høyt.**

**Hva jeg rapporterte i runde 1:** At skallet var dødt, at `grep` og `glob` var døde, og at
jeg derfor ikke kunne bygge, teste eller verifisere noe som helst. Jeg kalte det
«BLOKKERER» og ba deg starte DSH og Google Drive på nytt.

**Hva som faktisk var tilfellet:** Skallet virket hele tiden. Det feilet bare fordi
arbeidsverktøyet startet prosessen *inne i* den utilgjengelige stien
`G:\Min disk\GitHub\Vikingpilot`. Så snart jeg sendte med en arbeidsmappe på `C:`, svarte
skallet umiddelbart. Det samme gjaldt `grep` og `glob`.

**Bevis:**

```
pwsh, uten workdir:  spawn C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe ENOENT
pwsh, workdir C:\VikingPilot:  shell alive from C:   →   Path: C:\VikingPilot
```

**Hva jeg burde gjort:** Testet den ene hypotesen «kanskje det er arbeidsmappen og ikke
skallet» før jeg erklærte en blokkering. Det var én ekstra linje. I stedet brukte jeg en
hel runde på en feil konklusjon, og jeg ba deg om å gjøre unødvendig arbeid.

**Konsekvens for deg:** Du trenger **ikke** starte DSH eller Google Drive på nytt. Rådet i
runde 1 var feil.

**Hva som fortsatt står:** A-001 (byggeroten) er uendret og godt begrunnet — `G:` skriver
faktisk 0-byte filer. Det var den ene sanne delen av runde 1, og den er målt, ikke gjettet.

**Lærdom som er ført inn i planen:** Når noe ser ut som en miljøfeil, skal jeg teste den
minst invasive hypotesen først — her: at det er arbeidsmappen, ikke skallet.
