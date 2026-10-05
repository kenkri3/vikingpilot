/**
 * Oppvarmingsplan.
 *
 * Modul 4, bøtte 1. Et nytt avsenderdomene som plutselig sender 200 meldinger
 * om dagen blir behandlet som søppelpost. Kvoten skal derfor vokse gradvis.
 *
 * Planen er data i `Oppvarmingssteg`, ikke kode. Kenneth og Fredrik kan endre
 * kurven uten at noen skriver kode.
 *
 * Regelen er deterministisk: kvoten er `maksPerDag` i det høyeste trinnet der
 * `dagFraStart` er mindre enn eller lik antall dager siden oppstart.
 */

import { prisma } from "@/lib/db";
import { norskTid } from "@/lib/tid/vinduer";

export type OppvarmingsSvar = {
  /** Sann hvis avsenderen får sende nå. */
  tillatt: boolean;
  grunn: string;
  /** Dag nummer i oppvarmingsperioden. 0 er første dag. */
  dag: number;
  /** Kvoten som gjelder i dag. */
  kvoteIDag: number;
  /** Neste trinn, hvis det finnes flere. */
  nesteTrinn: { dagFraStart: number; maksPerDag: number } | null;
  /** Er avsenderen ferdig oppvarmet? */
  ferdigOppvarmet: boolean;
};

/**
 * Antall hele dager mellom to tidspunkt, regnet i norske døgn.
 *
 * Vi sammenligner datonøkler i stedet for millisekunder. Da blir «dag 3» det
 * samme som et menneske ville kalt dag 3, uansett sommertid.
 */
export function dagerSiden(start: Date, naa: Date): number {
  const startNorsk = norskTid(start);
  const naaNorsk = norskTid(naa);

  const a = Date.UTC(startNorsk.aar, startNorsk.maaned - 1, startNorsk.dag);
  const b = Date.UTC(naaNorsk.aar, naaNorsk.maaned - 1, naaNorsk.dag);

  return Math.floor((b - a) / 86_400_000);
}

/**
 * Regner ut kvoten for en gitt dag, ut fra trinnene.
 *
 * Er det ingen trinn, sier vi nei. En manglende oppvarmingsplan skal ikke
 * betyde «slipp gjennom» — det er den ene feilen som ville skadet domenet vårt.
 */
export function kvoteForDag(
  dag: number,
  trinn: { dagFraStart: number; maksPerDag: number }[],
): { kvote: number; neste: { dagFraStart: number; maksPerDag: number } | null } {
  if (trinn.length === 0) {
    return { kvote: 0, neste: null };
  }

  const sortert = [...trinn].sort((a, b) => a.dagFraStart - b.dagFraStart);

  let kvote = 0;
  let neste: { dagFraStart: number; maksPerDag: number } | null = null;

  for (const t of sortert) {
    if (t.dagFraStart <= dag) {
      kvote = t.maksPerDag;
    } else {
      neste = t;
      break;
    }
  }

  return { kvote, neste };
}

/**
 * Sjekker oppvarmingskvoten for en avsender.
 *
 * Er `oppvarmingAktiv` av på kanalen, eller er avsenderen merket som AKTIV,
 * gjelder den vanlige døgnkvoten i stedet.
 */
export async function sjekkOppvarming(
  avsenderId: string,
  naa: Date = new Date(),
): Promise<OppvarmingsSvar> {
  const avsender = await prisma.avsender.findUnique({ where: { id: avsenderId } });

  if (!avsender) {
    return {
      tillatt: false,
      grunn: "Avsenderen finnes ikke.",
      dag: 0,
      kvoteIDag: 0,
      nesteTrinn: null,
      ferdigOppvarmet: false,
    };
  }

  // En avsender som er satt til AKTIV av et menneske, er ferdig oppvarmet.
  if (avsender.status === "AKTIV") {
    return {
      tillatt: true,
      grunn: "Avsenderen er merket som aktiv. Oppvarmingsplanen gjelder ikke.",
      dag: 0,
      kvoteIDag: avsender.maksPerDag,
      nesteTrinn: null,
      ferdigOppvarmet: true,
    };
  }

  // Er oppvarming ikke startet, har vi ingen dag å regne fra.
  if (!avsender.oppvarmingStartDato) {
    // Er avsenderen merket OPPVARMING uten startdato, nekter vi. Å gjette en
    // startdato ville gitt en kvote vi ikke kan begrunne.
    if (avsender.status === "OPPVARMING") {
      return {
        tillatt: false,
        grunn:
          "Avsenderen er satt til oppvarming, men mangler startdato. Sett oppvarmingStartDato før noe sendes.",
        dag: 0,
        kvoteIDag: 0,
        nesteTrinn: null,
        ferdigOppvarmet: false,
      };
    }

    return {
      tillatt: true,
      grunn: "Ingen oppvarmingsplan er aktiv for denne avsenderen.",
      dag: 0,
      kvoteIDag: avsender.maksPerDag,
      nesteTrinn: null,
      ferdigOppvarmet: true,
    };
  }

  const dag = dagerSiden(avsender.oppvarmingStartDato, naa);

  // Trinn som gjelder denne avsenderen, pluss de globale (avsenderId = null).
  const trinn = await prisma.oppvarmingssteg.findMany({
    where: { OR: [{ avsenderId }, { avsenderId: null }] },
    select: { dagFraStart: true, maksPerDag: true, avsenderId: true },
    orderBy: { dagFraStart: "asc" },
  });

  // Foretrekk avsenderspesifikke trinn hvis de finnes.
  const egne = trinn.filter((t) => t.avsenderId === avsenderId);
  const valgte = egne.length > 0 ? egne : trinn.filter((t) => t.avsenderId === null);

  if (dag < 0) {
    return {
      tillatt: false,
      grunn: "Oppstartsdatoen ligger i fremtiden. Rett datoen før noe sendes.",
      dag,
      kvoteIDag: 0,
      nesteTrinn: null,
      ferdigOppvarmet: false,
    };
  }

  const { kvote, neste } = kvoteForDag(dag, valgte);

  if (valgte.length === 0) {
    return {
      tillatt: false,
      grunn: "Ingen oppvarmingsplan er satt opp. Ingen utsending er tillatt.",
      dag,
      kvoteIDag: 0,
      nesteTrinn: null,
      ferdigOppvarmet: false,
    };
  }

  // Når er planen FERDIG, altså når slipper avsenderen oppvarmingen helt?
  //
  // Det er ikke nok at det ikke finnes et neste trinn. En avsenderspesifikk plan
  // kan slutte på dag 0 — da ville «ingen neste trinn» betydd «ferdig oppvarmet»
  // allerede fra dag 1, og døgnkvoten ville sluppet til for fullt. Det er en
  // fail-open-feil, og den ble funnet ved å prøve en plan med ett enkelt trinn.
  //
  // Regelen er derfor: planen er ferdig først når vi har passert det SISTE
  // trinnet i den. Fram til da gjelder trinnets kvote.
  const sisteStegDag = Math.max(...valgte.map((t) => t.dagFraStart));
  // Oppvarmingen er ferdig først når planen er ute OG kvoten vi står på er minst
  // like høy som avsenderens egen døgnkvote. Ellers ville en plan med ett trinn
  // på dag 0 opphevet seg selv fra dag 1 — det er fail-open, og vi fant det ved
  // å prøve nettopp en slik plan.
  const planenErUte = neste === null && dag >= sisteStegDag;
  const ferdigOppvarmet = planenErUte && kvote >= avsender.maksPerDag;

  return {
    tillatt: kvote > 0,
    grunn:
      kvote > 0
        ? `Dag ${dag} i oppvarmingen. Kvoten er ${kvote} meldinger.${neste ? ` Dag ${neste.dagFraStart} øker den til ${neste.maksPerDag}.` : ""}`
        : `Dag ${dag} i oppvarmingen har kvote 0. Ingen utsending er tillatt.`,
    dag,
    kvoteIDag: kvote,
    nesteTrinn: neste,
    ferdigOppvarmet,
  };
}

/**
 * Den effektive døgnkvoten for en avsender: den laveste av
 * oppvarmingskvoten og avsenderens egen døgnkvote.
 *
 * Vi tar den laveste, ikke den høyeste. Begge grensene skal gjelde samtidig.
 */
export async function effektivDognkvote(
  avsenderId: string,
  naa: Date = new Date(),
): Promise<{ kvote: number; grunn: string }> {
  const avsender = await prisma.avsender.findUnique({ where: { id: avsenderId } });

  if (!avsender) {
    return { kvote: 0, grunn: "Avsenderen finnes ikke." };
  }

  const oppvarming = await sjekkOppvarming(avsenderId, naa);

  if (!oppvarming.tillatt) {
    return { kvote: 0, grunn: oppvarming.grunn };
  }

  if (oppvarming.ferdigOppvarmet) {
    return { kvote: avsender.maksPerDag, grunn: `Døgnkvoten er ${avsender.maksPerDag}.` };
  }

  const kvote = Math.min(oppvarming.kvoteIDag, avsender.maksPerDag);

  return {
    kvote,
    grunn: `Effektiv kvote er ${kvote}: den laveste av oppvarmingskvoten (${oppvarming.kvoteIDag}) og døgnkvoten (${avsender.maksPerDag}).`,
  };
}
