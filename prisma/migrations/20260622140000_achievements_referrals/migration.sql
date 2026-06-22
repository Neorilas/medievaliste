-- AlterTable: contadores de producción bruta acumulada (hazañas total_*_produced)
ALTER TABLE "Settlement" ADD COLUMN     "totalFoodProduced" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalStoneProduced" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalWoodProduced" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable: campos de referidos en User
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "referralRewardAt" TIMESTAMP(3);

-- Backfill: asigna un referralCode único a los usuarios existentes (gen_random_uuid
-- está disponible en PostgreSQL 13+; si no, usar md5(random()::text||clock_timestamp()::text)).
UPDATE "User" SET "referralCode" = gen_random_uuid()::text WHERE "referralCode" IS NULL;

-- Una vez backfilleado, el código pasa a ser NOT NULL.
ALTER TABLE "User" ALTER COLUMN "referralCode" SET NOT NULL;

-- CreateTable: hazañas completadas (las definiciones viven en código, no en BD)
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAchievement_userId_idx" ON "UserAchievement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
