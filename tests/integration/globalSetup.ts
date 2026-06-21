// globalSetup (una vez por ejecución): crea la base de test si no existe y aplica
// las migraciones. Requiere un Postgres accesible (en local: `npm run db:up`).
import { execSync } from "node:child_process";
import { Client } from "pg";
import { ADMIN_DATABASE_URL, TEST_DATABASE_URL, TEST_DB_NAME } from "./testEnv";

export default async function setup() {
  // 1. Crear la base de test si no existe.
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `No se pudo conectar a Postgres para preparar los tests de integración.\n` +
        `¿Está Postgres levantado? (npm run db:up)\n${(err as Error).message}`,
    );
  }
  try {
    await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } catch (err) {
    // 42P04 = la base ya existe → ok.
    if ((err as { code?: string }).code !== "42P04") throw err;
  } finally {
    await admin.end();
  }

  // 2. Aplicar migraciones sobre la base de test.
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
