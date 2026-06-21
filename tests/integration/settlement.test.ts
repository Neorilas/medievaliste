import { beforeEach, describe, expect, it } from "vitest";
import { createUser, prisma, resetDb } from "./helpers";
import { getOrCreateSettlementForUser, getSettlementView } from "../../lib/settlement";
import { BuildingType } from "../../lib/generated/prisma/enums";

beforeEach(resetDb);

describe("getOrCreateSettlementForUser", () => {
  it("crea el asentamiento inicial con los valores de partida", async () => {
    const u = await createUser();
    const id = await getOrCreateSettlementForUser(u.id);
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id }, include: { buildings: true } });
    expect(s.wood).toBe(15);
    expect(s.food).toBe(0);
    expect(s.population).toBe(3);
    expect(s.buildings).toHaveLength(2);
    const farm = s.buildings.find((b) => b.type === BuildingType.FARM)!;
    expect(farm.workers).toBe(2); // arranque autosuficiente
  });

  it("es idempotente: no crea un segundo asentamiento para el mismo usuario", async () => {
    const u = await createUser();
    const a = await getOrCreateSettlementForUser(u.id);
    const b = await getOrCreateSettlementForUser(u.id);
    expect(a).toBe(b);
    expect(await prisma.settlement.count()).toBe(1);
  });

  it("usuarios distintos tienen asentamientos distintos", async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    const s1 = await getOrCreateSettlementForUser(u1.id);
    const s2 = await getOrCreateSettlementForUser(u2.id);
    expect(s1).not.toBe(s2);
    expect(await prisma.settlement.count()).toBe(2);
  });
});

describe("getSettlementView", () => {
  it("refleja recursos, colonos libres y legalidad de opciones", async () => {
    const u = await createUser();
    const id = await getOrCreateSettlementForUser(u.id);
    const v = await getSettlementView(id);

    expect(v.resources.wood).toBe(15);
    expect(v.resources.cap).toBe(60);
    expect(v.population.free).toBe(1); // 3 - 2 en la granja

    const house = v.buildOptions.find((o) => o.type === BuildingType.HOUSE)!;
    expect(house.canBuild).toBe(true); // 15 madera = coste exacto

    const quarry = v.buildOptions.find((o) => o.type === BuildingType.QUARRY)!;
    expect(quarry.canBuild).toBe(false); // bloqueada hasta Ayuntamiento N2

    expect(v.townHallUpgrade.canUpgrade).toBe(false); // no asequible al inicio
    expect(v.townHallUpgrade.cost).toEqual({ wood: 120, stone: 40 });
  });
});
