-- Oppvarmingsplan per avsender.
--
-- Bakgrunn: `dagFraStart` var globalt unik. De seks globale trinnene eide dag 0,
-- 4, 8, 15, 22 og 31, så et avsenderspesifikt trinn på noen av disse dagene
-- kunne ikke opprettes. Koden som foretrekker egne trinn framfor de globale var
-- derfor aldri nåbar for en ny avsender. Konfigurasjonen så ut til å finnes,
-- men kunne ikke brukes.
--
-- Vi bytter til unikhet per avsender.

-- 1. Slipp den globale unikheten.
DROP INDEX IF EXISTS "Oppvarmingssteg_dagFraStart_key";

-- 2. Unik per avsender.
--
-- MERK: PostgreSQL behandler NULL som forskjellig fra NULL i en unik indeks.
-- Denne indeksen hindrer derfor IKKE to globale trinn på samme dag, fordi de
-- begge har avsenderId = NULL. Det håndteres i steg 3.
CREATE UNIQUE INDEX IF NOT EXISTS "Oppvarmingssteg_avsenderId_dagFraStart_key"
  ON "Oppvarmingssteg" ("avsenderId", "dagFraStart");

-- 3. Delvis unik indeks for de globale trinnene.
--
-- Uten denne kunne noen lagt inn to globale trinn på dag 4 med ulik kvote, og
-- `kvoteForDag` ville plukket ett av dem vilkårlig. Det er nettopp den typen
-- stillhet vi vil unngå.
--
-- Dette er eneste sted i prosjektet der vi går utenom Prisma-skjemaet og skriver
-- rå SQL. Det er fordi Prisma ikke uttrykker partielle indekser. Indeksen er
-- dokumentert i schema.prisma der Oppvarmingssteg er definert.
CREATE UNIQUE INDEX IF NOT EXISTS "Oppvarmingssteg_global_dag_key"
  ON "Oppvarmingssteg" ("dagFraStart")
  WHERE "avsenderId" IS NULL;
