-- AlterTable: canje manual de recompensas de hazañas. claimedAt = cuándo se reclamó
-- la recompensa (la recompensa solo se aplica al reclamar, no al completar).
ALTER TABLE "UserAchievement" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- Backfill: las hazañas ya completadas antes de esta migración tuvieron su recompensa
-- aplicada automáticamente (sistema anterior). Se marcan como ya reclamadas para que
-- el nuevo canje manual no vuelva a entregarlas.
UPDATE "UserAchievement" SET "claimedAt" = "completedAt" WHERE "claimedAt" IS NULL;
