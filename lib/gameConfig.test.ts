import { describe, expect, it } from "vitest";
import {
  buildCost,
  constructionSeconds,
  maxWorkers,
  productionPerHour,
  storageCap,
  townHallUpgradeCost,
  upgradeCost,
  TOWN_HALL,
  MAX_TOWN_HALL_LEVEL,
  barracksSlots,
  militaryForce,
  MILITARY,
} from "./gameConfig";
import { BuildingType } from "./generated/prisma/enums";

describe("buildCost", () => {
  it("devuelve el coste de cada edificio construible", () => {
    expect(buildCost(BuildingType.HOUSE)).toEqual({ wood: 8 });
    // La Cantera se construye solo con madera (única fuente de piedra).
    expect(buildCost(BuildingType.QUARRY)).toEqual({ wood: 30 });
  });

  it("el Ayuntamiento no es construible (coste vacío)", () => {
    expect(buildCost(BuildingType.TOWN_HALL)).toEqual({});
  });
});

describe("upgradeCost", () => {
  it("usa los costes explícitos cuando existen", () => {
    expect(upgradeCost(BuildingType.FARM, 2)).toEqual({ wood: 24 });
    expect(upgradeCost(BuildingType.WAREHOUSE, 2)).toEqual({ wood: 30, stone: 10 });
  });

  it("aplica la curva por defecto cuando el nivel no está listado", () => {
    // Granja N3 no listado → base {wood:18} * 1.3*(3-1) = 18*2.6 = 46.8 → ceil 47
    expect(upgradeCost(BuildingType.FARM, 3)).toEqual({ wood: 47 });
  });

  it("escala todos los recursos del coste base en la curva por defecto", () => {
    // House no tiene costes explícitos de mejora: usa la curva por defecto sobre
    // su base {wood:8}. N3 → factor 1.3*(3-1)=2.6 → ceil(8*2.6)=21.
    expect(upgradeCost(BuildingType.HOUSE, 3)).toEqual({ wood: 21 });
  });

  it("la Cantera tiene costes de mejora explícitos con piedra (construir es solo madera)", () => {
    expect(upgradeCost(BuildingType.QUARRY, 2)).toEqual({ wood: 30, stone: 15 });
    expect(upgradeCost(BuildingType.QUARRY, 3)).toEqual({ wood: 60, stone: 35 });
  });
});

describe("townHallUpgradeCost", () => {
  it("coincide con la tabla del Ayuntamiento", () => {
    // La primera mejora (N1→N2) es solo madera: rompe el bloqueo de la piedra.
    expect(townHallUpgradeCost(2)).toEqual({ wood: 55 });
    expect(townHallUpgradeCost(3)).toEqual({ wood: 300, stone: 120 });
  });

  it("nivel inexistente → coste vacío", () => {
    expect(townHallUpgradeCost(99)).toEqual({});
  });

  it("la tabla cubre hasta el nivel máximo", () => {
    expect(TOWN_HALL[MAX_TOWN_HALL_LEVEL]).toBeDefined();
  });
});

describe("storageCap", () => {
  it("niveles más allá de la tabla extrapolan con el último conocido", () => {
    expect(storageCap(99)).toBe(350); // tope del nivel 3
  });
  it("nivel negativo se trata como 0", () => {
    expect(storageCap(-5)).toBe(60);
  });
});

describe("maxWorkers / productionPerHour en niveles altos", () => {
  it("cada nivel añade un puesto", () => {
    expect(maxWorkers(BuildingType.SAWMILL, 1)).toBe(2);
    expect(maxWorkers(BuildingType.SAWMILL, 3)).toBe(4);
  });

  it("los puestos extra usan la última marginal definida, escalada por nivel", () => {
    // Serrería L1 marginales [4,6]; L3: x1.6^2=2.56; 4 puestos: 4,6,6,6 = 22 → *2.56
    const expected = (4 + 6 + 6 + 6) * Math.pow(1.6, 2);
    expect(productionPerHour(BuildingType.SAWMILL, 3, 4)).toBeCloseTo(expected, 5);
  });

  it("colonos por encima del tope no aportan nada extra", () => {
    const atCap = productionPerHour(BuildingType.SAWMILL, 3, 4);
    expect(productionPerHour(BuildingType.SAWMILL, 3, 10)).toBeCloseTo(atCap, 5);
  });

  it("un edificio en construcción (nivel 0) no admite colonos ni produce", () => {
    expect(maxWorkers(BuildingType.FARM, 0)).toBe(0);
    expect(productionPerHour(BuildingType.FARM, 0, 2)).toBe(0);
  });
});

describe("constructionSeconds (tiempo de obra)", () => {
  it("construir (nivel 1) usa el tiempo base del tipo", () => {
    expect(constructionSeconds(BuildingType.HOUSE, 1)).toBe(120);
    expect(constructionSeconds(BuildingType.QUARRY, 1)).toBe(240);
  });

  it("a mayor nivel objetivo, más tiempo", () => {
    const l1 = constructionSeconds(BuildingType.FARM, 1);
    const l2 = constructionSeconds(BuildingType.FARM, 2);
    const l3 = constructionSeconds(BuildingType.FARM, 3);
    expect(l2).toBeGreaterThan(l1);
    expect(l3).toBeGreaterThan(l2);
    // L2 = 180 * 1.8 = 324
    expect(l2).toBe(324);
  });

  it("el Ayuntamiento tiene su propia tabla, más lenta", () => {
    expect(constructionSeconds(BuildingType.TOWN_HALL, 2)).toBe(600);
    expect(constructionSeconds(BuildingType.TOWN_HALL, 3)).toBe(1800);
  });
});

describe("fuerza militar (Bloque 6)", () => {
  it("el Cuartel admite soldados según su nivel (maxWorkers = barracksSlots)", () => {
    expect(barracksSlots(0)).toBe(0); // en obra, sin puestos
    expect(barracksSlots(1)).toBe(3);
    expect(barracksSlots(2)).toBe(5);
    expect(maxWorkers(BuildingType.BARRACKS, 1)).toBe(3);
    expect(maxWorkers(BuildingType.BARRACKS, 2)).toBe(5);
  });

  it("el Cuartel no produce recursos acumulables", () => {
    expect(productionPerHour(BuildingType.BARRACKS, 2, 3)).toBe(0);
  });

  it("un asentamiento sin edificios militares solo tiene fuerza por recursos", () => {
    const force = militaryForce({ buildings: [], food: 20, wood: 20, stone: 10 });
    expect(force).toBe(Math.round(50 * MILITARY.forcePerStoredResource));
  });

  it("los soldados del Cuartel aportan fuerza y escalan con el nivel", () => {
    const l1 = militaryForce({
      buildings: [{ type: BuildingType.BARRACKS, level: 1, workers: 3 }],
      food: 0,
      wood: 0,
      stone: 0,
    });
    expect(l1).toBe(3 * MILITARY.forcePerSoldierL1);
    // A nivel 2, cada soldado rinde x barracksLevelFactor.
    const l2 = militaryForce({
      buildings: [{ type: BuildingType.BARRACKS, level: 2, workers: 3 }],
      food: 0,
      wood: 0,
      stone: 0,
    });
    expect(l2).toBe(Math.round(3 * MILITARY.forcePerSoldierL1 * MILITARY.barracksLevelFactor));
  });

  it("la Muralla aporta fuerza por nivel; los edificios en obra (nivel 0) no cuentan", () => {
    const force = militaryForce({
      buildings: [
        { type: BuildingType.WALL, level: 2, workers: 0 },
        { type: BuildingType.BARRACKS, level: 0, workers: 0 }, // en obra: no cuenta
      ],
      food: 0,
      wood: 0,
      stone: 0,
    });
    expect(force).toBe(2 * MILITARY.forcePerWallLevel);
  });

  it("los soldados se acotan a los puestos disponibles del Cuartel", () => {
    const force = militaryForce({
      buildings: [{ type: BuildingType.BARRACKS, level: 1, workers: 99 }],
      food: 0,
      wood: 0,
      stone: 0,
    });
    expect(force).toBe(3 * MILITARY.forcePerSoldierL1); // clamp a 3 puestos
  });
});
