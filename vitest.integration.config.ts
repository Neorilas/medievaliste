import { defineConfig } from "vitest/config";

// Tests de integración: usan una base de datos Postgres real (la de test).
// Requieren Postgres levantado. Se ejecutan con: npm run test:integration
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/globalSetup.ts"],
    setupFiles: ["tests/integration/setupEnv.ts"],
    fileParallelism: false, // comparten una sola base: evitar concurrencia entre archivos
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
