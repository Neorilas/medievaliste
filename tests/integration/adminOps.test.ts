import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithSettlement, prisma, resetDb, rewindLastTick } from "./helpers";
import { AdminOpError, applyAdminOp } from "../../lib/adminOps";
import { EventType } from "../../lib/generated/prisma/enums";

beforeEach(resetDb);

describe("applyAdminOp", () => {
  it("addResources incrementa los recursos", async () => {
    const { settlementId } = await createUserWithSettlement();
    await applyAdminOp(settlementId, "addResources", { wood: 100, stone: 5 });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.wood).toBe(115);
    expect(s.stone).toBe(5);
  });

  it("setResources fija valores absolutos", async () => {
    const { settlementId } = await createUserWithSettlement();
    await applyAdminOp(settlementId, "setResources", { food: 50, wood: 10, stone: 3 });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.food).toBe(50);
    expect(s.wood).toBe(10);
    expect(s.stone).toBe(3);
  });

  it("setPopulation recorta los trabajadores sobrantes", async () => {
    const { settlementId } = await createUserWithSettlement(); // granja con 2 colonos
    await applyAdminOp(settlementId, "setPopulation", { population: 1 });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId }, include: { buildings: true } });
    const assigned = s.buildings.reduce((a, b) => a + b.workers, 0);
    expect(s.population).toBe(1);
    expect(assigned).toBeLessThanOrEqual(1);
  });

  it("setWelfare clampa al rango 0..100", async () => {
    const { settlementId } = await createUserWithSettlement();
    await applyAdminOp(settlementId, "setWelfare", { welfare: 150 });
    expect((await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } })).welfare).toBe(100);
    await applyAdminOp(settlementId, "setWelfare", { welfare: -10 });
    expect((await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } })).welfare).toBe(0);
  });

  it("plague crea un evento y al resolver baja el bienestar", async () => {
    const { settlementId } = await createUserWithSettlement();
    await applyAdminOp(settlementId, "plague", { hours: 6 });
    expect(await prisma.event.count({ where: { settlementId, type: EventType.PLAGUE } })).toBe(1);

    await rewindLastTick(settlementId, 4);
    const before = (await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } })).welfare;
    const { summary } = await applyAdminOp(settlementId, "resolve");
    const after = (await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } })).welfare;
    expect(after).toBeLessThan(before);
    expect(summary?.plagueActive).toBe(true);
  });

  it("reset restaura el estado inicial y limpia edificios y eventos", async () => {
    const { settlementId } = await createUserWithSettlement();
    await applyAdminOp(settlementId, "addResources", { wood: 100 });
    await applyAdminOp(settlementId, "plague", { hours: 6 });

    await applyAdminOp(settlementId, "reset");
    const s = await prisma.settlement.findUniqueOrThrow({
      where: { id: settlementId },
      include: { buildings: true, events: true },
    });
    expect(s.wood).toBe(15);
    expect(s.population).toBe(3);
    expect(s.buildings).toHaveLength(2);
    expect(s.events).toHaveLength(0);
  });

  it("operar sobre un asentamiento inexistente lanza AdminOpError", async () => {
    await expect(applyAdminOp("no-existe", "addResources", { wood: 1 })).rejects.toBeInstanceOf(AdminOpError);
  });
});
