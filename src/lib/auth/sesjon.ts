/**
 * Sesjoner: signert cookie med HMAC-SHA256.
 *
 * Ingen eksterne avhengigheter. Se docs/beslutninger.md B-008.
 *
 * Cookien inneholder `<sesjonId>.<signatur>`. Signaturen dekker sesjonId, slik
 * at en angriper ikke kan bytte ut id-en uten å kjenne SESSION_SECRET.
 *
 * Selve sesjonen ligger i databasen og kan trekkes tilbake umiddelbart.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE_NAVN = "vikingpilot_sesjon";

/** Sesjonen varer i 12 timer. */
const LEVETID_MS = 12 * 60 * 60 * 1000;

function hentHemmelighet(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.trim().length < 32) {
    throw new Error(
      "SESSION_SECRET mangler eller er for kort. Den må være minst 32 tegn. " +
        "Generer med: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
        "Se docs/manuell-oppsett.md, del B3.",
    );
  }

  return secret;
}

/** Genererer en ny tilfeldig sesjonstoken. */
export function lagSesjonstoken(): string {
  return randomBytes(32).toString("hex");
}

/** Signerer en sesjonstoken med SESSION_SECRET. */
export function signer(sesjonstoken: string): string {
  return createHmac("sha256", hentHemmelighet()).update(sesjonstoken).digest("hex");
}

/**
 * Verifiserer en signert cookieverdi.
 * Returnerer sesjonstokenet hvis signaturen er gyldig, ellers null.
 */
export function verifiserSignertCookie(verdi: string | undefined): string | null {
  if (!verdi) return null;

  const skille = verdi.lastIndexOf(".");
  if (skille <= 0) return null;

  const token = verdi.slice(0, skille);
  const gittSignatur = verdi.slice(skille + 1);

  let forventet: string;
  try {
    forventet = signer(token);
  } catch {
    return null;
  }

  const a = Buffer.from(gittSignatur, "hex");
  const b = Buffer.from(forventet, "hex");

  if (a.length !== b.length || a.length === 0) return null;

  return timingSafeEqual(a, b) ? token : null;
}

/** Når en ny sesjon skal utløpe. */
export function utloeperTid(): Date {
  return new Date(Date.now() + LEVETID_MS);
}

/**
 * Setter sesjonscookien.
 *
 * httpOnly hindrer JavaScript i å lese den. sameSite=lax hindrer at en annen
 * side kan bruke den. secure settes når vi kjører over HTTPS.
 */
export async function settSesjonscookie(token: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAVN, `${token}.${signer(token)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(LEVETID_MS / 1000),
  });
}

/** Fjerner sesjonscookien. */
export async function fjernSesjonscookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAVN);
}

/** Leser og verifiserer sesjonstokenet fra cookien. */
export async function lesSesjonstoken(): Promise<string | null> {
  const cookieStore = await cookies();
  return verifiserSignertCookie(cookieStore.get(COOKIE_NAVN)?.value);
}
