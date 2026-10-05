/**
 * Cron-skjelettet og den globale sikringen mot gjetting.
 *
 * Bakgrunn: rate limiting per IP nøkler på `x-forwarded-for`, som kalleren selv
 * kan sette. Et script som sender et tilfeldig X-Forwarded-For per forespørsel
 * får dermed ubegrenset antall forsøk mot en cron-hemmelighet. Den globale
 * telleren ser ikke på hvem som spør, bare på hvor mange som har gjettet feil,
 * og kan derfor ikke lures på samme måte.
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  registrerFeilHemmelighet,
  forMangeFeilHemmelighet,
  nullstillFeilHemmelighet,
  sjekkHemmelighet,
  vilTorrkjoere,
} from "@/lib/cron/felles";

const NAVN = "TEST_CRON_HEMMELIGHET";

function lagRequest(headers: Record<string, string> = {}, query = ""): Request {
  return new Request(`http://localhost/api/cron/test${query}`, { headers });
}

describe("cron — hemmelighet og tørrkjøring", () => {
  beforeEach(() => {
    nullstillFeilHemmelighet();
    delete process.env[NAVN];
  });

  after(() => {
    nullstillFeilHemmelighet();
    delete process.env[NAVN];
  });

  test("manglende hemmelighet på serveren gir 503, ikke 401", () => {
    // 503 betyr «serveren er feilkonfigurert». 401 ville antydet at kalleren
    // gjorde noe galt, og det er ikke tilfelle.
    const svar = sjekkHemmelighet(lagRequest(), NAVN);
    assert.equal(svar.ok, false);
    assert.ok(!svar.ok);
    assert.equal(svar.status, 503);
    assert.match(svar.grunn, /ikke satt/);
  });

  test("feil hemmelighet gir 401", () => {
    process.env[NAVN] = "riktig-hemmelighet-som-er-lang-nok";

    const svar = sjekkHemmelighet(lagRequest({ authorization: "Bearer feil" }), NAVN);
    assert.ok(!svar.ok);
    assert.equal(svar.status, 401);
  });

  test("riktig hemmelighet slipper gjennom", () => {
    process.env[NAVN] = "riktig-hemmelighet-som-er-lang-nok";

    const svar = sjekkHemmelighet(
      lagRequest({ authorization: "Bearer riktig-hemmelighet-som-er-lang-nok" }),
      NAVN,
    );
    assert.equal(svar.ok, true);
  });

  test("tørrkjøring er standard, og krever eksplisitt false for ekte kjøring", () => {
    assert.equal(vilTorrkjoere(lagRequest()), true);
    assert.equal(vilTorrkjoere(lagRequest({}, "?torrkjoering=true")), true);
    assert.equal(vilTorrkjoere(lagRequest({}, "?torrkjoering=false")), false);
    assert.equal(vilTorrkjoere(lagRequest({}, "?torrkjoering=nei")), true, "bare «false» teller");
  });
});

describe("cron — global sikring mot gjetting", () => {
  beforeEach(() => {
    nullstillFeilHemmelighet();
  });

  after(() => {
    nullstillFeilHemmelighet();
  });

  test("under grensen er vi ikke sperret", () => {
    for (let i = 0; i < 19; i += 1) {
      registrerFeilHemmelighet();
    }

    const status = forMangeFeilHemmelighet();
    assert.equal(status.sperret, false, `sperret etter ${status.feil} feil`);
    assert.equal(status.feil, 19);
  });

  test("BRUDD: ved grensen sperres alle kall", () => {
    for (let i = 0; i < 20; i += 1) {
      registrerFeilHemmelighet();
    }

    const status = forMangeFeilHemmelighet();
    assert.equal(status.sperret, true, "20 feil sperret ikke");
    assert.equal(status.feil, 20);
  });

  test("BRUDD: sperren kan ikke omgås med en ny IP", () => {
    // Poenget med telleren: den ser ikke på hvem som spør. Vi simulerer
    // «forskjellige IP-er» ved å bare kalle registrerFeilHemmelighet gjentatte
    // ganger uten å oppgi noen IP i det hele tatt — akkurat som en angriper som
    // bytter X-Forwarded-For for hver forespørsel.
    for (let i = 0; i < 25; i += 1) {
      registrerFeilHemmelighet();
    }

    assert.equal(forMangeFeilHemmelighet().sperret, true);
  });

  test("nullstilling åpner igjen", () => {
    for (let i = 0; i < 20; i += 1) {
      registrerFeilHemmelighet();
    }
    assert.equal(forMangeFeilHemmelighet().sperret, true);

    nullstillFeilHemmelighet();

    assert.equal(forMangeFeilHemmelighet().sperret, false);
    assert.equal(forMangeFeilHemmelighet().feil, 0);
  });
});
