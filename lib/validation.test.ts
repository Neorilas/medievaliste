import { describe, expect, it } from "vitest";
import {
  canAfford,
  freeColonists,
  validateAction,
  type SettlementSnapshot,
} from "./validation";
import { BuildingType } from "./generated/prisma/enums";

function snap(overrides: Partial<SettlementSnapshot> = {}): SettlementSnapshot {
  return {
    townHallLevel: 1,
    food: 0,
    wood: 100,
    stone: 100,
    population: 3,
    buildings: [
      { id: "th", type: BuildingType.TOWN_HALL, level: 1, workers: 0 },
      { id: "farm", type: BuildingType.FARM, level: 1, workers: 0 },
    ],
    ...overrides,
  };
}

describe("helpers", () => {
  it("freeColonists descuenta los asignados", () => {
    const s = snap();
    s.buildings[1].workers = 2;
    expect(freeColonists(s)).toBe(1);
  });

  it("canAfford ignora el bienestar (no es acumulable)", () => {
    expect(canAfford(snap({ wood: 10 }), { wood: 15 })).toBe(false);
    expect(canAfford(snap({ wood: 20 }), { wood: 15 })).toBe(true);
  });
});

describe("build", () => {
  it("permite construir una casa con recursos suficientes", () => {
    const r = validateAction(snap(), { kind: "build", buildingType: BuildingType.HOUSE });
    expect(r.ok).toBe(true);
    expect(r.cost).toEqual({ wood: 15 });
  });

  it("rechaza si no hay recursos", () => {
    const r = validateAction(snap({ wood: 5 }), {
      kind: "build",
      buildingType: BuildingType.HOUSE,
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza construir un segundo Ayuntamiento", () => {
    const r = validateAction(snap(), { kind: "build", buildingType: BuildingType.TOWN_HALL });
    expect(r.ok).toBe(false);
  });

  it("respeta el tope de edificios del Ayuntamiento (4 en N1)", () => {
    const s = snap({
      buildings: [
        { id: "th", type: BuildingType.TOWN_HALL, level: 1, workers: 0 },
        { id: "f", type: BuildingType.FARM, level: 1, workers: 0 },
        { id: "s", type: BuildingType.SAWMILL, level: 1, workers: 0 },
        { id: "h", type: BuildingType.HOUSE, level: 1, workers: 0 },
      ],
    });
    const r = validateAction(s, { kind: "build", buildingType: BuildingType.HOUSE });
    expect(r.ok).toBe(false);
  });

  it("la Cantera requiere Ayuntamiento N2", () => {
    expect(
      validateAction(snap({ townHallLevel: 1 }), {
        kind: "build",
        buildingType: BuildingType.QUARRY,
      }).ok,
    ).toBe(false);
    expect(
      validateAction(snap({ townHallLevel: 2 }), {
        kind: "build",
        buildingType: BuildingType.QUARRY,
      }).ok,
    ).toBe(true);
  });
});

describe("upgrade", () => {
  it("permite subir la granja a N2 con Ayuntamiento N1 (tope 2)", () => {
    const r = validateAction(snap(), { kind: "upgrade", buildingId: "farm" });
    expect(r.ok).toBe(true);
    expect(r.cost).toEqual({ wood: 24 });
  });

  it("rechaza superar el nivel máximo permitido por el Ayuntamiento", () => {
    const s = snap();
    s.buildings[1].level = 2; // ya en el tope de TH1 (maxOtherLevel 2)
    const r = validateAction(s, { kind: "upgrade", buildingId: "farm" });
    expect(r.ok).toBe(false);
  });
});

describe("upgradeTownHall", () => {
  it("permite subir el Ayuntamiento con recursos", () => {
    const r = validateAction(snap({ wood: 200, stone: 100 }), { kind: "upgradeTownHall" });
    expect(r.ok).toBe(true);
    expect(r.cost).toEqual({ wood: 120, stone: 40 });
  });

  it("rechaza sin recursos", () => {
    const r = validateAction(snap({ wood: 50, stone: 10 }), { kind: "upgradeTownHall" });
    expect(r.ok).toBe(false);
  });
});

describe("assign", () => {
  it("asigna colonos a un productor dentro de su tope", () => {
    const r = validateAction(snap(), { kind: "assign", buildingId: "farm", workers: 2 });
    expect(r.ok).toBe(true);
  });

  it("rechaza más colonos que puestos del edificio", () => {
    const r = validateAction(snap(), { kind: "assign", buildingId: "farm", workers: 3 });
    expect(r.ok).toBe(false);
  });

  it("rechaza más colonos que población libre", () => {
    const r = validateAction(snap({ population: 1 }), {
      kind: "assign",
      buildingId: "farm",
      workers: 2,
    });
    expect(r.ok).toBe(false);
  });

  it("no se puede asignar colonos a una casa", () => {
    const s = snap();
    s.buildings.push({ id: "house", type: BuildingType.HOUSE, level: 1, workers: 0 });
    const r = validateAction(s, { kind: "assign", buildingId: "house", workers: 1 });
    expect(r.ok).toBe(false);
  });
});
