import { describe, expect, it } from "vitest";
import { simulate, type SimSettlement } from "./resolveSettlement";
import {
  maxWorkers,
  populationCapacity,
  productionPerHour,
  storageCap,
} from "./gameConfig";
import { BuildingType, EventType } from "./generated/prisma/enums";

const HOUR = 60 * 60 * 1000;
const EPOCH = new Date(0);
const at = (hours: number) => new Date(hours * HOUR);

/** Estado base: Ayuntamiento N1 + Granja N1, 3 colonos, bienestar 100. */
function baseState(overrides: Partial<SimSettlement> = {}): SimSettlement {
  return {
    townHallLevel: 1,
    food: 0,
    wood: 15,
    stone: 0,
    welfare: 100,
    population: 3,
    growthProgress: 0,
    famineProgress: 0,
    buildings: [
      { type: BuildingType.TOWN_HALL, level: 1, workers: 0 },
      { type: BuildingType.FARM, level: 1, workers: 0 },
    ],
    ...overrides,
  };
}

describe("productionPerHour (curvas de balance)", () => {
  it("granja N1: 0/1/2 colonos → 0/2/6 comida/h (rendimiento creciente)", () => {
    expect(productionPerHour(BuildingType.FARM, 1, 0)).toBe(0);
    expect(productionPerHour(BuildingType.FARM, 1, 1)).toBe(2);
    expect(productionPerHour(BuildingType.FARM, 1, 2)).toBe(6);
  });

  it("respeta el tope de puestos por nivel (3er colono en granja N1 no aporta)", () => {
    expect(maxWorkers(BuildingType.FARM, 1)).toBe(2);
    expect(productionPerHour(BuildingType.FARM, 1, 5)).toBe(6); // clamp a 2 puestos
  });

  it("un nivel superior sube la curva y añade un puesto", () => {
    expect(maxWorkers(BuildingType.FARM, 2)).toBe(3);
    // L2: cada marginal x1.6 → 1 col = 3.2, 2 col = 9.6
    expect(productionPerHour(BuildingType.FARM, 2, 1)).toBeCloseTo(3.2, 5);
    expect(productionPerHour(BuildingType.FARM, 2, 2)).toBeCloseTo(9.6, 5);
  });

  it("edificios sin curva (Casa, Ayuntamiento) no producen", () => {
    expect(productionPerHour(BuildingType.HOUSE, 1, 5)).toBe(0);
    expect(productionPerHour(BuildingType.TOWN_HALL, 1, 5)).toBe(0);
  });
});

describe("helpers de capacidad", () => {
  it("storageCap sigue la tabla del almacén", () => {
    expect(storageCap(0)).toBe(60);
    expect(storageCap(2)).toBe(150);
    expect(storageCap(3)).toBe(350);
  });

  it("populationCapacity: base 3, +2 por casa", () => {
    expect(populationCapacity(0)).toBe(3);
    expect(populationCapacity(2)).toBe(7);
  });
});

describe("simulate — tiempo y no-op", () => {
  it("delta cero no cambia nada", () => {
    const s = baseState({ food: 10 });
    const { state, summary } = simulate(s, EPOCH, EPOCH);
    expect(state.food).toBe(10);
    expect(summary.elapsedHours).toBe(0);
  });

  it("reloj hacia atrás no retrocede el estado", () => {
    const s = baseState({ food: 10 });
    const { state, summary } = simulate(s, at(5), at(0));
    expect(state.food).toBe(10);
    expect(summary.elapsedHours).toBe(0);
  });

  it("no muta el estado de entrada", () => {
    const s = baseState({ food: 0 });
    s.buildings[1].workers = 2;
    const inputFoodBefore = s.food;
    simulate(s, EPOCH, at(10));
    expect(s.food).toBe(inputFoodBefore);
  });
});

describe("simulate — producción y consumo", () => {
  it("arranque autosuficiente: 2 colonos en granja → superávit neto +3/h", () => {
    const s = baseState();
    s.buildings[1].workers = 2; // granja
    const { state } = simulate(s, EPOCH, at(1));
    // produce 6, consume 3 → +3
    expect(state.food).toBeCloseTo(3, 5);
    expect(state.welfare).toBe(100); // sin plaga ni hambre, bienestar estable
  });

  it("la comida se consume aunque los colonos estén libres", () => {
    const s = baseState({ food: 10 }); // granja con 0 trabajadores
    const { state } = simulate(s, EPOCH, at(5));
    // 0 producción, 3 colonos comen 3/h durante 5h = 15, pero solo hay 10 → 0 y hambre
    expect(state.food).toBe(0);
  });
});

describe("simulate — tope de almacenamiento", () => {
  it("la producción se desperdicia al llegar al tope del almacén", () => {
    // Población al tope (3, sin casas) → sin crecimiento que ensucie el test.
    const s = baseState({ population: 3 });
    s.buildings[1].workers = 2; // granja: comida +3/h neto
    s.buildings.push({ type: BuildingType.SAWMILL, level: 1, workers: 1 }); // madera +2/h
    // colonos: 2 granja + 1 serrería = 3 = población. 0 libres.
    const { state } = simulate(s, EPOCH, at(100));
    // El diseño (§2) capa la producción ANTES del consumo: cada hora llena a 60
    // y luego los 3 colonos comen 3 → estado estable en 57.
    expect(state.food).toBe(57);
    expect(state.wood).toBe(60); // sin consumo: capado a 60 (arranca en 15)
    expect(state.population).toBe(3); // sin sitio para crecer
    expect(state.welfare).toBe(100);
  });
});

describe("simulate — crecimiento de población", () => {
  it("+1 colono cada 24h si hay sitio, superávit y bienestar alto", () => {
    const s = baseState();
    s.buildings[1].workers = 2; // granja 6/h
    s.buildings.push({ type: BuildingType.HOUSE, level: 1, workers: 0 }); // capacidad → 5
    const { state, summary } = simulate(s, EPOCH, at(100));
    // 3→4 (24h), 4→5 (48h), luego capacidad 5 alcanzada → para.
    expect(state.population).toBe(5);
    expect(summary.colonistsArrived).toBe(2);
  });

  it("sin vivienda libre no crece", () => {
    const s = baseState(); // capacidad 3, población 3
    s.buildings[1].workers = 2;
    const { state, summary } = simulate(s, EPOCH, at(100));
    expect(state.population).toBe(3);
    expect(summary.colonistsArrived).toBe(0);
  });

  it("sin superávit de comida no crece", () => {
    const s = baseState();
    s.buildings[1].workers = 1; // granja 2/h, consumo 3/h → déficit
    s.buildings.push({ type: BuildingType.HOUSE, level: 1, workers: 0 });
    const { summary } = simulate(s, EPOCH, at(100));
    expect(summary.colonistsArrived).toBe(0);
  });
});

describe("simulate — hambruna y pérdida de población (§5)", () => {
  it("sin comida: el bienestar cae y se pierden colonos uno a uno", () => {
    const s = baseState({ food: 0, population: 3 }); // granja sin trabajadores
    const { state, summary, newEvents } = simulate(s, EPOCH, at(60));
    expect(summary.colonistsLost).toBe(3);
    expect(state.population).toBe(0);
    expect(summary.colonistsArrived).toBe(0);
    const famines = newEvents.filter((e) => e.type === EventType.FAMINE);
    expect(famines).toHaveLength(3);
  });

  it("mientras el bienestar está por encima del 70% no se pierde a nadie", () => {
    const s = baseState({ food: 0, population: 3 });
    // A las 3h: bienestar = 100 - 8*3 = 76 (>70) → aún sin pérdidas.
    const { state, summary } = simulate(s, EPOCH, at(3));
    expect(state.welfare).toBeCloseTo(76, 5);
    expect(summary.colonistsLost).toBe(0);
  });

  it("la hambruna también retira a los colonos asignados (no quedan trabajadores fantasma)", () => {
    const s = baseState({ food: 0, population: 3 });
    // Colonos asignados a la serrería (NO produce comida) → siguen pasando hambre.
    s.buildings.push({ type: BuildingType.SAWMILL, level: 1, workers: 2 });
    const { state } = simulate(s, EPOCH, at(60));
    const assigned = state.buildings.reduce((a, b) => a + b.workers, 0);
    expect(assigned).toBeLessThanOrEqual(state.population);
    expect(state.population).toBe(0);
    expect(assigned).toBe(0);
  });
});

describe("simulate — plaga", () => {
  it("una plaga activa drena bienestar aunque haya comida", () => {
    const s = baseState();
    s.buildings[1].workers = 2; // comida cubierta
    const plagues = [{ until: at(10) }];
    const { state, summary } = simulate(s, EPOCH, at(2), plagues);
    // drena 5/h durante 2h → 100 - 10 = 90
    expect(state.welfare).toBeCloseTo(90, 5);
    expect(summary.plagueActive).toBe(true);
  });

  it("sin plaga activa el bienestar no se ve afectado", () => {
    const s = baseState();
    s.buildings[1].workers = 2;
    const { state, summary } = simulate(s, EPOCH, at(2), []);
    expect(state.welfare).toBe(100);
    expect(summary.plagueActive).toBe(false);
  });
});
