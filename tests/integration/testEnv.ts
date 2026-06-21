// Configuración de la base de datos de TEST (separada de la de desarrollo).
// Por defecto apunta al mismo Postgres de Docker pero a la base `asentamiento_test`.
// Se puede sobrescribir con DATABASE_URL_TEST (p. ej. en CI).

const DEFAULT_TEST_URL =
  "postgresql://asentamiento:asentamiento_dev@localhost:5432/asentamiento_test?schema=public";

export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST ?? DEFAULT_TEST_URL;

// URL a una base existente del mismo servidor, para poder emitir CREATE DATABASE.
export const ADMIN_DATABASE_URL =
  process.env.ADMIN_DATABASE_URL ??
  TEST_DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

// Nombre de la base de test (último segmento del path, sin query).
export const TEST_DB_NAME =
  TEST_DATABASE_URL.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "asentamiento_test";
