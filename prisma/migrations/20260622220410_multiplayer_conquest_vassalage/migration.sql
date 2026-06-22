-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BuildingType" ADD VALUE 'BARRACKS';
ALTER TYPE "BuildingType" ADD VALUE 'WALL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'WAR_ATTACK';
ALTER TYPE "EventType" ADD VALUE 'WAR_DEFENSE';

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "tributeReceivedFood" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "tributeReceivedStone" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "tributeReceivedWood" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Vassalage" (
    "id" TEXT NOT NULL,
    "lordId" TEXT NOT NULL,
    "vassalId" TEXT NOT NULL,
    "tributePct" INTEGER NOT NULL DEFAULT 15,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vassalage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarDeclaration" (
    "id" TEXT NOT NULL,
    "attackerId" TEXT NOT NULL,
    "defenderId" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "winnerId" TEXT,
    "attackerForce" INTEGER NOT NULL,
    "defenderForce" INTEGER NOT NULL,
    "isRebellion" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WarDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vassalage_vassalId_key" ON "Vassalage"("vassalId");

-- CreateIndex
CREATE INDEX "Vassalage_lordId_idx" ON "Vassalage"("lordId");

-- CreateIndex
CREATE INDEX "WarDeclaration_attackerId_defenderId_declaredAt_idx" ON "WarDeclaration"("attackerId", "defenderId", "declaredAt");

-- AddForeignKey
ALTER TABLE "Vassalage" ADD CONSTRAINT "Vassalage_lordId_fkey" FOREIGN KEY ("lordId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vassalage" ADD CONSTRAINT "Vassalage_vassalId_fkey" FOREIGN KEY ("vassalId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarDeclaration" ADD CONSTRAINT "WarDeclaration_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarDeclaration" ADD CONSTRAINT "WarDeclaration_defenderId_fkey" FOREIGN KEY ("defenderId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
