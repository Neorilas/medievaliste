-- CreateEnum
CREATE TYPE "Region" AS ENUM ('GALLAECIA', 'CANTABRIA_ET_ASTURES', 'TARRACONENSIS', 'CAESARAUGUSTA', 'CELTIBERIA', 'LUSITANIA', 'CARTHAGINENSIS', 'BAETICA', 'INSULAE_BALEARES', 'INSULAE_FORTUNATAE');

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "nameChangedAt" TIMESTAMP(3),
ADD COLUMN     "posX" DOUBLE PRECISION,
ADD COLUMN     "posY" DOUBLE PRECISION,
ADD COLUMN     "region" "Region",
ALTER COLUMN "name" SET DEFAULT 'Asentamiento sin nombre';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "NeutralSettlement" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" "Region" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "posX" DOUBLE PRECISION NOT NULL,
    "posY" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeutralSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NeutralSettlement_region_idx" ON "NeutralSettlement"("region");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
