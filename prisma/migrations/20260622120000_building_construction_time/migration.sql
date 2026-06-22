-- AlterTable: tiempo de construcción/mejora de edificios.
-- NULL = edificio terminado y funcional. No-NULL = construyéndose/mejorando,
-- se completará a `level + 1` en ese instante (lo resuelve el motor diferido).
ALTER TABLE "Building" ADD COLUMN "constructionEndsAt" TIMESTAMP(3);
