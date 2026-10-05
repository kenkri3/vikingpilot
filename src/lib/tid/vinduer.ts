/**
 * Tidsvinduer.
 *
 * Utsendingsvakten slipper bare gjennom meldinger på hverdager, innenfor
 * tidsvinduet, og aldri på røde dager. Dette er deterministisk og hører i kode.
 *
 * Alt regnes i norsk tid, uansett hvilken tidssone serveren står i. Railway
 * kjører i UTC, så vi må være eksplisitte.
 */

import { erHelligdag, helligdagNavn } from "@/lib/tid/helligdager";

export type Tidsdel = {
  aar: number;
  maaned: number;
  dag: number;
  time: number;
  minutt: number;
  /** 0 = søndag, 1 = mandag, … 6 = lørdag. */
  ukedag: number;
  /** YYYY-MM-DD i norsk tid. */
  dato: string;
};

/**
 * Bryter ned et tidspunkt i norske deler.
 *
 * Vi bruker Intl med tidsone i stedet for å regne om manuelt, slik at
 * sommer- og vintertid håndteres riktig.
 */
export function norskTid(tidspunkt: Date, tidssone = "Europe/Oslo"): Tidsdel {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tidssone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const deler = formatter.formatToParts(tidspunkt);
  const hent = (type: string) => deler.find((d) => d.type === type)?.value ?? "";

  const aar = Number.parseInt(hent("year"), 10);
  const maaned = Number.parseInt(hent("month"), 10);
  const dag = Number.parseInt(hent("day"), 10);
  // Intl kan gi "24" for midnatt i enkelte miljøer. Normaliser til 0.
  const time = Number.parseInt(hent("hour"), 10) % 24;
  const minutt = Number.parseInt(hent("minutt"), 10) || Number.parseInt(hent("minute"), 10);

  const ukedagNavn = hent("weekday");
  const ukedagKart: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    aar,
    maaned,
    dag,
    time,
    minutt: Number.isFinite(minutt) ? minutt : 0,
    ukedag: ukedagKart[ukedagNavn] ?? 0,
    dato: `${aar}-${String(maaned).padStart(2, "0")}-${String(dag).padStart(2, "0")}`,
  };
}

/** Oversetter en YYYY-MM-DD-streng til en Date i UTC, for helligdagsøk. */
function datoTilUtc(dato: string): Date {
  const [aar, maaned, dag] = dato.split("-").map((d) => Number.parseInt(d, 10));
  return new Date(Date.UTC(aar!, (maaned ?? 1) - 1, dag ?? 1));
}

export type VinduKonfig = {
  /** Klokkeslett på formen «HH:MM». */
  start: string;
  slutt: string;
  kunHverdager: boolean;
  tidssone?: string;
};

export type VinduSvar = {
  aapen: boolean;
  /** Forklaring i klartekst. Brukes i dashbordet og i revisjonsloggen. */
  grunn: string;
};

function tilMinutter(klokke: string): number | null {
  const deler = klokke.split(":");
  if (deler.length !== 2) return null;

  const timer = Number.parseInt(deler[0]!, 10);
  const minutter = Number.parseInt(deler[1]!, 10);

  if (!Number.isFinite(timer) || !Number.isFinite(minutter)) return null;
  if (timer < 0 || timer > 23 || minutter < 0 || minutter > 59) return null;

  return timer * 60 + minutter;
}

/**
 * Er vinduet åpent på dette tidspunktet?
 *
 * Returnerer alltid en grunn, slik at revisjonsloggen kan vise *hvorfor* noe
 * ble stoppet eller sluppet gjennom.
 */
export function sjekkVindu(tidspunkt: Date, konfig: VinduKonfig): VinduSvar {
  const tidssone = konfig.tidssone ?? "Europe/Oslo";
  const naa = norskTid(tidspunkt, tidssone);
  const utcDato = datoTilUtc(naa.dato);

  if (konfig.kunHverdager) {
    if (naa.ukedag === 0 || naa.ukedag === 6) {
      return {
        aapen: false,
        grunn: `Helg (${naa.ukedag === 0 ? "søndag" : "lørdag"}).`,
      };
    }

    if (erHelligdag(utcDato)) {
      return {
        aapen: false,
        grunn: `Rød dag: ${helligdagNavn(utcDato)}.`,
      };
    }
  }

  const start = tilMinutter(konfig.start);
  const slutt = tilMinutter(konfig.slutt);

  if (start === null || slutt === null) {
    return {
      aapen: false,
      grunn: `Ugyldig tidsvindu («${konfig.start}»–«${konfig.slutt}»). Sending stanses til det er rettet.`,
    };
  }

  const naaMinutter = naa.time * 60 + naa.minutt;

  if (naaMinutter < start) {
    return {
      aapen: false,
      grunn: `Utenfor tidsvinduet. Klokka er ${klokke(naa.time, naa.minutt)} i ${tidssone}, vinduet åpner ${konfig.start}.`,
    };
  }

  if (naaMinutter >= slutt) {
    return {
      aapen: false,
      grunn: `Utenfor tidsvinduet. Klokka er ${klokke(naa.time, naa.minutt)} i ${tidssone}, vinduet stengte ${konfig.slutt}.`,
    };
  }

  return {
    aapen: true,
    grunn: `Innenfor tidsvinduet (${konfig.start}–${konfig.slutt}, ${tidssone}).`,
  };
}

function klokke(timer: number, minutter: number): string {
  return `${String(timer).padStart(2, "0")}:${String(minutter).padStart(2, "0")}`;
}

/**
 * Finner neste tidspunkt vinduet er åpent, fra og med `fra`.
 *
 * Brukes til å fortelle brukeren når noe tidligst kan sendes, i stedet for å
 * bare si nei.
 */
export function nesteAapning(fra: Date, konfig: VinduKonfig, maksDager = 14): Date | null {
  const tidssone = konfig.tidssone ?? "Europe/Oslo";
  const start = tilMinutter(konfig.start);
  if (start === null) return null;

  const naa = norskTid(fra, tidssone);
  const kandidat = new Date(fra.getTime());

  // Flytt framover i kvarter til vi finner et åpent vindu, eller gir opp.
  const grense = maksDager * 24 * 4;

  for (let i = 0; i < grense; i += 1) {
    if (sjekkVindu(kandidat, konfig).aapen) {
      return kandidat;
    }
    kandidat.setTime(kandidat.getTime() + 15 * 60 * 1000);
  }

  // Fant ingenting innenfor grensen. Returner starten på neste virkedag.
  void naa;
  return null;
}
