/**
 * Oppretter eller oppdaterer en bruker.
 *
 * HVORFOR DENNE FINNES:
 * `prisma db seed` lager brukere bare hvis SEED_PASSORD er satt, og den kjører
 * ikke i produksjonsbildet i det hele tatt. På Railway fantes det derfor ingen
 * vei til å få en konto — og uten konto kommer du ikke inn på dashbordet.
 *
 * Passordet skrives ikke ut og havner ikke i loggen. Det hashes med scrypt, med
 * samme kode som innloggingen bruker, så vi vet at det virker.
 *
 * BRUK:
 *   npm run bruker:lag -- --epost kenneth@vikingnet.no --navn "Kenneth Kristiansen"
 *
 * Passordet spørres om og vises ikke på skjermen. Kjører du på Railway, gjør det
 * fra tjenestens Shell-fane.
 */

import "dotenv/config";
import { createInterface } from "node:readline";

import { åpneKlient } from "./grunndata.mjs";

function lesArg(navn) {
  const indeks = process.argv.indexOf(`--${navn}`);
  return indeks >= 0 ? process.argv[indeks + 1] : undefined;
}

/** Leser et passord uten å vise det på skjermen. */
function spørOmPassord(spørsmål) {
  return new Promise((løs) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    // Skjul det som skrives.
    const skriv = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (tekst) => {
      if (tekst.includes("\n") || tekst.includes("\r")) skriv?.(tekst);
    };

    rl.question(spørsmål, (svar) => {
      rl.close();
      process.stdout.write("\n");
      løs(svar);
    });
  });
}

async function hoved() {
  const epost = (lesArg("epost") ?? "").trim().toLowerCase();
  const navn = (lesArg("navn") ?? "").trim();

  if (!epost || !epost.includes("@")) {
    console.error("Mangler eller ugyldig --epost.");
    console.error('Eksempel: npm run bruker:lag -- --epost kenneth@vikingnet.no --navn "Kenneth Kristiansen"');
    process.exit(2);
  }

  if (!navn) {
    console.error("Mangler --navn. Det brukes i revisjonsloggen, så det må være et ekte navn.");
    process.exit(2);
  }

  // Passordet kan komme fra miljøet, for automatisering. Ellers spør vi.
  let passord = process.env.BRUKER_PASSORD ?? "";

  if (!passord) {
    if (!process.stdin.isTTY) {
      console.error("Ingen terminal, og BRUKER_PASSORD er ikke satt.");
      console.error("Sett BRUKER_PASSORD midlertidig, eller kjør kommandoen i en terminal.");
      process.exit(2);
    }

    passord = await spørOmPassord(`Passord for ${epost}: `);
    const gjentatt = await spørOmPassord("Gjenta passordet: ");

    if (passord !== gjentatt) {
      console.error("Passordene er ikke like.");
      process.exit(1);
    }
  }

  // Bruk NØYAKTIG samme styrkesjekk og hashing som innloggingen bruker.
  const { hashPassord, sjekkPassordstyrke } = await import("../src/lib/auth/passord.ts");

  const svakheter = sjekkPassordstyrke(passord);

  if (svakheter.length > 0) {
    console.error("Passordet er ikke sterkt nok:");
    for (const s of svakheter) console.error(`  - ${s}`);
    process.exit(1);
  }

  const prisma = await åpneKlient();

  try {
    const { hash } = await hashPassord(passord);

    const eksisterende = await prisma.bruker.findUnique({ where: { epost } });

    if (eksisterende) {
      await prisma.bruker.update({
        where: { epost },
        data: { navn, passordHash: hash, aktiv: true },
      });

      // Gamle sesjoner må dø når passordet byttes.
      const slettet = await prisma.sesjon.deleteMany({ where: { brukerId: eksisterende.id } });

      console.log(`Oppdaterte ${epost}. ${slettet.count} sesjon(er) ble avsluttet.`);

      await prisma.revisjon.create({
        data: {
          handling: "BRUKER_PASSORD_ENDRET",
          aktor: epost,
          aktorType: "BRUKER",
          entitet: "Bruker",
          entitetId: eksisterende.id,
          grunnlag: "Passord satt på nytt fra kommandolinjen.",
          resultat: "Passordet er endret",
          resultatStatus: "ok",
          kilde: "scripts/bruker.mjs",
        },
      });
    } else {
      const opprettet = await prisma.bruker.create({
        data: { epost, navn, passordHash: hash, passordSalt: "se-hash", rolle: "BRUKER" },
      });

      console.log(`Opprettet ${epost} (${navn}).`);

      await prisma.revisjon.create({
        data: {
          handling: "BRUKER_OPPRETTET",
          aktor: epost,
          aktorType: "BRUKER",
          entitet: "Bruker",
          entitetId: opprettet.id,
          grunnlag: "Opprettet fra kommandolinjen.",
          resultat: "Brukeren er opprettet",
          resultatStatus: "ok",
          kilde: "scripts/bruker.mjs",
        },
      });
    }

    const antall = await prisma.bruker.count();
    console.log(`Det finnes nå ${antall} bruker(e). Logg inn på /login.`);
  } finally {
    await prisma.$disconnect();
  }
}

hoved().catch((feil) => {
  console.error("Feilet:", feil instanceof Error ? feil.message : feil);
  process.exit(1);
});
