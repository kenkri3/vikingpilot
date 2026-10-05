/**
 * Enhetsregister-pipelinen: normalisering og filtrering.
 *
 * Dette er rene funksjoner uten database og uten nettverk. Testene krever
 * derfor ingenting utenom Node.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normaliserNavn,
  normaliserOrgnr,
  normaliserDato,
  normaliserNettside,
  utledSektor,
  normaliserVirksomhet,
} from "@/lib/enhetsregister/normaliser";
import {
  vurderVirksomhet,
  filtrerVirksomheter,
  naeringTreffer,
  fylkeTreffer,
  maanederMellom,
  normaliserKode,
  STRENG_KONFIG,
  type FilterKonfig,
} from "@/lib/enhetsregister/filter";
import type { NormalisertVirksomhet } from "@/lib/enhetsregister/normaliser";

// ---------------------------------------------------------------------------
// Hjelper: bygger en gyldig virksomhet vi kan variere én og én ting på.
// ---------------------------------------------------------------------------

function virksomhet(over: Partial<NormalisertVirksomhet> = {}): NormalisertVirksomhet {
  return {
    orgnr: "999888777",
    navn: "Testbedriften AS",
    normalisertNavn: "testbedriften as",
    organisasjonsform: "AS",
    naeringskode: "62.010",
    naeringsbeskrivelse: "Databehandling",
    sektor: "PRIVAT",
    antallAnsatte: 20,
    stiftetDato: new Date(Date.UTC(2020, 0, 15)),
    registrertDato: new Date(Date.UTC(2020, 0, 20)),
    konkurs: false,
    underAvvikling: false,
    adresse: "Testveien 1",
    postnummer: "0150",
    poststed: "OSLO",
    fylke: "Oslo",
    kommunenummer: "0301",
    nettside: "https://testbedriften.no/",
    ...over,
  };
}

const NAA = new Date(Date.UTC(2026, 5, 15)); // 15. juni 2026

describe("normalisering", () => {
  test("normaliserer navn til sammenlignbar form", () => {
    assert.equal(normaliserNavn("  Acme  AS  "), "acme as");
    assert.equal(normaliserNavn("ACME AS"), "acme as");
    assert.equal(normaliserNavn("Acme AS."), "acme as");
    assert.equal(normaliserNavn("Acme & Co"), "acme og co");
    assert.equal(normaliserNavn("Acme (Oslo)"), "acme oslo");
  });

  test("beholder as og asa i navnet", () => {
    // Å fjerne dem ville slått sammen virksomheter som faktisk er forskjellige.
    assert.notEqual(normaliserNavn("Acme AS"), normaliserNavn("Acme ASA"));
  });

  test("fjerner aksenter men beholder æøå", () => {
    assert.equal(normaliserNavn("Næringslivets Hus"), "næringslivets hus");
    assert.equal(normaliserNavn("Café Nord"), "cafe nord");
  });

  test("godtar bare nøyaktig ni siffer som orgnr", () => {
    assert.equal(normaliserOrgnr("933 851 222"), "933851222");
    assert.equal(normaliserOrgnr("933851222"), "933851222");
    assert.equal(normaliserOrgnr("12345678"), null, "åtte siffer skal avvises");
    assert.equal(normaliserOrgnr("1234567890"), null, "ti siffer skal avvises");
    assert.equal(normaliserOrgnr(null), null);
    assert.equal(normaliserOrgnr(""), null);
  });

  test("tolker gyldige datoer og avviser ugyldige", () => {
    const d = normaliserDato("2020-01-15");
    assert.ok(d);
    assert.equal(d.getUTCFullYear(), 2020);
    assert.equal(d.getUTCMonth(), 0);
    assert.equal(d.getUTCDate(), 15);

    assert.equal(normaliserDato("2026-02-30"), null, "30. februar finnes ikke");
    assert.equal(normaliserDato("15.01.2020"), null, "feil format");
    assert.equal(normaliserDato("2020-1-5"), null, "ikke nullpolstret");
    assert.equal(normaliserDato(""), null);
  });

  test("datoen flytter seg ikke over tidssoner", () => {
    // Vi bygger datoen i UTC. Med lokal tid ville denne kunne bli 14. januar.
    const d = normaliserDato("2020-01-15")!;
    assert.equal(d.toISOString().slice(0, 10), "2020-01-15");
  });

  test("rydder nettadresser og avviser søppel", () => {
    assert.equal(normaliserNettside("test.no"), "https://test.no/");
    assert.equal(normaliserNettside("https://test.no"), "https://test.no/");
    assert.equal(normaliserNettside("  "), null);
    assert.equal(normaliserNettside("ikke-en-url"), null);
    assert.equal(normaliserNettside(null), null);
  });
});

describe("sektor — offentlig sektor skal alltid ut", () => {
  test("kjenner igjen offentlig sektor fra sektor-feltet", () => {
    assert.equal(utledSektor("offentlig", "AS"), "OFFENTLIG");
    assert.equal(utledSektor("Statlig", "AS"), "OFFENTLIG");
  });

  test("kjenner igjen offentlige organisasjonsformer", () => {
    assert.equal(utledSektor(undefined, "ORGL"), "OFFENTLIG");
    assert.equal(utledSektor(undefined, "STAT"), "OFFENTLIG");
    assert.equal(utledSektor(undefined, "KOMM"), "OFFENTLIG");
    assert.equal(utledSektor(undefined, "FYLK"), "OFFENTLIG");
    assert.equal(utledSektor(undefined, "IKS"), "OFFENTLIG");
  });

  test("BRUDD: vanlige private selskapsformer må IKKE havne i offentlig", () => {
    // Dette var en ekte feil. Enhetsregisterets `sektor`-felt er tomt i praksis,
    // og første versjon avviste derfor ALT fra det åpne API-et som «ukjent
    // sektor» — inkludert helt vanlige AS. Vi fant det ved å kjøre pipelinen
    // mot ekte data og få 0 godkjente av 200.
    for (const form of ["AS", "ASA", "ENK", "ANS", "DA", "SA", "FLI", "STI", "NUF"]) {
      assert.equal(
        utledSektor(undefined, form),
        "PRIVAT",
        `organisasjonsformen ${form} skal være PRIVAT`,
      );
    }
  });

  test("BRUDD: tomt sektor-felt alene gir UKJENT, ikke PRIVAT", () => {
    // Vi gjetter ikke. UKJENT avvises av filteret når ekskluderOffentlig er på.
    assert.equal(utledSektor(undefined, undefined), "UKJENT");
    assert.equal(utledSektor("", ""), "UKJENT");
    assert.equal(utledSektor(undefined, "UKJENTFORM"), "UKJENT");
  });

  test("eksplisitt sektor vinner over organisasjonsformen", () => {
    assert.equal(utledSektor("offentlig", "AS"), "OFFENTLIG");
    assert.equal(utledSektor("privat", "ORGL"), "PRIVAT");
  });

  test("behandler AS som privat selv om det er eid av det offentlige", () => {
    // Et aksjeselskap er en egen juridisk person og vurderes på vanlig måte.
    assert.equal(utledSektor("privat", "AS"), "PRIVAT");
    assert.equal(utledSektor(undefined, "AS"), "PRIVAT");
  });
});

describe("filtre — absolutte regler", () => {
  test("BRUDD: konkurs avvises alltid", () => {
    const svar = vurderVirksomhet(virksomhet({ konkurs: true }), STRENG_KONFIG, NAA);
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "KONKURS");
  });

  test("BRUDD: under avvikling avvises alltid", () => {
    const svar = vurderVirksomhet(virksomhet({ underAvvikling: true }), STRENG_KONFIG, NAA);
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "UNDER_AVVIKLING");
  });

  test("BRUDD: offentlig sektor avvises selv med helt åpen konfigurasjon", () => {
    // Selv om noen setter alle valg til «tillat», skal offentlig sektor ut.
    const aapen: FilterKonfig = {
      naeringskoder: [],
      fylker: [],
      minAnsatte: null,
      maxAnsatte: null,
      minAlderMaaneder: null,
      ekskluderOffentlig: false,
      ekskluderKonkurs: false,
      ekskluderUnderAvvikling: false,
    };

    const svar = vurderVirksomhet(virksomhet({ sektor: "OFFENTLIG" }), aapen, NAA);
    assert.equal(svar.godkjent, false, "offentlig sektor slapp gjennom");
    assert.equal(svar.kode, "OFFENTLIG_SEKTOR");
  });

  test("BRUDD: konkurs avvises selv med ekskluderKonkurs satt til false", () => {
    const aapen: FilterKonfig = { ...STRENG_KONFIG, ekskluderKonkurs: false };
    const svar = vurderVirksomhet(virksomhet({ konkurs: true }), aapen, NAA);
    assert.equal(svar.godkjent, false, "konkurs slapp gjennom");
  });

  test("ukjent sektor avvises når ekskluderOffentlig er på", () => {
    // Å utelate en privat virksomhet er billig. Å kontakte en offentlig er ikke.
    const svar = vurderVirksomhet(virksomhet({ sektor: "UKJENT" }), STRENG_KONFIG, NAA);
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "OFFENTLIG_SEKTOR");
  });

  test("ukjent sektor slipper gjennom når ekskluderOffentlig er av", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, ekskluderOffentlig: false };
    const svar = vurderVirksomhet(virksomhet({ sektor: "UKJENT" }), konfig, NAA);
    assert.equal(svar.godkjent, true);
  });

  test("en helt vanlig privat virksomhet godkjennes", () => {
    // Kontrolltest. Uten den vet vi ikke om avslagene over skyldtes reglene.
    const svar = vurderVirksomhet(virksomhet(), STRENG_KONFIG, NAA);
    assert.equal(svar.godkjent, true, `avvist: ${svar.grunn}`);
    assert.equal(svar.kode, "GODKJENT");
  });
});

describe("filtre — konfigurerbare regler", () => {
  test("NACE-kode matcher på prefiks", () => {
    assert.equal(naeringTreffer("62.010", ["62"]), true);
    assert.equal(naeringTreffer("62.010", ["62010"]), true);
    assert.equal(naeringTreffer("62.010", ["62.01"]), true);
    assert.equal(naeringTreffer("62.010", ["63"]), false);
    assert.equal(naeringTreffer("62.010", ["6201"]), true);
  });

  test("tom NACE-liste betyr alle", () => {
    assert.equal(naeringTreffer("62.010", []), true);
    assert.equal(naeringTreffer(null, []), true);
  });

  test("manglende NACE-kode avvises når listen ikke er tom", () => {
    assert.equal(naeringTreffer(null, ["62"]), false);
  });

  test("normaliserer NACE-koder for sammenligning", () => {
    assert.equal(normaliserKode("62.010"), "62010");
    assert.equal(normaliserKode("62"), "62");
  });

  test("fylke sammenlignes uten hensyn til store bokstaver", () => {
    assert.equal(fylkeTreffer("Oslo", ["oslo"]), true);
    assert.equal(fylkeTreffer("Vestland", ["Oslo"]), false);
    assert.equal(fylkeTreffer(null, ["Oslo"]), false);
    assert.equal(fylkeTreffer("Hva som helst", []), true);
  });

  test("avviser virksomhet utenfor næringskoden", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, naeringskoder: ["63"] };
    const svar = vurderVirksomhet(virksomhet({ naeringskode: "62.010" }), konfig, NAA);
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "NAERING");
  });

  test("avviser virksomhet utenfor fylket", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, fylker: ["Vestland"] };
    const svar = vurderVirksomhet(virksomhet({ fylke: "Oslo" }), konfig, NAA);
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "FYLKE");
  });

  test("avviser for få ansatte", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, minAnsatte: 50 };
    const svar = vurderVirksomhet(virksomhet({ antallAnsatte: 20 }), konfig, NAA);
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "ANSATTE");
  });

  test("avviser for mange ansatte", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, maxAnsatte: 10 };
    const svar = vurderVirksomhet(virksomhet({ antallAnsatte: 20 }), konfig, NAA);
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "ANSATTE");
  });

  test("avviser ukjent antall ansatte når grensen er satt", () => {
    // Vi gjetter ikke at en virksomhet med ukjent størrelse er stor nok.
    const konfig: FilterKonfig = { ...STRENG_KONFIG, minAnsatte: 5 };
    const svar = vurderVirksomhet(virksomhet({ antallAnsatte: null }), konfig, NAA);
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "ANSATTE");
  });

  test("grensene er inkluderende", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, minAnsatte: 20, maxAnsatte: 20 };
    assert.equal(vurderVirksomhet(virksomhet({ antallAnsatte: 20 }), konfig, NAA).godkjent, true);
  });

  test("regner hele måneder riktig", () => {
    const fra = new Date(Date.UTC(2020, 0, 15));

    assert.equal(maanederMellom(fra, new Date(Date.UTC(2020, 0, 15))), 0);
    assert.equal(maanederMellom(fra, new Date(Date.UTC(2020, 1, 14))), 0, "en dag for tidlig");
    assert.equal(maanederMellom(fra, new Date(Date.UTC(2020, 1, 15))), 1);
    assert.equal(maanederMellom(fra, new Date(Date.UTC(2021, 0, 15))), 12);
  });

  test("avviser virksomhet som er for ung", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, minAlderMaaneder: 12 };
    const svar = vurderVirksomhet(
      virksomhet({ stiftetDato: new Date(Date.UTC(2026, 5, 1)) }),
      konfig,
      NAA,
    );
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "ALDER");
  });

  test("avviser virksomhet med stiftelsesdato i fremtiden", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, minAlderMaaneder: 1 };
    const svar = vurderVirksomhet(
      virksomhet({ stiftetDato: new Date(Date.UTC(2030, 0, 1)) }),
      konfig,
      NAA,
    );
    assert.equal(svar.godkjent, false);
    assert.equal(svar.kode, "UGYLDIG_ALDER");
  });

  test("godtar virksomhet som akkurat er gammel nok", () => {
    const konfig: FilterKonfig = { ...STRENG_KONFIG, minAlderMaaneder: 12 };
    const svar = vurderVirksomhet(
      virksomhet({ stiftetDato: new Date(Date.UTC(2025, 5, 15)) }),
      konfig,
      NAA,
    );
    assert.equal(svar.godkjent, true, `avvist: ${svar.grunn}`);
  });
});

describe("filtrering av en liste", () => {
  test("deler i godkjente og avviste med opptelling", () => {
    const liste = [
      virksomhet({ orgnr: "111111111", navn: "A" }),
      virksomhet({ orgnr: "222222222", navn: "B", konkurs: true }),
      virksomhet({ orgnr: "333333333", navn: "C", sektor: "OFFENTLIG" }),
      virksomhet({ orgnr: "444444444", navn: "D" }),
    ];

    const { godkjente, avviste, opptelling } = filtrerVirksomheter(liste, STRENG_KONFIG, NAA);

    assert.equal(godkjente.length, 2);
    assert.equal(avviste.length, 2);
    assert.equal(opptelling["KONKURS"], 1);
    assert.equal(opptelling["OFFENTLIG_SEKTOR"], 1);
    assert.equal(opptelling["GODKJENT"], 2);
  });
});

describe("normalisering av en rå virksomhet", () => {
  test("normaliserer en fullstendig rå registrering", () => {
    const resultat = normaliserVirksomhet({
      organisasjonsnummer: "933 851 222",
      navn: "  Vikingnet AS  ",
      organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
      naeringskode1: { kode: "62.010", beskrivelse: "Databehandling" },
      antallAnsatte: 4,
      stiftelsesdato: "2020-01-15",
      registreringsdatoEnhetsregisteret: "2020-01-20",
      konkurs: false,
      underAvvikling: false,
      forretningsadresse: {
        adresse: ["Testveien 1"],
        postnummer: "0150",
        poststed: "OSLO",
        fylke: "Oslo",
        kommunenummer: "0301",
      },
      hjemmeside: "vikingnet.no",
      sektor: "privat",
    });

    assert.ok(resultat);
    assert.equal(resultat.orgnr, "933851222");
    assert.equal(resultat.navn, "Vikingnet AS", "navnet skal være trimmet");
    assert.equal(resultat.normalisertNavn, "vikingnet as");
    assert.equal(resultat.naeringskode, "62.010");
    assert.equal(resultat.sektor, "PRIVAT");
    assert.equal(resultat.antallAnsatte, 4);
    assert.equal(resultat.fylke, "Oslo");
    assert.equal(resultat.adresse, "Testveien 1");
    assert.equal(resultat.nettside, "https://vikingnet.no/");
    assert.equal(resultat.stiftetDato?.toISOString().slice(0, 10), "2020-01-15");
  });

  test("returnerer null uten gyldig orgnr", () => {
    assert.equal(normaliserVirksomhet({ navn: "Uten nummer AS" }), null);
    assert.equal(normaliserVirksomhet({ organisasjonsnummer: "123", navn: "For kort AS" }), null);
  });

  test("returnerer null uten navn", () => {
    assert.equal(normaliserVirksomhet({ organisasjonsnummer: "999888777" }), null);
    assert.equal(
      normaliserVirksomhet({ organisasjonsnummer: "999888777", navn: "   " }),
      null,
    );
  });

  test("behandler tvangsavvikling som under avvikling", () => {
    const resultat = normaliserVirksomhet({
      organisasjonsnummer: "999888777",
      navn: "Tvangsavviklet AS",
      underTvangsavviklingEllerTvangsopplosning: true,
    });

    assert.ok(resultat);
    assert.equal(resultat.underAvvikling, true);
  });

  test("faller tilbake til postadresse når forretningsadresse mangler", () => {
    const resultat = normaliserVirksomhet({
      organisasjonsnummer: "999888777",
      navn: "Postadresse AS",
      postadresse: { adresse: ["Postboks 1"], postnummer: "0100", poststed: "OSLO" },
    });

    assert.ok(resultat);
    assert.equal(resultat.adresse, "Postboks 1");
    assert.equal(resultat.postnummer, "0100");
  });

  test("tåler en registrering med nesten ingen felt", () => {
    const resultat = normaliserVirksomhet({
      organisasjonsnummer: "999888777",
      navn: "Minimal AS",
    });

    assert.ok(resultat);
    assert.equal(resultat.naeringskode, null);
    assert.equal(resultat.antallAnsatte, null);
    assert.equal(resultat.stiftetDato, null);
    assert.equal(resultat.adresse, null);
    assert.equal(resultat.sektor, "UKJENT");
  });

  test("en minimal virksomhet avvises av strengt filter", () => {
    // Uten sektor, næring eller alder skal den ikke slippe gjennom.
    const resultat = normaliserVirksomhet({
      organisasjonsnummer: "999888777",
      navn: "Minimal AS",
    })!;

    const svar = vurderVirksomhet(resultat, STRENG_KONFIG, NAA);
    assert.equal(svar.godkjent, false, "en virksomhet uten data slapp gjennom");
  });
});
