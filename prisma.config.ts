import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: tilkoblingsadressen for migreringer og CLI ligger her, ikke i schema.prisma.
// Selve applikasjonen kobler til via driver-adapteren i src/lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
