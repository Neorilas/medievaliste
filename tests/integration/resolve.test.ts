import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithSettlement, prisma, resetDb, rewindLastTick } from "./helpers";
import { resolveSettlement } from "../../lib/resolveSettlement";
import { EventType } from "../../lib/generated/prisma/enums";

beforeEach(resetDb);

describe("resolveSettlement (persistencia)", () => {
  it("acumula producción y actualiza lastTick", async () => {
    const { settlementId } = await createUserWithSettlement();
    await rewindLastTick(settlementId, 5); // 5 h transcurridas
    const before = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });

    const { summary } = await resolveSettlement(settlementId);
    const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });

    // Granja 2 colonos = +6/h, consumo 3/h → +3/h neto * 5h ≈ 15
    expect(after.food).toBeCloseTo(15, 0);
    expect(after.lastTick.getTime()).toBeGreaterThan(before.lastTick.getTime());
    expect(summary.elapsedHours).toBeGreaterThan(4.9);
  });

  it("hambruna: sin producción durante 60h pierde colonos y registra FAMINE", async () => {
    const { settlementId } = await createUserWithSettlement();
    await prisma.building.updateMany({ where: { settlementId }, data: { workers: 0 } });
    await prisma.settlement.update({ where: { id: settlementId }, data: { food: 0 } });
    await rewindLastTick(settlementId, 60);

    const { summary } = await resolveSettlement(settlementId);
    const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });

    expect(summary.colonistsLost).toBeGreaterThan(0);
    expect(after.population).toBeLessThan(3);
    const famines = await prisma.event.count({ where: { settlementId, type: EventType.FAMINE } });
    expect(famines).toBeGreaterThan(0);
  });
});
