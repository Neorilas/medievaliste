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

  it("mejorar la granja a N2 encarga la obra y descuenta el coste", async () => {
    const { settlementId } = await createUserWithSettlement();
    await prisma.settlement.update({ where: { id: settlementId }, data: { wood: 50 } });
    const farm = await prisma.building.findFirstOrThrow({ where: { settlementId, type: BuildingType.FARM } });

    await applyAction(settlementId, { kind: "upgrade", buildingId: farm.id });
    const after = await prisma.building.findUniqueOrThrow({ where: { id: farm.id } });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    // La mejora NO es instantánea: el edificio queda en obra (sigue a su nivel
    // actual) y sube al terminar; el coste se descuenta al encargarla.
    expect(after.level).toBe(1);
    expect(after.constructionEndsAt).not.toBeNull();
    expect(s.wood).toBe(50 - 24);
  });

  it("subir el Ayuntamiento encarga la obra y descuenta el coste", async () => {
    const { settlementId } = await createUserWithSettlement();
    // Dentro del tope de almacén inicial (60) para que resolver no recorte nada.
    await prisma.settlement.update({ where: { id: settlementId }, data: { wood: 60, stone: 30 } });
    await applyAction(settlementId, { kind: "upgradeTownHall" });

    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId }, include: { buildings: true } });
    const th = s.buildings.find((b) => b.type === BuildingType.TOWN_HALL)!;
    // El techo global NO sube hasta que la obra termina: queda en obra.
    expect(s.townHallLevel).toBe(1);
    expect(th.constructionEndsAt).not.toBeNull();
    // N1→N2 cuesta solo madera (Cambio A); la piedra no se toca.
    expect(s.wood).toBe(60 - 55);
    expect(s.stone).toBe(30);
  });

  it("cierra el tramo de producción ANTES de aplicar la acción", async () => {
    const { settlementId } = await createUserWithSettlement();
    await rewindLastTick(settlementId, 4); // 4h de producción pendiente
    await applyAction(settlementId, { kind: "build", buildingType: BuildingType.HOUSE });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.food).toBeGreaterThan(0); // la producción se consolidó al resolver
  });
});
