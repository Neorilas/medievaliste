// setupFile: se ejecuta ANTES de importar los módulos de test, así que cuando
// lib/prisma se evalúe, DATABASE_URL ya apunta a la base de test.
import { afterAll } from "vitest";
import { TEST_DATABASE_URL } from "./testEnv";

process.env.DATABASE_URL = TEST_DATABASE_URL;

// Cierra el pool de conexiones al terminar para que el proceso no quede colgado.
afterAll(async () => {
  const { prisma } = await import("../../lib/prisma");
  await prisma.$disconnect();
});
