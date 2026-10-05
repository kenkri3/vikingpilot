/**
 * Innlogging.
 *
 * E-post og passord i databasen, scrypt og signert cookie. Ingen eksterne
 * tjenester. Se docs/beslutninger.md B-008.
 */

import { prisma } from "@/lib/db";
import { verifiserPassord } from "@/lib/auth/passord";
import { lagSesjonstoken, lesSesjonstoken, utloeperTid } from "@/lib/auth/sesjon";
import { logg } from "@/lib/logg";

export type InnloggetBruker = {
  id: string;
  epost: string;
  navn: string;
  rolle: string;
};

/**
 * Logger inn en bruker.
 *
 * Returnerer en generisk feilmelding ved feil — vi røper aldri om det var
 * e-posten eller passordet som var galt.
 */
export async function loggInn(
  epost: string,
  passord: string,
  ip?: string,
): Promise<{ ok: true; token: string } | { ok: false; melding: string }> {
  const normalisert = epost.trim().toLowerCase();

  const bruker = await prisma.bruker.findUnique({ where: { epost: normalisert } });

  if (!bruker || !bruker.aktiv) {
    // Vi hasher ikke her engang — det ville lekket tid.
    logg.advarsel("Innloggingsforsøk avvist", { grunn: "ukjent_eller_inaktiv", ip });
    return { ok: false, melding: "Feil e-post eller passord." };
  }

  const riktig = await verifiserPassord(passord, bruker.passordHash);

  if (!riktig) {
    logg.advarsel("Innloggingsforsøk avvist", { grunn: "feil_passord", ip });
    return { ok: false, melding: "Feil e-post eller passord." };
  }

  const token = lagSesjonstoken();

  await prisma.sesjon.create({
    data: {
      token,
      brukerId: bruker.id,
      utloeper: utloeperTid(),
      ip: ip ?? null,
    },
  });

  await prisma.bruker.update({
    where: { id: bruker.id },
    data: { sistInnlogget: new Date() },
  });

  // Revisjonsloggen: innlogging er en handling med ekstern konsekvens.
  await prisma.revisjon.create({
    data: {
      handling: "INNLOGGING",
      aktor: bruker.epost,
      aktorType: "BRUKER",
      entitet: "Bruker",
      entitetId: bruker.id,
      resultat: "GODKJENT",
      resultatStatus: "ok",
      kilde: "innlogging",
      ip: ip ?? null,
    },
  });

  logg.info("Innlogging", { bruker: bruker.epost });

  return { ok: true, token };
}

/** Henter den innloggede brukeren, eller null. */
export async function hvemErInnlogget(): Promise<InnloggetBruker | null> {
  const token = await lesSesjonstoken();
  if (!token) return null;

  const sesjon = await prisma.sesjon.findUnique({
    where: { token },
    include: { bruker: true },
  });

  if (!sesjon) return null;

  if (sesjon.utloeper.getTime() < Date.now()) {
    await prisma.sesjon.delete({ where: { id: sesjon.id } }).catch(() => undefined);
    return null;
  }

  if (!sesjon.bruker.aktiv) return null;

  return {
    id: sesjon.bruker.id,
    epost: sesjon.bruker.epost,
    navn: sesjon.bruker.navn,
    rolle: sesjon.bruker.rolle,
  };
}

/** Logger ut ved å slette sesjonen. */
export async function loggUt(): Promise<void> {
  const token = await lesSesjonstoken();
  if (!token) return;

  await prisma.sesjon.deleteMany({ where: { token } });
  logg.info("Utlogging");
}
