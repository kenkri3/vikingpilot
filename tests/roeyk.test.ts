/**
 * Røyktest: beviser at systemet faktisk virker, ikke bare at koden ser riktig ut.
 *
 * Denne testen krever en database. Er DATABASE_URL ikke satt, hopper den over
 * med en ærlig melding i stedet for å late som den passerte.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { prisma, lukkDatabase } from "../src/lib/db.ts";
import { integrasjonsstatus, STANDARD_TORRKJORING } from "../src/lib/config.ts";
import { vask } from "../src/lib/logg.ts";
import { hashPassord, verifiserPassord } from "../src/lib/auth/passord.ts";

const harDatabase = Boolean(process.env.DATABASE_URL);

describe("database", { skip: !harDatabase ? "DATABASE_URL mangler" : false }, () => {
  const orgnr = "999888777";

  before(async () => {
    await prisma.organisasjon.deleteMany({ where: { orgnr } });
  });

  after(async () => {
    await prisma.organisasjon.deleteMany({ where: { orgnr } });
    await lukkDatabase();
  });

  test("kan skrive og lese en organisasjon", async () => {
    const opprettet = await prisma.organisasjon.create({
      data: {
        orgnr,
        navn: "Testbedriften AS",
        normalisertNavn: "testbedriften as",
      },
    });

    assert.equal(opprettet.orgnr, orgnr);

    const lest = await prisma.organisasjon.findUnique({ where: { orgnr } });
    assert.ok(lest, "organisasjonen skal kunne leses tilbake");
    assert.equal(lest.navn, "Testbedriften AS");
  });

  test("avviser duplikat orgnr", async () => {
    await assert.rejects(
      () =>
        prisma.organisasjon.create({
          data: { orgnr, navn: "Duplikat AS", normalisertNavn: "duplikat as" },
        }),
      "orgnr skal være unikt",
    );
  });

  test("utgående er av som standard i KanalInnstilling", async () => {
    const kanaler = await prisma.kanalInnstilling.findMany();
    // Det skal ikke finnes noen kanal som er slått på uten at et menneske har gjort det.
    for (const kanal of kanaler) {
      assert.equal(
        kanal.utgaaendeAktivert,
        false,
        `kanal ${kanal.kanal} skal ikke være slått på automatisk`,
      );
    }
  });
});

describe("konfigurasjon", () => {
  test("integrasjoner rapporterer hva som mangler, ikke oppdiktede data", () => {
    const status = integrasjonsstatus();
    assert.ok(status.length >= 4, "alle fire integrasjoner skal beskrives");

    for (const integrasjon of status) {
      assert.equal(typeof integrasjon.konfigurert, "boolean");
      if (!integrasjon.konfigurert) {
        assert.ok(
          integrasjon.manglendeNokler.length > 0,
          `${integrasjon.navn} må navngi hvilke nøkler som mangler`,
        );
      }
    }
  });

  test("tørrkjøring er på som standard", () => {
    assert.equal(STANDARD_TORRKJORING(), true);
  });
});

describe("logging", () => {
  test("maskerer passord i tilkoblingsstrenger", () => {
    const vasket = vask("postgresql://postgres:hemmelig@localhost:5432/db") as string;
    assert.ok(!vasket.includes("hemmelig"), "passordet skal være borte");
    assert.ok(vasket.includes("[skjult]"), "passordet skal være erstattet");
  });

  test("maskerer felter som ser hemmelige ut", () => {
    const vasket = vask({ epost: "a@b.no", apiKey: "abc123", vanlig: "verdi" }) as Record<
      string,
      unknown
    >;
    assert.equal(vasket.apiKey, "[skjult]");
    assert.equal(vasket.epost, "a@b.no");
    assert.equal(vasket.vanlig, "verdi");
  });
});

describe("passord", () => {
  test("hash og verifiser rundtur", async () => {
    const { hash } = await hashPassord("RiktigHest12Batteri");
    assert.ok(await verifiserPassord("RiktigHest12Batteri", hash));
    assert.equal(await verifiserPassord("FeilPassord123", hash), false);
  });

  test("samme passord gir ulik hash hver gang", async () => {
    const a = await hashPassord("RiktigHest12Batteri");
    const b = await hashPassord("RiktigHest12Batteri");
    assert.notEqual(a.hash, b.hash, "salt skal gjøre hash-ene ulike");
  });
});
