/**
 * Passordhashing med scrypt fra Nodes innebygde crypto.
 *
 * Ingen eksterne avhengigheter. Se docs/beslutninger.md B-008.
 *
 * Formatet på hashen er `scrypt$N$r$p$salt$hash`, slik at vi kan endre
 * parametrene senere uten å miste gamle passord.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  passord: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Kostnadsparametere. N=16384 er en fornuftig avveining mellom tid og minne. */
const N = 16_384;
const r = 8;
const p = 1;
const KEYLEN = 64;
const SALTLEN = 16;

/**
 * maxmem må settes eksplisitt: scrypt krever omtrent 128*N*r byte, og Nodes
 * standardgrense på 32 MB er for lav for N=16384.
 */
const MAXMEM = 128 * N * r * 2;

export type PassordHash = {
  hash: string;
  salt: string;
};

/** Lager et tilfeldig salt. */
export function lagSalt(): string {
  return randomBytes(SALTLEN).toString("hex");
}

/**
 * Hasher et passord med et gitt salt.
 * Returnerer den fulle hash-strengen inkludert parametrene.
 */
export async function hashPassord(passord: string, salt?: string): Promise<PassordHash> {
  const bruktSalt = salt ?? lagSalt();
  const utledet = await scrypt(passord.normalize("NFKC"), bruktSalt, KEYLEN, {
    N,
    r,
    p,
    maxmem: MAXMEM,
  });

  return {
    hash: `scrypt$${N}$${r}$${p}$${bruktSalt}$${utledet.toString("hex")}`,
    salt: bruktSalt,
  };
}

/**
 * Verifiserer et passord mot en lagret hash.
 *
 * Sammenligningen skjer i konstant tid, slik at svartiden ikke røper hvor mye
 * av hashen som var riktig.
 */
export async function verifiserPassord(passord: string, lagretHash: string): Promise<boolean> {
  const deler = lagretHash.split("$");

  if (deler.length !== 6 || deler[0] !== "scrypt") {
    return false;
  }

  const [, nStr, rStr, pStr, salt, forventetHex] = deler;
  const forventet = Buffer.from(forventetHex, "hex");

  try {
    const utledet = await scrypt(passord.normalize("NFKC"), salt, forventet.length, {
      N: Number.parseInt(nStr, 10),
      r: Number.parseInt(rStr, 10),
      p: Number.parseInt(pStr, 10),
      maxmem: MAXMEM,
    });

    if (utledet.length !== forventet.length) {
      return false;
    }

    return timingSafeEqual(utledet, forventet);
  } catch {
    return false;
  }
}

/**
 * Sjekker styrken på et passord. Returnerer en liste med grunner til at det
 * ikke godtas — tom liste betyr godkjent.
 */
export function sjekkPassordstyrke(passord: string): string[] {
  const grunner: string[] = [];

  if (passord.length < 12) {
    grunner.push("Passordet må være minst 12 tegn.");
  }
  if (!/[a-zæøå]/.test(passord)) {
    grunner.push("Passordet må inneholde en liten bokstav.");
  }
  if (!/[A-ZÆØÅ]/.test(passord)) {
    grunner.push("Passordet må inneholde en stor bokstav.");
  }
  if (!/[0-9]/.test(passord)) {
    grunner.push("Passordet må inneholde et tall.");
  }

  return grunner;
}
