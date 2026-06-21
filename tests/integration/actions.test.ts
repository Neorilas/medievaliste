import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithSettlement, prisma, resetDb, rewindLastTick } from "./helpers";
import { ActionError, applyAction } from "../../lib/actions";
import { BuildingType } from "../../lib/generated/prisma/enums";

beforeEach(resetDb);

describe("applyAction", () => {
  it("construir Casa descuenta madera y añade el edificio", async () => {
    const { settlementId } = await createUserWithSettlement();
    await applyAction(settlementId, { kind: "build", buildingType: BuildingType.HOUSE });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId }, include: { buildings: true } });
    expect(s.wood).toBe(0); // 15 - 15
    expect(s.buildings.some((b) => b.type === BuildingType.HOUSE)).toBe(true);
  });

  it("construir sin recursos lanza ActionError", async () => {
    const { settlementId } = await createUserWithSettlement();
    await prisma.settlement.update({ where: { id: settlementId }, data: { wood: 0 } });
    await expect(
      applyAction(settlementId, { kind: "build", buildingType: BuildingType.HOUSE }),
    ).rejects.toBeInstanceOf(ActionError);
  });

  it("asignar por encima del tope del edificio lanza ActionError; dentro del tope persiste", async () => {
    const { settlementId } = await createUserWithSettlement();
    const farm = await prisma.building.findFirstOrThrow({ where: { settlementId, type: BuildingType.FARM } });

    await expect(
      applyAction(settlementId, { kind: "assign", buildingId: farm.id, workers: 3 }),
    ).rejects.toBeInstanceOf(ActionError);

    await applyAction(settlementId, { kind: "assign", buildingId: farm.id, workers: 1 });
    const after = await prisma.building.findUniqueOrThrow({ where: { id: farm.id } });
    expect(after.workers).toBe(1);
  });

  it("mejorar la granja a N2 sube el nivel y descuenta el coste", async () => {
    const { settlementId } = await createUserWithSettlement();
    await prisma.settlement.update({ where: { id: settlementId }, data: { wood: 50 } });
    const farm = await prisma.building.findFirstOrThrow({ where: { settlementId, type: BuildingType.FARM } });

    await applyAction(settlementId, { kind: "upgrade", buildingId: farm.id });
    const after = await prisma.building.findUniqueOrThrow({ where: { id: farm.id } });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(after.level).toBe(2);
    expect(s.wood).toBe(50 - 24);
  });

  it("subir el Ayuntamiento sube el nivel del asentamiento y del propio edificio", async () => {
    const { settlementId } = await createUserWithSettlement();
    await prisma.settlement.update({ where: { id: settlementId }, data: { wood: 200, stone: 100 } });
    await applyAction(settlementId, { kind: "upgradeTownHall" });

    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId }, include: { buildings: true } });
    const th = s.buildings.find((b) => b.type === BuildingType.TOWN_HALL)!;
    expect(s.townHallLevel).toBe(2);
    expect(th.level).toBe(2);
    expect(s.wood).toBe(200 - 120);
    expect(s.stone).toBe(100 - 40);
  });

  it("cierra el tramo de producción ANTES de aplicar la acción", async () => {
    const { settlementId } = await createUserWithSettlement();
    await rewindLastTick(settlementId, 4); // 4h de producción pendiente
    await applyAction(settlementId, { kind: "build", buildingType: BuildingType.HOUSE });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.food).toBeGreaterThan(0); // la producción se consolidó al resolver
  });
});
