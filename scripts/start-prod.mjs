/**
 * Oppstart i produksjon.
 *
 * Rekkefølgen er viktig:
 *
 *   1. Migreringer kjøres. Feiler de, starter vi ikke — et halvferdig skjema er
 *      verre enn ingen tjeneste.
 *   2. Serveren startes på Railways PORT.
 *
 * Skjemaet setter seg selv opp. Se docs/stoppkriterier.md, kriterium 2.
 *
 * Ingen hemmeligheter skrives ut her. Feilmeldinger fra Prisma kan inneholde
 * vertsnavn, men aldri passord.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Laster .env lokalt. På Railway finnes ikke filen, og variablene kommer fra
// tjenestens egne innstillinger. dotenv feiler stille hvis filen mangler.
import "dotenv/config";

const PORT = process.env.PORT ?? "3000";

function kjør(kommando, args, ekstraEnv = {}) {
  return new Promise((resolve, reject) => {
    const barn = spawn(kommando, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...ekstraEnv },
    });

    barn.on("error", reject);
    barn.on("close", (kode) => {
      if (kode === 0) resolve();
      else reject(new Error(`${kommando} avsluttet med kode ${kode}`));
    });
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL mangler. Sett den i Railway under Variables. Se docs/manuell-oppsett.md, del C1.",
    );
    process.exit(1);
  }

  console.log("Kjører migreringer …");
  try {
    await kjør("npx", ["prisma", "migrate", "deploy"]);
    console.log("Migreringer fullført.");
  } catch (feil) {
    console.error("Migrering feilet:", feil.message);
    console.error("Tjenesten starter ikke. Se docs/manuell-oppsett.md, del E.");
    process.exit(1);
  }

  const nodeBin = process.execPath;
  // fileURLToPath gir riktig sti på Windows. `new URL(...).pathname` gir «/C:/…»,
  // som blir «C:\C:\…» når den brukes videre. Det feilet vi på én gang.
  const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

  console.log(`Starter VikingPilot på port ${PORT} …`);

  const server = spawn(nodeBin, [nextBin, "start", "-p", String(PORT), "-H", "0.0.0.0"], {
    stdio: "inherit",
    env: process.env,
  });

  server.on("close", (kode) => process.exit(kode ?? 0));

  // Railway sender SIGTERM ved omstart. Vi avslutter ryddig, slik at
  // pågående databasespørringer ikke kappes.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      console.log(`Mottok ${signal}, avslutter …`);
      server.kill(signal);
    });
  }
}

main().catch((feil) => {
  console.error("Oppstart feilet:", feil.message);
  process.exit(1);
});
