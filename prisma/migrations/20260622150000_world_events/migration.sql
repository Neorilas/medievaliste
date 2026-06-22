-- CreateEnum
CREATE TYPE "WorldEventType" AS ENUM ('TRADE_FAVORABLE', 'TRADE_NEUTRAL', 'TRADE_UNFAVORABLE', 'INCLEMENCY', 'COLONIST_ARRIVAL');

-- CreateEnum
CREATE TYPE "WorldEventStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- AlterTable: campos nuevos en Settlement (Bloque 4)
ALTER TABLE "Settlement" ADD COLUMN     "firstColonistReceived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastEventAt" TIMESTAMP(3);

-- CreateTable: eventos aleatorios interactivos (las definiciones viven en lib/events.ts)
CREATE TABLE "WorldEvent" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "type" "WorldEventType" NOT NULL,
    "status" "WorldEventStatus" NOT NULL DEFAULT 'PENDING',
    "characterKey" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WorldEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorldEvent_settlementId_status_idx" ON "WorldEvent"("settlementId", "status");

-- AddForeignKey
ALTER TABLE "WorldEvent" ADD CONSTRAINT "WorldEvent_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
