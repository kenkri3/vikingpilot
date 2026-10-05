# Import av kontakter

Enhetsregisteret oppgir virksomheter, ikke personer eller e-postadresser. Uansett hvor
kontaktene kommer fra — et CRM-eksport, en liste fra et webinar, eller noe Kenneth har
samlet selv — må de inn i systemet på én måte. Det er denne.

---

## Kommandoen

```powershell
cd C:\VikingPilot

# 1. Se hva som ville skjedd. Ingenting lagres.
npm run kontakt:import -- --fil kontakter.csv --grunnlag "Meldt på webinar 12.03.2026"

# 2. Lagre.
npm run kontakt:import -- --fil kontakter.csv --grunnlag "Meldt på webinar 12.03.2026" --ekte
```

**Tørrkjøring er standard.** Du må skrive `--ekte` for at noe skal lagres. Det er med vilje:
en import er vanskelig å angre, fordi du ikke uten videre vet hvilke rader som var nye.

På Railway gjør du det samme fra **Shell**-fanen på app-tjenesten.

---

## Formatet

Filen er en vanlig CSV. Første linje er overskrifter. Komma og semikolon går like bra —
norsk Excel bruker semikolon.

### Påkrevde kolonner

| Kolonne | Betydning |
|---|---|
| `fornavn` | Også `firstname`, `first name` |
| `etternavn` | Også `lastname`, `last name` |
| `epost` | Også `e-post`, `email`, `mail` |

### Valgfrie kolonner

| Kolonne | Betydning |
|---|---|
| `telefon` | Også `tlf`, `phone`, `mobil` |
| `rolle` | Også `stilling`, `tittel`, `title` |
| `orgnr` | Ni siffer. Mellomrom går bra: `123 456 789` |
| `organisasjon` | Firmanavn, hvis du ikke har orgnr |
| `beslutningstaker` | `ja`, `nei`, `true`, `1`, `x` |
| `samtykke` | Hvorfor dere har lov til å lagre opplysningene |
| `notat` | Fritekst |
| `linkedin` | Profil-URL |

### Eksempel

```csv
fornavn,etternavn,epost,rolle,orgnr,beslutningstaker,samtykke
Kari,Nordmann,kari@firma.no,Daglig leder,123456789,ja,"Meldt på webinar 12.03.2026"
Ola,Hansen,ola@annet.no,IT-sjef,,nei,"Meldt på webinar 12.03.2026"
```

---

## Hvordan en kontakt kobles til et selskap

Rekkefølgen er valgt med vilje, fra sikrest til svakest:

1. **Organisasjonsnummer.** Entydig, kan ikke tolkes feil.
2. **E-postdomenet** mot selskapets nettside. `kari@firma.no` kobles til selskapet med
   `firma.no` som nettside.
3. **Navnet**, men bare ved **ett entydig treff** på normalisert navn. Heter to selskaper
   det samme, kobler vi ikke i det hele tatt — å koble en kontakt til feil selskap er verre
   enn å ikke koble den.

Finner vi ingen organisasjon, lagres kontakten **uten** selskap. Den går ikke tapt, og den
vises i oppsummeringen som «uten organisasjon». Legg til et orgnr i filen og kjør igjen.

> **Merk:** Enhetsregisteret oppgir ikke `fylke` eller `antallAnsatte` for de fleste
> virksomheter. Det er ikke en feil i importen, men i kilden.

---

## Personvern

E-postadresser er personopplysninger. Derfor:

- Har filen en `samtykke`-kolonne, brukes den.
- Har den ikke det, **må** du oppgi `--grunnlag "hvorfor"`. Importen nekter ellers.
- Grunnlaget lagres på hver kontakt, sammen med datoen det ble registrert.
- `samtykkeDato` settes én gang. Kjører du filen på nytt, står datoen stille — den viser når
  grunnlaget ble registrert, ikke når filen sist ble lest.

**Vi gjetter ikke på hvorfor vi har lov til å lagre opplysningene.**

Vil du slette en kontakt, gjør du det direkte i databasen. Sletting fjerner også
vedkommendes sperreoppføringer og dialoger gjennom databasens egne regler. Revisjonsloggen
beholdes — den skal ikke kunne endres.

---

## Hva importen avviser

Importen er streng med vilje. En kontakt vi ikke kan kontakte, er bare en personopplysning
vi ikke har nytte av.

| Situasjon | Hva som skjer |
|---|---|
| Mangler fornavn eller etternavn | Avvises |
| Mangler e-postadresse | Avvises |
| E-postadressen ser ugyldig ut | Avvises |
| Organisasjonsnummer er ikke ni siffer | Avvises |
| Samme adresse to ganger i filen | Den siste brukes, og den første varsles om |
| Mangler samtykkegrunnlag | Avvises, og hele importen stopper |

**Én avvist rad stopper ikke resten.** Du får en liste over hva som ble avvist og hvorfor,
med linjenummer.

---

## Er den trygg å kjøre flere ganger?

Ja. Samme fil to ganger gir samme resultat: kontakter som finnes oppdateres, de dupliseres
ikke. Prøvd: første kjøring opprettet 3, andre kjøring opprettet 0 og oppdaterte 3. Antallet
i basen sto stille på 3.

---

## Etter importen

Kontaktene finnes nå, men de er ikke i noen sekvens ennå. Sekvensmotoren kobler kontakter
til prospekter når den kjører:

```powershell
npm run sjekkliste
```

Den viser hvor mange prospekter som fortsatt står uten kontakt. Står det fortsatt et høyt
tall, er det fordi prospektene gjelder andre selskaper enn dem kontaktene hører til.

**Og ingenting sendes.** All utgående trafikk er av, og går bare gjennom godkjenningskøen
når den først er slått på.
