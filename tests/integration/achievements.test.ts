import { beforeEach, describe, expect, it } from "vitest";
import { createUser, createUserWithSettlement, prisma, resetDb } from "./helpers";
import {
  ClaimError,
  claimAchievement,
  countPendingClaims,
  evaluateAchievements,
} from "../../lib/achievements";

beforeEach(resetDb);

// Detecta hazañas dentro de una transacción (igual que hacen los endpoints reales).
async function detect(settlementId: string) {
  return prisma.$transaction((tx) => evaluateAchievements(tx, settlementId));
}

describe("hazañas — canje manual", () => {
  it("detectar NO aplica la recompensa: queda pendiente de canje", async () => {
    const { userId, settlementId } = await createUserWithSettlement();
    const before = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });

    // Producción suficiente para wood_1 (100 madera → recompensa +50 comida).
    await prisma.settlement.update({
      where: { id: settlementId },
      data: { totalWoodProduced: 100 },
    });

    const completed = await detect(settlementId);
    expect(completed.map((c) => c.id)).toContain("wood_1");

    // La hazaña queda registrada SIN claimedAt y los recursos NO han cambiado.
    const ua = await prisma.userAchievement.findFirstOrThrow({
      where: { userId, achievementId: "wood_1" },
    });
    expect(ua.claimedAt).toBeNull();

    const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(after.food).toBe(before.food); // +50 comida NO entregada todavía

    const pending = await prisma.$transaction((tx) => countPendingClaims(tx, userId));
    expect(pending).toBe(1);
  });

  it("reclamar aplica la recompensa y marca claimedAt", async () => {
    const { userId, settlementId } = await createUserWithSettlement();
    const before = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });

    await prisma.settlement.update({
      where: { id: settlementId },
      data: { totalWoodProduced: 100 },
    });
    await detect(settlementId);

    const reward = await claimAchievement(userId, "wood_1");
    expect(reward).toEqual({ food: 50 });

    const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(after.food).toBe(before.food + 50);

    const claimed = await prisma.userAchievement.findFirstOrThrow({
      where: { userId, achievementId: "wood_1" },
    });
    expect(claimed.claimedAt).not.toBeNull();

    const pending = await prisma.$transaction((tx) => countPendingClaims(tx, userId));
    expect(pending).toBe(0);
  });

  it("reclamar dos veces lanza ClaimError(already_claimed) y no duplica la recompensa", async () => {
    const { userId, settlementId } = await createUserWithSettlement();
    await prisma.settlement.update({
      where: { id: settlementId },
      data: { totalWoodProduced: 100 },
    });
    await detect(settlementId);

    await claimAchievement(userId, "wood_1");
    const afterFirst = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });

    await expect(claimAchievement(userId, "wood_1")).rejects.toBeInstanceOf(ClaimError);

    const afterSecond = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(afterSecond.food).toBe(afterFirst.food); // sin segunda entrega
  });

  it("reclamar una hazaña de otro usuario lanza ClaimError(not_found)", async () => {
    const owner = await createUserWithSettlement();
    await prisma.settlement.update({
      where: { id: owner.settlementId },
      data: { totalWoodProduced: 100 },
    });
    await detect(owner.settlementId);

    const intruder = await createUser();
    await expect(claimAchievement(intruder.id, "wood_1")).rejects.toMatchObject({
      reason: "not_found",
    });
  });
});
