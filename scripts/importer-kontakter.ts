/**
 * Importerer kontakter fra en CSV-fil.
 *
 * BRUK:
 *   npm run kontakt:import -- --fil kontakter.csv
 *   npm run kontakt:import -- --fil kontakter.csv --grunnlag "Meldt på webinar 12.03.2026"
 *   npm run kontakt:import -- --fil kontakter.csv --ekte
 *
 * TØRRKJØRING ER STANDARD. Du må skrive --ekte for at noe skal lagres.
 *
 * PERSONVERN: e-postadresser er personopplysninger. Har ikke filen en kolonne for
 * samtykkegrunnlag, må du oppgi --grunnlag. Vi gjetter ikke på hvorfor vi har lov
 * til å lagre dem.
 *
 * Se docs/import-av-kontakter.md for formatet på filen.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";

import { importerKontakter, erImportFeil } from "../src/lib/kontakter/import.ts";
import { lukkDatabase } from "../src/lib/db.ts";

function lesArg(navn: string): string | undefined {
  const indeks = process.argv.indexOf(`--${navn}`);
  return indeks >= 0 ? process.argv[indeks + 1] : undefined;
}

function harFlagg(navn: string): boolean {
  return process.argv.includes(`--${navn}`);
}

async function hoved(): Promise<void> {
  const fil = lesArg("fil");

  if (!fil) {
    console.error("Mangler --fil.");
    console.error("");
    console.error("  npm run kontakt:import -- --fil kontakter.csv");
    console.error("");
    console.error("Se docs/import-av-kontakter.md for hvilke kolonner filen må ha.");
    process.exit(2);
  }

  let innhold: string;

  try {
    innhold = readFileSync(fil, "utf8");
  } catch {
    console.error(`Fant ikke filen «${fil}».`);
    process.exit(2);
  }

  const torrkjoering = !harFlagg("ekte");
  const grunnlag = lesArg("grunnlag");

  console.log(`Leser ${fil}`);
  console.log(torrkjoering ? "TØRRKJØRING — ingenting lagres.\n" : "EKTE KJØRING — dette lagres.\n");

  const resultat = await importerKontakter(innhold, {
    torrkjoering,
    samtykkeGrunnlag: grunnlag,
    kilde: fil,
  });

  console.log(`Lest:            ${resultat.lest} rad(er)`);
  console.log(`Gyldige:         ${resultat.gyldige}`);
  console.log(`  opprettes:     ${resultat.opprettet}`);
  console.log(`  oppdateres:    ${resultat.oppdatert}`);
  console.log(`Uten organisasjon: ${resultat.utenOrganisasjon}`);
  console.log(`Avvist:          ${resultat.feil.length}`);

  if (resultat.feil.length > 0) {
    console.log("\nAvviste rader:");

    for (const f of resultat.feil.slice(0, 25)) {
      console.log(`  linje ${f.linje}: ${f.grunn}`);
      if (f.rad.length < 90) console.log(`    ${f.rad}`);
    }

    if (resultat.feil.length > 25) {
      console.log(`  … og ${resultat.feil.length - 25} til.`);
    }
  }

  if (resultat.utenOrganisasjon > 0) {
    console.log(
      `\nMerk: ${resultat.utenOrganisasjon} kontakt(er) ble ikke koblet til en organisasjon.`,
    );
    console.log("De lagres likevel, men uten selskap. Legg til et orgnr i filen for å koble dem.");
  }

  if (torrkjoering) {
    console.log("\nIngenting er lagret. Kjør med --ekte for å lagre.");
  } else {
    console.log("\nFerdig. Importen er skrevet til revisjonsloggen.");
  }
}

hoved()
  .catch((feil) => {
    if (erImportFeil(feil)) {
      console.error(`\nImporten stoppet: ${feil.message}`);

      for (const f of feil.feil.slice(0, 10)) {
        console.error(`  linje ${f.linje}: ${f.grunn}`);
      }

      if (feil.feil.length > 10) console.error(`  … og ${feil.feil.length - 10} til.`);
    } else {
      console.error("Feilet:", feil instanceof Error ? feil.message : feil);
    }

    process.exitCode = 1;
  })
  .finally(async () => {
    await lukkDatabase();
  });
