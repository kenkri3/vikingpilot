/**
 * Databaseklient.
 *
 * Prisma 7 krever en driver-adapter. Tilkoblingsadressen kommer fra miljøvariabelen
 * DATABASE_URL — aldri hardkodet, og aldri logget.
 *
 * Denne filen er det eneste stedet i systemet som oppretter en databaseforbindelse.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Leser DATABASE_URL og kaster en forståelig feil hvis den mangler.
 * Vi logger aldri adressen — den inneholder passord.
 */
function lesDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url || url.trim() === "") {
    throw new Error(
      "DATABASE_URL mangler. Sett den i .env lokalt, eller i Railway under Variables. " +
        "Se docs/manuell-oppsett.md, del C1.",
    );
  }

  return url;
}

/**
 * I utvikling skal Next.js laste modulen på nytt ved hver endring. Uten denne
 * globale mellomlagringen ville hver omlasting åpnet et nytt forbindelsespool.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function opprettKlient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: lesDatabaseUrl() });

  return new PrismaClient({
    adapter,
    log: process.env.LOGG_NIVAA === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export const prisma = globalForPrisma.prisma ?? opprettKlient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Lukker forbindelsen. Brukes av skript og tester som skal avslutte ryddig. */
export async function lukkDatabase(): Promise<void> {
  await prisma.$disconnect();
}
