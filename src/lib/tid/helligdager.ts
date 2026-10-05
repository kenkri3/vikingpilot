/**
 * Norske helligdager.
 *
 * Utsendingsvakten skal ikke sende på røde dager. Det er en deterministisk regel,
 * og den hører i kode — ikke i en prompt. Se docs/spesifikasjon.md, bøtte 1.
 *
 * Vi regner ut helligdagene i stedet for å slå dem opp eksternt, slik at
 * systemet virker uten nettverk.
 */

/**
 * Beregner datoen for første påskedag (påskedag, søndag) med Gauss' algoritme
 * i Meeus' form. Gyldig for alle år i den gregorianske kalenderen.
 */
export function forstePaskedag(aar: number): Date {
  const a = aar % 19;
  const b = Math.floor(aar / 100);
  const c = aar % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const maaned = Math.floor((h + l - 7 * m + 114) / 31);
  const dag = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(aar, maaned - 1, dag));
}

/** Legger til et antall dager på en dato, uten å påvirke klokkeslettet. */
function leggTilDager(dato: Date, dager: number): Date {
  const kopi = new Date(dato.getTime());
  kopi.setUTCDate(kopi.getUTCDate() + dager);
  return kopi;
}

/** Formaterer en dato som YYYY-MM-DD i UTC. */
export function datoNokkel(dato: Date): string {
  const aar = dato.getUTCFullYear();
  const maaned = String(dato.getUTCMonth() + 1).padStart(2, "0");
  const dag = String(dato.getUTCDate()).padStart(2, "0");
  return `${aar}-${maaned}-${dag}`;
}

export type Helligdag = {
  dato: string;
  navn: string;
};

/**
 * Alle norske helligdager for et år.
 *
 * Faste dager, pluss de bevegelige som følger av påsken.
 * Merk: 1. og 17. mai er helligdager. 17. mai er det selv om den faller på en
 * søndag — den er like fullt en rød dag.
 */
export function helligdagerForAar(aar: number): Helligdag[] {
  const paske = forstePaskedag(aar);

  const liste: Helligdag[] = [
    { dato: `${aar}-01-01`, navn: "Første nyttårsdag" },
    { dato: datoNokkel(leggTilDager(paske, -3)), navn: "Skjærtorsdag" },
    { dato: datoNokkel(leggTilDager(paske, -2)), navn: "Langfredag" },
    { dato: datoNokkel(paske), navn: "Første påskedag" },
    { dato: datoNokkel(leggTilDager(paske, 1)), navn: "Andre påskedag" },
    { dato: `${aar}-05-01`, navn: "Arbeidernes dag" },
    { dato: `${aar}-05-17`, navn: "Grunnlovsdagen" },
    { dato: datoNokkel(leggTilDager(paske, 39)), navn: "Kristi himmelfartsdag" },
    { dato: datoNokkel(leggTilDager(paske, 49)), navn: "Første pinsedag" },
    { dato: datoNokkel(leggTilDager(paske, 50)), navn: "Andre pinsedag" },
    { dato: `${aar}-12-25`, navn: "Første juledag" },
    { dato: `${aar}-12-26`, navn: "Andre juledag" },
  ];

  return liste.sort((a, b) => a.dato.localeCompare(b.dato));
}

/**
 * Slår opp helligdager for et år, med mellomlagring.
 * Utsendingsvakten kalles ofte, og dette er ren beregning.
 */
const hurtiglager = new Map<number, Map<string, string>>();

function helligdagKart(aar: number): Map<string, string> {
  const lagret = hurtiglager.get(aar);
  if (lagret) return lagret;

  const kart = new Map<string, string>();
  for (const h of helligdagerForAar(aar)) {
    kart.set(h.dato, h.navn);
  }

  hurtiglager.set(aar, kart);
  return kart;
}

/** Er datoen en norsk helligdag? */
export function erHelligdag(dato: Date): boolean {
  return helligdagKart(dato.getUTCFullYear()).has(datoNokkel(dato));
}

/** Henter navnet på helligdagen, eller null. */
export function helligdagNavn(dato: Date): string | null {
  return helligdagKart(dato.getUTCFullYear()).get(datoNokkel(dato)) ?? null;
}

/** Er datoen lørdag eller søndag? */
export function erHelg(dato: Date): boolean {
  const dag = dato.getUTCDay();
  return dag === 0 || dag === 6;
}

/** Er datoen en virkedag — altså hverken helg eller helligdag? */
export function erHverdag(dato: Date): boolean {
  return !erHelg(dato) && !erHelligdag(dato);
}

/** Tømmer mellomlageret. Brukes av tester. */
export function nullstillHelligdagHurtiglager(): void {
  hurtiglager.clear();
}
